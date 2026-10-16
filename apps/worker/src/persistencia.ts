import {
  prisma,
  Prisma,
  aplicarRegrasPadrao,
  type CanalTipo,
} from '@alvorada/db';
import { classificarCanal, situacaoContaNaAnalise } from '@alvorada/shared';
import type { PedidoDetalhe, Produto, ProdutoCustoApi } from '@alvorada/bling';

/**
 * Gravacao dos dados do Bling no banco.
 *
 * Tres pontos deste arquivo merecem leitura atenta antes de confiar nos numeros:
 * a vigencia inicial do custo, a extracao do frete e a extracao das taxas. Cada
 * um esta comentado no ponto onde aparece.
 */

/**
 * Data usada como inicio de vigencia na PRIMEIRA carga de custo de um produto.
 *
 * Isto e uma aproximacao deliberada e precisa ser entendida: na primeira
 * importacao conhecemos apenas o custo atual do produto, nao o historico. Para
 * que pedidos dos ultimos meses encontrem algum custo, assumimos que o custo
 * atual valia desde sempre.
 *
 * Consequencia pratica: se o custo de um produto mudou nos ultimos 3 meses, a
 * margem dos pedidos anteriores a mudanca sai calculada com o custo novo. A
 * partir daqui o historico passa a ser registrado corretamente, porque cada
 * alteracao futura cria uma nova vigencia. Vale avisar o usuario em vez de
 * apresentar o numero como exato.
 */
const INICIO_VIGENCIA_PRIMEIRA_CARGA = new Date('2000-01-01T00:00:00.000Z');

const dec = (valor: number | null | undefined): Prisma.Decimal =>
  new Prisma.Decimal(valor ?? 0);

const decOuNulo = (valor: number | null | undefined): Prisma.Decimal | null =>
  valor === null || valor === undefined ? null : new Prisma.Decimal(valor);

/** Converte data do Bling ("2026-01-15" ou ISO) para Date. */
export function parseDataBling(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (!texto) return null;
  // "2026-01-15" vira meia-noite local; "2026-01-15 14:30:00" tambem e aceito.
  const normalizado = texto.includes('T') ? texto : texto.replace(' ', 'T');
  const data = new Date(normalizado);
  return Number.isNaN(data.getTime()) ? null : data;
}

// ============================================================
// Canais
// ============================================================

/**
 * Garante que o canal exista, criando a partir da loja do pedido.
 *
 * Derivamos os canais dos proprios pedidos em vez de depender de um endpoint de
 * listagem de lojas: funciona em qualquer conta e nao gasta requisicao extra. O
 * tipo e deduzido do nome e fica editavel na interface.
 */
export async function garantirCanal(
  empresaId: number,
  loja: { id?: string; nome?: string } | undefined,
): Promise<number | null> {
  if (!loja?.id) return null;

  const existente = await prisma.canal.findUnique({
    where: { empresaId_blingId: { empresaId, blingId: loja.id } },
    select: { id: true },
  });

  if (existente) return existente.id;

  const nome = loja.nome?.trim() || `Loja ${loja.id}`;
  const tipo = classificarCanal(nome) as CanalTipo;

  const criado = await prisma.canal.create({
    data: { empresaId, blingId: loja.id, nome, tipo },
    select: { id: true },
  });

  // Um canal recem-descoberto nasce com as regras de taxa padrao do seu tipo.
  // Sem isso, os pedidos desse canal ficariam sem nenhuma taxa e apareceriam com
  // margem artificialmente alta - o erro mais perigoso possivel aqui, porque
  // levaria a investir no canal errado.
  await aplicarRegrasPadrao(criado.id, tipo);

  return criado.id;
}

// ============================================================
// Produtos e custos
// ============================================================

export async function salvarProduto(
  empresaId: number,
  produto: Produto,
): Promise<number> {
  const sku = produto.codigo?.trim() || `BLING-${produto.id}`;
  const peso = produto.pesoLiquido ?? produto.pesoBruto ?? null;

  const registro = await prisma.produto.upsert({
    where: { empresaId_blingId: { empresaId, blingId: produto.id } },
    create: {
      empresaId,
      blingId: produto.id,
      sku,
      nome: produto.nome || sku,
      gtin: produto.gtin ?? null,
      unidade: produto.unidade ?? null,
      pesoKg: decOuNulo(peso),
      ativo: produto.situacao !== 'I',
      raw: produto as unknown as Prisma.InputJsonValue,
      sincronizadoEm: new Date(),
    },
    update: {
      sku,
      nome: produto.nome || sku,
      gtin: produto.gtin ?? null,
      unidade: produto.unidade ?? null,
      pesoKg: decOuNulo(peso),
      ativo: produto.situacao !== 'I',
      raw: produto as unknown as Prisma.InputJsonValue,
      sincronizadoEm: new Date(),
    },
    select: { id: true },
  });

  // O custo pode vir embutido no proprio produto, dentro de `fornecedor`.
  if (produto.fornecedor?.precoCusto != null) {
    await registrarCusto(registro.id, {
      precoCusto: produto.fornecedor.precoCusto,
      precoCompra: produto.fornecedor.precoCompra ?? null,
    });
  }

  return registro.id;
}

