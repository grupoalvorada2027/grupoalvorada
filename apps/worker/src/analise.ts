import { prisma } from '@alvorada/db';
import {
  calcularMargemPedido,
  arredondar,
  type ItemParaMargem,
  type TaxaParaMargem,
} from '@alvorada/shared';

/**
 * Producao das analises de lucratividade.
 *
 * A margem e calculada em TypeScript, reusando `calcularMargemPedido` de
 * @alvorada/shared - a mesma funcao coberta por 19 testes. Nao reescrevemos a
 * formula em SQL de proposito: duas implementacoes da mesma regra divergem com o
 * tempo, e a divergencia apareceria como numero errado no painel, nao como erro.
 *
 * O custo disso e carregar os pedidos do periodo em memoria. Para a escala deste
 * projeto (alguns milhares de pedidos por trimestre) isso leva segundos e cabe
 * folgado na memoria. Se um dia passar de centenas de milhares, o caminho e
 * agregar incrementalmente, nao duplicar a formula.
 */

export interface LinhaCanal {
  canal: string;
  tipo: string;
  pedidos: number;
  itens: number;
  receita: number;
  custo: number;
  taxas: number;
  frete: number;
  imposto: number;
  margem: number;
  margemPct: number;
  ticketMedio: number;
  /** Quantos itens do canal estao sem custo cadastrado. */
  itensSemCusto: number;
}

export interface LinhaCanalMes {
  mes: string;
  canal: string;
  receita: number;
  margem: number;
  margemPct: number;
  pedidos: number;
}

export interface LinhaSkuCanal {
  sku: string;
  descricao: string;
  canal: string;
  quantidade: number;
  receita: number;
  custo: number;
  taxas: number;
  margem: number;
  margemPct: number;
  pedidos: number;
  semCusto: boolean;
}

export interface Cobertura {
  pedidos: number;
  pedidosForaDaAnalise: number;
  /** Vendas que apareciam mais de uma vez no Bling e foram contadas so uma. */
  pedidosDuplicados: number;
  itens: number;
  itensSemCusto: number;
  percentualItensComCusto: number;
  taxasReais: number;
  taxasEstimadas: number;
  /** True quando toda taxa do periodo veio do marketplace. */
  taxasTodasReais: boolean;
}

export interface Analise {
  geradoEm: string;
  periodo: { inicio: string; fim: string };
  cobertura: Cobertura;
  canais: LinhaCanal[];
  canalMes: LinhaCanalMes[];
  skuCanal: LinhaSkuCanal[];
  /** SKUs com margem negativa, do pior para o menos pior. */
  prejuizo: LinhaSkuCanal[];
  /** Comparacao direta do mesmo SKU entre canais. */
  comparativoCanais: ComparativoSku[];
  /** Observacoes calculadas a partir dos numeros. */
  insights: Insight[];
}

/**
 * Comparacao do mesmo SKU entre canais diferentes.
 *
 * E a resposta para "onde vale a pena anunciar este produto": mostra, para cada
 * SKU vendido em mais de um canal, qual deles entrega mais margem.
 */
export interface ComparativoSku {
  sku: string;
  descricao: string;
  canais: Array<{
    canal: string;
    quantidade: number;
    receita: number;
    margem: number;
    margemPct: number;
  }>;
  melhorCanal: string;
  piorCanal: string;
  /** Diferenca de margem percentual entre o melhor e o pior canal. */
  diferencaPct: number;
}

const chave = (...partes: string[]) => partes.join('\u0000');

