import { prisma, comLock, LOCK } from '@alvorada/db';
import type { Contexto } from '../contexto.js';
import { salvarPedido } from '../persistencia.js';

/**
 * Sincronizacao continua: fila de webhooks e varredura incremental.
 *
 * Os dois existem juntos de proposito, porque resolvem falhas diferentes:
 *
 *  - webhook: reacao quase imediata, mas o Bling nao garante entrega nem ordem,
 *    e desativa o endpoint depois de falhas repetidas;
 *  - varredura: lenta, porem nao depende de nada ter sido entregue.
 *
 * Confiar so no webhook significa descobrir meses depois que um dia inteiro de
 * pedidos nunca chegou. Confiar so na varredura desperdicia requisicoes e atrasa
 * o painel.
 */

/** Quantos eventos processar por ciclo. */
const LOTE_WEBHOOK = 50;

/** Tentativas antes de desistir de um evento. */
const MAX_TENTATIVAS = 5;

/**
 * Processa a fila de webhooks recebidos.
 *
 * A rota HTTP apenas grava e responde 200 (o Bling exige resposta em menos de 5
 * segundos). O trabalho real acontece aqui, onde podemos gastar o tempo
 * necessario e respeitar o limite de requisicoes.
 */
export async function processarWebhooks(ctx: Contexto): Promise<{
  processados: number;
  erros: number;
  ignorados: number;
}> {
  const resultado = await comLock(LOCK.WEBHOOK_QUEUE, async () => {
    const { empresaId, logger, recursos } = ctx;

    const eventos = await prisma.webhookEvent.findMany({
      where: { status: 'PENDENTE', tentativas: { lt: MAX_TENTATIVAS } },
      orderBy: { recebidoEm: 'asc' },
      take: LOTE_WEBHOOK,
    });

    let processados = 0;
    let erros = 0;
    let ignorados = 0;

    for (const evento of eventos) {
      try {
        const [recurso, acao] = evento.evento.split('.');

        if (recurso !== 'order') {
          // Produtos e estoque tambem geram eventos; por ora so pedidos movem a
          // analise de margem. Marcamos como ignorado em vez de apagar, para
          // ficar visivel que chegaram.
          await prisma.webhookEvent.update({
            where: { id: evento.id },
            data: { status: 'IGNORADO', processadoEm: new Date() },
          });
          ignorados += 1;
          continue;
        }

        const payload = evento.payload as Record<string, unknown> | null;
        const dados = (payload?.data ?? payload) as Record<string, unknown> | null;
        const blingId = dados?.id != null ? String(dados.id) : null;

        if (!blingId) {
          throw new Error('Evento de pedido sem id no payload');
        }

        if (acao === 'deleted') {
          // Pedido removido no Bling: tiramos da analise, mas preservamos o
          // registro. Apagar esconderia a razao de o faturamento do mes ter
          // mudado depois de fechado.
          await prisma.pedido.updateMany({
            where: { empresaId, blingId },
            data: { considerarNaAnalise: false, situacaoNome: 'Excluido no Bling' },
          });
        } else {
          // O payload do webhook e resumido: buscamos o pedido completo para ter
          // itens e valores.
          const detalhe = await recursos.obterPedido(blingId);

          if (detalhe) {
            await salvarPedido(empresaId, detalhe, {
              versaoEvento: evento.dataEvento,
            });
          } else {
            logger.warn(
              { blingId, evento: evento.evento },
              'Pedido do webhook nao encontrado na API',
            );
          }
        }

        await prisma.webhookEvent.update({
          where: { id: evento.id },
          data: { status: 'PROCESSADO', processadoEm: new Date(), erro: null },
        });
        processados += 1;
      } catch (erro) {
        erros += 1;
        const tentativas = evento.tentativas + 1;
        const desistiu = tentativas >= MAX_TENTATIVAS;

        await prisma.webhookEvent.update({
          where: { id: evento.id },
          data: {
            tentativas,
            erro: String(erro).slice(0, 1000),
            status: desistiu ? 'ERRO' : 'PENDENTE',
          },
        });

        ctx.logger.error(
          { eventId: evento.eventId, tentativas, erro: String(erro) },
          desistiu
            ? 'Evento de webhook descartado apos esgotar as tentativas'
            : 'Falha ao processar webhook, sera tentado de novo',
        );
      }
    }

    return { processados, erros, ignorados };
  });

  return resultado ?? { processados: 0, erros: 0, ignorados: 0 };
}

