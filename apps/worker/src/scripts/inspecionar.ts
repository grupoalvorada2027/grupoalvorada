import 'dotenv/config';
import { criarContexto } from '../contexto.js';
import { extrairFrete, extrairTaxasReais } from '../persistencia.js';

/**
 * Ferramenta de diagnostico: mostra o JSON CRU de um pedido real da conta.
 *
 * Existe porque a documentacao do Bling e uma SPA e nao expoe em texto a lista
 * completa de campos. Varios nomes usados no sistema foram inferidos, e dois
 * deles decidem se o lucro sai certo:
 *
 *   - onde vem o frete e quem o paga (`transporte.fretePorConta`)
 *   - onde vem a comissao do marketplace (`taxas`)
 *
 * Em vez de adivinhar e gerar numero plausivel e errado, este script mostra a
 * verdade da sua conta para ajustarmos o codigo com certeza.
 *
 * Uso:
 *   npm run inspecionar -w @alvorada/worker                 # pedido mais recente
 *   npm run inspecionar -w @alvorada/worker -- 123456789    # pedido especifico
 */
async function main(): Promise<void> {
  const ctx = await criarContexto();
  const idInformado = process.argv[2];

  let idPedido = idInformado;

  if (!idPedido) {
    ctx.logger.info('Nenhum id informado, buscando o pedido mais recente');
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setMonth(inicio.getMonth() - 1);

    for await (const resumo of ctx.recursos.listarPedidos({
      dataInicial: inicio.toISOString().slice(0, 10),
      dataFinal: hoje.toISOString().slice(0, 10),
    })) {
      idPedido = resumo.id;
      break; // so o primeiro
    }
  }

  if (!idPedido) {
    console.error(
      'Nenhum pedido encontrado no ultimo mes. Informe um id: npm run inspecionar -w @alvorada/worker -- <id>',
    );
    process.exit(1);
  }

  // Buscamos sem validacao de schema, para ver exatamente o que o Bling manda.
  const cru = await ctx.client.bruto(`/pedidos/vendas/${idPedido}`);

  console.log('\n===================== JSON CRU DO PEDIDO =====================');
  console.log(JSON.stringify(cru, null, 2));

  const dados = (cru as { data?: Record<string, unknown> })?.data;

  console.log('\n===================== LEITURA DO SISTEMA =====================');

  if (!dados) {
    console.log('Resposta sem campo `data`. O envelope mudou - avise para ajustarmos.');
  } else {
    console.log('\n--- Bloco de transporte (origem do frete) ---');
    console.log(JSON.stringify(dados.transporte ?? null, null, 2));

    console.log('\n--- Bloco de taxas (origem da comissao do marketplace) ---');
    if (dados.taxas === undefined) {
      console.log(
        'CAMPO AUSENTE. O pedido nao traz `taxas`.\n' +
          'Verifique se a importacao de taxas do marketplace esta ativada na\n' +
          'configuracao da loja dentro do Bling. Sem isso, a comissao sera\n' +
          'ESTIMADA por regra, nao real.',
      );
    } else {
      console.log(JSON.stringify(dados.taxas, null, 2));
    }

    console.log('\n--- Chaves presentes no primeiro nivel ---');
    console.log(Object.keys(dados).sort().join(', '));

    // Mostra como o sistema interpretou, para comparacao direta.
    try {
      const comoLemos = dados as never;
      console.log('\n--- Como o sistema interpretou ---');
      console.log('frete:', JSON.stringify(extrairFrete(comoLemos)));
      console.log('taxas reais:', JSON.stringify(extrairTaxasReais(comoLemos)));
      console.log(
        '\nSe as taxas reais vierem vazias mas existirem no JSON acima, o caminho\n' +
          'de leitura precisa ser ajustado em apps/worker/src/persistencia.ts\n' +
          '(funcao extrairTaxasReais).',
      );
    } catch (erro) {
      console.log('Falha ao interpretar:', String(erro));
    }
  }

  const stats = ctx.rateLimiter.estatisticas;
  console.log(
    `\nRequisicoes consumidas nesta execucao: ${stats.consumidasHoje}/${stats.tetoDiario}`,
  );

  process.exit(0);
}

main().catch((erro) => {
  console.error('Falha na inspecao:', erro);
  process.exit(1);
});
