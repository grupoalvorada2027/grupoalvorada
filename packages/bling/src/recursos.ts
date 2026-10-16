import { z } from 'zod';
import { BlingClient } from './client.js';

/**
 * Schemas e acesso aos recursos do Bling v3 que interessam a analise de margem.
 *
 * ESTRATEGIA DOS SCHEMAS: sao deliberadamente tolerantes. Todo campo alem do
 * identificador e opcional e objetos usam `passthrough`, por tres razoes:
 *
 *  1. A documentacao oficial e uma SPA e nao expoe a lista completa de campos em
 *     texto, entao parte dos nomes foi inferida e precisa ser confirmada contra
 *     a API real (ver script `inspecionar-pedido`).
 *  2. O Bling publica changelog de payload, ou seja, os campos mudam.
 *  3. Guardamos o JSON cru em `pedido.raw`, entao nada se perde: se descobrirmos
 *     um campo novo depois, reprocessamos o historico sem baixar de novo - o que
 *     importa quando o limite e 3 req/s.
 *
 * O que NAO e tolerante: os campos que entram no calculo de margem. Se o valor
 * de um item vier em formato inesperado, e melhor estourar erro do que gravar
 * um numero silenciosamente errado.
 */

/** Converte valores que o Bling as vezes manda como string ("1234.50"). */
const numeroFlexivel = z.union([z.number(), z.string()]).transform((valor) => {
  if (typeof valor === 'number') return valor;
  const limpo = valor.trim().replace(',', '.');
  const n = Number(limpo);
  if (!Number.isFinite(n)) {
    throw new Error(`Valor numerico invalido recebido do Bling: ${valor}`);
  }
  return n;
});

const numeroOpcional = numeroFlexivel.optional().nullable();

const idFlexivel = z.union([z.number(), z.string()]).transform(String);

// ============================================================
// Pedidos de venda
// ============================================================

