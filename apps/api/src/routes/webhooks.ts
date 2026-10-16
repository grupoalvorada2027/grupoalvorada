import type { FastifyInstance } from 'fastify';
import { validarAssinaturaWebhook } from '@alvorada/bling';
import { prisma, Prisma } from '@alvorada/db';
import type { Env } from '@alvorada/shared';

/**
 * Receptor de webhooks do Bling.
 *
 * As regras do Bling que moldam esta rota:
 *
 *  1. RESPOSTA EM MENOS DE 5 SEGUNDOS, senao conta como falha. Depois de falhas
 *     repetidas o Bling DESATIVA o webhook sozinho, e ninguem e avisado. Por isso
 *     a rota nao processa nada: valida a assinatura, grava na fila e responde
 *     200. O worker faz o trabalho.
 *
 *  2. ENTREGA PODE REPETIR. O mesmo evento chega mais de uma vez, entao a
 *     gravacao e idempotente pelo `eventId`.
 *
 *  3. ORDEM NAO E GARANTIDA. Um evento antigo pode chegar depois de um novo, e
 *     quem resolve isso e a comparacao de `versaoEvento` na hora de aplicar (ver
 *     salvarPedido no worker).
 *
 *  4. ASSINATURA HMAC SHA-256 no header `X-Bling-Signature-256`, calculada sobre
 *     o corpo CRU com o client_secret. Precisa ser o corpo cru: reserializar o
 *     JSON muda bytes e invalida a conferencia.
 */

interface CorpoWebhook {
  eventId?: string;
  event?: string;
  companyId?: string | number;
  version?: string;
  date?: string;
  data?: unknown;
}

export async function rotasWebhook(
  app: FastifyInstance,
  opcoes: { env: Env },
): Promise<void> {
  const { env } = opcoes;

  app.post('/webhooks/bling', async (request, reply) => {
    // `rawBody` e preenchido pelo content type parser em server.ts.
    const corpoCru = (request as { rawBody?: string }).rawBody;

    if (!corpoCru) {
      request.log.error('Webhook sem corpo cru disponivel para validar a assinatura');
      return reply.status(400).send({ erro: 'Corpo ausente' });
    }

    const assinatura = request.headers['x-bling-signature-256'];
    const valida = await validarAssinaturaWebhook(
      corpoCru,
      typeof assinatura === 'string' ? assinatura : undefined,
      env.BLING_CLIENT_SECRET,
    );

    if (!valida) {
      // Nao damos detalhe do motivo: um atacante nao precisa saber se errou o
      // formato ou a chave.
      request.log.warn(
        { ip: request.ip, temAssinatura: Boolean(assinatura) },
        'Webhook com assinatura invalida recusado',
      );
      return reply.status(401).send({ erro: 'Assinatura invalida' });
    }

    const corpo = request.body as CorpoWebhook;
    const eventId = corpo.eventId;

    if (!eventId || !corpo.event) {
      return reply.status(400).send({ erro: 'Payload sem eventId ou event' });
    }

    try {
      await prisma.webhookEvent.create({
        data: {
          eventId,
          evento: corpo.event,
          companyId: corpo.companyId != null ? String(corpo.companyId) : null,
          versao: corpo.version ?? null,
          dataEvento: corpo.date ? new Date(corpo.date) : null,
          payload: (corpo as unknown as Prisma.InputJsonValue) ?? {},
        },
      });

      request.log.info({ eventId, evento: corpo.event }, 'Webhook recebido');
    } catch (erro) {
      // P2002 = violacao de unicidade, ou seja, evento repetido. Isso e normal e
      // esperado: respondemos 200 para o Bling parar de reenviar.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        request.log.debug({ eventId }, 'Webhook duplicado ignorado');
        return reply.status(200).send({ recebido: true, duplicado: true });
      }

      // Qualquer outra falha: respondemos 500 de proposito, para o Bling reenviar.
      request.log.error({ eventId, erro: String(erro) }, 'Falha ao enfileirar webhook');
      return reply.status(500).send({ erro: 'Falha ao registrar evento' });
    }

    return reply.status(200).send({ recebido: true });
  });

  /** Diagnostico da fila. Ajuda a perceber webhook desativado pelo Bling. */
  app.get('/webhooks/situacao', async () => {
    const [pendentes, erros, ultimo] = await Promise.all([
      prisma.webhookEvent.count({ where: { status: 'PENDENTE' } }),
      prisma.webhookEvent.count({ where: { status: 'ERRO' } }),
      prisma.webhookEvent.findFirst({
        orderBy: { recebidoEm: 'desc' },
        select: { recebidoEm: true, evento: true },
      }),
    ]);

    const horasSemEvento = ultimo
      ? (Date.now() - ultimo.recebidoEm.getTime()) / 3_600_000
      : null;

    return {
      pendentes,
      comErro: erros,
      ultimoEvento: ultimo?.recebidoEm ?? null,
      ultimoTipo: ultimo?.evento ?? null,
      alerta:
        horasSemEvento !== null && horasSemEvento > 24
          ? 'Mais de 24h sem receber webhook. Verifique se o Bling nao desativou o endpoint.'
          : ultimo === null
            ? 'Nenhum webhook recebido ainda. Confirme o cadastro da URL no app Bling.'
            : null,
    };
  });
}
