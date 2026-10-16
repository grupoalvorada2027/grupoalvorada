import pino from 'pino';
import { carregarEnv } from '@alvorada/shared';
import { prisma, TokenStore } from '@alvorada/db';
import {
  BlingOAuth,
  BlingClient,
  RateLimiter,
  RecursosBling,
} from '@alvorada/bling';

/**
 * Monta as dependencias do worker.
 *
 * O worker e o UNICO processo que chama a API do Bling. A API HTTP nunca chama,
 * com uma excecao: a troca do authorization_code no callback do OAuth, que por
 * natureza acontece dentro de uma requisicao do navegador.
 *
 * Essa centralizacao nao e preferencia de organizacao, e o que torna o controle
 * de vazao possivel. O limite de 3 req/s vale para a conta inteira, entao um
 * rate limiter so faz sentido se existir um unico ponto de saida. Dois processos
 * com um limiter cada, ambos convencidos de estarem dentro do limite, somam 5
 * req/s e levam bloqueio de IP.
 */

export interface Contexto {
  env: ReturnType<typeof carregarEnv>;
  logger: pino.Logger;
  oauth: BlingOAuth;
  rateLimiter: RateLimiter;
  client: BlingClient;
  recursos: RecursosBling;
  tokenStore: TokenStore;
  empresaId: number;
}

export async function criarContexto(): Promise<Contexto> {
  const env = carregarEnv();

  const logger = pino({
    level: env.LOG_LEVEL,
    base: { app: 'worker' },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });

  const empresa = await prisma.empresa.findFirst({
    where: { ativa: true },
    orderBy: { id: 'asc' },
  });

  if (!empresa) {
    throw new Error(
      'Nenhuma empresa autorizada encontrada. Rode a autorizacao OAuth primeiro: ' +
        'suba a API e acesse /oauth/iniciar no navegador.',
    );
  }

  const oauth = new BlingOAuth({
    clientId: env.BLING_CLIENT_ID,
    clientSecret: env.BLING_CLIENT_SECRET,
    redirectUri: env.BLING_REDIRECT_URI,
  });

  const tokenStore = new TokenStore(empresa.id, oauth, logger);

  const rateLimiter = new RateLimiter({
    porSegundo: env.BLING_RATE_LIMIT_PER_SECOND,
    onAvisoDiario: (consumidas, teto) => {
      logger.warn(
        { consumidas, teto },
        'Mais de 80% do limite diario de requisicoes ao Bling consumido',
      );
    },
  });

  const client = new BlingClient({
    token: tokenStore,
    rateLimiter,
    logger,
  });

  return {
    env,
    logger,
    oauth,
    rateLimiter,
    client,
    recursos: new RecursosBling(client),
    tokenStore,
    empresaId: empresa.id,
  };
}
