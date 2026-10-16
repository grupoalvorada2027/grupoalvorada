# Grupo Alvorada BI

Análise de lucratividade por canal de venda a partir do ERP Bling. Responde duas
perguntas que o faturamento sozinho não responde:

1. Qual canal dá mais **lucro** depois de comissão, frete, custo e imposto — não
   qual vende mais.
2. Quais SKUs compensa empurrar em cada canal, e quais estão vendendo com margem
   negativa.

## Como está organizado

```
packages/shared    Cálculo de margem (lógica pura, com testes), env, canais
packages/bling     Cliente da API Bling v3: rate limit, OAuth, retry, schemas
packages/db        Prisma: schema, cliente, store de token, regras de taxa
apps/api           Fastify: OAuth do Bling, receptor de webhooks, healthcheck
apps/worker        Backfill, sincronização incremental, fila de webhooks
```

## Onde cada parte roda

| Onde | O que |
|---|---|
| Servidor Windows | PostgreSQL + `apps/api` + `apps/worker` + `cloudflared` |
| HostGator Plano M | Frontend compilado (arquivos estáticos) |
| Cloudflare Tunnel | Expõe a API em HTTPS sem IP fixo e sem abrir portas |

O Plano M é hospedagem compartilhada e **não roda Node.js** — por isso o backend
fica no servidor Windows, junto do banco.

## Três restrições da API Bling que explicam o desenho

Vale ler antes de mexer no código, porque cada uma gerou uma decisão estrutural.

**1. Limite de 3 req/s e 120.000 req/dia, por conta** (não por endpoint). Toda
análise roda sobre o banco local; a API nunca é consultada ao vivo para montar um
relatório. E só o **worker** fala com o Bling — um rate limiter só funciona se
existir um único ponto de saída.

**2. Bloqueio de IP.** 600 requisições em 10 segundos bloqueiam por 10 minutos.
Pior: **20 chamadas a `/oauth/token` em 60 segundos bloqueiam por 60 minutos**. Daí
a renovação de token ser serializada por advisory lock do Postgres
(`comLock` em `packages/db/src/cliente.ts`).

**3. `refresh_token` expira em 30 dias.** Se o worker ficar parado mais que isso, a
autorização morre e exige reautorização manual no navegador. Há job de verificação
e alerta.

Um ganho que compensa: o Bling **tem webhooks** (recurso `order`), com assinatura
HMAC SHA-256. A sincronização é quase imediata e o polling fica só como rede de
segurança.

## Começando

### Pré-requisitos

- Node.js 22 ou superior (testado com 24.13)
- PostgreSQL 16 no servidor Windows
- Um aplicativo criado no Bling (Central de Extensões → Área do Integrador)
- Conta Cloudflare gratuita, para o túnel

Passo a passo detalhado em [docs/setup-servidor.md](docs/setup-servidor.md).

### Instalação

```bash
npm install
cp .env.example .env     # preencha os valores
npm run db:generate
npm run db:migrate
npm run db:seed
```

### Autorizar o Bling

A primeira autorização é sempre manual — o Bling só implementa o grant
`authorization_code`.

```bash
npm run api              # sobe a API
```

Acesse `/oauth/iniciar` e aprove. Em desenvolvimento, use
`http://localhost:3333/oauth/iniciar`, com `BLING_REDIRECT_URI` apontando para o
mesmo host **exatamente** como cadastrado no app Bling.

Confira depois em `/oauth/situacao`.

### Antes de confiar nos números: inspecione um pedido real

A documentação do Bling é uma SPA e não expõe em texto a lista completa de campos.
Dois deles decidem se o lucro sai certo — onde vem o frete e quem paga, e onde vem
a comissão do marketplace. O código traz uma leitura inferida e **conservadora**,
que precisa ser confirmada contra a sua conta:

```bash
npm run inspecionar -w @alvorada/worker
```

O script imprime o JSON cru de um pedido e mostra como o sistema o interpretou. Se
as taxas aparecerem no JSON mas vierem vazias na leitura, ajuste
`extrairTaxasReais` em `apps/worker/src/persistencia.ts`.

**Ative a importação de taxas do marketplace** na configuração das lojas Mercado
Livre e Shopee dentro do Bling (disponível nos planos Titânio, Diamante e Elite).
Sem isso a comissão real não chega e o sistema usa estimativa por regra.

### Importar o histórico

```bash
npm run backfill -w @alvorada/worker        # usa BACKFILL_MESES do .env
npm run backfill -w @alvorada/worker -- 6   # ou uma janela específica
```

Pode ser interrompido com Ctrl+C e retomado: o progresso fica em
`sync_checkpoint`. Para ~1.500 pedidos, espere de 10 a 15 minutos — o custo é
dominado por uma chamada de detalhe por pedido, porque a listagem não traz itens.

Rode o seed outra vez depois do backfill: os canais são descobertos a partir dos
pedidos, e a segunda execução cria as regras de taxa deles.

### Deixar sincronizando

```bash
npm run worker
```

Processa a fila de webhooks a cada minuto, faz varredura incremental a cada 15
minutos e cuida da renovação do token.

## Decisões que afetam a confiança nos números

Três coisas foram feitas de um jeito específico para o painel não mentir:

**Custo ausente não é custo zero.** Um produto sem custo cadastrado produz margem
`null` e entra na contagem de lacunas, nunca margem cheia. Tratar como zero daria
margem altíssima justamente nos produtos mal cadastrados — e é assim que um painel
passa a recomendar investir no produto errado.

**Custo tem histórico com vigência.** A margem de um pedido usa o custo que valia
na data daquele pedido. Ressalva importante: na primeira importação só conhecemos o
custo atual, então assumimos que ele valia no passado (ver
`INICIO_VIGENCIA_PRIMEIRA_CARGA`). Se o custo mudou nos últimos meses, a margem dos
pedidos anteriores à mudança sai aproximada. Daí em diante o histórico é exato.

**Taxa estimada é marcada como estimada.** `pedido_taxa.origem` distingue `REAL`
(importada do marketplace) de `ESTIMADO` (calculada por regra). As regras padrão em
`packages/db/src/regras-padrao.ts` usam percentuais genéricos de mercado, **não as
suas taxas** — confira com o extrato e ajuste.

## Verificação

```bash
npm run typecheck
npm test -w @alvorada/shared     # 19 testes do cálculo de margem
```

O teste que de fato valida o sistema não é automatizado: **compare a margem de 5
pedidos reais, um a um, contra o dashboard "Margem por Pedido" do próprio Bling.**
Divergência precisa ser explicável — tipicamente imposto ou vigência de custo. Sem
essa conferência, os relatórios são convincentes e possivelmente errados.

## O que ainda não existe

Fases 1 a 3 do plano estão implementadas (fundação, banco, integração Bling). Ainda
faltam:

- Views analíticas e relatórios (margem por canal/mês, matriz SKU × canal, curva
  ABC por margem, alertas de margem negativa)
- Autenticação de usuários com JWT e os três papéis (ADMIN, GESTOR, OPERADOR)
- Frontend React
- Publicação: Cloudflare Tunnel, serviços do Windows, deploy na HostGator

O cálculo de margem (`packages/shared/src/margem.ts`) já está pronto e testado, e é
sobre ele que os relatórios serão construídos.
