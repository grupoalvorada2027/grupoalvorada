/**
 * Calculo de margem de contribuicao por item e por pedido.
 *
 * A formula segue a mesma do dashboard "Margem por Pedido" do Bling, de proposito:
 * se os numeros daqui divergirem dos de lá, queremos que a divergencia seja
 * explicavel, nao uma diferenca de metodologia.
 *
 *   margem = receita - custo do produto - taxas do marketplace - frete do
 *            vendedor - impostos
 *
 * Duas decisoes que definem se o relatorio merece confianca:
 *
 * 1. CUSTO AUSENTE NAO E CUSTO ZERO. Quando um produto nao tem custo cadastrado,
 *    a margem do item fica indefinida (`null`) e o item e contado como lacuna.
 *    Tratar custo ausente como zero produziria margem altissima justamente nos
 *    produtos mal cadastrados, e e assim que um painel passa a recomendar
 *    investir no produto errado.
 *
 * 2. O RATEIO FECHA AO CENTAVO. Distribuir R$ 10,00 entre tres itens da
 *    3,333... cada; somar os arredondados da R$ 9,99. Usamos o metodo do maior
 *    resto, entao a soma das partes e exatamente igual ao total. Sem isso, o
 *    total do relatorio nao bate com a soma das linhas e o usuario perde a
 *    confianca no sistema inteiro - com razao.
 */

export interface ItemParaMargem {
  /** Identificador do item, usado para devolver o resultado correlacionado. */
  id: number;
  sku: string | null;
  quantidade: number;
  valorUnitario: number;
  /** Desconto do proprio item, em valor absoluto. */
  desconto: number;
  /** Custo unitario vigente na data do pedido. Null quando nao cadastrado. */
  custoUnitario: number | null;
  /** Aliquota de imposto em percentual (12 = 12%). */
  aliquotaImposto: number;
}

export interface TaxaParaMargem {
  tipo: 'COMISSAO' | 'FRETE' | 'TARIFA_FIXA' | 'ANTECIPACAO' | 'OUTRA';
  valor: number;
  origem: 'REAL' | 'ESTIMADO';
}

export interface PedidoParaMargem {
  itens: ItemParaMargem[];
  /** Desconto aplicado no pedido como um todo, a ratear entre os itens. */
  descontoPedido: number;
  /** Frete pago pelo vendedor. Custo. Nao confundir com frete cobrado do cliente. */
  freteVendedor: number;
  taxas: TaxaParaMargem[];
}

export interface MargemItem {
  id: number;
  sku: string | null;
  receita: number;
  custo: number | null;
  taxas: number;
  frete: number;
  imposto: number;
  /** Null quando o custo do produto nao esta cadastrado. */
  margem: number | null;
  /** Margem sobre a receita, em percentual. Null se a margem for indefinida. */
  margemPercentual: number | null;
  custoIndisponivel: boolean;
}

export interface MargemPedido {
  receita: number;
  custo: number;
  taxas: number;
  frete: number;
  imposto: number;
  margem: number;
  margemPercentual: number;
  itens: MargemItem[];
  /** Quantos itens ficaram sem custo cadastrado. */
  itensSemCusto: number;
  /**
   * True quando algum item nao tem custo. Nesse caso a margem do pedido e
   * parcial: ela soma apenas os itens com custo conhecido, e a interface precisa
   * sinalizar isso em vez de apresentar o numero como completo.
   */
  margemParcial: boolean;
  /** True quando toda taxa considerada veio do marketplace, sem estimativa. */
  taxasTodasReais: boolean;
}

/** Arredonda para centavos, com desempate para cima. */
export function arredondar(valor: number, casas = 2): number {
  const fator = 10 ** casas;
  // O epsilon corrige casos como 1.005 que, em ponto flutuante, e 1.00499...
  return Math.round((valor + Number.EPSILON * Math.abs(valor)) * fator) / fator;
}

/**
 * Distribui `total` entre os itens na proporcao de `pesos`, garantindo que a
 * soma do resultado seja exatamente `total` (metodo do maior resto).
 *
 * Quando a soma dos pesos e zero (por exemplo, pedido de brinde com receita
 * zero), distribui igualmente, porque qualquer outra escolha concentraria o
 * custo arbitrariamente em um item.
 */
