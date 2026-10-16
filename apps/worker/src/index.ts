import 'dotenv/config';
import cron from 'node-cron';
import { criarContexto, type Contexto } from './contexto.js';
import {
  processarWebhooks,
  sincronizarIncremental,
  verificarSaudeToken,
} from './jobs/sync.js';

/**
 * Processo residente do worker.
 *
 * Responsabilidades:
 *   - processar a fila de webhooks (frequente, pois e o caminho rapido)
 *   - varredura incremental (rede de seguranca contra evento perdido)
 *   - renovar o token e avisar quando a autorizacao estiver perto de expirar
 *
 * Roda como servico do Windows na mesma maquina do banco. Toda chamada a API do
 * Bling sai deste processo, o que e o que permite respeitar o limite de 3 req/s
 * da conta.
 */

/** Evita que um ciclo comece antes do anterior terminar. */
function semSobreposicao(
  nome: string,
  ctx: Contexto,
  tarefa: () => Promise<void>,
): () => Promise<void> {
  let rodando = false;

  return async () => {
    if (rodando) {
      ctx.logger.debug({ tarefa: nome }, 'Ciclo anterior ainda rodando, pulando');
      return;
    }
    rodando = true;
    try {
      await tarefa();
    } catch (erro) {
      ctx.logger.error({ tarefa: nome, erro: String(erro) }, 'Falha no ciclo');
    } finally {
      rodando = false;
    }
  };
}

async function main(): Promise<void> {
  const ctx = await criarContexto();
  ctx.logger.info(
    {
      empresaId: ctx.empresaId,
      limitePorSegundo: ctx.env.BLING_RATE_LIMIT_PER_SECOND,
      syncCron: ctx.env.SYNC_CRON,
    },
    'Worker iniciado',
  );

  await verificarSaudeToken(ctx);

  // Fila de webhooks: a cada minuto. Barato, pois so consulta o banco quando nao
  // ha nada pendente.
  const tarefaWebhooks = semSobreposicao('webhooks', ctx, async () => {
    const r = await processarWebhooks(ctx);
    if (r.processados > 0 || r.erros > 0) {
      ctx.logger.info(r, 'Fila de webhooks processada');
    }
  });
  cron.schedule('* * * * *', tarefaWebhooks);

  // Varredura incremental.
  const tarefaSync = semSobreposicao('sync', ctx, async () => {
    await sincronizarIncremental(ctx);
  });
  cron.schedule(ctx.env.SYNC_CRON, tarefaSync);

  // Saude do token.
  const tarefaToken = semSobreposicao('token', ctx, async () => {
    await verificarSaudeToken(ctx);
    // Pedir o token forca a renovacao antecipada se estiver perto de vencer, de
    // forma controlada e fora de qualquer rajada de requisicoes.
    await ctx.tokenStore.obter();
  });
  cron.schedule(ctx.env.TOKEN_REFRESH_CRON, tarefaToken);

  // Primeira passada imediata, para nao esperar o primeiro tique do cron.
  await tarefaWebhooks();

  const encerrar = (sinal: string) => {
    ctx.logger.info({ sinal }, 'Encerrando worker');
    process.exit(0);
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

main().catch((erro) => {
  console.error('Worker nao conseguiu iniciar:', erro);
  process.exit(1);
});
