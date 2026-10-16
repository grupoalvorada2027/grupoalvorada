export {
  calcularMargemPedido,
  receitaItem,
  ratear,
  arredondar,
  type ItemParaMargem,
  type TaxaParaMargem,
  type PedidoParaMargem,
  type MargemItem,
  type MargemPedido,
} from './margem.js';

export {
  classificarCanal,
  classificarPorIntermediador,
  CNPJ_MARKETPLACE,
  situacaoContaNaAnalise,
  nomeDaSituacao,
  SITUACAO_VALOR,
  SITUACAO_ID,
  type TipoCanal,
} from './canais.js';

export { carregarEnv, limparCacheEnv, type Env } from './env.js';
