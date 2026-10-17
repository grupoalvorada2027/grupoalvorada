# Mercado Pago

Objetivo: trazer cada venda paga pelo Mercado Pago e mostrar, por pedido, se o
dinheiro **já caiu** na conta da loja ou **ainda está retido**, com a data
prevista e o valor líquido depois das tarifas.

## Dois "pago" diferentes

| Situação | O que significa | Campo na API |
|---|---|---|
| Aprovado | O comprador pagou. | `status = approved` |
| Liberado | O dinheiro está disponível para a loja. | `money_release_status = released` |

Uma venda aprovada pode ficar dias retida. "A receber" é aprovado e ainda não
liberado. Devolução, estorno e chargeback (`refunded`, `charged_back`) tiram o
dinheiro depois, então entram como negativo, nunca como zero.

## Passo 1. Credencial de cada conta

Faça isto logado em **cada** conta do Mercado Pago ligada a uma loja do
Mercado Livre:

1. Abra https://www.mercadopago.com.br/developers/panel/app e clique em
   **Criar aplicação**.
2. Nome `Alvorada BI`. Tipo de solução: **Pagamentos on-line**. Não vai usar
   plataforma de e-commerce. Produto: **Checkout Pro**, só para o formulário
   aceitar; nada de checkout será usado.
3. Na aplicação criada, vá em **Credenciais de produção** e copie o
   **Access Token**, que começa com `APP_USR-`.
4. Cole no `.env` do servidor, uma linha por conta:

   ```
   MP_ACCESS_TOKEN_DIST=APP_USR-...
   ```

Não precisa de OAuth: a credencial da própria aplicação já lê a própria conta.
Ela dá acesso de leitura e escrita ao dinheiro da conta, então segue a mesma
regra do Bling. Fica só no `.env` do servidor e nunca vai para o `web/`.

## Passo 2. Conferir os dados reais

```bash
npm run inspecionar:mp -w @alvorada/worker
```

Mostra, por conta, os últimos pagamentos com status, valor bruto, líquido,
tarifas e data de liberação, sem nenhum dado do comprador. Só depois disso os
nomes de campo viram código.

## Passo 3 em diante

Construído depois do passo 2, com os campos confirmados:

1. Tabelas `PagamentoMp` e `LiberacaoMp` no banco, valores em `Decimal`.
2. Sincronização no worker: 3 meses para trás, depois só o que mudou.
3. Ligação com o pedido do Bling pelo número do pedido do Mercado Livre.
4. Relatório de Liberações em CSV, que é o extrato oficial do que caiu.
5. Tela "Recebimentos" no painel: a receber, liberado, retido e estornado.
