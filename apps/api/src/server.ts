import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { carregarEnv } from '@alvorada/shared';
import { prisma } from '@alvorada/db';
import { rotasOAuth } from './routes/oauth.js';
import { rotasWebhook } from './routes/webhooks.js';

/**
 * API HTTP.
 *
 * Roda no servidor Windows, atras do Cloudflare Tunnel. Nao escuta em 0.0.0.0 por
 * padrao: o tunnel conversa com 127.0.0.1, e deixar a porta aberta na rede local
 * seria superficie de ataque sem necessidade.
 *
 * Esta API NAO chama a API do Bling, com a unica excecao do fluxo OAuth. Todo o
 * resto do trafego com o Bling sai do worker, porque o limite de 3 req/s vale
 * para a conta inteira e precisa de um ponto unico de saida.
 */

export async function criarServidor() {
  const env = carregarEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    // O Cloudflare Tunnel e um proxy: sem isto, request.ip seria sempre o do
    // tunnel e o rate limit por IP agruparia todo mundo no mesmo balde.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  /**
   * Preserva o corpo cru das requisicoes JSON.
   *
   * Obrigatorio para validar a assinatura HMAC dos webhooks do Bling: o hash e
   * calculado sobre os bytes exatos que chegaram. Reserializar o objeto
   * (JSON.stringify) muda espacos e ordem de chaves e invalida a conferencia,
   * fazendo todo webhook legitimo ser recusado.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, corpo, done) => {
      const texto = typeof corpo === 'string' ? corpo : corpo.toString('utf8');
      (request as { rawBody?: string }).rawBody = texto;

      if (texto.length === 0) {
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(texto));
      } catch (erro) {
        done(erro as Error, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  /**
   * Limite de requisicoes por IP.
   *
   * A rota de webhook fica de fora: o Bling pode entregar uma rajada de eventos
   * legitimos, e limitar isso faria o Bling considerar as entregas como falha e,
   * depois de algumas tentativas, desativar o webhook.
   */
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (request) => request.url.startsWith('/webhooks/'),
  });

  app.get('/saude', async () => {
    const inicio = Date.now();
    let banco = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (erro) {
      banco = `falha: ${String(erro).slice(0, 200)}`;
    }

    return {
      status: banco === 'ok' ? 'ok' : 'degradado',
      banco,
      latenciaBancoMs: Date.now() - inicio,
      ambiente: env.NODE_ENV,
      horario: new Date().toISOString(),
    };
  });

  await app.register(rotasOAuth, { env });
  await app.register(rotasWebhook, { env });

  return { app, env };
}

async function main(): Promise<void> {
  const { app, env } = await criarServidor();

  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(
      {
        porta: env.API_PORT,
        host: env.API_HOST,
        redirectUri: env.BLING_REDIRECT_URI,
      },
      'API iniciada',
    );
  } catch (erro) {
    app.log.error(erro, 'Falha ao iniciar a API');
    process.exit(1);
  }

  const encerrar = async (sinal: string) => {
    app.log.info({ sinal }, 'Encerrando API');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void encerrar('SIGINT'));
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
}

// Só sobe o servidor quando executado diretamente, para que testes possam
// importar criarServidor sem abrir porta.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  void main();
}
