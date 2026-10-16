import { prisma } from './cliente.js';
import type { CanalTipo } from '@prisma/client';

/**
 * Regras de taxa iniciais por canal.
 *
 * LEIA ANTES DE CONFIAR NESTES NUMEROS.
 *
 * Estes valores sao um ponto de partida plausivel, NAO as suas taxas reais.
 * Comissao de marketplace varia por categoria de produto, por programa de frete
 * (frete gratis costuma elevar a comissao), por regiao e por acordo comercial, e
 * os marketplaces reajustam periodicamente.
 *
 * Duas coisas tornam isso administravel:
 *
 *  1. Toda taxa calculada por estas regras e gravada com origem ESTIMADO, e os
 *     relatorios mostram essa marca. Um numero estimado nunca se disfarca de
 *     numero real.
 *
 *  2. Com a importacao de taxas do marketplace ativada no Bling (disponivel nos
 *     planos Titanio, Diamante e Elite), a comissao REAL de cada pedido chega
 *     pela API e tem precedencia sobre estas regras. Nesse cenario as regras
 *     servem apenas de rede para pedidos em que a taxa nao veio.
 *
 * Ajuste os valores na tela de regras conferindo com o extrato do marketplace.
 */

export interface RegraPadrao {
  descricao: string;
  percentual: number;
  taxaFixa: number;
  valorMinimo: number | null;
  valorMaximo: number | null;
  prioridade: number;
}

/**
 * O Mercado Livre cobra comissao percentual e, em itens de baixo valor, tambem
 * uma tarifa fixa por unidade. Por isso duas faixas: a tarifa fixa deixa de
 * existir acima do limite.
 */
const MERCADO_LIVRE: RegraPadrao[] = [
  {
    descricao: 'Mercado Livre - itens abaixo de R$ 79 (comissao + tarifa fixa)',
    percentual: 14,
    taxaFixa: 6,
    valorMinimo: null,
    valorMaximo: 78.99,
    prioridade: 10,
  },
  {
    descricao: 'Mercado Livre - itens de R$ 79 ou mais (comissao)',
    percentual: 14,
    taxaFixa: 0,
    valorMinimo: 79,
    valorMaximo: null,
    prioridade: 5,
  },
];

const SHOPEE: RegraPadrao[] = [
  {
    descricao: 'Shopee - comissao padrao + tarifa por item',
    percentual: 14,
    taxaFixa: 4,
    valorMinimo: null,
    valorMaximo: null,
    prioridade: 5,
  },
];

const AMAZON: RegraPadrao[] = [
  {
    descricao: 'Amazon - comissao padrao',
    percentual: 15,
    taxaFixa: 0,
    valorMinimo: null,
    valorMaximo: null,
    prioridade: 5,
  },
];

const MAGALU: RegraPadrao[] = [
  {
    descricao: 'Magalu - comissao padrao',
    percentual: 16,
    taxaFixa: 0,
    valorMinimo: null,
    valorMaximo: null,
    prioridade: 5,
  },
];

export const REGRAS_PADRAO: Record<CanalTipo, RegraPadrao[]> = {
  MERCADO_LIVRE,
  SHOPEE,
  AMAZON,
  MAGALU,
  // Loja propria nao tem comissao de marketplace. Taxa de meio de pagamento, se
  // houver, deve ser cadastrada manualmente.
  LOJA_PROPRIA: [],
  OUTRO: [],
};

/**
 * Cria as regras padrao de um canal, caso ele ainda nao tenha nenhuma.
 *
 * Nao sobrescreve regras existentes: se o usuario ajustou a comissao para o valor
 * real dele, uma sincronizacao nao pode desfazer esse trabalho.
 */
export async function aplicarRegrasPadrao(
  canalId: number,
  tipo: CanalTipo,
): Promise<number> {
  const jaTem = await prisma.regraTaxa.count({ where: { canalId } });
  if (jaTem > 0) return 0;

  const regras = REGRAS_PADRAO[tipo] ?? [];
  if (regras.length === 0) return 0;

  // Vigencia a partir de uma data bem antiga, para que as regras tambem valham
  // para os pedidos historicos importados no backfill.
  const vigenciaInicio = new Date('2000-01-01T00:00:00.000Z');

  await prisma.regraTaxa.createMany({
    data: regras.map((r) => ({
      canalId,
      descricao: r.descricao,
      percentual: r.percentual,
      taxaFixa: r.taxaFixa,
      valorMinimo: r.valorMinimo,
      valorMaximo: r.valorMaximo,
      prioridade: r.prioridade,
      vigenciaInicio,
    })),
  });

  return regras.length;
}
