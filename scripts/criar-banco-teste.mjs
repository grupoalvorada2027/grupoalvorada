#!/usr/bin/env node
/**
 * Cria o banco de homologação a partir de uma amostra do banco real.
 *
 * Por que uma AMOSTRA e não uma cópia inteira: o banco real tem quase 10 mil
 * pedidos e cresce. Para testar uma mudança de cálculo ou de tela, alguns
 * milhares de registros bastam, e o banco de teste fica leve o suficiente para
 * ser recriado quantas vezes for preciso.
 *
 * O que NÃO é copiado, de propósito:
 *   - oauth_token  : credencial de acesso ao Bling. O ambiente de teste não
 *                    deve conseguir falar com o ERP de produção; um backfill
 *                    disparado por engano lá consumiria o limite diário de
 *                    requisições da conta real.
 *   - usuario/sessao: logins de produção não valem em teste.
 *
 * Uso:
 *   node scripts/criar-banco-teste.mjs            # últimos 30 dias
 *   node scripts/criar-banco-teste.mjs --dias 90
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';

const DIAS = (() => {
  const i = process.argv.indexOf('--dias');
  const v = i >= 0 ? Number(process.argv[i + 1]) : 30;
  return Number.isFinite(v) && v > 0 ? v : 30;
})();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não está definida no .env');
  process.exit(1);
}

const origem = new URL(url);
const bancoOrigem = origem.pathname.replace(/^\//, '').split('?')[0];
const bancoTeste = bancoOrigem + '_teste';

console.log(`Origem.: ${bancoOrigem} em ${origem.hostname}:${origem.port}`);
console.log(`Destino: ${bancoTeste}`);
console.log(`Janela.: últimos ${DIAS} dias\n`);

const psqlBase = [
  '-h', origem.hostname,
  '-p', origem.port || '5432',
  '-U', decodeURIComponent(origem.username),
];

const env = { ...process.env, PGPASSWORD: decodeURIComponent(origem.password) };

function psql(banco, sql) {
  return execFileSync('psql', [...psqlBase, '-d', banco, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env,
    encoding: 'utf8',
  });
}

try {
  execFileSync('psql', ['--version'], { stdio: 'ignore' });
} catch {
  console.error(
    'psql não encontrado no PATH.\n' +
      'Adicione a pasta bin do PostgreSQL, por exemplo:\n' +
      '  C:\\Program Files\\PostgreSQL\\18\\bin',
  );
  process.exit(1);
}

try {
  console.log('1. Recriando o banco de teste...');
  // Derruba conexões abertas, senão o DROP falha.
  psql(
    bancoOrigem,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '${bancoTeste}' AND pid <> pg_backend_pid();`,
  );
  psql(bancoOrigem, `DROP DATABASE IF EXISTS ${bancoTeste};`);
  psql(bancoOrigem, `CREATE DATABASE ${bancoTeste} OWNER ${decodeURIComponent(origem.username)};`);
  console.log('   banco criado');

  console.log('2. Copiando a estrutura (sem dados)...');
  const estrutura = execFileSync(
    'pg_dump',
    [...psqlBase, '-d', bancoOrigem, '--schema-only', '--no-owner', '--no-privileges'],
    { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  execFileSync('psql', [...psqlBase, '-d', bancoTeste, '-v', 'ON_ERROR_STOP=1'], {
    env,
    input: estrutura,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  console.log('   estrutura copiada');

  console.log(`3. Copiando os dados dos últimos ${DIAS} dias...`);

  // A ordem respeita as chaves estrangeiras: empresa antes de canal, canal
  // antes de pedido, e assim por diante.
  const copias = [
    ['empresa', 'SELECT * FROM empresa'],
    ['canal', 'SELECT * FROM canal'],
    ['produto', 'SELECT * FROM produto'],
    ['produto_custo', 'SELECT * FROM produto_custo'],
    ['regra_taxa', 'SELECT * FROM regra_taxa'],
    ['pedido', `SELECT * FROM pedido WHERE data >= now() - interval '${DIAS} days'`],
    [
      'pedido_item',
      `SELECT i.* FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
       WHERE p.data >= now() - interval '${DIAS} days'`,
    ],
    [
      'pedido_taxa',
      `SELECT t.* FROM pedido_taxa t JOIN pedido p ON p.id = t.pedido_id
       WHERE p.data >= now() - interval '${DIAS} days'`,
    ],
  ];

  for (const [tabela, consulta] of copias) {
    const dados = execFileSync(
      'psql',
      [...psqlBase, '-d', bancoOrigem, '-v', 'ON_ERROR_STOP=1', '-c',
       `COPY (${consulta}) TO STDOUT`],
      { env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );

    if (dados.trim().length === 0) {
      console.log(`   ${tabela.padEnd(14)} vazio`);
      continue;
    }

    execFileSync(
      'psql',
      [...psqlBase, '-d', bancoTeste, '-v', 'ON_ERROR_STOP=1', '-c',
       `COPY ${tabela} FROM STDIN`],
      { env, input: dados, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
    );

    const linhas = dados.trim().split('\n').length;
    console.log(`   ${tabela.padEnd(14)} ${linhas} registros`);
  }

  console.log('4. Ajustando as sequências...');
  // Sem isto, um INSERT no banco de teste tentaria reusar ids já existentes.
  psql(
    bancoTeste,
    `DO $$
     DECLARE r RECORD;
     BEGIN
       FOR r IN
         SELECT c.relname AS seq, t.relname AS tabela, a.attname AS coluna
         FROM pg_class c
         JOIN pg_depend d ON d.objid = c.oid
         JOIN pg_class t ON t.oid = d.refobjid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
         WHERE c.relkind = 'S'
       LOOP
         EXECUTE format(
           'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 1))',
           r.seq, r.coluna, r.tabela);
       END LOOP;
     END $$;`,
  );
  console.log('   sequências ajustadas');

  const destino = new URL(url);
  destino.pathname = '/' + bancoTeste;

  console.log('\n' + '='.repeat(68));
  console.log('BANCO DE TESTE PRONTO');
  console.log('='.repeat(68));
  console.log('\nUse esta linha no .env do ambiente de homologação:\n');
  console.log(`DATABASE_URL="${destino.toString()}"`);
  console.log(
    '\nO token do Bling NÃO foi copiado de propósito: o ambiente de teste não\n' +
      'deve falar com o ERP de produção, para não consumir o limite diário de\n' +
      'requisições da conta real.\n',
  );
} catch (erro) {
  console.error('\nFalhou:', erro.message);
  if (erro.stderr) console.error(String(erro.stderr).slice(0, 800));
  process.exit(1);
}
