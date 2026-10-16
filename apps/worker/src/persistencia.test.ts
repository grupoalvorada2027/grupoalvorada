import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extrairFrete, extrairTaxasReais } from './persistencia.js';
import { situacaoContaNaAnalise, nomeDaSituacao } from '@alvorada/shared';
import type { PedidoDetalhe } from '@alvorada/bling';

/**
 * Testes das regras descobertas inspecionando pedidos REAIS da conta em
 * 11/10/2026. Cada caso aqui corresponde a um formato que a API devolveu de
 * verdade - nao a uma suposicao sobre como ela deveria funcionar.
 */

const pedido = (over: Partial<PedidoDetalhe> = {}): PedidoDetalhe =>
  ({ id: '1', itens: [], ...over }) as PedidoDetalhe;

describe('extrairFrete', () => {
  it('le o frete do marketplace em taxas.custoFrete', () => {
    // Formato real de um pedido do Mercado Livre: o frete do vendedor vem nas
    // taxas, e transporte.frete fica zerado.
    const r = extrairFrete(
      pedido({
        taxas: { taxaComissao: 32.24, custoFrete: 75.65, valorBase: 307 },
        transporte: { fretePorConta: 0, frete: 0 },
      } as Partial<PedidoDetalhe>),
    );

    assert.equal(r.freteVendedor, 75.65, 'o frete do marketplace e custo do vendedor');
    assert.equal(r.freteCliente, 0);
  });

  it('usa o bloco de transporte quando nao ha custoFrete nas taxas', () => {
    const r = extrairFrete(
      pedido({ transporte: { fretePorConta: 0, frete: 40 } } as Partial<PedidoDetalhe>),
    );
    assert.equal(r.freteVendedor, 40);
  });

  it('nao conta como custo o frete por conta do destinatario', () => {
    const r = extrairFrete(
      pedido({ transporte: { fretePorConta: 1, frete: 40 } } as Partial<PedidoDetalhe>),
    );
    assert.equal(r.freteVendedor, 0, 'quem pagou foi o cliente');
    assert.equal(r.freteCliente, 40);
  });

  it('devolve zero quando nao ha frete em lugar nenhum', () => {
    const r = extrairFrete(pedido());
    assert.deepEqual(r, { freteCliente: 0, freteVendedor: 0 });
  });

  it('trata valor negativo como custo positivo', () => {
    const r = extrairFrete(
      pedido({ taxas: { custoFrete: -75.65 } } as Partial<PedidoDetalhe>),
    );
    assert.equal(r.freteVendedor, 75.65);
  });
});

describe('extrairTaxasReais', () => {
  it('le a comissao real do marketplace', () => {
    const taxas = extrairTaxasReais(
      pedido({
        taxas: { taxaComissao: 32.24, custoFrete: 75.65, valorBase: 307 },
      } as Partial<PedidoDetalhe>),
    );

    assert.equal(taxas.length, 1, 'so a comissao vira taxa');
    assert.equal(taxas[0]?.tipo, 'COMISSAO');
    assert.equal(taxas[0]?.valor, 32.24);
    assert.equal(taxas[0]?.origem, 'REAL');
  });

  it('NAO inclui custoFrete, que ja e contado como frete do pedido', () => {
    // Se o frete entrasse aqui tambem, seria descontado duas vezes e a margem
    // sairia menor que a real.
    const taxas = extrairTaxasReais(
      pedido({ taxas: { custoFrete: 75.65 } } as Partial<PedidoDetalhe>),
    );
    assert.equal(
      taxas.some((t) => t.tipo === 'FRETE'),
      false,
    );
  });

  it('NAO trata valorBase como cobranca', () => {
    // valorBase e a base de calculo da comissao, nao um valor cobrado.
    const taxas = extrairTaxasReais(
      pedido({ taxas: { valorBase: 307 } } as Partial<PedidoDetalhe>),
    );
    assert.equal(taxas.length, 0);
  });

  it('devolve vazio quando o pedido nao tem bloco de taxas', () => {
    assert.deepEqual(extrairTaxasReais(pedido()), []);
  });

  it('reconhece tarifa fixa e antecipacao quando presentes', () => {
    const taxas = extrairTaxasReais(
      pedido({
        taxas: { taxaComissao: 10, taxaFixa: 6, taxaAntecipacao: 2 },
      } as Partial<PedidoDetalhe>),
    );
    assert.equal(taxas.length, 3);
    assert.deepEqual(
      taxas.map((t) => t.tipo).sort(),
      ['ANTECIPACAO', 'COMISSAO', 'TARIFA_FIXA'],
    );
  });
});

describe('situacaoContaNaAnalise', () => {
  // Valores conferidos em 300 pedidos reais da conta.
  it('inclui pedido em aberto (id 6, valor 0)', () => {
    assert.equal(situacaoContaNaAnalise(6, 0), true);
  });

  it('inclui pedido atendido (id 9, valor 1)', () => {
    assert.equal(situacaoContaNaAnalise(9, 1), true);
  });

  it('EXCLUI pedido cancelado (id 12, valor 2)', () => {
    assert.equal(situacaoContaNaAnalise(12, 2), false);
  });

  it('exclui cancelado mesmo se so o valor vier', () => {
    assert.equal(situacaoContaNaAnalise(null, 2), false);
  });

  it('exclui cancelado mesmo se o valor vier como string', () => {
    assert.equal(situacaoContaNaAnalise(null, '2'), false);
  });

  it('na duvida, inclui: sumir com receita e pior que inflar', () => {
    assert.equal(situacaoContaNaAnalise(null, null), true);
    assert.equal(situacaoContaNaAnalise(999, 7), true);
  });
});

describe('nomeDaSituacao', () => {
  it('traduz os codigos numericos para texto legivel', () => {
    assert.equal(nomeDaSituacao(6, 0), 'Em aberto');
    assert.equal(nomeDaSituacao(9, 1), 'Atendido');
    assert.equal(nomeDaSituacao(12, 2), 'Cancelado');
  });

  it('nao inventa nome para situacao desconhecida', () => {
    assert.match(nomeDaSituacao(77, 9), /77/);
  });
});