/**
 * Registra o custo do produto, mantendo historico.
 *
 * Se o custo nao mudou, nao faz nada. Se mudou, fecha a vigencia anterior e abre
 * uma nova a partir de agora. Nunca sobrescreve: e isso que permite recalcular a
 * margem de um pedido antigo com o custo que valia naquele dia.
 */
export async function registrarCusto(
  produtoId: number,
  dados: { precoCusto: number; precoCompra?: number | null },
): Promise<void> {
  const vigente = await prisma.produtoCusto.findFirst({
    where: { produtoId, vigenciaFim: null },
    orderBy: { vigenciaInicio: 'desc' },
  });

  const novoCusto = new Prisma.Decimal(dados.precoCusto);

  if (vigente) {
    if (vigente.custo.equals(novoCusto)) {
      return; // custo inalterado
    }

    const agora = new Date();
    await prisma.$transaction([
      prisma.produtoCusto.update({
        where: { id: vigente.id },
        data: { vigenciaFim: agora },
      }),
      prisma.produtoCusto.create({
        data: {
          produtoId,
          custo: novoCusto,
          precoCompra: decOuNulo(dados.precoCompra),
          vigenciaInicio: agora,
        },
      }),
    ]);
    return;
  }

  // Primeira carga: ver a nota em INICIO_VIGENCIA_PRIMEIRA_CARGA.
  await prisma.produtoCusto.create({
    data: {
      produtoId,
      custo: novoCusto,
      precoCompra: decOuNulo(dados.precoCompra),
      vigenciaInicio: INICIO_VIGENCIA_PRIMEIRA_CARGA,
    },
  });
}

export async function salvarCustosEmLote(
  empresaId: number,
  custos: Map<string, ProdutoCustoApi>,
): Promise<number> {
  let gravados = 0;

  for (const [blingId, custo] of custos) {
    if (custo.precoCusto == null) continue;

    const produto = await prisma.produto.findUnique({
      where: { empresaId_blingId: { empresaId, blingId } },
      select: { id: true },
    });
    if (!produto) continue;

    await registrarCusto(produto.id, {
      precoCusto: custo.precoCusto,
      precoCompra: custo.precoCompra ?? null,
    });
    gravados += 1;
  }

  return gravados;
}

/** Custo vigente de um produto em uma data. Null quando nao houver. */
export async function custoVigente(
  produtoId: number,
  data: Date,
): Promise<number | null> {
  const registro = await prisma.produtoCusto.findFirst({
    where: {
      produtoId,
      vigenciaInicio: { lte: data },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: data } }],
    },
    orderBy: { vigenciaInicio: 'desc' },
    select: { custo: true },
  });

  return registro ? Number(registro.custo) : null;
}

// ============================================================
// Frete e taxas
// ============================================================

/**
 * Separa o frete entre o que o cliente pagou e o que o vendedor bancou.
 *
 * Somente o frete por conta do vendedor e custo e entra na margem. Misturar os
 * dois e um erro que distorce a comparacao entre canais justamente onde ela mais
 * importa: Mercado Livre e Shopee subsidiam frete de formas diferentes.
 *
 * `fretePorConta` segue a convencao da NF-e, em que 0 indica frete por conta do
 * remetente (o vendedor) e 1 indica por conta do destinatario. Os demais codigos
 * (2, 3, 4, 9) descrevem terceiros ou ausencia de frete e sao tratados como nao
 * sendo custo do vendedor.
 *
 * ATENCAO: esta leitura precisa ser confirmada contra pedidos reais da conta
 * (use `npm run inspecionar -w @alvorada/worker`). Se o campo vier diferente, o
 * valor cai em freteCliente e a margem fica otimista - e preferivel errar para
 * o lado conservador, mas o certo e confirmar.
 */
export function extrairFrete(detalhe: PedidoDetalhe): {
  freteCliente: number;
  freteVendedor: number;
} {
  const transporte = detalhe.transporte;
  const valorFrete = Number(transporte?.frete ?? 0) || 0;

  if (valorFrete === 0) {
    return { freteCliente: 0, freteVendedor: 0 };
  }

  const porConta = transporte?.fretePorConta;
  const codigo = porConta === null || porConta === undefined ? null : String(porConta);

  const porContaDoVendedor = codigo === '0' || codigo === 'R';

  return porContaDoVendedor
    ? { freteCliente: 0, freteVendedor: valorFrete }
    : { freteCliente: valorFrete, freteVendedor: 0 };
}

