import { z } from 'zod';

/**
 * Leitura e validacao das variaveis de ambiente.
 *
 * Validamos na partida e falhamos alto. A alternativa - descobrir que
 * BLING_CLIENT_SECRET estava vazio somente quando o primeiro webhook chega com
 * assinatura invalida - custa muito mais caro para diagnosticar.
 */

const booleano = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),

  BLING_CLIENT_ID: z.string().min(1, 'BLING_CLIENT_ID e obrigatorio'),
  BLING_CLIENT_SECRET: z
    .string()
    .min(1, 'BLING_CLIENT_SECRET e obrigatorio (assina os webhooks)'),
  BLING_REDIRECT_URI: z
    .string()
    .url('BLING_REDIRECT_URI precisa ser uma URL completa'),
  BLING_RATE_LIMIT_PER_SECOND: z.coerce.number().positive().max(3).default(2.5),

  API_PORT: z.coerce.number().int().positive().default(3333),
  API_HOST: z.string().default('127.0.0.1'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  BACKFILL_MESES: z.coerce.number().int().positive().max(60).default(3),
  SYNC_CRON: z.string().default('*/15 * * * *'),
  TOKEN_REFRESH_CRON: z.string().default('0 */4 * * *'),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_SENHA: z.string().optional(),
  ADMIN_NOME: z.string().default('Administrador'),

  // --- Publicacao do painel na HostGator ---
  // O servidor envia os resultados por FTPS. Sao conexoes de SAIDA, por isso
  // nada precisa ser exposto na rede do servidor.
  FTP_HOST: z.string().optional(),
  FTP_USER: z.string().optional(),
  FTP_SENHA: z.string().optional(),
  /** Pasta de destino no servidor da HostGator. */
  FTP_DIR: z.string().default('/public_html/painel'),
  /**
   * FTPS (TLS) por padrao. So desligue se a hospedagem nao suportar: com FTP
   * puro, a senha trafega em texto claro pela internet.
   */
  FTP_SEGURO: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Periodicidade da publicacao do painel. */
  PUBLICAR_CRON: z.string().default('*/30 * * * *'),
  /** Quantos meses de historico entram na analise publicada. */
  ANALISE_MESES: z.coerce.number().int().positive().max(60).default(12),

  // --- Ponte de autorizacao OAuth ---
  // O Bling exige um redirect HTTPS publico e o servidor nao tem um. A pagina
  // oauth-callback.php na hospedagem recebe o code e o worker o busca aqui.
  /** URL completa do oauth-callback.php publicado na hospedagem. */
  OAUTH_PONTE_URL: z.string().url().optional(),
  /** Segredo compartilhado com o PHP. Precisa ser identico nos dois lados. */
  OAUTH_PONTE_CHAVE: z.string().min(16).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cache: Env | null = null;

/**
 * Devolve o ambiente validado.
 *
 * O limite de requisicoes e travado em no maximo 3 pelo schema, porque e o
 * limite real do Bling: configurar um valor maior nao acelera nada, apenas
 * garante erro 429 e risco de bloqueio de IP.
 */
export function carregarEnv(origem: NodeJS.ProcessEnv = process.env): Env {
  if (cache) return cache;

  const resultado = envSchema.safeParse(origem);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Configuracao invalida no .env:\n${problemas}\n\n` +
        `Copie .env.example para .env e preencha os valores.`,
    );
  }

  cache = resultado.data;
  return cache;
}

/** Limpa o cache. Util em testes. */
export function limparCacheEnv(): void {
  cache = null;
}

export { booleano };
