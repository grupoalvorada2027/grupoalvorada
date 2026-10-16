/**
 * Classificacao de canais de venda e de situacoes de pedido.
 */

export type TipoCanal =
  | 'MERCADO_LIVRE'
  | 'SHOPEE'
  | 'TIKTOK_SHOP'
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
 * CNPJ do intermediador -> marketplace.
 *
 * Esta e a forma CONFIAVEL de identificar o canal. O pedido do Bling traz a
 * loja apenas como um id numerico proprio da conta (`loja: { id: 206165681 }`),
 * sem nome - nao da para saber se e Mercado Livre ou Shopee por ali.
 *
 * O bloco `intermediador`, porem, traz o CNPJ de quem intermediou a venda, que
 * e informacao fiscal e nao muda. Confirmado nos pedidos reais da conta em
 * 11/10/2026.
 *
 * Um detalhe que isso revelou: ha TRES contas de Mercado Livre (DIST ALVORADA,
 * GRUPOALVORADATMZ e TOMAX_INDUSTRIA) e uma de Shopee. Sem o CNPJ, as tres
 * contas do ML apareceriam como canais nao identificados.
 */
export const CNPJ_MARKETPLACE: Record<string, TipoCanal> = {
  // Mercado Livre
  '03007331000141': 'MERCADO_LIVRE',
  // Shopee - a plataforma e administrada pela SHPS Tecnologia e Servicos Ltda,
  // conforme a propria politica de privacidade da Shopee.
  '35635824000112': 'SHOPEE',
  // TikTok Shop - opera no Brasil como ByteDance Brasil Tecnologia Ltda.
  '27415911000136': 'TIKTOK_SHOP',
  '15436940000103': 'AMAZON',
  '47960950000121': 'MAGALU',
  '07170938000107': 'MAGALU', // Netshoes, do grupo Magalu
};

/** Nome amigavel do marketplace, para compor o nome do canal. */
const NOME_MARKETPLACE: Record<TipoCanal, string> = {
  MERCADO_LIVRE: 'Mercado Livre',
  SHOPEE: 'Shopee',
  TIKTOK_SHOP: 'TikTok Shop',
  AMAZON: 'Amazon',
  MAGALU: 'Magalu',
  LOJA_PROPRIA: 'Loja própria',
  OUTRO: 'Outro',
};

const soDigitos = (texto: string): string => texto.replace(/\D/g, '');

/**
 * Identifica o canal pelo bloco `intermediador` do pedido.
 *
 * Devolve o tipo e um nome legivel que inclui a conta, porque operar varias
 * contas no mesmo marketplace e comum e a comparacao entre elas tambem
 * interessa: duas contas de Mercado Livre podem ter margens bem diferentes.
 */
export function classificarPorIntermediador(
  cnpj: string | null | undefined,
  nomeUsuario: string | null | undefined,
  lojaId?: string | null,
): { tipo: TipoCanal; nome: string } | null {
  if (!cnpj) return null;

  const tipo = CNPJ_MARKETPLACE[soDigitos(cnpj)];
  if (!tipo) return null;

  const base = NOME_MARKETPLACE[tipo];
  const conta = nomeUsuario?.trim();

  // Nome legivel da conta, quando existe (ex: "DIST ALVORADA").
  if (conta && !/^\d+$/.test(conta)) {
    return { tipo, nome: `${base} · ${conta}` };
  }

  // Alguns marketplaces identificam a conta so por um numero interno, que nao
  // diz nada a quem le. Mesmo assim o canal precisa de nome UNICO: este cliente
  // tem duas contas Shopee, e sem o sufixo as duas apareceriam como "Shopee" no
  // painel, como se fossem uma so. Usamos a loja do Bling, que e o id que
  // aparece no proprio sistema e permite achar a conta la.
  if (lojaId) {
    return { tipo, nome: `${base} · loja ${lojaId}` };
  }

  return { tipo, nome: base };
}

