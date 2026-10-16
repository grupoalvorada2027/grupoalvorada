import { prisma, comLock, LOCK } from '@alvorada/db';
import type { Contexto } from '../contexto.js';
import { salvarPedido, salvarProduto, salvarCustosEmLote } from '../persistencia.js';

/**
 * Importacao inicial do historico.
 *
 * Custo em requisicoes, que e o recurso escasso aqui (3 req/s, 120.000/dia):
 *
 *   produtos:  1 requisicao por 100 produtos
 *   custos:    1 requisicao por 40 produtos
 *   pedidos:   1 requisicao por 100 pedidos (lista)
 *            + 1 requisicao POR PEDIDO (detalhe, onde estao os itens)
 *
 * O detalhe por pedido domina tudo. Para 1.500 pedidos: ~1.515 requisicoes, algo
 * em torno de 10 minutos a 2,5 req/s. Para 100.000 pedidos seriam ~11 horas e o
 * teto diario entraria em jogo - por isso o checkpoint e obrigatorio e nao um
 * refinamento.
 *
 * ORDEM IMPORTA: produtos e custos primeiro, pedidos depois. O custo unitario e
 * congelado no item no momento em que o pedido e gravado; se os pedidos
 * entrassem antes, todos ficariam sem custo e seria preciso reprocessar.
 */

export interface ResultadoBackfill {
  produtosLidos: number;
  custosGravados: number;
  pedidosLidos: number;
  pedidosGravados: number;
  itensSemCusto: number;
  interrompido: boolean;
}

const formatarData = (data: Date): string => data.toISOString().slice(0, 10);

async function atualizarCheckpoint(
  empresaId: number,
  entidade: string,
  dados: {
    status?: 'OCIOSO' | 'RODANDO' | 'ERRO';
    cursorPagina?: number | null;
    cursorData?: Date | null;
    registrosLidos?: number;
    ultimoErro?: string | null;
    iniciadoEm?: Date;
    concluidoEm?: Date | null;
  },
): Promise<void> {
  await prisma.syncCheckpoint.upsert({
    where: { empresaId_entidade: { empresaId, entidade } },
    create: { empresaId, entidade, ...dados },
    update: dados,
  });
}

async function lerCheckpoint(empresaId: number, entidade: string) {
  return prisma.syncCheckpoint.findUnique({
    where: { empresaId_entidade: { empresaId, entidade } },
  });
}

/**
 * Importa produtos e seus custos.
 *
 * Retomavel: guarda a pagina atual no checkpoint a cada pagina concluida.
 */
export async function backfillProdutos(ctx: Contexto): Promise<{
  produtosLidos: number;
  custosGravados: number;
}> {
  const { empresaId, logger, recursos } = ctx;

  const checkpoint = await lerCheckpoint(empresaId, 'produtos');
  const paginaInicial =
    checkpoint?.status === 'ERRO' && checkpoint.cursorPagina
      ? checkpoint.cursorPagina
      : 1;

  await atualizarCheckpoint(empresaId, 'produtos', {
    status: 'RODANDO',
    iniciadoEm: new Date(),
    ultimoErro: null,
    concluidoEm: null,
  });

  let produtosLidos = 0;
  const idsParaCusto: string[] = [];

  try {
    for await (const produto of recursos.listarProdutos({
      paginaInicial,
      aoVirarPagina: async (pagina, itens) => {
        await atualizarCheckpoint(empresaId, 'produtos', {
          cursorPagina: pagina,
          registrosLidos: produtosLidos,
        });
        logger.info({ pagina, itens, produtosLidos }, 'Produtos: pagina concluida');
      },
    })) {
      await salvarProduto(empresaId, produto);
      produtosLidos += 1;

      // Se o custo nao veio junto com o produto, buscamos depois em lote.
      if (produto.fornecedor?.precoCusto == null) {
        idsParaCusto.push(produto.id);
      }
    }
  } catch (erro) {
    await atualizarCheckpoint(empresaId, 'produtos', {
      status: 'ERRO',
      ultimoErro: String(erro),
      registrosLidos: produtosLidos,
    });
    throw erro;
  }

  logger.info(
    { produtosLidos, semCusto: idsParaCusto.length },
    'Produtos importados, buscando custos em lote',
  );

  let custosGravados = 0;
  if (idsParaCusto.length > 0) {
    const custos = await recursos.obterCustos(idsParaCusto);
    custosGravados = await salvarCustosEmLote(empresaId, custos);
  }

  await atualizarCheckpoint(empresaId, 'produtos', {
    status: 'OCIOSO',
    cursorPagina: null,
    registrosLidos: produtosLidos,
    concluidoEm: new Date(),
  });

  return { produtosLidos, custosGravados };
}

/**
 * Importa os pedidos dos ultimos `meses`.
 */