export async function gerarAnalise(
  empresaId: number,
  opcoes: { meses?: number } = {},
): Promise<Analise> {
  const meses = opcoes.meses ?? 12;
  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setMonth(inicio.getMonth() - meses);

  // Carregamos tudo de uma vez: uma consulta com os relacionamentos evita o
  // problema de N+1 que tornaria isso lento de verdade.
  const pedidos = await prisma.pedido.findMany({
    where: {
      empresaId,
      data: { gte: inicio, lte: fim },
    },
    include: {
      canal: { select: { nome: true, tipo: true } },
      itens: {
        include: { produto: { select: { sku: true, aliquotaImposto: true } } },
      },
      taxas: true,
    },
    orderBy: { data: 'asc' },
  });

  const candidatos = pedidos.filter((p) => p.considerarNaAnalise);

  /**
   * Remove vendas duplicadas.
   *
   * Encontrado em 11/10/2026 nos dados reais: a mesma venda da Shopee entra no
   * Bling DUAS vezes, com dois numeros de pedido e duas "lojas" diferentes, mas
   * o mesmo numero de pedido do marketplace. Provavelmente ha duas integracoes
   * apontando para a mesma conta.
   *
   * Sem isto, o faturamento daquele canal aparece dobrado. Como `numeroLoja` e
   * o identificador da venda no proprio marketplace, duas linhas com o mesmo
   * valor sao necessariamente a mesma venda.
   *
   * Mantemos o pedido mais ANTIGO (menor id do Bling) por ser o original, e
   * contamos quantos foram descartados - o painel mostra esse numero, porque
   * isto e um problema de cadastro que o usuario precisa corrigir na origem,
   * nao algo para o sistema esconder.
   */
  const vistos = new Map<string, (typeof candidatos)[number]>();
  const pedidosValidos: typeof candidatos = [];
  let duplicadosDescartados = 0;

  for (const pedido of candidatos) {
    const chaveVenda = pedido.numeroLoja?.trim();

    // Venda sem numero de marketplace (venda direta) nao tem como duplicar.
    if (!chaveVenda) {
      pedidosValidos.push(pedido);
      continue;
    }

    const anterior = vistos.get(chaveVenda);
    if (!anterior) {
      vistos.set(chaveVenda, pedido);
      pedidosValidos.push(pedido);
      continue;
    }

    duplicadosDescartados += 1;
  }

  // --- acumuladores ---
  const porCanal = new Map<string, LinhaCanal>();
  const porCanalMes = new Map<string, LinhaCanalMes>();
  const porSkuCanal = new Map<string, LinhaSkuCanal>();

  let totalItens = 0;
  let totalItensSemCusto = 0;
  let taxasReais = 0;
  let taxasEstimadas = 0;

  for (const pedido of pedidosValidos) {
    const nomeCanal = pedido.canal?.nome ?? 'Sem canal';
    const tipoCanal = pedido.canal?.tipo ?? 'OUTRO';

    const itens: ItemParaMargem[] = pedido.itens.map((item) => ({
      id: item.id,
      sku: item.sku ?? item.produto?.sku ?? null,
      quantidade: Number(item.quantidade),
      valorUnitario: Number(item.valorUnitario),
      desconto: Number(item.desconto),
      custoUnitario:
        item.custoUnitario === null ? null : Number(item.custoUnitario),
      aliquotaImposto: Number(item.produto?.aliquotaImposto ?? 0),
    }));

    const taxas: TaxaParaMargem[] = pedido.taxas.map((t) => ({
      tipo: t.tipo,
      valor: Number(t.valor),
      origem: t.origem,
    }));

    for (const t of pedido.taxas) {
      if (t.origem === 'REAL') taxasReais += 1;
      else taxasEstimadas += 1;
    }

    const resultado = calcularMargemPedido({
      itens,
      descontoPedido: Number(pedido.desconto),
      freteVendedor: Number(pedido.freteVendedor),
      taxas,
    });

    totalItens += itens.length;
    totalItensSemCusto += resultado.itensSemCusto;

    // --- agregacao por canal ---
    const linhaCanal = porCanal.get(nomeCanal) ?? {
      canal: nomeCanal,
      tipo: tipoCanal,
      pedidos: 0,
      itens: 0,
      receita: 0,
      custo: 0,
      taxas: 0,
      frete: 0,
      imposto: 0,
      margem: 0,
      margemPct: 0,
      ticketMedio: 0,
      itensSemCusto: 0,
    };
    linhaCanal.pedidos += 1;
    linhaCanal.itens += itens.length;
    linhaCanal.receita += resultado.receita;
    linhaCanal.custo += resultado.custo;
    linhaCanal.taxas += resultado.taxas;
    linhaCanal.frete += resultado.frete;
    linhaCanal.imposto += resultado.imposto;
    linhaCanal.margem += resultado.margem;
    linhaCanal.itensSemCusto += resultado.itensSemCusto;
    porCanal.set(nomeCanal, linhaCanal);

    // --- agregacao por canal e mes ---
    const mes = pedido.data.toISOString().slice(0, 7);
    const kMes = chave(mes, nomeCanal);
    const linhaMes = porCanalMes.get(kMes) ?? {
      mes,
      canal: nomeCanal,
      receita: 0,
      margem: 0,
      margemPct: 0,
      pedidos: 0,
    };
    linhaMes.receita += resultado.receita;
    linhaMes.margem += resultado.margem;
    linhaMes.pedidos += 1;
    porCanalMes.set(kMes, linhaMes);

    // --- agregacao por SKU e canal ---
    for (let i = 0; i < resultado.itens.length; i += 1) {
      const m = resultado.itens[i];
      const original = pedido.itens[i];
      if (!m || !original) continue;

      const sku = m.sku ?? 'SEM-SKU';
      const k = chave(sku, nomeCanal);

      const linhaSku = porSkuCanal.get(k) ?? {
        sku,
        descricao: original.descricao ?? sku,
        canal: nomeCanal,
        quantidade: 0,
        receita: 0,
        custo: 0,
        taxas: 0,
        margem: 0,
        margemPct: 0,
        pedidos: 0,
        semCusto: false,
      };

      linhaSku.quantidade += Number(original.quantidade);
      linhaSku.receita += m.receita;
      linhaSku.custo += m.custo ?? 0;
      linhaSku.taxas += m.taxas;
      linhaSku.margem += m.margem ?? 0;
      linhaSku.pedidos += 1;
      // Basta um item sem custo para a linha inteira ficar marcada: o numero
      // agregado passa a ser parcial, e esconder isso seria enganoso.
      if (m.custoIndisponivel) linhaSku.semCusto = true;

      porSkuCanal.set(k, linhaSku);
    }
  }

  // --- finaliza percentuais ---
  const canais = [...porCanal.values()].map((c) => ({
    ...c,
    receita: arredondar(c.receita),
    custo: arredondar(c.custo),
    taxas: arredondar(c.taxas),
    frete: arredondar(c.frete),
    imposto: arredondar(c.imposto),
    margem: arredondar(c.margem),
    margemPct: c.receita === 0 ? 0 : arredondar((c.margem / c.receita) * 100),
    ticketMedio: c.pedidos === 0 ? 0 : arredondar(c.receita / c.pedidos),
  }));
  canais.sort((a, b) => b.margem - a.margem);

  const canalMes = [...porCanalMes.values()].map((m) => ({
    ...m,
    receita: arredondar(m.receita),
    margem: arredondar(m.margem),
    margemPct: m.receita === 0 ? 0 : arredondar((m.margem / m.receita) * 100),
  }));
  canalMes.sort((a, b) => a.mes.localeCompare(b.mes) || a.canal.localeCompare(b.canal));

  const skuCanal = [...porSkuCanal.values()].map((s) => ({
    ...s,
    receita: arredondar(s.receita),
    custo: arredondar(s.custo),
    taxas: arredondar(s.taxas),
    margem: arredondar(s.margem),
    margemPct: s.receita === 0 ? 0 : arredondar((s.margem / s.receita) * 100),
  }));
  skuCanal.sort((a, b) => b.margem - a.margem);

  // Prejuizo: so faz sentido listar quem tem custo conhecido. Um SKU sem custo
  // aparece com margem baixa por falta de dado, nao por estar dando prejuizo -
  // misturar os dois geraria alarme falso.
  const prejuizo = skuCanal
    .filter((s) => !s.semCusto && s.margem < 0)
    .sort((a, b) => a.margem - b.margem);

  const resultado: Analise = {
    geradoEm: new Date().toISOString(),
    periodo: { inicio: inicio.toISOString(), fim: fim.toISOString() },
    cobertura: {
      pedidos: pedidosValidos.length,
      pedidosForaDaAnalise: pedidos.length - candidatos.length,
      pedidosDuplicados: duplicadosDescartados,
      itens: totalItens,
      itensSemCusto: totalItensSemCusto,
      percentualItensComCusto:
        totalItens === 0
          ? 0
          : arredondar(((totalItens - totalItensSemCusto) / totalItens) * 100),
      taxasReais,
      taxasEstimadas,
      taxasTodasReais: taxasEstimadas === 0 && taxasReais > 0,
    },
    canais,
    canalMes,
    skuCanal,
    prejuizo,
    comparativoCanais: montarComparativo(skuCanal),
    insights: [],
  };

  resultado.insights = gerarInsights(resultado);
  return resultado;
}