/**
 * Deduz o tipo de canal a partir do nome da loja cadastrada no Bling.
 *
 * Usado apenas como ultimo recurso, quando o intermediador nao identifica o
 * canal. O `OUTRO` serve de balde visivel para o que nao reconhecemos - melhor
 * aparecer como nao classificado do que ser classificado errado.
 */
export function classificarCanal(nomeLoja: string | null | undefined): TipoCanal {
  if (!nomeLoja) return 'OUTRO';
  const nome = normalizar(nomeLoja);

  if (/(mercado\s*livre|mercadolivre|meli|\bml\b)/.test(nome)) return 'MERCADO_LIVRE';
  if (/shopee/.test(nome)) return 'SHOPEE';
  if (/tiktok/.test(nome)) return 'TIKTOK_SHOP';
  if (/amazon/.test(nome)) return 'AMAZON';
  if (/(magalu|magazine\s*luiza|netshoes)/.test(nome)) return 'MAGALU';
  if (/(loja\s*(propria|virtual)|site|ecommerce|e-commerce|shopify|woocommerce|tray|nuvemshop)/.test(nome)) {
    return 'LOJA_PROPRIA';
  }

  return 'OUTRO';
}

/**
 * Situacao de pedido de venda no Bling.
 *
 * O payload NAO traz o nome da situacao: traz `{ id, valor }`, ambos numericos.
 * Confirmado contra 300 pedidos reais da conta em 11/10/2026:
 *
 *   id=6  valor=0  ->  Em aberto     (184 pedidos)
 *   id=9  valor=1  ->  Atendido      (107 pedidos)
 *   id=12 valor=2  ->  Cancelado     (  9 pedidos)
 *
 * O `valor` segue a convencao fixa do Bling e e mais estavel que o `id`, que
 * pode variar quando a conta cria situacoes personalizadas.
 */
export const SITUACAO_VALOR = {
  EM_ABERTO: 0,
  ATENDIDO: 1,
  CANCELADO: 2,
  EM_ANDAMENTO: 3,
} as const;

/** Ids padrao do modulo Pedido de Venda. */
export const SITUACAO_ID = {
  EM_ABERTO: 6,
  ATENDIDO: 9,
  CANCELADO: 12,
  EM_ANDAMENTO: 15,
} as const;

/** Nomes legiveis, para exibicao. */
export function nomeDaSituacao(
  id: number | null | undefined,
  valor: number | string | null | undefined,
): string {
  const v = typeof valor === 'string' ? Number(valor) : valor;

  if (v === SITUACAO_VALOR.CANCELADO || id === SITUACAO_ID.CANCELADO) return 'Cancelado';
  if (v === SITUACAO_VALOR.ATENDIDO || id === SITUACAO_ID.ATENDIDO) return 'Atendido';
  if (v === SITUACAO_VALOR.EM_ABERTO || id === SITUACAO_ID.EM_ABERTO) return 'Em aberto';
  if (v === SITUACAO_VALOR.EM_ANDAMENTO || id === SITUACAO_ID.EM_ANDAMENTO) return 'Em andamento';

  return `Situacao ${id ?? '?'}`;
}

/**
 * Decide se um pedido entra na analise de lucratividade.
 *
 * Pedido cancelado nao gerou receita. Incluir cancelados infla o faturamento e
 * distorce a comparacao entre canais - e marketplaces tem taxas de cancelamento
 * bem diferentes entre si, entao o erro nao se anula na comparacao.
 *
 * Na duvida, o pedido CONTA: deixar de fora uma venda real seria um erro pior
 * que incluir uma situacao desconhecida, porque sumir com receita e mais dificil
 * de perceber do que um numero levemente alto.
 */
export function situacaoContaNaAnalise(
  id: number | null | undefined,
  valor: number | string | null | undefined,
): boolean {
  const v = typeof valor === 'string' ? Number(valor) : valor;

  if (v === SITUACAO_VALOR.CANCELADO) return false;
  if (id === SITUACAO_ID.CANCELADO) return false;

  return true;
}
