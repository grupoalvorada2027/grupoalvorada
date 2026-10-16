import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { prisma } from './cliente.js';
import { aplicarRegrasPadrao } from './regras-padrao.js';

/**
 * Carga inicial do banco.
 *
 * Idempotente: pode rodar quantas vezes quiser. Nao sobrescreve senha de usuario
 * existente nem regra de taxa que tenha sido ajustada.
 *
 * Rode depois do backfill tambem: os canais sao descobertos a partir dos pedidos,
 * e uma segunda execucao cria as regras de taxa dos canais que apareceram.
 */
async function main(): Promise<void> {
  console.log('Seed: iniciando\n');

  // --- Usuario administrador ---
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_SENHA;

  if (!email || !senha) {
    console.log(
      'Usuario admin: ADMIN_EMAIL ou ADMIN_SENHA ausentes no .env, pulando.\n' +
        '  Para criar o administrador, preencha as duas variaveis e rode o seed de novo.\n',
    );
  } else if (senha.length < 10) {
    // Falhamos de proposito em vez de criar um acesso fraco: este usuario ve
    // custo e margem de toda a operacao.
    throw new Error(
      'ADMIN_SENHA tem menos de 10 caracteres. Use uma senha mais longa: ' +
        'este usuario tem acesso total aos dados financeiros.',
    );
  } else {
    const existente = await prisma.usuario.findUnique({ where: { email } });

    if (existente) {
      console.log(`Usuario admin: ${email} ja existe, senha preservada.`);
    } else {
      await prisma.usuario.create({
        data: {
          email,
          nome: process.env.ADMIN_NOME ?? 'Administrador',
          senhaHash: await hash(senha),
          papel: 'ADMIN',
        },
      });
      console.log(`Usuario admin criado: ${email}`);
    }
  }

  // --- Regras de taxa dos canais existentes ---
  const canais = await prisma.canal.findMany({
    select: { id: true, nome: true, tipo: true },
  });

  if (canais.length === 0) {
    console.log(
      '\nNenhum canal cadastrado ainda. Isso e esperado antes do primeiro backfill:\n' +
        '  os canais sao descobertos a partir das lojas dos pedidos importados.\n' +
        '  Rode o backfill e depois este seed novamente para criar as regras de taxa.',
    );
  } else {
    console.log('\nRegras de taxa:');
    for (const canal of canais) {
      const criadas = await aplicarRegrasPadrao(canal.id, canal.tipo);
      console.log(
        criadas > 0
          ? `  ${canal.nome} (${canal.tipo}): ${criadas} regra(s) criada(s)`
          : `  ${canal.nome} (${canal.tipo}): mantido como esta`,
      );
    }
    console.log(
      '\n  ATENCAO: as regras criadas usam percentuais genericos de mercado, nao\n' +
        '  as suas taxas reais. Confira com o extrato do marketplace e ajuste.\n' +
        '  Taxas reais importadas do Bling tem precedencia sobre estas regras.',
    );
  }

  console.log('\nSeed: concluido');
}

main()
  .catch((erro) => {
    console.error('\nSeed falhou:', erro);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
