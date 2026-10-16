import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { BlingOAuth, BlingClient, RateLimiter } from '@alvorada/bling';
import { prisma, salvarTokenInicial } from '@alvorada/db';
import type { Env } from '@alvorada/shared';

/**
 * Fluxo de autorizacao do Bling.
 *
 * E o unico lugar da API que fala com o Bling. O Bling so implementa o grant
 * `authorization_code`, entao a primeira autorizacao e sempre manual: alguem
 * abre /oauth/iniciar no navegador e aprova. Depois disso o worker se sustenta
 * com o refresh_token.
 *
 * Esta rota precisa ficar protegida atras de login antes de ir para producao, ou
 * qualquer pessoa com a URL poderia iniciar uma reautorizacao. Como a autorizacao
 * em si exige credenciais do Bling, o risco e baixo, mas nao e zero.
 */

/**
 * States pendentes do OAuth.
 *
 * Em memoria de proposito: o fluxo dura menos de um minuto e e manual. A
 * consequencia e que reiniciar a API no meio da autorizacao invalida o state e
 * exige comecar de novo - aceitavel para algo que acontece uma vez por mes no
 * pior caso.
 */
const statesPendentes = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function limparStatesExpirados(): void {
  const agora = Date.now();
  for (const [state, criadoEm] of statesPendentes) {
    if (agora - criadoEm > STATE_TTL_MS) statesPendentes.delete(state);
  }
}