/**
 * Monta a comparacao do mesmo SKU entre canais.
 *
 * Considera apenas SKUs vendidos em mais de um canal e com custo conhecido em
 * todos eles. Comparar um canal com custo conhecido contra outro sem custo
 * produziria uma diferenca que nao existe na realidade.
 */
function montarComparativo(linhas: LinhaSkuCanal[]): ComparativoSku[] {
  const porSku = new Map<string, LinhaSkuCanal[]>();

  for (const linha of linhas) {
    const lista = porSku.get(linha.sku) ?? [];
    lista.push(linha);
    porSku.set(linha.sku, lista);
  }

  const comparativos: ComparativoSku[] = [];

  for (const [sku, lista] of porSku) {
    if (lista.length < 2) continue;
    if (lista.some((l) => l.semCusto)) continue;

    const canais = lista
      .map((l) => ({
        canal: l.canal,
        quantidade: l.quantidade,
        receita: l.receita,
        margem: l.margem,
        margemPct: l.margemPct,
      }))
      .sort((a, b) => b.margemPct - a.margemPct);

    const melhor = canais[0];
    const pior = canais[canais.length - 1];
    if (!melhor || !pior) continue;

    comparativos.push({
      sku,
      descricao: lista[0]?.descricao ?? sku,
      canais,
      melhorCanal: melhor.canal,
      piorCanal: pior.canal,
      diferencaPct: arredondar(melhor.margemPct - pior.margemPct),
    });
  }

  // Maior diferenca primeiro: sao os produtos onde a escolha do canal mais pesa.
  comparativos.sort((a, b) => b.diferencaPct - a.diferencaPct);
  return comparativos;
}

