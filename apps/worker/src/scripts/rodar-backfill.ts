import 'dotenv/config';
import { criarContexto } from '../contexto.js';
import { executarBackfill } from '../jobs/backfill.js';

/**
 * Executa a importacao inicial do historico.
 *
 * Pode ser interrompido com Ctrl+C e retomado: o progresso fica no checkpoint,
 * o que importa quando o limite e 3 req/s e uma importacao grande leva horas.
 *
 * Uso:
 *   npm run backfill -w @alvorada/worker          # usa BACKFILL_MESES do .env
 *   npm run backfill -w @alvorada/worker -- 6     # 6 meses
 */
async function main(): Promise<void> {
  const ctx = await criarContexto();

  const mesesArg = process.argv[2];
  const meses = mesesArg ? Number(mesesArg) : undefined;

  if (mesesArg && (!Number.isFinite(meses) || (meses ?? 0) <= 0)) {
    console.error(`Valor invalido para meses: ${mesesArg}`);
    process.exit(1);
  }

  const resultado = await executarBackfill(ctx, meses);

  if (resultado === null) {
    ctx.logger.warn(
      'Ja existe um backfill em andamento em outro processo. Nada a fazer.',
    );
    process.exit(0);
  }

  ctx.logger.info(resultado, 'Backfill finalizado');
  process.exit(0);
}

main().catch((erro) => {
  console.error('Backfill falhou:', erro);
  process.exit(1);
});