/**
 * Varredura incremental.
 *
 * Filtra por DATA DE ALTERACAO, nao por data de venda. A diferenca importa: um
 * pedido de dois meses atras que foi cancelado hoje precisa sair da analise, e
 * um filtro por data de venda nunca o traria de volta.
 */
export async function sincronizarIncremental(ctx: Contexto): Promise<{
  lidos: number;
  gravados: number;
} | null> {
  return comLock(LOCK.SYNC, async () => {
    const { empresaId, logger, recursos } = ctx;

    const checkpoint = await prisma.syncCheckpoint.findUnique({
      where: { empresaId_entidade: { empresaId, entidade: 'pedidos' } },
    });

    // Sem checkpoint ainda significa que o backfill nao rodou. Nao assumimos uma
    // janela gigante aqui: isso poderia disparar milhares de requisicoes sem
    // aviso. O backfill e explicito.
    if (!checkpoint?.cursorData) {
      logger.warn(
        'Sem checkpoint de pedidos. Rode o backfill primeiro: npm run backfill -w @alvorada/worker',
      );
      return { lidos: 0, gravados: 0 };
    }

    // Uma folga para tras cobre pedidos alterados durante o ciclo anterior.
    const desde = new Date(checkpoint.cursorData.getTime() - 60 * 60 * 1000);
    const agora = new Date();

    let lidos = 0;
    let gravados = 0;

    for await (const resumo of recursos.listarPedidos({
      dataAlteracaoInicial: desde.toISOString().slice(0, 10),
    })) {
      lidos += 1;
      const detalhe = await recursos.obterPedido(resumo.id);
      if (!detalhe) continue;
      await salvarPedido(empresaId, detalhe);
      gravados += 1;
    }

    await prisma.syncCheckpoint.update({
      where: { empresaId_entidade: { empresaId, entidade: 'pedidos' } },
      data: { cursorData: agora, concluidoEm: agora, status: 'OCIOSO' },
    });

    if (gravados > 0) {
      logger.info({ lidos, gravados }, 'Sincronizacao incremental concluida');
    }

    return { lidos, gravados };
  });
}

/**
 * Verifica a saude da autorizacao.
 *
 * O refresh_token vale 30 dias. Se o worker ficar parado alem disso - servidor
 * desligado nas ferias, por exemplo - a integracao morre e exige alguem abrindo
 * a URL de autorizacao no navegador. Avisar com antecedencia e a diferenca entre
 * um clique e uma semana sem dados.
 */
export async function verificarSaudeToken(ctx: Contexto): Promise<void> {
  const dias = await ctx.tokenStore.diasRestantesRefresh();

  if (dias === null) {
    ctx.logger.error('Nenhum token do Bling cadastrado. O sistema nao vai sincronizar.');
    return;
  }

  if (dias < 0) {
    ctx.logger.error(
      { dias },
      'A AUTORIZACAO DO BLING EXPIROU. Acesse /oauth/iniciar e autorize novamente.',
    );
    return;
  }

  if (dias <= 7) {
    ctx.logger.warn(
      { dias },
      'A autorizacao do Bling expira em poucos dias. Mantenha o worker rodando ' +
        'para que ele renove sozinho, ou reautorize manualmente.',
    );
    return;
  }

  ctx.logger.debug({ dias }, 'Autorizacao do Bling saudavel');
}
