import 'dotenv/config';
import { criarContexto } from '../contexto.js';

/**
 * Procura os nomes das lojas (canais de venda).
 *
 * O pedido traz apenas `loja: { id }`, sem nome. Sem o nome nao ha como saber
 * qual canal e Mercado Livre e qual e Shopee - que e a comparacao central do
 * sistema. Testamos os endpoints candidatos para descobrir onde essa informacao
 * esta disponivel nesta conta.
 */
async function main(): Promise<void> {
  const ctx = await criarContexto();

  const candidatos = [
    '/lojas',
    '/canais-de-venda',
    '/lojas-virtuais',
    '/vendas/lojas',
    '/pedidos/vendas/lojas',
  ];

  for (const caminho of candidatos) {
    try {
      const r = await ctx.client.bruto(caminho, { nuloSeAusente: true });
      if (r === null) {
        console.log(`${caminho.padEnd(26)} -> 404 (nao existe)`);
        continue;
      }
      console.log(`\n===== ${caminho} =====`);
      console.log(JSON.stringify(r, null, 2).slice(0, 1800));
    } catch (erro) {
      const msg = String(erro);
      const curto = msg.includes('insufficient_scope')
        ? 'sem escopo'
        : msg.slice(0, 110);
      console.log(`${caminho.padEnd(26)} -> ${curto}`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
