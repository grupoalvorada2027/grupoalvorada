/**
 * Classificacao de canais de venda e de situacoes de pedido.
 */

export type TipoCanal =
  | 'MERCADO_LIVRE'
  | 'SHOPEE'
  | 'AMAZON'
  | 'MAGALU'
  | 'LOJA_PROPRIA'
  | 'OUTRO';

const normalizar = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .trim();

/**
 * Deduz o tipo de canal a partir do nome da loja cadastrada no Bling.
 *
 * Classificamos por nome porque o Bling identifica a loja por um id proprio de
 * cada conta, sem um campo estavel que diga "este e o Mercado Livre". O nome e o
 * que o usuario escolheu, entao a deducao e um palpite informado: o tipo fica
 * editavel na interface, e o `OUTRO` serve de balde visivel para o que nao
 * reconhecemos - melhor aparecer como nao classificado do que ser classificado
 * errado.
 */
export function classificarCanal(nomeLoja: string | null | undefined): TipoCanal {
  if (!nomeLoja) return 'OUTRO';
  const nome = normalizar(nomeLoja);

  if (/(mercado\s*livre|mercadolivre|meli|\bml\b)/.test(nome)) return 'MERCADO_LIVRE';
  if (/shopee/.test(nome)) return 'SHOPEE';
  if (/amazon/.test(nome)) return 'AMAZON';
  if (/(magalu|magazine\s*luiza|netshoes)/.test(nome)) return 'MAGALU';
  if (/(loja\s*(propria|virtual)|site|ecommerce|e-commerce|shopify|woocommerce|tray|nuvemshop)/.test(nome)) {
    return 'LOJA_PROPRIA';
  }

  return 'OUTRO';
}

/**
 * Situacoes que NAO entram na analise de lucratividade.
 *
 * Pedido cancelado ou devolvido nao gerou receita. Incluir esses pedidos infla o
 * faturamento e, pior, dilui a margem percentual, porque os custos de frete e
 * taxa as vezes permanecem enquanto a receita desaparece.
 */
export const SITUACOES_FORA_DA_ANALISE = [
  'cancelado',
  'devolvido',
  'recusado',
  'estornado',
] as const;

/**
 * Decide se um pedido conta na analise, a partir do nome da situacao.
 *
 * Usamos o nome e nao o id porque os ids de situacao sao configuraveis por conta
 * no Bling - uma conta pode ter situacoes personalizadas. O nome e menos
 * estavel, mas e o unico sinal portavel; situacoes personalizadas que precisem
 * ficar de fora podem ser tratadas ajustando esta lista.
 */
export function situacaoContaNaAnalise(
  nomeSituacao: string | null | undefined,
): boolean {
  if (!nomeSituacao) return true; // sem informacao, assumimos que conta
  const nome = normalizar(nomeSituacao);
  return !SITUACOES_FORA_DA_ANALISE.some((fora) => nome.includes(fora));
}