export async function backfillPedidos(
  ctx: Contexto,
  meses: number,
): Promise<{
  pedidosLidos: number;
  pedidosGravados: number;
  itensSemCusto: number;
}> {
  const { empresaId, logger, recursos } = ctx;

  const dataFinal = new Date();
  const dataInicial = new Date(dataFinal);
  dataInicial.setMonth(dataInicial.getMonth() - meses);

  const checkpoint = await lerCheckpoint(empresaId, 'pedidos');
  const paginaInicial =
    checkpoint?.status === 'ERRO' && checkpoint.cursorPagina
      ? checkpoint.cursorPagina
      : 1;

  if (paginaInicial > 1) {
    logger.warn(
      { paginaInicial },
      'Retomando backfill de pedidos de onde parou',
    );
  }

  await atualizarCheckpoint(empresaId, 'pedidos', {
    status: 'RODANDO',
    iniciadoEm: new Date(),
    ultimoErro: null,
    concluidoEm: null,
  });

  let pedidosLidos = 0;
  let pedidosGravados = 0;
  let itensSemCusto = 0;

  try {
    for await (const resumo of recursos.listarPedidos(
      {
        dataInicial: formatarData(dataInicial),
        dataFinal: formatarData(dataFinal),
      },
      {
        paginaInicial,
        aoVirarPagina: async (pagina, itens) => {
          await atualizarCheckpoint(empresaId, 'pedidos', {
            cursorPagina: pagina,
            registrosLidos: pedidosLidos,
          });
          logger.info(
            { pagina, itens, pedidosLidos, pedidosGravados },
            'Pedidos: pagina concluida',
          );
        },
      },
    )) {
      pedidosLidos += 1;

      // A listagem nao traz itens nem valores detalhados: e preciso buscar o
      // pedido completo. E aqui que o tempo do backfill e gasto.
      const detalhe = await recursos.obterPedido(resumo.id);
      if (!detalhe) {
        logger.warn({ blingId: resumo.id }, 'Pedido desapareceu entre a lista e o detalhe');
        continue;
      }

      const resultado = await salvarPedido(empresaId, detalhe);
      pedidosGravados += 1;
      itensSemCusto += resultado.itensSemCusto;

      if (pedidosGravados % 50 === 0) {
        const stats = ctx.rateLimiter.estatisticas;
        logger.info(
          {
            pedidosGravados,
            requisicoesHoje: stats.consumidasHoje,
            tetoDiario: stats.tetoDiario,
          },
          'Progresso do backfill',
        );
      }
    }
  } catch (erro) {
    await atualizarCheckpoint(empresaId, 'pedidos', {
      status: 'ERRO',
      ultimoErro: String(erro),
      registrosLidos: pedidosLidos,
    });
    throw erro;
  }

  await atualizarCheckpoint(empresaId, 'pedidos', {
    status: 'OCIOSO',
    cursorPagina: null,
    cursorData: dataFinal,
    registrosLidos: pedidosLidos,
    concluidoEm: new Date(),
  });

  return { pedidosLidos, pedidosGravados, itensSemCusto };
}

/**
 * Backfill completo. Protegido por lock para que duas execucoes simultaneas nao
 * dupliquem o consumo do limite diario de requisicoes.
 */
export async function executarBackfill(
  ctx: Contexto,
  meses?: number,
): Promise<ResultadoBackfill | null> {
  const janela = meses ?? ctx.env.BACKFILL_MESES;

  return comLock(LOCK.BACKFILL, async () => {
    ctx.logger.info({ meses: janela }, 'Iniciando backfill');
    const inicio = Date.now();

    const produtos = await backfillProdutos(ctx);
    const pedidos = await backfillPedidos(ctx, janela);

    const duracaoMin = ((Date.now() - inicio) / 60_000).toFixed(1);
    const stats = ctx.rateLimiter.estatisticas;

    ctx.logger.info(
      {
        ...produtos,
        ...pedidos,
        duracaoMin,
        requisicoesConsumidas: stats.consumidasHoje,
      },
      'Backfill concluido',
    );

    if (pedidos.itensSemCusto > 0) {
      ctx.logger.warn(
        { itensSemCusto: pedidos.itensSemCusto },
        'Ha itens sem custo cadastrado. A margem desses itens fica indefinida ' +
          'de proposito, para nao gerar lucro falso. Cadastre o custo no Bling ' +
          'e rode o recalculo.',
      );
    }

    return {
      produtosLidos: produtos.produtosLidos,
      custosGravados: produtos.custosGravados,
      pedidosLidos: pedidos.pedidosLidos,
      pedidosGravados: pedidos.pedidosGravados,
      itensSemCusto: pedidos.itensSemCusto,
      interrompido: false,
    };
  });
}
