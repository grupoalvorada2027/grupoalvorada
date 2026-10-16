import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arredondar,
  ratear,
  calcularMargemPedido,
  type ItemParaMargem,
} from './margem.js';

const item = (over: Partial<ItemParaMargem> = {}): ItemParaMargem => ({
  id: 1,
  sku: 'SKU-1',
  quantidade: 1,
  valorUnitario: 100,
  desconto: 0,
  custoUnitario: 40,
  aliquotaImposto: 0,
  ...over,
});

describe('ratear', () => {
  it('distribui proporcionalmente e a soma fecha exatamente com o total', () => {
    const partes = ratear(10, [1, 1, 1]);
    assert.equal(
      partes.reduce((a, b) => a + b, 0),
      10,
      'a soma das partes tem de ser igual ao total',
    );
  });

  it('nao perde centavos em divisao com resto', () => {
    // 100 / 3 = 33,333... Arredondar cada parte isoladamente daria 99,99.
    const partes = ratear(100, [1, 1, 1]);
    assert.equal(partes.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(partes.map((p) => Math.round(p * 100)).sort((a, b) => a - b), [
      3333, 3333, 3334,
    ]);
  });

  it('respeita o peso de cada item', () => {
    const partes = ratear(90, [100, 200]);
    assert.deepEqual(partes, [30, 60]);
  });

  it('distribui igualmente quando a soma dos pesos e zero', () => {
    const partes = ratear(10, [0, 0]);
    assert.deepEqual(partes, [5, 5]);
    assert.equal(partes.reduce((a, b) => a + b, 0), 10);
  });

  it('lida com valores negativos (estorno) sem perder centavos', () => {
    const partes = ratear(-10, [1, 1, 1]);
    assert.equal(arredondar(partes.reduce((a, b) => a + b, 0)), -10);
  });

  it('devolve lista vazia quando nao ha itens', () => {
    assert.deepEqual(ratear(10, []), []);
  });
});

describe('calcularMargemPedido', () => {
  it('calcula a margem de um pedido simples', () => {
    const r = calcularMargemPedido({
      itens: [item({ valorUnitario: 100, custoUnitario: 40 })],
      descontoPedido: 0,
      freteVendedor: 10,
      taxas: [{ tipo: 'COMISSAO', valor: 14, origem: 'REAL' }],
    });

    // 100 de receita - 40 de custo - 14 de comissao - 10 de frete = 36
    assert.equal(r.receita, 100);
    assert.equal(r.custo, 40);
    assert.equal(r.margem, 36);
    assert.equal(r.margemPercentual, 36);
    assert.equal(r.margemParcial, false);
    assert.equal(r.taxasTodasReais, true);
  });

  it('aplica imposto sobre a receita', () => {
    const r = calcularMargemPedido({
      itens: [item({ valorUnitario: 100, custoUnitario: 40, aliquotaImposto: 12 })],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [],
    });

    assert.equal(r.imposto, 12);
    assert.equal(r.margem, 48); // 100 - 40 - 12
  });

  it('abate o desconto do pedido da receita, nao do custo', () => {
    const r = calcularMargemPedido({
      itens: [item({ valorUnitario: 100, custoUnitario: 40 })],
      descontoPedido: 20,
      freteVendedor: 0,
      taxas: [],
    });

    assert.equal(r.receita, 80, 'desconto do pedido reduz a receita');
    assert.equal(r.custo, 40, 'desconto nao altera o custo');
    assert.equal(r.margem, 40);
  });

  it('rateia taxas e frete entre os itens pela participacao na receita', () => {
    const r = calcularMargemPedido({
      itens: [
        item({ id: 1, valorUnitario: 100, custoUnitario: 50 }),
        item({ id: 2, valorUnitario: 300, custoUnitario: 100 }),
      ],
      descontoPedido: 0,
      freteVendedor: 40,
      taxas: [{ tipo: 'COMISSAO', valor: 40, origem: 'REAL' }],
    });

    const i1 = r.itens.find((i) => i.id === 1);
    const i2 = r.itens.find((i) => i.id === 2);

    // Item 1 representa 25% da receita, item 2 representa 75%.
    assert.equal(i1?.taxas, 10);
    assert.equal(i2?.taxas, 30);
    assert.equal(i1?.frete, 10);
    assert.equal(i2?.frete, 30);

    // O total do pedido tem de bater com a soma das linhas.
    assert.equal(r.taxas, 40);
    assert.equal(r.frete, 40);
  });

  it('NAO trata custo ausente como zero: a margem do item fica indefinida', () => {
    const r = calcularMargemPedido({
      itens: [item({ valorUnitario: 100, custoUnitario: null })],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [],
    });

    const linha = r.itens[0];
    assert.equal(linha?.custo, null);
    assert.equal(linha?.margem, null, 'margem indefinida, nao 100');
    assert.equal(linha?.margemPercentual, null);
    assert.equal(linha?.custoIndisponivel, true);
    assert.equal(r.itensSemCusto, 1);
    assert.equal(r.margemParcial, true, 'o pedido precisa se declarar parcial');
  });

  it('sinaliza margem parcial quando apenas parte dos itens tem custo', () => {
    const r = calcularMargemPedido({
      itens: [
        item({ id: 1, valorUnitario: 100, custoUnitario: 40 }),
        item({ id: 2, valorUnitario: 100, custoUnitario: null }),
      ],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [],
    });

    assert.equal(r.itensSemCusto, 1);
    assert.equal(r.margemParcial, true);
    // So o item com custo conhecido contribui para a margem.
    assert.equal(r.margem, 60);
  });

  it('marca as taxas como nao totalmente reais quando houver estimativa', () => {
    const r = calcularMargemPedido({
      itens: [item()],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [
        { tipo: 'COMISSAO', valor: 14, origem: 'REAL' },
        { tipo: 'TARIFA_FIXA', valor: 6, origem: 'ESTIMADO' },
      ],
    });

    assert.equal(r.taxasTodasReais, false);
    assert.equal(r.taxas, 20);
  });

  it('identifica margem negativa, que e justamente o que o sistema deve denunciar', () => {
    const r = calcularMargemPedido({
      itens: [item({ valorUnitario: 50, custoUnitario: 40 })],
      descontoPedido: 0,
      freteVendedor: 15,
      taxas: [{ tipo: 'COMISSAO', valor: 7, origem: 'REAL' }],
    });

    // 50 - 40 - 7 - 15 = -12
    assert.equal(r.margem, -12);
    assert.ok((r.margemPercentual ?? 0) < 0);
  });

  it('considera a quantidade no custo', () => {
    const r = calcularMargemPedido({
      itens: [item({ quantidade: 3, valorUnitario: 100, custoUnitario: 40 })],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [],
    });

    assert.equal(r.receita, 300);
    assert.equal(r.custo, 120);
    assert.equal(r.margem, 180);
  });

  it('nao quebra em pedido sem itens', () => {
    const r = calcularMargemPedido({
      itens: [],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [],
    });
    assert.equal(r.margem, 0);
    assert.equal(r.margemPercentual, 0);
  });

  it('nao divide por zero quando a receita do item e zero (brinde)', () => {
    const r = calcularMargemPedido({
      itens: [item({ valorUnitario: 0, custoUnitario: 10 })],
      descontoPedido: 0,
      freteVendedor: 0,
      taxas: [],
    });

    assert.equal(r.itens[0]?.receita, 0);
    assert.equal(r.itens[0]?.margemPercentual, null);
    assert.equal(r.margem, -10, 'brinde da margem negativa igual ao custo');
  });
});

describe('arredondar', () => {
  it('arredonda para centavos', () => {
    assert.equal(arredondar(1.005), 1.01);
    assert.equal(arredondar(2.344), 2.34);
    assert.equal(arredondar(2.345), 2.35);
  });

  it('nao introduz erro de ponto flutuante em soma de centavos', () => {
    assert.equal(arredondar(0.1 + 0.2), 0.3);
  });
});
