import { z } from 'zod';

/**
 * Fluxo OAuth 2.0 do Bling v3.
 *
 * O Bling implementa somente o grant type `authorization_code`. Nao existe
 * client_credentials, o que significa que a autorizacao inicial e sempre
 * manual: alguem precisa abrir a URL no navegador e aprovar. Dai em diante o
 * sistema se sustenta com o refresh_token, que vale 30 dias.
 *
 * CUIDADO COM O BLOQUEIO DE IP: 20 chamadas a /oauth/token em 60 segundos
 * bloqueiam o IP por 60 minutos. Toda chamada daqui deve passar pelo advisory
 * lock (ver `comLock` em @alvorada/db). Nunca chame no caminho de uma
 * requisicao HTTP de usuario.
 */

export const URL_AUTORIZACAO_PADRAO = 'https://bling.com.br/Api/v3/oauth/authorize';
export const URL_TOKEN_PADRAO = 'https://api.bling.com.br/Api/v3/oauth/token';
export const URL_REVOGACAO_PADRAO = 'https://api.bling.com.br/Api/v3/oauth/revoke';

/** O Bling documenta validade de 30 dias para o refresh_token. */
export const REFRESH_TOKEN_DIAS = 30;

const respostaTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().default('Bearer'),
  /** Segundos de validade do access_token. */
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});

export type RespostaToken = z.infer<typeof respostaTokenSchema>;

export interface TokenResolvido {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string | null;
  /** Momento em que o access_token expira. */
  expiraEm: Date;
  /** Momento em que o refresh_token expira (30 dias a partir de agora). */
  refreshExpiraEm: Date;
}

export class BlingAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly corpo?: unknown,
  ) {
    super(message);
    this.name = 'BlingAuthError';
  }

  /**
   * Indica que a autorizacao morreu e exige intervencao humana: abrir a URL de
   * autorizacao no navegador novamente. Acontece quando o refresh_token expirou
   * (30 dias sem uso), foi revogado, ou a empresa esta inativa no Bling.
   */
  get exigeReautorizacao(): boolean {
    return this.status === 400 || this.status === 401;
  }
}

export interface ConfigOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  urlAutorizacao?: string;
  urlToken?: string;
  urlRevogacao?: string;
}