// ============================================================
// Insights
// ============================================================

export interface Insight {
  tipo: 'oportunidade' | 'alerta' | 'informacao';
  titulo: string;
  texto: string;
}

/**
 * Gera observacoes em texto a partir dos numeros.
 *
 * Sao calculadas no servidor, e nao escritas a mao, para nunca contradizerem os
 * dados da tela. Cada uma aponta uma acao possivel - um painel que so mostra
 * numeros deixa o trabalho de interpretar para quem olha, e e justamente esse
 * trabalho que costuma nao acontecer.
 */
export function gerarInsights(a: Analise): Insight[] {
  const insights: Insight[] = [];
  const brl = (v: number) =>
    'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v: number) => v.toFixed(1).replace('.', ',') + '%';

  const comVolume = a.canais.filter((c) => c.pedidos >= 30);
  const receitaTotal = a.canais.reduce((s, c) => s + c.receita, 0);

  // 1. Diferenca de margem entre canais de volume relevante. Costuma ser o
  //    achado mais acionavel: mesma operacao, resultado diferente.
  if (comVolume.length >= 2) {
    const ordenados = [...comVolume].sort((x, y) => y.margemPct - x.margemPct);
    const melhor = ordenados[0];
    const pior = ordenados[ordenados.length - 1];
    if (melhor && pior && melhor.margemPct - pior.margemPct >= 2) {
      const diferenca = melhor.margemPct - pior.margemPct;
      const ganhoPotencial = (pior.receita * diferenca) / 100;
      insights.push({
        tipo: 'oportunidade',
        titulo: 'Diferença de margem entre canais',
        texto:
          `${melhor.canal} entrega ${pct(melhor.margemPct)} de margem contra ` +
          `${pct(pior.margemPct)} de ${pior.canal} — ${pct(diferenca)} de diferença. ` +
          `Se o pior igualasse o melhor, seriam ${brl(ganhoPotencial)} a mais no período.`,
      });
    }
  }

  // 2. Concentracao de faturamento.
  const lider = a.canais[0];
  if (lider && receitaTotal > 0) {
    const participacao = (lider.receita / receitaTotal) * 100;
    if (participacao >= 70) {
      insights.push({
        tipo: 'alerta',
        titulo: 'Concentração em um canal',
        texto:
          `${lider.canal} responde por ${pct(participacao)} da receita. ` +
          `Dependência alta: uma suspensão de conta ou mudança de regra nesse ` +
          `canal atinge quase toda a operação.`,
      });
    }
  }

  // 3. Produtos no prejuizo.
  if (a.prejuizo.length > 0) {
    const perda = a.prejuizo.reduce((s, p) => s + p.margem, 0);
    const pior = a.prejuizo[0];
    insights.push({
      tipo: 'alerta',
      titulo: `${a.prejuizo.length} produtos vendendo no prejuízo`,
      texto:
        `Prejuízo somado de ${brl(Math.abs(perda))} no período. ` +
        (pior ? `O pior é ${pior.sku} em ${pior.canal}, com ${brl(pior.margem)}.` : ''),
    });
  }

  // 4. Mesmo produto rendendo mais em outro canal.
  const maiorDiferenca = a.comparativoCanais[0];
  if (maiorDiferenca && maiorDiferenca.diferencaPct >= 10) {
    insights.push({
      tipo: 'oportunidade',
      titulo: 'Mesmo produto, margens muito diferentes',
      texto:
        `${maiorDiferenca.sku} rende ${pct(maiorDiferenca.diferencaPct)} a mais em ` +
        `${maiorDiferenca.melhorCanal} que em ${maiorDiferenca.piorCanal}. ` +
        `Vale rever preço ou priorizar o anúncio no canal melhor.`,
    });
  }

  // 5. Canais com volume baixo demais para conclusao.
  const semVolume = a.canais.filter((c) => c.pedidos > 0 && c.pedidos < 30);
  if (semVolume.length > 0) {
    insights.push({
      tipo: 'informacao',
      titulo: 'Canais sem volume para análise',
      texto:
        `${semVolume.map((c) => c.canal).join(', ')} ` +
        `${semVolume.length === 1 ? 'tem' : 'têm'} menos de 30 pedidos no período. ` +
        `A margem exibida é real, mas um único pedido atípico a desloca inteira — ` +
        `não é base para decidir investimento.`,
    });
  }

  // 6. Qualidade do dado: taxa estimada.
  if (a.cobertura.taxasEstimadas > 0) {
    const total = a.cobertura.taxasReais + a.cobertura.taxasEstimadas;
    const pctEstimado = (a.cobertura.taxasEstimadas / total) * 100;
    if (pctEstimado >= 10) {
      insights.push({
        tipo: 'informacao',
        titulo: 'Parte das comissões é estimada',
        texto:
          `${pct(pctEstimado)} das taxas vêm de regra, não do marketplace. ` +
          `Ative a importação de taxas na configuração da loja no Bling para ` +
          `ter a comissão exata.`,
      });
    }
  }

  return insights;
}
