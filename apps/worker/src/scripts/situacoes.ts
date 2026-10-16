import 'dotenv/config';
import { criarContexto } from '../contexto.js';

/**
 * Amostra as situacoes presentes nos pedidos reais da conta.
 *
 * O endpoint /situacoes exige escopo que o aplicativo nao tem, entao inferimos
 * pelos proprios pedidos: listamos uma janela recente e contamos quais ids de
 * situacao aparecem, com um exemplo de cada.
 */
async function main(): Promise<void> {
  const ctx = await criarContexto();

  const fim = new Date();
  const ini = new Date(fim);
  ini.setMonth(ini.getMonth() - 3);

  const contagem = new Map<string, { n: number; exemplo: unknown }>();
  let lidos = 0;

  for await (const p of ctx.recursos.listarPedidos({
    dataInicial: ini.toISOString().slice(0, 10),
    dataFinal: fim.toISOString().slice(0, 10),
  })) {
    lidos += 1;
    const chave = `id=${p.situacao?.id ?? '?'} valor=${String(p.situacao?.valor ?? '?')}`;
    const atual = contagem.get(chave) ?? { n: 0, exemplo: p.situacao };
    atual.n += 1;
    contagem.set(chave, atual);

    if (lidos >= 300) break; // amostra suficiente, sem gastar o limite diario
  }

  console.log(`\nPedidos amostrados: ${lidos}\n`);
  console.log('Situacoes encontradas:');
  [...contagem.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([k, v]) => console.log(`  ${String(v.n).padStart(5)} pedidos  ${k}`));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