export class BlingOAuth {
  constructor(private readonly config: ConfigOAuth) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error(
        'BLING_CLIENT_ID e BLING_CLIENT_SECRET precisam estar definidos no .env',
      );
    }
  }

  /**
   * Monta a URL que o usuario abre no navegador para autorizar o aplicativo.
   *
   * O `state` e obrigatorio na pratica: e o que impede CSRF no callback. Gere um
   * valor aleatorio, guarde em sessao e confira na volta.
   *
   * O `scope` nao vai aqui: o Bling usa os escopos marcados no cadastro do
   * aplicativo e ignora o parametro, mesmo se enviado.
   */
  gerarUrlAutorizacao(state: string): string {
    const base = this.config.urlAutorizacao ?? URL_AUTORIZACAO_PADRAO;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      state,
      redirect_uri: this.config.redirectUri,
    });
    return `${base}?${params.toString()}`;
  }

  /** Credencial Basic exigida pelo endpoint de token. */
  private cabecalhoBasic(): string {
    const credencial = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString('base64');
    return `Basic ${credencial}`;
  }

  /**
   * Troca o authorization_code pelo par de tokens.
   *
   * O codigo expira em 1 MINUTO. Se o callback demorar (por exemplo esperando o
   * banco subir), a troca falha. Faca esta chamada antes de qualquer outra coisa
   * no handler do callback.
   */
  async trocarCodigo(code: string): Promise<TokenResolvido> {
    return this.pedirToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });
  }

  /** Renova o par de tokens. O Bling devolve um refresh_token novo a cada uso. */
  async renovar(refreshToken: string): Promise<TokenResolvido> {
    return this.pedirToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  /**
   * Executa a chamada ao endpoint de token.
   *
   * NOTA SOBRE O FORMATO DO CORPO: a documentacao do Bling e uma SPA e nao expoe
   * o Content-Type exato do /oauth/token em texto. Enviamos
   * `application/x-www-form-urlencoded`, que e o formato exigido pela RFC 6749 e
   * o que o Bling declara seguir. Se o servidor recusar o formato, caimos
   * automaticamente para JSON uma unica vez.
   *
   * O fallback e deliberadamente limitado a uma tentativa: 20 chamadas a este
   * endpoint em 60 segundos bloqueiam o IP por uma hora.
   */
  private async pedirToken(
    campos: Record<string, string>,
  ): Promise<TokenResolvido> {
    const url = this.config.urlToken ?? URL_TOKEN_PADRAO;

    let resposta = await this.postToken(url, campos, 'form');

    if (resposta.status === 400 || resposta.status === 415) {
      // Pode ser rejeicao do formato do corpo, e nao credencial invalida.
      const tentativaJson = await this.postToken(url, campos, 'json');
      if (tentativaJson.ok) {
        resposta = tentativaJson;
      }
    }

    if (!resposta.ok) {
      throw new BlingAuthError(
        `Falha ao obter token do Bling (HTTP ${resposta.status}): ${resposta.textoBruto}`,
        resposta.status,
        resposta.corpo,
      );
    }

    const parsed = respostaTokenSchema.safeParse(resposta.corpo);
    if (!parsed.success) {
      throw new BlingAuthError(
        `Resposta de token em formato inesperado: ${parsed.error.message}`,
        resposta.status,
        resposta.corpo,
      );
    }

    const agora = Date.now();
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      tokenType: parsed.data.token_type,
      scope: parsed.data.scope ?? null,
      expiraEm: new Date(agora + parsed.data.expires_in * 1000),
      refreshExpiraEm: new Date(agora + REFRESH_TOKEN_DIAS * 86_400_000),
    };
  }

  private async postToken(
    url: string,
    campos: Record<string, string>,
    formato: 'form' | 'json',
  ): Promise<{
    ok: boolean;
    status: number;
    corpo: unknown;
    textoBruto: string;
  }> {
    const headers: Record<string, string> = {
      Authorization: this.cabecalhoBasic(),
      Accept: 'application/json',
      'Content-Type':
        formato === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
    };

    const body =
      formato === 'form'
        ? new URLSearchParams(campos).toString()
        : JSON.stringify(campos);

    const resposta = await fetch(url, { method: 'POST', headers, body });
    const textoBruto = await resposta.text();

    let corpo: unknown = null;
    try {
      corpo = textoBruto ? JSON.parse(textoBruto) : null;
    } catch {
      corpo = textoBruto;
    }

    return { ok: resposta.ok, status: resposta.status, corpo, textoBruto };
  }

  /** Revoga o token atual. Util ao desconectar a empresa. */
  async revogar(token: string): Promise<void> {
    const url = this.config.urlRevogacao ?? URL_REVOGACAO_PADRAO;
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.cabecalhoBasic(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    if (!resposta.ok) {
      throw new BlingAuthError(
        `Falha ao revogar token (HTTP ${resposta.status})`,
        resposta.status,
      );
    }
  }
}

/**
 * Valida a assinatura HMAC de um webhook do Bling.
 *
 * O Bling envia `X-Bling-Signature-256: sha256=<hex>`, calculado sobre o corpo
 * CRU da requisicao usando o client_secret como chave. Precisa ser o corpo cru:
 * se o JSON for reserializado antes da conferencia, um espaco ou ordem de chave
 * diferente invalida a assinatura.
 *
 * A comparacao usa timingSafeEqual para nao vazar informacao pelo tempo de
 * resposta.
 */
export async function validarAssinaturaWebhook(
  corpoCru: string | Buffer,
  cabecalhoAssinatura: string | undefined,
  clientSecret: string,
): Promise<boolean> {
  if (!cabecalhoAssinatura) return false;

  const { createHmac, timingSafeEqual } = await import('node:crypto');

  const recebida = cabecalhoAssinatura.startsWith('sha256=')
    ? cabecalhoAssinatura.slice('sha256='.length)
    : cabecalhoAssinatura;

  const esperada = createHmac('sha256', clientSecret)
    .update(corpoCru)
    .digest('hex');

  const bufRecebida = Buffer.from(recebida, 'utf8');
  const bufEsperada = Buffer.from(esperada, 'utf8');

  if (bufRecebida.length !== bufEsperada.length) return false;
  return timingSafeEqual(bufRecebida, bufEsperada);
}
