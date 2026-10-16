import 'dotenv/config';
import { criarContexto } from '../contexto.js';
import { publicarPainel, publicarInterface } from '../jobs/publicar.js';

/**
 * Gera a analise e publica o painel na hospedagem.
 *
 * Uso:
 *   npm run publicar -w @alvorada/worker            # so os dados
 *   npm run publicar -w @alvorada/worker -- --tudo  # dados + HTML/CSS/JS
 *
 * O `--tudo` so e necessario quando a interface mudou; no dia a dia o worker
 * republica apenas o dados.json, que e pequeno.
 */
async function main(): Promise<void> {
  const ctx = await criarContexto();
  const enviarInterface = process.argv.includes('--tudo');

  if (enviarInterface) {
    ctx.logger.info('Enviando arquivos da interface');
    await publicarInterface(ctx);
  }

  const resultado = await publicarPainel(ctx);

  if (!resultado.enviado) {
    ctx.logger.warn(
      { motivo: resultado.motivoNaoEnvio, arquivo: resultado.arquivoLocal },
      'Analise gerada, mas NAO publicada',
    );
    console.log(
      `\nO arquivo foi gravado em:\n  ${resultado.arquivoLocal}\n` +
        `Configure FTP_HOST, FTP_USER e FTP_SENHA no .env para publicar automaticamente.\n`,
    );
    process.exit(0);
  }

  ctx.logger.info(resultado, 'Publicacao concluida');
  process.exit(0);
}

main().catch((erro) => {
  console.error('Falha ao publicar:', erro);
  process.exit(1);
});
