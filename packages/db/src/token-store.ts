import { prisma, comLock, LOCK } from './cliente.js';

/**
 * Guarda e renova o par de tokens OAuth do Bling.
 *
 * Esta classe existe para resolver um problema especifico e caro: o Bling
 * bloqueia o IP por 60 MINUTOS apos 20 chamadas a /oauth/token em 60 segundos.
 * Num cenario trivial - token expira, e cinco jobs mais a API percebem ao mesmo
 * tempo - uma implementacao ingenua dispara seis refreshes simultaneos. Alguns
 * ciclos assim e a integracao sai do ar por uma hora.
 *
 * As protecoes aqui:
 *
 *  - renovacao sempre dentro de advisory lock do Postgres (um por vez, em todo
 *    o sistema, inclusive entre processos diferentes);
 *  - reconferencia dentro do lock, porque quem esperou pode descobrir que o
 *    token ja foi renovado por outro e nao precisa chamar o Bling;
 *  - renovacao antecipada, com folga antes do vencimento, para que o refresh
 *    aconteca em um job agendado e nao no meio de uma rajada de requisicoes.
 */

/** Renovamos o access_token quando falta menos que isto para expirar. */
const FOLGA_RENOVACAO_MS = 10 * 60 * 1000; // 10 minutos

/** Aviso de refresh_token proximo do fim (ele vale 30 dias). */
export const ALERTA_REFRESH_DIAS = 7;

export class ReautorizacaoNecessariaError extends Error {
  constructor(motivo: string) {
    super(
      `A autorizacao do Bling expirou e precisa ser renovada manualmente: ${motivo}. ` +
        `Abra a URL de autorizacao em /oauth/iniciar e aprove o aplicativo novamente.`,
    );
    this.name = 'ReautorizacaoNecessariaError';
  }
}

export interface RenovadorToken {
  renovar(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    scope: string | null;
    expiraEm: Date;
    refreshExpiraEm: Date;
  }>;
}

export interface LoggerSimples {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export class TokenStore {
  constructor(
    private readonly empresaId: number,
    private readonly renovador: RenovadorToken,
    private readonly logger?: LoggerSimples,
  ) {}

  /**
   * Devolve um access_token valido, renovando se estiver perto de expirar.
   */
  async obter(): Promise<string> {
    const registro = await prisma.oAuthToken.findUnique({
      where: { empresaId: this.empresaId },
    });

    if (!registro) {
      throw new ReautorizacaoNecessariaError(
        'nenhum token encontrado para esta empresa',
      );
    }

    const agora = Date.now();

    if (registro.refreshExpiraEm.getTime() <= agora) {
      throw new ReautorizacaoNecessariaError(
        `o refresh_token expirou em ${registro.refreshExpiraEm.toISOString()}`,
      );
    }

    const precisaRenovar =
      registro.expiraEm.getTime() - agora <= FOLGA_RENOVACAO_MS;

    if (!precisaRenovar) {
      return registro.accessToken;
    }

    const renovado = await this.renovarComLock();
    return renovado ?? registro.accessToken;
  }

  /** Forca a renovacao. Chamado apos um 401 do Bling. */
  async invalidar(): Promise<void> {
    await this.renovarComLock(true);
  }

  /**
   * Renova sob lock. Devolve o novo access_token, ou null quando nao renovou
   * (porque outro processo ja havia renovado, ou porque o lock estava tomado).
   */
  private async renovarComLock(forcar = false): Promise<string | null> {
    const resultado = await comLock(LOCK.REFRESH_TOKEN_BLING, async () => {
      // Reconferencia DENTRO do lock: enquanto esperavamos, outro processo pode
      // ter renovado. Sem isto, uma fila de 6 esperando viraria 6 chamadas ao
      // Bling - exatamente o que leva ao bloqueio de IP.
      const atual = await prisma.oAuthToken.findUnique({
        where: { empresaId: this.empresaId },
      });

      if (!atual) {
        throw new ReautorizacaoNecessariaError('token removido durante a renovacao');
      }

      const agora = Date.now();
      const aindaValido =
        atual.expiraEm.getTime() - agora > FOLGA_RENOVACAO_MS;

      if (aindaValido && !forcar) {
        this.logger?.info(
          { empresaId: this.empresaId },
          'Token ja renovado por outro processo, aproveitando',
        );
        return atual.accessToken;
      }

      if (atual.refreshExpiraEm.getTime() <= agora) {
        throw new ReautorizacaoNecessariaError(
          `o refresh_token expirou em ${atual.refreshExpiraEm.toISOString()}`,
        );
      }

      this.logger?.info(
        { empresaId: this.empresaId },
        'Renovando access_token do Bling',
      );

      const novo = await this.renovador.renovar(atual.refreshToken);

      await prisma.oAuthToken.update({
        where: { empresaId: this.empresaId },
        data: {
          accessToken: novo.accessToken,
          refreshToken: novo.refreshToken,
          tokenType: novo.tokenType,
          scope: novo.scope,
          expiraEm: novo.expiraEm,
          refreshExpiraEm: novo.refreshExpiraEm,
          ultimoRefreshEm: new Date(),
        },
      });

      return novo.accessToken;
    });

    if (resultado === null) {
      // Lock tomado: outro processo esta renovando agora. Insistir aqui seria
      // justamente a rajada que queremos evitar.
      this.logger?.warn(
        { empresaId: this.empresaId },
        'Renovacao de token em andamento em outro processo, seguindo com o token atual',
      );
    }

    return resultado;
  }

  /** Dias restantes do refresh_token. Negativo significa expirado. */
  async diasRestantesRefresh(): Promise<number | null> {
    const registro = await prisma.oAuthToken.findUnique({
      where: { empresaId: this.empresaId },
      select: { refreshExpiraEm: true },
    });
    if (!registro) return null;
    return Math.floor(
      (registro.refreshExpiraEm.getTime() - Date.now()) / 86_400_000,
    );
  }
}

/**
 * Grava o par de tokens obtido na autorizacao inicial, criando a empresa se
 * necessario.
 */
export async function salvarTokenInicial(params: {
  blingCompanyId: string;
  nomeEmpresa?: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string | null;
  expiraEm: Date;
  refreshExpiraEm: Date;
}): Promise<number> {
  const empresa = await prisma.empresa.upsert({
    where: { blingId: params.blingCompanyId },
    create: {
      blingId: params.blingCompanyId,
      nome: params.nomeEmpresa ?? `Empresa ${params.blingCompanyId}`,
    },
    update: {},
  });

  await prisma.oAuthToken.upsert({
    where: { empresaId: empresa.id },
    create: {
      empresaId: empresa.id,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenType: params.tokenType,
      scope: params.scope,
      expiraEm: params.expiraEm,
      refreshExpiraEm: params.refreshExpiraEm,
    },
    update: {
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      tokenType: params.tokenType,
      scope: params.scope,
      expiraEm: params.expiraEm,
      refreshExpiraEm: params.refreshExpiraEm,
      ultimoRefreshEm: new Date(),
    },
  });

  return empresa.id;
}
