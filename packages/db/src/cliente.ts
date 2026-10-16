import { PrismaClient, Prisma } from '@prisma/client';

export * from '@prisma/client';
export { Prisma };

/**
 * Cliente Prisma compartilhado.
 *
 * Em desenvolvimento o tsx reinicia o processo a cada alteracao de arquivo, e
 * sem este cache cada reload abriria um novo pool de conexoes ate esgotar o
 * limite do Postgres.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Chaves de advisory lock. Numeros arbitrarios, porem fixos: o Postgres usa o
 * proprio inteiro como identidade do lock.
 */
export const LOCK = {
  /** Refresh do token OAuth do Bling. */
  REFRESH_TOKEN_BLING: 918_371,
  /** Execucao do backfill, para nao rodarem dois ao mesmo tempo. */
  BACKFILL: 918_372,
  /** Ciclo de sincronizacao incremental. */
  SYNC: 918_373,
  /** Processamento da fila de webhooks. */
  WEBHOOK_QUEUE: 918_374,
} as const;

/**
 * Executa `fn` sob um advisory lock do Postgres, garantindo que apenas um
 * processo rode aquele trecho por vez.
 *
 * Isto existe por um motivo concreto: o Bling bane o IP por 60 minutos depois
 * de 20 chamadas a /oauth/token em 60 segundos. Se a API e o worker renovassem
 * o token em paralelo, um unico momento de token expirado geraria uma rajada de
 * refreshes simultaneos e tiraria a integracao do ar por uma hora.
 *
 * Retorna `null` quando o lock ja esta tomado (sem esperar), para que o chamador
 * possa simplesmente desistir do ciclo e tentar no proximo agendamento.
 */
export async function comLock<T>(
  chave: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  // Usamos uma conexao dedicada da transacao para que lock e unlock ocorram na
  // mesma sessao do Postgres - advisory locks sao por sessao, e o pool pode
  // devolver conexoes diferentes entre duas queries soltas.
  return prisma.$transaction(async (tx) => {
    const resultado = await tx.$queryRaw<
      Array<{ obtido: boolean }>
    >`SELECT pg_try_advisory_xact_lock(${chave}::bigint) AS obtido`;

    if (!resultado[0]?.obtido) {
      return null;
    }

    return fn();
  });
}

/** Converte Decimal do Prisma para number. Use somente na borda de saida. */
export function paraNumero(valor: Prisma.Decimal | null | undefined): number {
  if (valor === null || valor === undefined) return 0;
  return Number(valor);
}