export interface TaxaExtraida {
  tipo: 'COMISSAO' | 'FRETE' | 'TARIFA_FIXA' | 'ANTECIPACAO' | 'OUTRA';
  valor: number;
  origem: 'REAL' | 'ESTIMADO';
  descricao: string | null;
}

/**
 * Extrai as taxas reais do marketplace a partir do payload do pedido.
 *
 * DELIBERADAMENTE CONSERVADOR: so reconhecemos a estrutura `taxas` quando ela
 * vem num formato que entendemos. Nao varremos o JSON procurando qualquer numero
 * parecido com taxa.
 *
 * O motivo e direto: um palpite errado aqui nao gera erro, gera um numero de
 * lucro plausivel e falso, que e o pior resultado possivel num sistema de
 * decisao. Quando nao reconhecemos nada, devolvemos lista vazia e o pedido passa
 * a usar as regras de taxa estimada, marcadas como ESTIMADO.
 *
 * Para confirmar o formato real desta conta, rode:
 *   npm run inspecionar -w @alvorada/worker -- <id-do-pedido>
 */
export function extrairTaxasReais(detalhe: PedidoDetalhe): TaxaExtraida[] {
  const bruto = detalhe.taxas;
  if (!bruto || typeof bruto !== 'object') return [];

  const taxas: TaxaExtraida[] = [];

  const lerNumero = (valor: unknown): number | null => {
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    if (typeof valor === 'string') {
      const n = Number(valor.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const objeto = bruto as Record<string, unknown>;

  // Formato esperado: { taxaComissao, custoFrete, taxaFixa, ... }
  const mapa: Array<[string, TaxaExtraida['tipo']]> = [
    ['taxaComissao', 'COMISSAO'],
    ['comissao', 'COMISSAO'],
    ['custoFrete', 'FRETE'],
    ['taxaFrete', 'FRETE'],
    ['taxaFixa', 'TARIFA_FIXA'],
    ['taxaAntecipacao', 'ANTECIPACAO'],
  ];

  for (const [chave, tipo] of mapa) {
    const valor = lerNumero(objeto[chave]);
    if (valor !== null && valor !== 0) {
      taxas.push({ tipo, valor: Math.abs(valor), origem: 'REAL', descricao: chave });
    }
  }

  return taxas;
}

/**
 * Calcula taxas estimadas a partir das regras do canal.
 *
 * Usado somente quando a taxa real nao veio. O resultado e marcado como
 * ESTIMADO, e a interface mostra essa distincao: um relatorio que mistura taxa
 * real e estimada sem avisar nao permite saber o quanto confiar no numero.
 */
export async function calcularTaxasEstimadas(
  canalId: number | null,
  data: Date,
  receitaTotal: number,
): Promise<TaxaExtraida[]> {
  if (canalId === null || receitaTotal <= 0) return [];

  const regras = await prisma.regraTaxa.findMany({
    where: {
      canalId,
      ativa: true,
      vigenciaInicio: { lte: data },
      OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: data } }],
      AND: [
        {
          OR: [{ valorMinimo: null }, { valorMinimo: { lte: receitaTotal } }],
        },
        {
          OR: [{ valorMaximo: null }, { valorMaximo: { gte: receitaTotal } }],
        },
      ],
    },
    orderBy: { prioridade: 'desc' },
  });

  // Aplicamos apenas a regra de maior prioridade que casou, nao todas: somar
  // regras sobrepostas cobraria comissao em dobro.
  const regra = regras[0];
  if (!regra) return [];

  const taxas: TaxaExtraida[] = [];

  const percentual = Number(regra.percentual);
  if (percentual > 0) {
    taxas.push({
      tipo: 'COMISSAO',
      valor: (receitaTotal * percentual) / 100,
      origem: 'ESTIMADO',
      descricao: regra.descricao,
    });
  }

  const fixa = Number(regra.taxaFixa);
  if (fixa > 0) {
    taxas.push({
      tipo: 'TARIFA_FIXA',
      valor: fixa,
      origem: 'ESTIMADO',
      descricao: regra.descricao,
    });
  }

  return taxas;
}

// ============================================================
// Pedidos
// ============================================================

export interface ResultadoSalvarPedido {
  pedidoId: number;
  criado: boolean;
  ignoradoPorVersao: boolean;
  itensSemCusto: number;
}

/**
 * Grava um pedido completo com itens e taxas.
 *
 * Idempotente: pode ser chamado quantas vezes for, com o mesmo pedido, sem
 * duplicar nada. Isso e requisito, nao refinamento - os webhooks do Bling
 * reentregam o mesmo evento e nao garantem ordem.
 *
 * Itens e taxas sao apagados e regravados em vez de atualizados um a um. E mais
 * simples e mais correto: se um item foi removido do pedido no Bling, um diff
 * cuidadoso poderia deixa-lo para tras e inflar a receita.
 */
