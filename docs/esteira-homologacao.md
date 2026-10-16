# Homologação e produção

Como testar uma alteração antes de ela chegar ao painel que a equipe usa.

## O que muda em relação a hoje

Hoje o código e o que está no ar são duas coisas sem ligação: o `git push` guarda
o código no GitHub e **não publica nada**; quem publica é o FTP, rodado à mão ou
pelo worker. Com a esteira, o push passa a ser o gatilho da publicação.

```
branch homologacao  →  Actions  →  FTP  →  ambiente de teste
branch main         →  Actions  →  FTP  →  produção
```

**O que a esteira cobre:** apenas a pasta `web/`, que é o painel. O worker roda
no servidor da empresa e o GitHub não o alcança — ele continua sendo atualizado
com `git pull` lá. Essa separação é consequência da arquitetura: o servidor não
aceita conexões de fora, de propósito.

## Montagem, uma vez só

### 1. Subdomínio de teste (cPanel)

**Domínios → Criar um novo domínio**

| Campo | Valor |
|---|---|
| Domínio | `teste.grupoalvorada1029.com.br` |
| Compartilhar raiz | **desmarcado** |
| Raiz do documento | `public_html/teste` |

Depois, em **SSL/TLS Status**, rode o AutoSSL para o subdomínio novo.

### 2. Conta FTP de teste

**Contas de FTP → Adicionar conta FTP**

| Campo | Valor |
|---|---|
| Login | `teste` |
| Diretório | `public_html/teste` |

Confira que o caminho mostrado termina em `/public_html/teste`. O cPanel monta o
caminho a partir da **home**, não de dentro do `public_html` — é o erro que fez a
primeira publicação ir para uma pasta que o site não servia.

### 3. Banco de teste

No seu PC, com a VPN Radmin conectada:

```bash
node scripts/criar-banco-teste.mjs --dias 30
```

Cria `alvorada_bi_teste` com a estrutura completa e uma amostra dos últimos 30
dias. **Não copia o token do Bling** de propósito: o ambiente de teste não deve
falar com o ERP de produção, senão um backfill disparado por engano consumiria o
limite diário de requisições da conta real.

### 4. Segredos no GitHub

Crie dois ambientes em **Settings → Environments**: `producao` e `homologacao`.

Em cada um, adicione os **secrets**:

| Secret | Produção | Homologação |
|---|---|---|
| `FTP_HOST` | `108.179.253.27` | `108.179.253.27` |
| `FTP_USER` | `painel@grupoalvorada.com.br` | `teste@grupoalvorada.com.br` |
| `FTP_SENHA` | senha da conta | senha da conta |

E a **variable** (não secret, porque não é sigilosa):

| Variable | Produção | Homologação |
|---|---|---|
| `URL_PAINEL` | `https://grupoalvorada1029.com.br` | `https://teste.grupoalvorada1029.com.br` |

No ambiente `producao`, vale marcar **Required reviewers** com o seu usuário: o
deploy fica parado esperando sua aprovação, o que evita subir algo sem querer.

### 5. Criar a branch

```bash
git checkout -b homologacao
git push -u origin homologacao
```

## O dia a dia

```bash
git checkout homologacao
# ... alterações ...
git add -A
git commit -m "Descrição da mudança"
git push
```

A Action roda typecheck e os 52 testes; passando, publica em
`teste.grupoalvorada1029.com.br`. Você confere lá.

Aprovado, leve para produção:

```bash
git checkout main
git merge homologacao
git push
```

## O que a Action nunca toca

Três arquivos ficam de fora da publicação por motivos diferentes:

| Arquivo | Por quê |
|---|---|
| `config.php` | Guarda hashes de senha e a chave da ponte OAuth. Existe só no servidor, nunca no Git. |
| `dados.json` | É publicado pelo worker a cada sincronização. Se o deploy o sobrescrevesse, o painel voltaria a mostrar dados velhos. |
| `.ponte-*.json` | Troca do OAuth, vive segundos. |

## Verificação automática

Depois de publicar, a Action confere duas coisas e **falha o deploy** se alguma
não bater:

1. `login.php` responde 200 — prova que o Apache está servindo os arquivos novos
2. `dados.json` responde 403 — prova que o arquivo com custos e margens **não**
   ficou acessível sem login

A segunda é a que importa: já aconteceu de uma publicação ir para a pasta errada
e o site seguir mostrando a versão antiga sem nenhum erro aparente. A conferência
pega esse tipo de falha silenciosa.

## O worker, que fica de fora

Para atualizar o worker no servidor:

```bash
ssh alvorada-srv
cd C:\caminho\GrupoAlvorada
git pull
npm ci
npm run build
```

E reinicie o serviço, se já estiver instalado como serviço do Windows.
