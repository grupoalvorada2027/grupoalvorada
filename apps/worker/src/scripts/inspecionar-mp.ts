import 'dotenv/config';

/**
 * Diagnostico do Mercado Pago: mostra o formato REAL dos pagamentos da conta.
 *
 * Mesma razao do inspecionar.ts do Bling: antes de gravar qualquer numero,
 * confirmar com dados de verdade onde vem o valor liquido, as tarifas e a data
 * de liberacao. Um campo lido errado aqui nao da erro, da um "a receber"
 * plausivel e falso.
 *
 * Le toda variavel MP_ACCESS_TOKEN ou MP_ACCESS_TOKEN_<APELIDO> do .env, uma por
 * conta do Mercado Pago (cada conta do Mercado Livre tem a sua).
 *
 * Nada do comprador e impresso: nem nome, nem e-mail, nem documento. So a forma
 * dos dados e os valores do vendedor.
 *
 * Uso:
 *   npm run inspecionar:mp -w @alvorada/worker
 *   npm run inspecionar:mp -w @alvorada/worker -- 20   # quantos pagamentos
 */

const API = 'https://api.mercadopago.com';

type Json = Record<string, unknown>;

async function chamar(token: string, caminho: string): Promise<{ status: number; corpo: Json }> {
  const resp = await fetch(API + caminho, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const texto = await resp.text();
  let corpo: Json = {};
  try { corpo = JSON.parse(texto) as Json; } catch { corpo = { bruto: texto.slice(0, 200) }; }
  return { status: resp.status, corpo };
}

function credenciais(): Array<{ apelido: string; token: string }> {
  return Object.entries(process.env)
    .filter(([k, v]) => /^MP_ACCESS_TOKEN(_[A-Z0-9_]+)?$/.test(k) && v)
    .map(([k, v]) => ({ apelido: k.replace(/^MP_ACCESS_TOKEN_?/, '') || 'PADRAO', token: String(v) }));
}

const num = (v: unknown): string => (typeof v === 'number' ? v.toFixed(2) : String(v ?? '-'));

async function inspecionarConta(apelido: string, token: string, quantos: number): Promise<void> {
  console.log(`\n================ ${apelido} ================`);
  // So o prefixo: o suficiente para saber se e producao (APP_USR) ou teste (TEST).
  console.log(`token: ${token.slice(0, 8)}... (${token.startsWith('APP_USR') ? 'producao' : 'NAO e producao'})`);

  const eu = await chamar(token, '/users/me');
  if (eu.status !== 200) {
    console.log(`  /users/me -> HTTP ${eu.status}: ${JSON.stringify(eu.corpo).slice(0, 200)}`);
    return;
  }
  console.log(`conta: id ${String(eu.corpo.id)} | apelido ${String(eu.corpo.nickname)} | site ${String(eu.corpo.site_id)}`);

  const busca = await chamar(token, `/v1/payments/search?sort=date_created&criteria=desc&limit=${quantos}`);
  if (busca.status !== 200) {
    console.log(`  /v1/payments/search -> HTTP ${busca.status}: ${JSON.stringify(busca.corpo).slice(0, 200)}`);
    return;
  }
  const resultados = (busca.corpo.results as Json[] | undefined) ?? [];
  const paginacao = busca.corpo.paging as Json | undefined;
  console.log(`pagamentos na conta: ${String(paginacao?.total ?? '?')} | mostrando ${resultados.length}`);

  // Contagem de situacoes: mostra quais status realmente aparecem na conta.
  const contagem = new Map<string, number>();
  for (const p of resultados) {
    const chave = `${String(p.status)} / ${String(p.status_detail)} / liberacao ${String(p.money_release_status ?? '-')}`;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  console.log('\nsituacoes encontradas:');
  for (const [k, n] of contagem) console.log(`  ${n}x  ${k}`);

  console.log('\nid | criado | status | bruto | liquido | tarifas | liberacao | origem');
  for (const p of resultados) {
    const det = (p.transaction_details as Json | undefined) ?? {};
    const tarifas = ((p.fee_details as Json[] | undefined) ?? [])
      .map((f) => `${String(f.type)}:${num(f.amount)}`).join(',') || '-';
    const pedido = p.order as Json | undefined;
    const origem = pedido?.id ? `${String(pedido.type)}#${String(pedido.id)}` : `ref:${p.external_reference ? 'sim' : 'nao'}`;
    console.log([
      String(p.id), String(p.date_created).slice(0, 10), String(p.status),
      num(p.transaction_amount), num(det.net_received_amount), tarifas,
      `${String(p.money_release_date ?? '-').slice(0, 10)} ${String(p.money_release_status ?? '')}`,
      `${String(p.operation_type)} ${String(p.payment_type_id)} ${origem}`,
    ].join(' | '));
  }

  if (resultados[0]) {
    console.log('\ncampos de primeiro nivel de um pagamento real:');
    console.log('  ' + Object.keys(resultados[0]).sort().join(', '));
  }

  // O Relatorio de Liberacoes precisa de configuracao antes do primeiro uso.
  const cfg = await chamar(token, '/v1/account/release_report/config');
  console.log(`\nrelatorio de liberacoes: config -> HTTP ${cfg.status}` +
    (cfg.status === 200 ? ` | colunas: ${((cfg.corpo.columns as Json[] | undefined) ?? []).length}` : ` (${JSON.stringify(cfg.corpo).slice(0, 150)})`));
}

async function main(): Promise<void> {
  const contas = credenciais();
  if (contas.length === 0) {
    console.error('Nenhuma MP_ACCESS_TOKEN no .env. Veja o passo 1 em docs/mercado-pago.md.');
    process.exit(1);
  }
  const quantos = Math.min(Math.max(Number(process.argv[2]) || 10, 1), 50);
  for (const c of contas) await inspecionarConta(c.apelido, c.token, quantos);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
