import 'dotenv/config';
import { prisma, aplicarRegrasPadrao, type CanalTipo } from '@alvorada/db';
import { classificarPorIntermediador } from '@alvorada/shared';

/**
 * Reclassifica os canais ja gravados usando o bloco `intermediador` do JSON
 * bruto dos pedidos.
 *
 * Nao consome nenhuma requisicao da API: le o `pedido.raw`, que guardamos
 * justamente para situacoes como esta - descobrir um campo util depois da
 * importacao sem precisar baixar tudo de novo a 3 req/s.
 */
async function main(): Promise<void> {
  const canais = await prisma.canal.findMany({
    select: { id: true, blingId: true, nome: true, tipo: true },
  });

  console.log(`Canais cadastrados: ${canais.length}\n`);

  for (const canal of canais) {
    // Um pedido qualquer do canal basta: o intermediador e o mesmo para todos.
    // Filtrar `raw` por nulo exige sintaxe especial no Prisma para campos Json;
    // como todo pedido gravado tem raw, basta pegar o primeiro.
    const pedido = await prisma.pedido.findFirst({
      where: { canalId: canal.id },
      select: { raw: true },
    });

    const raw = pedido?.raw as { intermediador?: { cnpj?: string; nomeUsuario?: string } } | null;
    const inter = raw?.intermediador;

    if (!inter?.cnpj) {
      console.log(`  ${canal.nome}: sem intermediador no payload, mantido como esta`);
      continue;
    }

    const novo = classificarPorIntermediador(inter.cnpj, inter.nomeUsuario ?? null, canal.blingId);

    if (!novo) {
      console.log(
        `  ${canal.nome}: CNPJ ${inter.cnpj} nao reconhecido ` +
          `(conta "${inter.nomeUsuario ?? '?'}") - adicione em CNPJ_MARKETPLACE`,
      );
      continue;
    }

    if (canal.nome === novo.nome && canal.tipo === novo.tipo) {
      console.log(`  ${canal.nome}: ja estava correto`);
      continue;
    }

    await prisma.canal.update({
      where: { id: canal.id },
      data: { nome: novo.nome, tipo: novo.tipo as CanalTipo },
    });

    // As regras de taxa padrao dependem do tipo: um canal que estava como OUTRO
    // nao tinha regra nenhuma e ficaria sem taxa estimada.
    const criadas = await aplicarRegrasPadrao(canal.id, novo.tipo as CanalTipo);

    console.log(
      `  ${canal.nome} -> ${novo.nome} (${novo.tipo})` +
        (criadas > 0 ? ` [+${criadas} regras de taxa]` : ''),
    );
  }

  console.log('\nResultado:');
  const final = await prisma.canal.findMany({
    select: { nome: true, tipo: true, _count: { select: { pedidos: true } } },
    orderBy: { nome: 'asc' },
  });
  final.forEach((c) =>
    console.log(`  ${c.nome.padEnd(34)} ${c.tipo.padEnd(15)} ${c._count.pedidos} pedidos`),
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
