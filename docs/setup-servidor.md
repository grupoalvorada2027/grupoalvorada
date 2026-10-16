# Colocar o sistema no ar

Ordem recomendada: banco → aplicativo Bling → túnel → serviços do Windows →
frontend na HostGator. Cada etapa é verificável sozinha, então não avance com uma
falhando.

## 1. PostgreSQL no servidor Windows

Baixe o instalador do PostgreSQL 16 em
[postgresql.org/download/windows](https://www.postgresql.org/download/windows/).

Durante a instalação:
- anote a senha do superusuário `postgres`;
- mantenha a porta 5432;
- o serviço do Windows sobe sozinho no boot (confirme em `services.msc`).

Crie o banco e um usuário próprio da aplicação — não use `postgres` para a
aplicação, porque um erro de query com superusuário pode danificar mais do que
deveria:

```sql
-- no psql, como postgres
CREATE USER alvorada WITH PASSWORD 'uma-senha-longa-aqui';
CREATE DATABASE alvorada_bi OWNER alvorada;
```

No `.env`:

```
DATABASE_URL="postgresql://alvorada:uma-senha-longa-aqui@localhost:5432/alvorada_bi?schema=public"
```

Aplique o schema:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

**Não exponha a porta 5432 na internet.** O banco é acessado apenas por processos
da própria máquina; o acesso externo acontece pela API, com HTTPS e login.

### Backup

Crie uma tarefa diária no Agendador de Tarefas do Windows:

```bat
"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U alvorada -d alvorada_bi -F c -f "D:\backups\alvorada_%date:~-4%%date:~3,2%%date:~0,2%.dump"
```

Guarde uma cópia fora da máquina. O banco está num servidor físico só seu: se o
disco falhar sem backup externo, o histórico reconstruído a 3 req/s custaria horas
ou dias de reimportação.

## 2. Aplicativo no Bling

Em **Central de Extensões → Área do Integrador → Criar aplicativo**:

- **Redirect URI**: `https://api.seudominio.com.br/oauth/callback` — tem de ser
  idêntica ao `BLING_REDIRECT_URI` do `.env`, inclusive sem barra no final.
- **Escopos**: pedidos de venda, produtos, estoque, contatos, notas fiscais.
  O Bling usa os escopos marcados no cadastro e ignora o parâmetro `scope` enviado
  na URL, então marcar aqui é o que vale.
- Guarde `client_id` e `client_secret` no `.env`.

### Ativar a importação de taxas do marketplace

Em cada loja (Mercado Livre, Shopee), nas configurações da integração dentro do
Bling, ative a importação de taxas. É isto que faz a **comissão real** de cada
pedido chegar pela API. Sem isso o sistema estima por regra, e a diferença entre
margem real e estimada pode mudar a decisão de em qual canal investir.

### Webhooks

Na aba **Webhooks** do aplicativo:

- Servidor: `https://api.seudominio.com.br/webhooks/bling`
- Recurso: `order` (pedido de venda)
- Ações: criado, atualizado, excluído

Os eventos só começam a fluir **depois** de concluída a autorização OAuth.

> O Bling exige resposta em menos de 5 segundos e desativa o webhook sozinho depois
> de falhas repetidas — sem avisar. Acompanhe `/webhooks/situacao`, que alerta
> quando passam 24 horas sem nenhum evento.

## 3. Cloudflare Tunnel

Resolve o IP dinâmico sem abrir portas: o `cloudflared` abre a conexão de dentro
para fora.

### Domínio no Cloudflare

1. Crie a conta gratuita e adicione seu domínio.
2. O Cloudflare mostra dois nameservers.
3. No **registro.br**, em DNS → Alterar servidores DNS, troque pelos do Cloudflare.
   A propagação leva de minutos a algumas horas.

### Instalar e criar o túnel

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create alvorada-api
cloudflared tunnel route dns alvorada-api api.seudominio.com.br
```

Crie `C:\Users\<voce>\.cloudflared\config.yml`:

```yaml
tunnel: alvorada-api
credentials-file: C:\Users\<voce>\.cloudflared\<id-do-tunel>.json

ingress:
  - hostname: api.seudominio.com.br
    service: http://127.0.0.1:3333
  - service: http_status:404
```

Instale como serviço do Windows, para subir no boot:

```powershell
cloudflared service install
```

Teste de fora da rede (pelo 4G do celular, por exemplo):
`https://api.seudominio.com.br/saude`.

## 4. API e worker como serviços do Windows

Compile:

```bash
npm run build
```

Use o [NSSM](https://nssm.cc/download) para transformar os dois processos em
serviços que sobem no boot e reiniciam se caírem:

```powershell
nssm install AlvoradaAPI "C:\Program Files\nodejs\node.exe" "C:\caminho\GrupoAlvorada\apps\api\dist\server.js"
nssm set AlvoradaAPI AppDirectory "C:\caminho\GrupoAlvorada"
nssm set AlvoradaAPI AppStdout "C:\caminho\GrupoAlvorada\logs\api.log"
nssm set AlvoradaAPI AppStderr "C:\caminho\GrupoAlvorada\logs\api-erro.log"
nssm start AlvoradaAPI

nssm install AlvoradaWorker "C:\Program Files\nodejs\node.exe" "C:\caminho\GrupoAlvorada\apps\worker\dist\index.js"
nssm set AlvoradaWorker AppDirectory "C:\caminho\GrupoAlvorada"
nssm start AlvoradaWorker
```

O `AppDirectory` precisa ser a raiz do projeto, senão o `.env` não é encontrado.

> Mantenha o worker rodando. Ele renova o `refresh_token`, que expira em 30 dias —
> se o servidor ficar desligado mais que isso, a autorização morre e exige alguém
> abrindo `/oauth/iniciar` no navegador outra vez.

## 5. Frontend na HostGator (quando existir)

O Plano M é hospedagem compartilhada: serve arquivos estáticos muito bem, mas não
roda Node.js. O React compilado é exatamente isso — HTML, CSS e JS.

1. Crie o subdomínio `app.seudominio.com.br` no cPanel, apontando para uma pasta
   própria.
2. Ative o SSL grátis (AutoSSL) nesse subdomínio.
3. Envie o conteúdo de `apps/web/dist` por FTPS para a pasta.
4. Crie um `.htaccess` na pasta, para que as rotas da SPA funcionem ao recarregar:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
```

Inclua `https://app.seudominio.com.br` em `CORS_ORIGINS` no `.env` e reinicie a API.

No Cloudflare, crie um registro `A` para `app` apontando ao IP da sua hospedagem
HostGator (está no cPanel, em Informações Gerais → Endereço IP compartilhado).

## Verificação final

| Verificação | Como |
|---|---|
| Banco de pé | `npm run db:studio` abre e lista as tabelas |
| API respondendo | `curl https://api.seudominio.com.br/saude` |
| Autorização válida | `/oauth/situacao` mostra `autorizado: true` e os dias restantes |
| Webhooks chegando | `/webhooks/situacao` sem alerta, com evento recente |
| Assinatura rejeitando | POST em `/webhooks/bling` sem assinatura devolve 401 |
| Números corretos | comparar 5 pedidos com o dashboard do Bling, um a um |

A última linha é a que importa de verdade. As outras provam que o sistema está no
ar; só ela prova que ele está certo.

## Riscos desta arquitetura

O banco e a API ficam no seu servidor físico, então **se a máquina ou a internet
caírem, o sistema sai do ar** — o frontend na HostGator continua carregando, mas sem
dados. Mitigações: UPS, monitoramento externo do `/saude` (UptimeRobot resolve) e
backup diário fora da máquina.

É o custo de manter o dado em casa, e foi uma escolha consciente. Se um dia a
disponibilidade incomodar, o caminho é mover a API e o banco para um VPS, mantendo o
servidor Windows como réplica de backup — o código não precisa mudar, só o
`DATABASE_URL` e onde os serviços rodam.
