#!/usr/bin/env node
/**
 * Diagnostico do ambiente.
 *
 * Mostra o que ja esta pronto e o que falta para o sistema funcionar, na ordem em
 * que as coisas dependem umas das outras. Nunca imprime o valor de um segredo -
 * apenas se esta preenchido e quantos caracteres tem.
 *
 * Uso: npm run doutor
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const VERDE = '\x1b[32m';
const AMARELO = '\x1b[33m';
const VERMELHO = '\x1b[31m';
const CINZA = '\x1b[90m';
const RESET = '\x1b[0m';
const NEGRITO = '\x1b[1m';

let proximoPasso = null;

const ok = (msg, detalhe) => {
  console.log(`  ${VERDE}OK${RESET}      ${msg}${detalhe ? ` ${CINZA}${detalhe}${RESET}` : ''}`);
};
const aviso = (msg, detalhe) => {
  console.log(`  ${AMARELO}ATENCAO${RESET} ${msg}${detalhe ? `\n          ${CINZA}${detalhe}${RESET}` : ''}`);
};
const falta = (msg, comoResolver) => {
  console.log(`  ${VERMELHO}FALTA${RESET}   ${msg}`);
  if (comoResolver) console.log(`          ${CINZA}${comoResolver}${RESET}`);
  if (!proximoPasso) proximoPasso = comoResolver ?? msg;
};
const secao = (titulo) => console.log(`\n${NEGRITO}${titulo}${RESET}`);

// ------------------------------------------------------------------
secao('1. Ferramentas');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 22) ok('Node.js', `v${process.versions.node}`);
else falta(`Node.js v${process.versions.node} e antigo`, 'Instale o Node 22 ou superior');

let temPsql = false;
try {
  const v = execSync('psql --version', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  ok('PostgreSQL (cliente)', v);
  temPsql = true;
} catch {
  aviso(
    'psql nao encontrado no PATH',
    'Nao impede nada se o servidor estiver instalado; so limita testes pelo terminal.',
  );
}

try {
  execSync('cloudflared --version', { stdio: ['ignore', 'pipe', 'ignore'] });
  ok('cloudflared instalado');
} catch {
  aviso(
    'cloudflared nao instalado',
    'Necessario para expor a API. Instale com: winget install Cloudflare.cloudflared',
  );
}

// ------------------------------------------------------------------
secao('2. Configuracao (.env)');

if (!existsSync('.env')) {
  falta('Arquivo .env nao existe', 'Copie o modelo: cp .env.example .env');
} else {
  const conteudo = readFileSync('.env', 'utf8');
  const ler = (chave) => {
    const linha = conteudo
      .split('\n')
      .find((l) => l.trim().startsWith(`${chave}=`));
    if (!linha) return null;
    return linha.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  };

  const obrigatorios = [
    ['BLING_CLIENT_ID', 'Pegue no app criado no Bling'],
    ['BLING_CLIENT_SECRET', 'Pegue no app criado no Bling'],
    ['BLING_REDIRECT_URI', 'Tem de ser IDENTICA a cadastrada no app Bling'],
    ['DATABASE_URL', 'Aponte para o PostgreSQL local'],
    ['JWT_SECRET', 'Gere com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'],
  ];

  for (const [chave, dica] of obrigatorios) {
    const valor = ler(chave);
    if (!valor) {
      falta(`${chave} vazio`, dica);
      continue;
    }

    // Nunca imprimimos o valor de um segredo.
    if (chave === 'DATABASE_URL') {
      if (valor.includes('TROQUE_ESTA_SENHA')) {
        falta('DATABASE_URL ainda tem a senha de exemplo', 'Troque pela senha real do banco');
      } else {
        const semSenha = valor.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
        ok('DATABASE_URL', semSenha);
      }
    } else if (chave === 'BLING_REDIRECT_URI') {
      if (valor.includes('seudominio')) {
        falta('BLING_REDIRECT_URI ainda e o exemplo', 'Use a URL real cadastrada no Bling');
      } else if (valor.endsWith('/')) {
        falta('BLING_REDIRECT_URI termina com barra', 'Remova a barra final: o Bling compara literalmente');
      } else {
        ok('BLING_REDIRECT_URI', valor);
      }
    } else {
      ok(chave, `preenchido (${valor.length} caracteres)`);
    }
  }
}

// ------------------------------------------------------------------
secao('3. Banco de dados');

let prisma = null;
try {
  const { config } = require('dotenv');
  config();
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient({ log: [] });
  await prisma.$queryRaw`SELECT 1`;
  ok('Conexao com o PostgreSQL');

  try {
    const empresas = await prisma.empresa.count();
    ok('Tabelas criadas (migrations aplicadas)');

    // ----------------------------------------------------------------
    secao('4. Autorizacao do Bling');

    if (empresas === 0) {
      falta(
        'Nenhuma empresa autorizada',
        'Suba a API (npm run api) e acesse /oauth/iniciar no navegador',
      );
    } else {
      const token = await prisma.oAuthToken.findFirst({
        include: { empresa: { select: { nome: true } } },
      });
      if (!token) {
        falta('Empresa existe mas sem token', 'Refaca a autorizacao em /oauth/iniciar');
      } else {
        const dias = Math.floor((token.refreshExpiraEm - Date.now()) / 86400000);
        if (dias < 0) {
          falta(
            `Autorizacao EXPIRADA ha ${-dias} dias`,
            'Reautorize em /oauth/iniciar',
          );
        } else if (dias <= 7) {
          aviso(`Autorizacao expira em ${dias} dias`, 'Mantenha o worker rodando para renovar');
        } else {
          ok('Autorizacao do Bling', `${token.empresa.nome}, expira em ${dias} dias`);
        }
      }
    }

    // ----------------------------------------------------------------
    secao('5. Dados importados');

    const [produtos, custos, pedidos, canais, pendentes] = await Promise.all([
      prisma.produto.count(),
      prisma.produtoCusto.count(),
      prisma.pedido.count(),
      prisma.canal.count(),
      prisma.webhookEvent.count({ where: { status: 'PENDENTE' } }),
    ]);

    if (pedidos === 0) {
      falta(
        'Nenhum pedido importado',
        'Rode a importacao inicial: npm run backfill -w @alvorada/worker',
      );
    } else {
      ok('Pedidos', `${pedidos}`);
      ok('Canais descobertos', `${canais}`);
      ok('Produtos', `${produtos} (${custos} com custo registrado)`);

      if (custos === 0) {
        aviso(
          'Nenhum produto tem custo',
          'Sem custo nao ha margem. Cadastre o custo no Bling e rode o backfill de novo.',
        );
      } else if (custos < produtos * 0.5) {
        aviso(
          `Menos da metade dos produtos tem custo (${custos}/${produtos})`,
          'A margem desses itens fica indefinida de proposito, para nao inventar lucro.',
        );
      }

      const semCusto = await prisma.pedidoItem.count({ where: { custoUnitario: null } });
      const totalItens = await prisma.pedidoItem.count();
      if (semCusto > 0) {
        aviso(
          `${semCusto} de ${totalItens} itens de pedido estao sem custo`,
          'Esses itens aparecem como lacuna nos relatorios, nunca como margem cheia.',
        );
      }

      const taxasReais = await prisma.pedidoTaxa.count({ where: { origem: 'REAL' } });
      const taxasEstimadas = await prisma.pedidoTaxa.count({ where: { origem: 'ESTIMADO' } });
      if (taxasReais === 0 && taxasEstimadas > 0) {
        aviso(
          'Todas as taxas sao ESTIMADAS, nenhuma real',
          'Ative a importacao de taxas na configuracao das lojas no Bling para ter a comissao real.',
        );
      } else if (taxasReais > 0) {
        ok('Taxas', `${taxasReais} reais, ${taxasEstimadas} estimadas`);
      }

      if (pendentes > 0) ok('Fila de webhooks', `${pendentes} pendente(s)`);
    }
  } catch (erro) {
    if (String(erro).includes('does not exist') || erro?.code === 'P2021') {
      falta('Tabelas nao criadas', 'Aplique o schema: npm run db:migrate');
    } else {
      falta(`Erro ao consultar o banco: ${String(erro).slice(0, 120)}`);
    }
  }
} catch (erro) {
  const msg = String(erro);
  if (msg.includes('P1001') || msg.includes("Can't reach database")) {
    falta(
      'PostgreSQL nao esta acessivel',
      'Instale o PostgreSQL 16 e confira DATABASE_URL. Veja docs/setup-servidor.md',
    );
  } else if (msg.includes('P1000')) {
    falta('Usuario ou senha do banco incorretos', 'Confira DATABASE_URL no .env');
  } else if (msg.includes('P1003')) {
    falta('O banco nao existe', 'Crie com: CREATE DATABASE alvorada_bi OWNER alvorada;');
  } else {
    falta(`Falha ao conectar: ${msg.slice(0, 160)}`);
  }
} finally {
  await prisma?.$disconnect().catch(() => {});
}

// ------------------------------------------------------------------
console.log('');
if (proximoPasso) {
  console.log(`${NEGRITO}Proximo passo:${RESET} ${proximoPasso}\n`);
  process.exit(1);
} else {
  console.log(`${VERDE}${NEGRITO}Ambiente completo.${RESET} Deixe o worker rodando: npm run worker\n`);
}