export function ratear(total: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];

  const totalCent = Math.round(total * 100);
  const somaPesos = pesos.reduce((acc, p) => acc + p, 0);

  const proporcoes =
    somaPesos > 0
      ? pesos.map((p) => p / somaPesos)
      : pesos.map(() => 1 / pesos.length);

  const brutos = proporcoes.map((p) => totalCent * p);
  const pisos = brutos.map((v) => Math.floor(v));

  let restante = totalCent - pisos.reduce((acc, v) => acc + v, 0);

  // Entrega os centavos sobrantes a quem tem o maior resto decimal.
  const ordemPorResto = brutos
    .map((bruto, indice) => ({ indice, resto: bruto - Math.floor(bruto) }))
    .sort((a, b) => b.resto - a.resto);

  const resultadoCent = [...pisos];
  let i = 0;
  while (restante > 0 && ordemPorResto.length > 0) {
    const alvo = ordemPorResto[i % ordemPorResto.length];
    if (alvo) {
      resultadoCent[alvo.indice] = (resultadoCent[alvo.indice] ?? 0) + 1;
      restante -= 1;
    }
    i += 1;
  }
  // Total negativo (estorno) pode gerar sobra negativa.
  while (restante < 0 && ordemPorResto.length > 0) {
    const alvo = ordemPorResto[i % ordemPorResto.length];
    if (alvo) {
      resultadoCent[alvo.indice] = (resultadoCent[alvo.indice] ?? 0) - 1;
      restante += 1;
    }
    i += 1;
  }

  return resultadoCent.map((c) => c / 100);
}

/** Receita liquida do item: quantidade x valor unitario, menos desconto do item. */
export function receitaItem(item: ItemParaMargem): number {
  return arredondar(item.quantidade * item.valorUnitario - item.desconto);
}

export function calcularMargemPedido(pedido: PedidoParaMargem): MargemPedido {
  const { itens, descontoPedido, freteVendedor, taxas } = pedido;

  if (itens.length === 0) {
    return {
      receita: 0,
      custo: 0,
      taxas: 0,
      frete: 0,
      imposto: 0,
      margem: 0,
      margemPercentual: 0,
      itens: [],
      itensSemCusto: 0,
      margemParcial: false,
      taxasTodasReais: true,
    };
  }

  // Receita bruta de cada item, antes do rateio do desconto do pedido.
  const receitasBrutas = itens.map(receitaItem);

  // O desconto do pedido e rateado pela participacao na receita e abatido da
  // receita do item, nao somado aos custos: desconto reduz o que entrou.
  const descontosRateados = ratear(descontoPedido, receitasBrutas);
  const receitas = receitasBrutas.map((bruta, i) =>
    arredondar(bruta - (descontosRateados[i] ?? 0)),
  );

  // Taxas e frete sao rateados pela receita liquida.
  const totalTaxas = taxas.reduce((acc, t) => acc + t.valor, 0);
  const taxasRateadas = ratear(totalTaxas, receitas);
  const fretesRateados = ratear(freteVendedor, receitas);

  const resultadoItens: MargemItem[] = itens.map((item, i) => {
    const receita = receitas[i] ?? 0;
    const taxaItem = taxasRateadas[i] ?? 0;
    const freteItem = fretesRateados[i] ?? 0;
    const imposto = arredondar(receita * (item.aliquotaImposto / 100));

    const custoIndisponivel = item.custoUnitario === null;
    const custo = custoIndisponivel
      ? null
      : arredondar((item.custoUnitario ?? 0) * item.quantidade);

    const margem =
      custo === null
        ? null
        : arredondar(receita - custo - taxaItem - freteItem - imposto);

    return {
      id: item.id,
      sku: item.sku,
      receita,
      custo,
      taxas: taxaItem,
      frete: freteItem,
      imposto,
      margem,
      margemPercentual:
        margem === null || receita === 0 ? null : arredondar((margem / receita) * 100, 2),
      custoIndisponivel,
    };
  });

  const soma = (fn: (m: MargemItem) => number) =>
    arredondar(resultadoItens.reduce((acc, m) => acc + fn(m), 0));

  const receitaTotal = soma((m) => m.receita);
  const custoTotal = soma((m) => m.custo ?? 0);
  const taxasTotal = soma((m) => m.taxas);
  const freteTotal = soma((m) => m.frete);
  const impostoTotal = soma((m) => m.imposto);
  const margemTotal = soma((m) => m.margem ?? 0);

  const itensSemCusto = resultadoItens.filter((m) => m.custoIndisponivel).length;

  return {
    receita: receitaTotal,
    custo: custoTotal,
    taxas: taxasTotal,
    frete: freteTotal,
    imposto: impostoTotal,
    margem: margemTotal,
    margemPercentual:
      receitaTotal === 0 ? 0 : arredondar((margemTotal / receitaTotal) * 100, 2),
    itens: resultadoItens,
    itensSemCusto,
    margemParcial: itensSemCusto > 0,
    taxasTodasReais:
      taxas.length === 0 || taxas.every((t) => t.origem === 'REAL'),
  };
}
