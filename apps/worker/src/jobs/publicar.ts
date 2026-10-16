import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client as FtpClient } from 'basic-ftp';
import type { Contexto } from '../contexto.js';
import { gerarAnalise } from '../analise.js';

/**
 * Publica o painel na HostGator.
 *
 * Esta e a peca que resolve o acesso remoto sem expor o servidor: em vez de a
 * internet alcancar a maquina de casa, a maquina de casa envia o resultado para
 * a hospedagem. Tudo aqui e conexao de SAIDA, igual a um navegador - nenhuma
 * porta precisa ser aberta no roteador.
 *
 * O que vai para a HostGator sao apenas os NUMEROS JA CALCULADOS, em JSON. O
 * banco, os pedidos brutos e os tokens do Bling nunca saem do servidor.
 */

const aqui = dirname(fileURLToPath(import.meta.url));

export interface ResultadoPublicacao {
  arquivoLocal: string;
  enviado: boolean;
  tamanhoKb: number;
  canais: number;
  pedidos: number;
  motivoNaoEnvio?: string;
}

export async function publicarPainel(
  ctx: Contexto,
): Promise<ResultadoPublicacao> {
  const { env, logger, empresaId } = ctx;

  logger.info({ meses: env.ANALISE_MESES }, 'Gerando analise');
  const analise = await gerarAnalise(empresaId, { meses: env.ANALISE_MESES });

  // Grava local primeiro. Se o FTP falhar, o resultado nao se perde e da para
  // inspecionar o JSON na mao.
  const pastaSaida = join(aqui, '..', '..', 'saida');
  await mkdir(pastaSaida, { recursive: true });
  const arquivoLocal = join(pastaSaida, 'dados.json');

  const conteudo = JSON.stringify(analise);
  await writeFile(arquivoLocal, conteudo, 'utf8');

  const tamanhoKb = Math.round(Buffer.byteLength(conteudo, 'utf8') / 1024);

  logger.info(
    {
      canais: analise.canais.length,
      pedidos: analise.cobertura.pedidos,
      skus: analise.skuCanal.length,
      tamanhoKb,
    },
    'Analise gerada',
  );

  if (analise.cobertura.itensSemCusto > 0) {
    logger.warn(
      {
        itensSemCusto: analise.cobertura.itensSemCusto,
        percentualComCusto: analise.cobertura.percentualItensComCusto,
      },
      'Parte dos itens nao tem custo cadastrado; a margem desses fica indefinida',
    );
  }

  if (!env.FTP_HOST || !env.FTP_USER || !env.FTP_SENHA) {
    logger.warn(
      'FTP nao configurado no .env; o painel foi gerado apenas localmente',
    );
    return {
      arquivoLocal,
      enviado: false,
      tamanhoKb,
      canais: analise.canais.length,
      pedidos: analise.cobertura.pedidos,
      motivoNaoEnvio: 'FTP_HOST, FTP_USER ou FTP_SENHA ausentes',
    };
  }

  const cliente = new FtpClient(30_000);
  cliente.ftp.verbose = false;

  try {
    await cliente.access({
      host: env.FTP_HOST,
      user: env.FTP_USER,
      password: env.FTP_SENHA,
      secure: env.FTP_SEGURO,
      // A HostGator usa certificado do proprio servidor compartilhado, que
      // frequentemente nao casa com o hostname informado. Mantemos o TLS (a
      // senha e os dados seguem criptografados) sem exigir o casamento do nome.
      secureOptions: { rejectUnauthorized: false },
    });

    await irParaDestino(cliente, env.FTP_DIR, logger);
    await cliente.uploadFrom(arquivoLocal, 'dados.json');

    logger.info(
      { destino: `${env.FTP_HOST}${env.FTP_DIR}/dados.json`, tamanhoKb },
      'Painel publicado',
    );

    return {
      arquivoLocal,
      enviado: true,
      tamanhoKb,
      canais: analise.canais.length,
      pedidos: analise.cobertura.pedidos,
    };
  } finally {
    cliente.close();
  }
}

/**
 * Envia os arquivos estaticos do painel (HTML, CSS, JS).
 *
 * Roda separado da publicacao dos dados porque muda raramente: os dados vao a
 * cada ciclo, a interface so quando o codigo dela muda.
 */
export async function publicarInterface(ctx: Contexto): Promise<number> {
  const { env, logger } = ctx;

  if (!env.FTP_HOST || !env.FTP_USER || !env.FTP_SENHA) {
    logger.warn('FTP nao configurado; interface nao enviada');
    return 0;
  }

  const pastaWeb = join(aqui, '..', '..', '..', '..', 'web');
  const cliente = new FtpClient(30_000);
  cliente.ftp.verbose = false;

  try {
    await cliente.access({
      host: env.FTP_HOST,
      user: env.FTP_USER,
      password: env.FTP_SENHA,
      secure: env.FTP_SEGURO,
      secureOptions: { rejectUnauthorized: false },
    });

    await irParaDestino(cliente, env.FTP_DIR, logger);
    await cliente.uploadFromDir(pastaWeb);

    logger.info({ origem: pastaWeb, destino: env.FTP_DIR }, 'Interface publicada');
    return 1;
  } finally {
    cliente.close();
  }
}

/**
 * Posiciona o cliente FTP na pasta de destino.
 *
 * NUNCA usa ensureDir aqui, e isso e deliberado: contas de FTP do cPanel ficam
 * presas ao proprio diretorio, entao ao entrar o usuario JA esta na pasta
 * certa. Um ensureDir com caminho absoluto CRIA a estrutura de novo dentro
 * dela - foi o que aconteceu em 11/10/2026, gerando
 * public_html/painel/public_html/painel e publicando num lugar que o site nao
 * serve. O site seguiu mostrando a versao antiga, sem nenhum erro aparente.
 *
 * Se a pasta configurada nao existir, ficamos onde a conta abriu.
 */
async function irParaDestino(
  cliente: FtpClient,
  dir: string,
  logger: { info: (o: unknown, m?: string) => void },
): Promise<void> {
  const raiz = await cliente.pwd();

  if (!dir || dir === '/' || dir === raiz) {
    return;
  }

  try {
    await cliente.cd(dir);
  } catch {
    logger.info(
      { dirConfigurado: dir, usando: raiz },
      'Pasta configurada nao existe nesta conta; publicando na raiz dela',
    );
    await cliente.cd(raiz);
  }
}
