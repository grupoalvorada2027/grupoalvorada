import { z } from 'zod';
import { RateLimiter } from './rate-limiter.js';

export const URL_BASE_PADRAO = 'https://api.bling.com.br/Api/v3';

/** Maximo de registros por pagina aceito pelo Bling. */
export const LIMITE_PAGINA = 100;

export class BlingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly corpo?: unknown,
    readonly caminho?: string,
  ) {
    super(message);
    this.name = 'BlingApiError';
  }

  get naoEncontrado(): boolean {
    return this.status === 404;
  }

  get naoAutorizado(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface ProvedorToken {
  /** Devolve um access_token valido, renovando se necessario. */
  obter(): Promise<string>;
  /** Forca renovacao apos um 401. Deve ser protegido por lock. */
  invalidar(): Promise<void>;
}

export interface OpcoesBlingClient {
  token: ProvedorToken;
  rateLimiter: RateLimiter;
  urlBase?: string;
  /** Tentativas totais por requisicao, incluindo a primeira. Padrao 4. */
  maxTentativas?: number;
  logger?: {
    debug: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

interface OpcoesRequisicao {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | undefined>;
  corpo?: unknown;
  /** Quando true, um 404 devolve null em vez de lancar excecao. */
  nuloSeAusente?: boolean;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BlingClient {
  private readonly urlBase: string;
  private readonly maxTentativas: number;

  constructor(private readonly opcoes: OpcoesBlingClient) {
    this.urlBase = opcoes.urlBase ?? URL_BASE_PADRAO;
    this.maxTentativas = opcoes.maxTentativas ?? 4;
  }

  get rateLimiter(): RateLimiter {
    return this.opcoes.rateLimiter;
  }

  /**
   * Executa uma requisicao e valida a resposta contra um schema Zod.
   *
   * Validar a resposta nao e burocracia: a API do Bling evolui (ha changelog de
   * payload) e um campo que muda de tipo silenciosamente viraria NaN no calculo
   * de margem. E melhor falhar alto na borda do que gravar numero errado.
   */
  async requisitar<S extends z.ZodTypeAny>(
    caminho: string,
    schema: S,
    opcoes: OpcoesRequisicao = {},
  ): Promise<z.infer<S> | null> {
    const resposta = await this.bruto(caminho, opcoes);

    if (resposta === null) return null;

    const parsed = schema.safeParse(resposta);
    if (!parsed.success) {
      throw new BlingApiError(
        `Resposta do Bling em formato inesperado em ${caminho}: ${parsed.error.message}`,
        200,
        resposta,
        caminho,
      );
    }
    return parsed.data;
  }

  /** Requisicao sem validacao de schema. Util para inspecionar payloads novos. */
  async bruto(
    caminho: string,
    opcoes: OpcoesRequisicao = {},
  ): Promise<unknown | null> {
    const { metodo = 'GET', query, corpo, nuloSeAusente } = opcoes;

    const url = new URL(`${this.urlBase}${caminho}`);
    if (query) {
      for (const [chave, valor] of Object.entries(query)) {
        if (valor !== undefined && valor !== null && valor !== '') {
          url.searchParams.set(chave, String(valor));
        }
      }
    }

    let ultimoErro: unknown;
    let tentouRenovarToken = false;

    for (let tentativa = 1; tentativa <= this.maxTentativas; tentativa += 1) {
      await this.opcoes.rateLimiter.aguardarVez();

      const accessToken = await this.opcoes.token.obter();

      let resposta: Response;
      try {
        resposta = await fetch(url, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(corpo ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        });
      } catch (erro) {
        // Falha de rede. O servidor fica em conexao residencial, entao oscilacao
        // de link e esperada e merece retry.
        ultimoErro = erro;
        const espera = this.esperaBackoff(tentativa);
        this.opcoes.logger?.warn(
          { caminho, tentativa, espera, erro: String(erro) },
          'Falha de rede ao chamar o Bling, tentando de novo',
        );
        await dormir(espera);
        continue;
      }

      if (resposta.status === 404 && nuloSeAusente) {
        return null;
      }

      // Rate limit. O Bling esta dizendo que estamos rapidos demais: atrasamos a
      // fila inteira, nao apenas esta requisicao.
      if (resposta.status === 429) {
        const retryAfter = Number(resposta.headers.get('retry-after'));
        const espera = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : this.esperaBackoff(tentativa);
        this.opcoes.rateLimiter.recuar(espera);
        this.opcoes.logger?.warn(
          { caminho, tentativa, espera },
          'Bling respondeu 429, reduzindo o ritmo',
        );
        await dormir(espera);
        continue;
      }

      // Token expirado ou revogado. Renovamos no maximo uma vez por requisicao:
      // insistir aqui e o caminho mais curto para o banimento de IP de 60 min.
      if (resposta.status === 401 && !tentouRenovarToken) {
        tentouRenovarToken = true;
        this.opcoes.logger?.warn(
          { caminho },
          'Bling respondeu 401, renovando o access_token',
        );
        await this.opcoes.token.invalidar();
        continue;
      }

      if (resposta.status >= 500) {
        const espera = this.esperaBackoff(tentativa);
        ultimoErro = new BlingApiError(
          `Erro do servidor Bling (HTTP ${resposta.status})`,
          resposta.status,
          undefined,
          caminho,
        );
        this.opcoes.logger?.warn(
          { caminho, tentativa, status: resposta.status, espera },
          'Erro 5xx no Bling, tentando de novo',
        );
        await dormir(espera);
        continue;
      }

      const texto = await resposta.text();
      let corpoResposta: unknown = null;
      try {
        corpoResposta = texto ? JSON.parse(texto) : null;
      } catch {
        corpoResposta = texto;
      }

      if (!resposta.ok) {
        throw new BlingApiError(
          `Bling recusou ${metodo} ${caminho} (HTTP ${resposta.status}): ${texto.slice(0, 500)}`,
          resposta.status,
          corpoResposta,
          caminho,
        );
      }

      return corpoResposta;
    }

    throw ultimoErro instanceof Error
      ? ultimoErro
      : new BlingApiError(
          `Esgotadas as ${this.maxTentativas} tentativas em ${caminho}`,
          0,
          ultimoErro,
          caminho,
        );
  }

  /** Backoff exponencial com jitter, para nao sincronizar retries. */
  private esperaBackoff(tentativa: number): number {
    const base = Math.min(1000 * 2 ** (tentativa - 1), 30_000);
    return base + Math.random() * 500;
  }

  /**
   * Percorre todas as paginas de um endpoint de listagem.
   *
   * A paginacao do Bling e `?pagina=N&limite=100`. Nao ha cursor nem contagem
   * total: a lista acabou quando a pagina volta vazia ou com menos itens que o
   * limite.
   *
   * Entrega item por item com AsyncGenerator para que o backfill possa gravar e
   * atualizar o checkpoint conforme avanca, em vez de acumular tudo em memoria e
   * perder o progresso se cair no meio.
   */
  async *paginar<S extends z.ZodTypeAny>(
    caminho: string,
    schemaItem: S,
    opcoes: {
      query?: Record<string, string | number | undefined>;
      paginaInicial?: number;
      limite?: number;
      aoVirarPagina?: (pagina: number, itensLidos: number) => Promise<void>;
    } = {},
  ): AsyncGenerator<z.infer<S>, void, void> {
    const limite = opcoes.limite ?? LIMITE_PAGINA;
    let pagina = opcoes.paginaInicial ?? 1;

    const envelope = z.object({ data: z.array(z.unknown()).default([]) });

    for (;;) {
      const resposta = await this.bruto(caminho, {
        query: { ...opcoes.query, pagina, limite },
      });

      const parsedEnvelope = envelope.safeParse(resposta);
      if (!parsedEnvelope.success) {
        throw new BlingApiError(
          `Envelope de listagem inesperado em ${caminho}: esperado { data: [...] }`,
          200,
          resposta,
          caminho,
        );
      }

      const itens = parsedEnvelope.data.data;
      if (itens.length === 0) return;

      for (const item of itens) {
        const parsed = schemaItem.safeParse(item);
        if (!parsed.success) {
          throw new BlingApiError(
            `Item de ${caminho} em formato inesperado: ${parsed.error.message}`,
            200,
            item,
            caminho,
          );
        }
        yield parsed.data;
      }

      await opcoes.aoVirarPagina?.(pagina, itens.length);

      // Pagina incompleta significa ultima pagina.
      if (itens.length < limite) return;
      pagina += 1;
    }
  }
}