export async function salvarPedido(
  empresaId: number,
  detalhe: PedidoDetalhe,
  opcoes: { versaoEvento?: Date | null } = {},
): Promise<ResultadoSalvarPedido> {
  const data = parseDataBling(detalhe.data) ?? new Date();
  const canalId = await garantirCanal(empresaId, detalhe.loja);

  const existente = await prisma.pedido.findUnique({
    where: { empresaId_blingId: { empresaId, blingId: detalhe.id } },
    select: { id: true, versaoEvento: true },
  });

  // Webhooks chegam fora de ordem. Um evento mais antigo que o ja aplicado nao
  // pode sobrescrever o estado atual: um pedido cancelado as 10h05 nao deve
  // voltar a "em aberto" porque o evento das 10h00 chegou depois.
  if (
    existente &&
    opcoes.versaoEvento &&
    existente.versaoEvento &&
    opcoes.versaoEvento < existente.versaoEvento
  ) {
    return {
      pedidoId: existente.id,
      criado: false,
      ignoradoPorVersao: true,
      itensSemCusto: 0,
    };
  }

  const { freteCliente, freteVendedor } = extrairFrete(detalhe);
  const situacaoNome =
    detalhe.situacao?.valor !== undefined
      ? String(detalhe.situacao.valor)
      : null;

  const dadosPedido = {
    empresaId,
    blingId: detalhe.id,
    numero: detalhe.numero != null ? String(detalhe.numero) : null,
    numeroLoja: detalhe.numeroLoja != null ? String(detalhe.numeroLoja) : null,
    canalId,
    data,
    dataSaida: parseDataBling(detalhe.dataSaida),
    situacaoId: detalhe.situacao?.id ?? null,
    situacaoNome,
    considerarNaAnalise: situacaoContaNaAnalise(situacaoNome),
    totalProdutos: dec(detalhe.totalProdutos),
    totalPedido: dec(detalhe.total),
    desconto: dec(detalhe.desconto?.valor),
    freteCliente: dec(freteCliente),
    freteVendedor: dec(freteVendedor),
    contatoNome: detalhe.contato?.nome ?? null,
    contatoDoc: detalhe.contato?.numeroDocumento ?? null,
    raw: detalhe as unknown as Prisma.InputJsonValue,
    sincronizadoEm: new Date(),
    versaoEvento: opcoes.versaoEvento ?? null,
  };

  const pedido = await prisma.pedido.upsert({
    where: { empresaId_blingId: { empresaId, blingId: detalhe.id } },
    create: dadosPedido,
    update: dadosPedido,
    select: { id: true },
  });

  // --- Itens ---
  let itensSemCusto = 0;
  const itensParaCriar: Prisma.PedidoItemCreateManyInput[] = [];
  let receitaTotal = 0;

  for (const item of detalhe.itens) {
    const blingIdProduto = item.produto?.id ?? null;
    let produtoId: number | null = null;

    if (blingIdProduto) {
      const produto = await prisma.produto.findUnique({
        where: { empresaId_blingId: { empresaId, blingId: blingIdProduto } },
        select: { id: true },
      });
      produtoId = produto?.id ?? null;
    }

    const custo = produtoId !== null ? await custoVigente(produtoId, data) : null;
    if (custo === null) itensSemCusto += 1;

    const receita = item.quantidade * item.valor - (item.desconto ?? 0);
    receitaTotal += receita;

    itensParaCriar.push({
      pedidoId: pedido.id,
      produtoId,
      sku: item.codigo ?? item.produto?.codigo ?? null,
      descricao: item.descricao ?? null,
      quantidade: dec(item.quantidade),
      valorUnitario: dec(item.valor),
      desconto: dec(item.desconto),
      custoUnitario: decOuNulo(custo),
    });
  }

  // --- Taxas ---
  let taxas = extrairTaxasReais(detalhe);
  if (taxas.length === 0) {
    taxas = await calcularTaxasEstimadas(canalId, data, receitaTotal);
  }

  await prisma.$transaction([
    prisma.pedidoItem.deleteMany({ where: { pedidoId: pedido.id } }),
    prisma.pedidoTaxa.deleteMany({ where: { pedidoId: pedido.id } }),
    prisma.pedidoItem.createMany({ data: itensParaCriar }),
    prisma.pedidoTaxa.createMany({
      data: taxas.map((t) => ({
        pedidoId: pedido.id,
        tipo: t.tipo,
        origem: t.origem,
        valor: dec(t.valor),
        descricao: t.descricao,
      })),
    }),
  ]);

  return {
    pedidoId: pedido.id,
    criado: !existente,
    ignoradoPorVersao: false,
    itensSemCusto,
  };
}