export async function rotasOAuth(
  app: FastifyInstance,
  opcoes: { env: Env },
): Promise<void> {
  const { env } = opcoes;

  const oauth = new BlingOAuth({
    clientId: env.BLING_CLIENT_ID,
    clientSecret: env.BLING_CLIENT_SECRET,
    redirectUri: env.BLING_REDIRECT_URI,
  });

  /** Inicia a autorizacao, redirecionando para o Bling. */
  app.get('/oauth/iniciar', async (request, reply) => {
    limparStatesExpirados();

    const state = randomBytes(24).toString('base64url');
    statesPendentes.set(state, Date.now());

    const url = oauth.gerarUrlAutorizacao(state);
    request.log.info({ redirectUri: env.BLING_REDIRECT_URI }, 'Iniciando autorizacao do Bling');

    return reply.redirect(url);
  });

  /**
   * Callback da autorizacao.
   *
   * O authorization_code expira em 1 MINUTO, por isso a troca e a primeira coisa
   * feita aqui, antes de qualquer outra consulta.
   */
  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>('/oauth/callback', async (request, reply) => {
    const { code, state, error } = request.query;

    if (error) {
      return reply.status(400).send({
        erro: 'Autorizacao recusada no Bling',
        detalhe: error,
      });
    }

    if (!code || !state) {
      return reply
        .status(400)
        .send({ erro: 'Callback sem code ou state' });
    }

    // Conferencia do state: e o que impede CSRF neste fluxo.
    if (!statesPendentes.has(state)) {
      return reply.status(400).send({
        erro: 'State invalido ou expirado',
        detalhe:
          'Inicie a autorizacao novamente em /oauth/iniciar. Se a API reiniciou ' +
          'durante o processo, isso e esperado.',
      });
    }
    statesPendentes.delete(state);

    try {
      const token = await oauth.trocarCodigo(code);

      // Precisamos de um identificador da empresa. A resposta do token nao traz,
      // entao tentamos descobrir pela API. Se nao der, usamos um identificador
      // fixo: o sistema opera uma empresa, e o companyId real sera corrigido
      // quando o primeiro webhook chegar trazendo esse campo.
      const blingCompanyId = await descobrirCompanyId(token.accessToken, request.log);

      const empresaId = await salvarTokenInicial({
        blingCompanyId: blingCompanyId.id,
        nomeEmpresa: blingCompanyId.nome,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenType: token.tokenType,
        scope: token.scope,
        expiraEm: token.expiraEm,
        refreshExpiraEm: token.refreshExpiraEm,
      });

      request.log.info(
        { empresaId, expiraEm: token.expiraEm, refreshExpiraEm: token.refreshExpiraEm },
        'Autorizacao do Bling concluida',
      );

      return reply.type('text/html').send(`
        <!doctype html>
        <html lang="pt-BR">
          <head><meta charset="utf-8"><title>Bling autorizado</title></head>
          <body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto; line-height: 1.6">
            <h1>Bling autorizado</h1>
            <p>A integracao esta ativa. O token de renovacao vale ate
            <strong>${token.refreshExpiraEm.toLocaleDateString('pt-BR')}</strong>
            e o worker vai renova-lo sozinho enquanto estiver rodando.</p>
            <p>Proximo passo: rodar a importacao inicial com
            <code>npm run backfill -w @alvorada/worker</code>.</p>
          </body>
        </html>
      `);
    } catch (erro) {
      request.log.error({ erro: String(erro) }, 'Falha ao concluir autorizacao');
      return reply.status(500).send({
        erro: 'Falha ao trocar o codigo por token',
        detalhe: String(erro),
        dica:
          'O authorization_code expira em 1 minuto. Se demorou, tente de novo. ' +
          'Confira tambem se BLING_REDIRECT_URI e identica a URL cadastrada no app Bling.',
      });
    }
  });

  /** Situacao atual da autorizacao. Util para monitoramento. */
  app.get('/oauth/situacao', async () => {
    const token = await prisma.oAuthToken.findFirst({
      include: { empresa: { select: { nome: true, blingId: true } } },
      orderBy: { empresaId: 'asc' },
    });

    if (!token) {
      return {
        autorizado: false,
        mensagem: 'Nenhuma autorizacao encontrada. Acesse /oauth/iniciar.',
      };
    }

    const agora = Date.now();
    const diasRestantes = Math.floor(
      (token.refreshExpiraEm.getTime() - agora) / 86_400_000,
    );

    return {
      autorizado: diasRestantes >= 0,
      empresa: token.empresa.nome,
      accessTokenExpiraEm: token.expiraEm,
      refreshTokenExpiraEm: token.refreshExpiraEm,
      diasRestantes,
      ultimoRefreshEm: token.ultimoRefreshEm,
      alerta:
        diasRestantes < 0
          ? 'EXPIRADO: reautorize em /oauth/iniciar'
          : diasRestantes <= 7
            ? 'Expira em poucos dias'
            : null,
    };
  });
}

/**
 * Tenta descobrir a identificacao da empresa autorizada.
 *
 * O endpoint exato nao esta documentado em texto na SPA do Bling, entao tentamos
 * e seguimos sem ele em caso de falha: um identificador provisorio nao impede
 * nada de funcionar, porque o sistema opera uma empresa. Preferimos isso a travar
 * a autorizacao por um dado acessorio.
 */
async function descobrirCompanyId(
  accessToken: string,
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<{ id: string; nome?: string }> {
  try {
    const client = new BlingClient({
      token: { obter: async () => accessToken, invalidar: async () => {} },
      rateLimiter: new RateLimiter({ porSegundo: 2 }),
    });

    const resposta = (await client.bruto('/empresas/me', {
      nuloSeAusente: true,
    })) as { data?: { id?: unknown; nome?: unknown; razaoSocial?: unknown } } | null;

    const dados = resposta?.data;
    if (dados?.id != null) {
      const nome =
        typeof dados.nome === 'string'
          ? dados.nome
          : typeof dados.razaoSocial === 'string'
            ? dados.razaoSocial
            : undefined;
      return { id: String(dados.id), nome };
    }
  } catch (erro) {
    log.warn(
      { erro: String(erro) },
      'Nao foi possivel identificar a empresa pela API, usando identificador provisorio',
    );
  }

  return { id: 'principal', nome: 'Empresa principal' };
}
