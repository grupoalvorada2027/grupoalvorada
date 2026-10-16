import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, LimiteDiarioExcedidoError } from './rate-limiter.js';
import { validarAssinaturaWebhook } from './oauth.js';
import { createHmac } from 'node:crypto';

describe('RateLimiter', () => {
  it('espaça as requisições conforme a taxa configurada', async () => {
    // 10 req/s = 100ms entre cada uma. Usamos taxa alta para o teste ser rápido;
    // a mecânica é a mesma de 2,5 req/s.
    const limiter = new RateLimiter({ porSegundo: 10 });

    const inicio = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await limiter.aguardarVez();
    }
    const decorrido = Date.now() - inicio;

    // 5 requisições a 100ms de intervalo: a primeira sai na hora, então o mínimo
    // esperado é ~400ms.
    assert.ok(
      decorrido >= 380,
      `esperado ao menos ~400ms de espaçamento, foi ${decorrido}ms`,
    );
  });

  it('serializa chamadas concorrentes sem estourar a taxa', async () => {
    const limiter = new RateLimiter({ porSegundo: 10 });

    const inicio = Date.now();
    // Seis chamadas disparadas ao mesmo tempo. Uma implementação que medisse
    // "tempo desde a última chamada" deixaria todas passarem juntas.
    await Promise.all(
      Array.from({ length: 6 }, () => limiter.aguardarVez()),
    );
    const decorrido = Date.now() - inicio;

    assert.ok(
      decorrido >= 480,
      `chamadas concorrentes têm de ser serializadas; levou só ${decorrido}ms`,
    );
  });

  it('recuar atrasa a fila inteira, não só a requisição que falhou', async () => {
    const limiter = new RateLimiter({ porSegundo: 100 });
    await limiter.aguardarVez();

    limiter.recuar(300);

    const inicio = Date.now();
    await limiter.aguardarVez();
    const decorrido = Date.now() - inicio;

    assert.ok(
      decorrido >= 280,
      `após recuar(300) a próxima deveria esperar ~300ms, esperou ${decorrido}ms`,
    );
  });

  it('conta o consumo diário', async () => {
    const limiter = new RateLimiter({ porSegundo: 1000 });
    await limiter.aguardarVez();
    await limiter.aguardarVez();

    assert.equal(limiter.estatisticas.consumidasHoje, 2);
    assert.equal(limiter.estatisticas.tetoDiario, 120_000);
  });

  it('bloqueia ao atingir o teto diário em vez de seguir pedindo', async () => {
    const limiter = new RateLimiter({ porSegundo: 1000, porDia: 2 });
    await limiter.aguardarVez();
    await limiter.aguardarVez();

    await assert.rejects(
      () => limiter.aguardarVez(),
      LimiteDiarioExcedidoError,
      'a terceira chamada deveria falhar',
    );
  });

  it('avisa ao passar de 80% do teto diário', async () => {
    let avisou = false;
    const limiter = new RateLimiter({
      porSegundo: 1000,
      porDia: 10,
      onAvisoDiario: () => {
        avisou = true;
      },
    });

    for (let i = 0; i < 9; i += 1) {
      await limiter.aguardarVez();
    }

    assert.equal(avisou, true, 'o aviso de consumo alto deveria ter disparado');
  });

  it('recusa taxa inválida na construção', () => {
    assert.throws(() => new RateLimiter({ porSegundo: 0 }));
    assert.throws(() => new RateLimiter({ porSegundo: -1 }));
  });
});

describe('validarAssinaturaWebhook', () => {
  const segredo = 'client-secret-de-teste';
  const corpo = JSON.stringify({ eventId: 'abc', event: 'order.updated' });

  const assinar = (payload: string, chave = segredo): string =>
    'sha256=' + createHmac('sha256', chave).update(payload).digest('hex');

  it('aceita assinatura válida', async () => {
    const valida = await validarAssinaturaWebhook(corpo, assinar(corpo), segredo);
    assert.equal(valida, true);
  });

  it('aceita assinatura sem o prefixo sha256=', async () => {
    const hex = createHmac('sha256', segredo).update(corpo).digest('hex');
    assert.equal(await validarAssinaturaWebhook(corpo, hex, segredo), true);
  });

  it('recusa assinatura gerada com outro segredo', async () => {
    const valida = await validarAssinaturaWebhook(
      corpo,
      assinar(corpo, 'segredo-errado'),
      segredo,
    );
    assert.equal(valida, false);
  });

  it('recusa quando o corpo foi alterado', async () => {
    const assinatura = assinar(corpo);
    const corpoAdulterado = JSON.stringify({
      eventId: 'abc',
      event: 'order.deleted',
    });

    assert.equal(
      await validarAssinaturaWebhook(corpoAdulterado, assinatura, segredo),
      false,
    );
  });

  it('recusa quando não há cabeçalho de assinatura', async () => {
    assert.equal(await validarAssinaturaWebhook(corpo, undefined, segredo), false);
    assert.equal(await validarAssinaturaWebhook(corpo, '', segredo), false);
  });

  it('recusa assinatura de tamanho diferente sem estourar erro', async () => {
    assert.equal(await validarAssinaturaWebhook(corpo, 'sha256=abc', segredo), false);
  });

  it('valida igual sobre Buffer e string, já que o corpo chega cru', async () => {
    const assinatura = assinar(corpo);
    assert.equal(
      await validarAssinaturaWebhook(Buffer.from(corpo, 'utf8'), assinatura, segredo),
      true,
    );
  });

  it('a reserialização do JSON invalida a assinatura (motivo de guardar o corpo cru)', async () => {
    // O Bling assina os bytes exatos que enviou. Um JSON.parse seguido de
    // JSON.stringify muda espaçamento e ordem de chaves, e a conferência falha.
    const cru = '{ "eventId": "abc",  "event": "order.updated" }';
    const assinatura = assinar(cru);
    const reserializado = JSON.stringify(JSON.parse(cru));

    assert.equal(await validarAssinaturaWebhook(cru, assinatura, segredo), true);
    assert.equal(
      await validarAssinaturaWebhook(reserializado, assinatura, segredo),
      false,
    );
  });
});
