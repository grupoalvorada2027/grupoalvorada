# Convenções deste projeto

## Idioma

Código, comentários, nomes de variáveis e mensagens de log em **português**, sem
acentos em identificadores. Comentários explicam *por que*, não *o que*.

## Regras que não devem ser quebradas

**Só o worker chama a API do Bling.** A única exceção é a troca do
`authorization_code` no callback OAuth. O limite de 3 req/s vale para a conta
inteira, então dois pontos de saída com rate limiters independentes somam acima do
limite e levam bloqueio de IP.

**Nunca chame `/oauth/token` fora de `comLock(LOCK.REFRESH_TOKEN_BLING, ...)`.** 20
chamadas em 60 segundos bloqueiam o IP por uma hora.

**Valores monetários são `Decimal` no banco.** Nunca `Float`.

**Custo ausente é `null`, nunca `0`.** Margem indefinida é informação; margem
inflada é erro silencioso que leva a decidir errado.

**Taxa estimada é marcada como `ESTIMADO`.** Nunca apresente estimativa como real.

**O receptor de webhook não processa nada.** Valida assinatura, grava na fila,
responde 200 em menos de 5 segundos. O Bling desativa webhooks lentos.

**Toda gravação de pedido é idempotente.** Webhooks reentregam e não garantem ordem.

## Ao mexer na leitura de campos do Bling

Os schemas em `packages/bling/src/recursos.ts` são tolerantes de propósito: a
documentação oficial é uma SPA e parte dos nomes de campo foi inferida. Antes de
mudar a leitura de frete ou de taxas, confirme com dados reais:

```bash
npm run inspecionar -w @alvorada/worker -- <id-do-pedido>
```

Prefira falhar a adivinhar. Um palpite errado aqui não gera erro — gera um número de
lucro plausível e falso, que é o pior resultado possível.

## Verificação

```bash
npm run typecheck
npm test -w @alvorada/shared
```

Lógica de cálculo vai em `packages/shared`, que é puro e testável. Não coloque
regra de margem em rota HTTP nem em job.

## Migrations

```bash
npm run db:migrate        # cria migration em desenvolvimento
npm run db:migrate:deploy # aplica em produção, sem gerar nova
```

Nunca edite uma migration já aplicada.
