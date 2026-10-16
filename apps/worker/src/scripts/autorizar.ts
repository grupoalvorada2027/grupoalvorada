import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { carregarEnv } from '@alvorada/shared';
import { prisma, salvarTokenInicial } from '@alvorada/db';
import { BlingOAuth } from '@alvorada/bling';

/**
 * Autorizacao inicial do Bling, sem precisar expor o servidor.
 *
 * O problema: o Bling so implementa o grant `authorization_code`, que exige um
 * redirect HTTPS publico. O servidor fica atras de um roteador doméstico, sem
 * porta aberta.
 *
 * A solucao: o redirect aponta para `oauth-callback.php`, hospedado na
 * HostGator. Ele guarda o `code` por alguns segundos e este script o busca,
 * fazendo a troca pelo token aqui, onde o client_secret vive. O segredo nunca
 * sai do servidor.
 *
 * O prazo e apertado de proposito pelo Bling: o `code` expira em 1 MINUTO. Por
 * isso o script fica em espera ativa, pegando o codigo em segundos, em vez de
 * depender de alguem copiar e colar a tempo.
 *
 * Uso: npm run autorizar -w @alvorada/worker
 */

const INTERVALO_MS = 2000;
const TENTATIVAS_MAX = 150; // ~5 minutos de espera

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const env = carregarEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    transport: { target: 'pino-pretty', options: { colorize: true } },
  });

  if (!env.OAUTH_PONTE_URL || !env.OAUTH_PONTE_CHAVE) {
    console.error(
      '\nFaltam OAUTH_PONTE_URL e OAUTH_PONTE_CHAVE no .env.\n\n' +
        '  OAUTH_PONTE_URL   = a URL do oauth-callback.php publicado na hospedagem\n' +
        '  OAUTH_PONTE_CHAVE = o mesmo valor que esta na constante PONTE_CHAVE do PHP\n',
    );
    process.exit(1);
  }

  const oauth = new BlingOAuth({
    clientId: env.BLING_CLIENT_ID,
    clientSecret: env.BLING_CLIENT_SECRET,
    redirectUri: env.BLING_REDIRECT_URI,
  });

  const state = randomBytes(24).toString('base64url');
  const url = oauth.gerarUrlAutorizacao(state);

  // Confere o redirect ANTES de ficar esperando.
  //
  // O Bling compara a URL caractere por caractere com a cadastrada no
  // aplicativo e, quando nao bate, redireciona para uma pagina de erro - o
  // usuario nunca chega a ver a tela de autorizacao. Sem esta checagem, o
  // script esperaria cinco minutos por um codigo que jamais vem, sem dizer o
  // motivo.
  try {
    const teste = await fetch(url, { redirect: 'manual' });
    const destino = teste.headers.get('location') ?? '';

    if (destino.includes('redirect_uri_mismatch')) {
      console.error(
        '\n' + '='.repeat(70) +
        '\nO BLING RECUSOU O ENDERECO DE REDIRECIONAMENTO' +
        '\n' + '='.repeat(70) +
        `\n\nO sistema esta enviando:\n  ${env.BLING_REDIRECT_URI}\n\n` +
        'Esse valor precisa ser IDENTICO ao campo "Link de redirecionamento"\n' +
        'do aplicativo no Bling (Central de Extensoes > Area do Integrador).\n\n' +
        'Confira: barra no final, http vs https, e subpastas a mais.\n',
      );
      process.exit(1);
    }

    if (destino.includes('error')) {
      console.error(`\nO Bling recusou a solicitacao: ${destino}\n`);
      process.exit(1);
    }
  } catch (erro) {
    console.log(`Aviso: nao foi possivel pre-validar o redirect (${String(erro)}).`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('ABRA ESTE ENDERECO NO NAVEGADOR E AUTORIZE O APLICATIVO:');
  console.log('='.repeat(70));
  console.log('\n' + url + '\n');
  console.log('='.repeat(70));
  console.log('Aguardando a autorizacao...\n');

  const urlBusca = `${env.OAUTH_PONTE_URL}?buscar=${encodeURIComponent(env.OAUTH_PONTE_CHAVE)}`;

  let code: string | null = null;
  let stateRecebido: string | null = null;

  for (let i = 0; i < TENTATIVAS_MAX; i += 1) {
    try {
      const resposta = await fetch(urlBusca, { headers: { Accept: 'application/json' } });

      if (resposta.status === 403) {
        console.error(
          '\nA ponte recusou a chave. OAUTH_PONTE_CHAVE do .env precisa ser igual ' +
            'a constante PONTE_CHAVE dentro de oauth-callback.php.',
        );
        process.exit(1);
      }

      if (resposta.ok) {
        const corpo = (await resposta.json()) as {
          code?: string;
          state?: string;
          pendente?: boolean;
        };
        if (corpo.code) {
          code = corpo.code;
          stateRecebido = corpo.state ?? null;
          break;
        }
      }
    } catch (erro) {
      // Oscilacao de rede nao deve derrubar a espera.
      if (i % 15 === 0) {
        logger.debug({ erro: String(erro) }, 'Falha ao consultar a ponte');
      }
    }

    if (i > 0 && i % 15 === 0) {
      console.log(`  ... ainda aguardando (${Math.round((i * INTERVALO_MS) / 1000)}s)`);
    }
    await dormir(INTERVALO_MS);
  }

  if (!code) {
    console.error(
      '\nTempo esgotado sem receber a autorizacao.\n\n' +
        'Verifique:\n' +
        '  - o oauth-callback.php esta publicado e acessivel pela URL configurada\n' +
        '  - o Link de redirecionamento no app Bling e exatamente igual a BLING_REDIRECT_URI\n' +
        '  - a pasta na hospedagem tem permissao de escrita\n',
    );
    process.exit(1);
  }

  // Conferencia do state: e o que impede que um code de outra origem seja aceito.
  if (stateRecebido && stateRecebido !== state) {
    console.error('\nO state recebido nao confere com o enviado. Autorizacao abortada.');
    process.exit(1);
  }

  console.log('Codigo recebido. Trocando pelo token...\n');

  const token = await oauth.trocarCodigo(code);

  const empresaId = await salvarTokenInicial({
    blingCompanyId: 'principal',
    nomeEmpresa: 'Grupo Alvorada',
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    tokenType: token.tokenType,
    scope: token.scope,
    expiraEm: token.expiraEm,
    refreshExpiraEm: token.refreshExpiraEm,
  });

  console.log('='.repeat(70));
  console.log('AUTORIZADO COM SUCESSO');
  console.log('='.repeat(70));
  console.log(`  empresa no banco....: ${empresaId}`);
  console.log(`  access_token expira.: ${token.expiraEm.toLocaleString('pt-BR')}`);
  console.log(`  refresh_token expira: ${token.refreshExpiraEm.toLocaleString('pt-BR')}`);
  console.log(`  escopos.............: ${token.scope ?? '(nao informados)'}`);
  console.log('\nProximo passo: npm run backfill -w @alvorada/worker\n');

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (erro) => {
  console.error('\nFalha na autorizacao:', erro);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
