/**
 * Controle de vazao para a API do Bling.
 *
 * O Bling impoe tres limites distintos, e todos valem para a CONTA inteira, nao
 * por endpoint:
 *
 *   - 3 requisicoes por segundo
 *   - 120.000 requisicoes por dia
 *   - bloqueio de IP por 10 minutos ao fazer 600 requisicoes em 10 segundos
 *     (e por 60 minutos ao fazer 20 chamadas a /oauth/token em 60 segundos)
 *
 * Operamos a 2,5 req/s de proposito. O limite real e 3, mas a contagem do lado
 * do Bling nao enxerga a latencia da rede do mesmo jeito que a nossa: duas
 * requisicoes que saem daqui separadas por 340ms podem chegar la separadas por
 * 280ms. A folga de 0,5 req/s custa pouco tempo e evita o bloqueio de IP, que
 * custaria 10 minutos de integracao parada.
 */

export interface OpcoesRateLimiter {
  /** Requisicoes por segundo. Padrao 2,5 (limite do Bling e 3). */
  porSegundo?: number;
  /** Teto diario. Padrao 120.000, igual ao do Bling. */
  porDia?: number;
  /** Chamado quando o consumo diario passa de 80%. */
  onAvisoDiario?: (consumidas: number, teto: number) => void;
}

export class LimiteDiarioExcedidoError extends Error {
  constructor(consumidas: number, teto: number) {
    super(
      `Limite diario de requisicoes ao Bling atingido (${consumidas}/${teto}). ` +
        `O contador zera a meia-noite.`,
    );
    this.name = 'LimiteDiarioExcedidoError';
  }
}

export class RateLimiter {
  private readonly intervaloMs: number;
  private readonly porDia: number;
  private readonly onAvisoDiario?: (consumidas: number, teto: number) => void;

  /** Momento em que a proxima requisicao pode partir. */
  private proximoSlot = 0;

  private consumidasHoje = 0;
  private diaCorrente = this.hojeISO();
  private avisouHoje = false;

  constructor(opcoes: OpcoesRateLimiter = {}) {
    const porSegundo = opcoes.porSegundo ?? 2.5;
    if (porSegundo <= 0) {
      throw new Error('porSegundo deve ser maior que zero');
    }
    this.intervaloMs = 1000 / porSegundo;
    this.porDia = opcoes.porDia ?? 120_000;
    this.onAvisoDiario = opcoes.onAvisoDiario;
  }

  private hojeISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private virarDiaSeNecessario(): void {
    const hoje = this.hojeISO();
    if (hoje !== this.diaCorrente) {
      this.diaCorrente = hoje;
      this.consumidasHoje = 0;
      this.avisouHoje = false;
    }
  }

  /**
   * Bloqueia ate que seja seguro disparar a proxima requisicao.
   *
   * O agendamento usa um relogio proprio (`proximoSlot`) em vez de medir o tempo
   * desde a ultima chamada. Isso serializa corretamente varias chamadas
   * concorrentes: cada uma reserva seu lugar na fila no momento em que pede, e
   * nao ha como duas reservarem o mesmo instante.
   */
  async aguardarVez(): Promise<void> {
    this.virarDiaSeNecessario();

    if (this.consumidasHoje >= this.porDia) {
      throw new LimiteDiarioExcedidoError(this.consumidasHoje, this.porDia);
    }

    const agora = Date.now();
    const partida = Math.max(agora, this.proximoSlot);
    this.proximoSlot = partida + this.intervaloMs;

    this.consumidasHoje += 1;

    if (
      !this.avisouHoje &&
      this.consumidasHoje > this.porDia * 0.8 &&
      this.onAvisoDiario
    ) {
      this.avisouHoje = true;
      this.onAvisoDiario(this.consumidasHoje, this.porDia);
    }

    const esperaMs = partida - agora;
    if (esperaMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }

  /**
   * Empurra o proximo slot para frente. Usado ao receber 429 ou Retry-After:
   * o Bling esta dizendo que estamos rapidos demais, entao toda a fila espera,
   * nao apenas a requisicao que falhou.
   */
  recuar(ms: number): void {
    this.proximoSlot = Math.max(this.proximoSlot, Date.now() + ms);
  }

  get estatisticas(): { consumidasHoje: number; tetoDiario: number } {
    this.virarDiaSeNecessario();
    return { consumidasHoje: this.consumidasHoje, tetoDiario: this.porDia };
  }
}