const situacaoSchema = z
  .object({
    id: z.number().optional(),
    valor: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const lojaSchema = z
  .object({
    id: idFlexivel.optional(),
    nome: z.string().optional(),
negocio: z.string().optional(),
  })
  .passthrough();

const contatoSchema = z
  .object({
    id: idFlexivel.optional(),
    nome: z.string().optional(),
    numeroDocumento: z.string().optional(),
  })
  .passthrough();

/** Item do pedido. Os campos de valor aqui alimentam a margem diretamente. */
const itemPedidoSchema = z
  .object({
    id: idFlexivel.optional(),
    codigo: z.string().optional().nullable(),
    descricao: z.string().optional().nullable(),
    unidade: z.string().optional().nullable(),
    quantidade: numeroFlexivel,
    valor: numeroFlexivel,
    desconto: numeroOpcional,
    aliquotaIPI: numeroOpcional,
    produto: z
      .object({ id: idFlexivel.optional(), codigo: z.string().optional() })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

const descontoSchema = z
  .object({
    valor: numeroOpcional,
    unidade: z.string().optional(),
  })
  .passthrough();

/**
 * Bloco de transporte. O frete aparece aqui, e a distincao importa:
 * `fretePorConta` indica quem paga, e so o frete por conta do vendedor entra
 * como custo na margem.
 */
const transporteSchema = z
  .object({
    fretePorConta: z.union([z.number(), z.string()]).optional().nullable(),
    frete: numeroOpcional,
    etiqueta: z.unknown().optional(),
    volumes: z.unknown().optional(),
  })
  .passthrough();

/** Pedido como vem na LISTAGEM (resumido). */
export const pedidoListaSchema = z
  .object({
    id: idFlexivel,
    numero: z.union([z.number(), z.string()]).optional().nullable(),
    numeroLoja: z.union([z.number(), z.string()]).optional().nullable(),
    data: z.string().optional(),
    dataSaida: z.string().optional().nullable(),
    total: numeroOpcional,
    situacao: situacaoSchema.optional(),
    loja: lojaSchema.optional(),
    contato: contatoSchema.optional(),
  })
  .passthrough();

export type PedidoLista = z.infer<typeof pedidoListaSchema>;

/**
 * Pedido COMPLETO, como vem em GET /pedidos/vendas/{id}.
 *
 * A listagem nao traz itens nem valores detalhados, por isso o backfill precisa
 * de uma chamada por pedido. E o que domina o custo da importacao: 1 chamada de
 * lista por 100 pedidos, mais 1 chamada por pedido.
 */
export const pedidoDetalheSchema = z
  .object({
    id: idFlexivel,
    numero: z.union([z.number(), z.string()]).optional().nullable(),
    numeroLoja: z.union([z.number(), z.string()]).optional().nullable(),
    data: z.string().optional(),
    dataSaida: z.string().optional().nullable(),
    dataPrevista: z.string().optional().nullable(),
    totalProdutos: numeroOpcional,
    total: numeroOpcional,
    observacoes: z.string().optional().nullable(),
    situacao: situacaoSchema.optional(),
    loja: lojaSchema.optional(),
    contato: contatoSchema.optional(),
    desconto: descontoSchema.optional().nullable(),
    transporte: transporteSchema.optional().nullable(),
    itens: z.array(itemPedidoSchema).default([]),
    /** Taxas do marketplace podem aparecer aqui, conforme a loja. */
    taxas: z.unknown().optional(),
    tributacao: z.unknown().optional(),
    parcelas: z.unknown().optional(),
  })
  .passthrough();

export type PedidoDetalhe = z.infer<typeof pedidoDetalheSchema>;

const envelopeDadoSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ data: schema });

// ============================================================
// Produtos e custos
// ============================================================

export const produtoSchema = z
  .object({
    id: idFlexivel,
    nome: z.string().optional().default(''),
    codigo: z.string().optional().nullable(),
    preco: numeroOpcional,
    unidade: z.string().optional().nullable(),
    gtin: z.string().optional().nullable(),
    pesoLiquido: numeroOpcional,
    pesoBruto: numeroOpcional,
    situacao: z.string().optional().nullable(),
    tipo: z.string().optional().nullable(),
    formato: z.string().optional().nullable(),
    /**
     * ATENCAO: o precoCusto do Bling v3 vive DENTRO de `fornecedor`, nao na raiz
     * do produto. Enviar precoCusto na raiz faz o Bling responder 200 sem salvar
     * nada - uma das pegadinhas mais custosas desta API.
     */
    fornecedor: z
      .object({
        id: idFlexivel.optional(),
        precoCusto: numeroOpcional,
        precoCompra: numeroOpcional,
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

export type Produto = z.infer<typeof produtoSchema>;

/** Resposta do endpoint dedicado de custos. */
export const produtoCustoSchema = z
  .object({
    id: idFlexivel.optional(),
    codigo: z.string().optional().nullable(),
    precoCusto: numeroOpcional,
    precoCompra: numeroOpcional,
  })
  .passthrough();

export type ProdutoCustoApi = z.infer<typeof produtoCustoSchema>;

// ============================================================
// Acesso aos recursos
// ============================================================

export interface FiltroPedidos {
  /** Data inicial no formato YYYY-MM-DD. */
  dataInicial?: string;
  /** Data final no formato YYYY-MM-DD. */
  dataFinal?: string;
  /** Filtra por loja (canal). */
  idLoja?: string;
  /** Filtra por situacao do pedido. */
  idSituacao?: number;
  /** Data de alteracao inicial, usada no sync incremental. */
  dataAlteracaoInicial?: string;
}

export class RecursosBling {
  constructor(private readonly client: BlingClient) {}

  /**
   * Lista pedidos de venda pagina por pagina.
   *
   * Observacao sobre o sync incremental: filtrar por `dataAlteracaoInicial`
   * captura pedidos antigos que mudaram de situacao (um pedido de janeiro
   * cancelado hoje precisa sair da analise). Filtrar apenas por data de venda
   * deixaria essas mudancas passar.
   */
  listarPedidos(
    filtro: FiltroPedidos = {},
    opcoes: {
      paginaInicial?: number;
      aoVirarPagina?: (pagina: number, itensLidos: number) => Promise<void>;
    } = {},
  ): AsyncGenerator<PedidoLista, void, void> {
    return this.client.paginar('/pedidos/vendas', pedidoListaSchema, {
      query: {
        dataInicial: filtro.dataInicial,
        dataFinal: filtro.dataFinal,
        idLoja: filtro.idLoja,
        idSituacao: filtro.idSituacao,
        dataAlteracaoInicial: filtro.dataAlteracaoInicial,
      },
      paginaInicial: opcoes.paginaInicial,
      aoVirarPagina: opcoes.aoVirarPagina,
    });
  }

  /** Busca o pedido completo, com itens e valores. */
  async obterPedido(id: string): Promise<PedidoDetalhe | null> {
    const resposta = await this.client.requisitar(
      `/pedidos/vendas/${id}`,
      envelopeDadoSchema(pedidoDetalheSchema),
      { nuloSeAusente: true },
    );
    return resposta?.data ?? null;
  }

  /** Lista produtos pagina por pagina. */
  listarProdutos(
    opcoes: {
      paginaInicial?: number;
      aoVirarPagina?: (pagina: number, itensLidos: number) => Promise<void>;
    } = {},
  ): AsyncGenerator<Produto, void, void> {
    return this.client.paginar('/produtos', produtoSchema, {
      query: { tipo: 'P' },
      paginaInicial: opcoes.paginaInicial,
      aoVirarPagina: opcoes.aoVirarPagina,
    });
  }

  async obterProduto(id: string): Promise<Produto | null> {
    const resposta = await this.client.requisitar(
      `/produtos/${id}`,
      envelopeDadoSchema(produtoSchema),
      { nuloSeAusente: true },
    );
    return resposta?.data ?? null;
  }

  /**
   * Busca custos em lote.
   *
   * O endpoint dedicado aceita ate 40 produtos por chamada, o que importa muito
   * a 2,5 req/s: 2.000 SKUs saem em 50 chamadas (~20s) em vez de 2.000 chamadas
   * individuais (~13 minutos).
   *
   * O formato exato do parametro nao esta documentado em texto na SPA do Bling,
   * entao ha fallback: se a chamada em lote falhar, caimos para leitura
   * individual via GET /produtos/{id}, que e lenta mas comprovadamente funciona.
   * O fallback registra aviso para que isso seja corrigido, nao escondido.
   */
  async obterCustos(idsProdutos: string[]): Promise<Map<string, ProdutoCustoApi>> {
    const resultado = new Map<string, ProdutoCustoApi>();
    if (idsProdutos.length === 0) return resultado;

    const LOTE = 40;
    for (let i = 0; i < idsProdutos.length; i += LOTE) {
      const lote = idsProdutos.slice(i, i + LOTE);

      let sucessoEmLote = false;
      try {
        const query: Record<string, string> = {};
        lote.forEach((id, indice) => {
          query[`idsProdutos[${indice}]`] = id;
        });

        const resposta = await this.client.requisitar(
          '/produtos/custo',
          z.object({ data: z.array(produtoCustoSchema).default([]) }),
          { query },
        );

        if (resposta) {
          for (const item of resposta.data) {
            if (item.id) resultado.set(item.id, item);
          }
          sucessoEmLote = true;
        }
      } catch {
        sucessoEmLote = false;
      }

      if (!sucessoEmLote) {
        for (const id of lote) {
          const produto = await this.obterProduto(id);
          if (produto?.fornecedor) {
            resultado.set(id, {
              id,
              codigo: produto.codigo ?? null,
              precoCusto: produto.fornecedor.precoCusto ?? null,
              precoCompra: produto.fornecedor.precoCompra ?? null,
            });
          }
        }
      }
    }

    return resultado;
  }
}
