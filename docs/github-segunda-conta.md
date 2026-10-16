# Usar uma segunda conta do GitHub só para este projeto

O objetivo é commitar e dar push neste repositório com uma conta diferente das que
você já usa na máquina, **sem interferir nelas**. A técnica é uma chave SSH dedicada
mais um apelido de host.

Hoje seu `~/.ssh/config` tem apenas a entrada `portal-fc` (um servidor GCP), e não
há nenhuma configuração de GitHub — então não existe conflito a resolver. Seu
`git config --global user.email` também está vazio, o que ajuda: vamos definir a
identidade **por repositório**, nunca global.

## 1. Criar a chave dedicada

No Git Bash:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_alvorada -C "grupo-alvorada-bi"
```

Pode deixar a senha em branco se o worker for rodar sem interação. Isso gera dois
arquivos: `id_ed25519_alvorada` (privada, nunca sai da máquina) e
`id_ed25519_alvorada.pub` (pública).

## 2. Cadastrar a chave pública na segunda conta

```bash
cat ~/.ssh/id_ed25519_alvorada.pub
```

Copie a saída. Na **segunda conta** do GitHub: Settings → SSH and GPG keys → New SSH
key → cole → salve.

> Uma chave SSH só pode estar vinculada a uma conta do GitHub por vez. É justamente
> por isso que criamos uma chave nova em vez de reaproveitar a `id_rsa` existente.

## 3. Criar o apelido de host

Adicione ao fim de `~/.ssh/config`:

```
Host github-alvorada
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_alvorada
  IdentitiesOnly yes
```

O `IdentitiesOnly yes` é o detalhe que faz a coisa funcionar: sem ele, o SSH oferece
todas as chaves que encontrar, o GitHub aceita a primeira que reconhecer e você
acaba autenticado na conta errada sem perceber.

Teste:

```bash
ssh -T git@github-alvorada
```

A resposta esperada é `Hi <usuario-da-segunda-conta>! You've successfully
authenticated...`. Confirme que o nome é o da segunda conta.

## 4. Apontar o repositório para a segunda conta

Crie o repositório **privado** `grupo-alvorada-bi` (vazio, sem README) na segunda
conta. Depois, na raiz do projeto:

```bash
git remote add origin git@github-alvorada:USUARIO/grupo-alvorada-bi.git
```

Note o `github-alvorada` no lugar de `github.com` — é o apelido do passo 3 que
seleciona a chave certa.

## 5. Definir a identidade local

```bash
git config --local user.name  "Seu Nome"
git config --local user.email "email-da-segunda-conta@exemplo.com"
```

Use `--local`, nunca `--global`. Assim a identidade vale só neste repositório e seus
outros projetos continuam intactos.

Confira com `git config --local --list | grep user`.

## 6. Primeiro push

```bash
git push -u origin main
```

## Verificando que deu certo

```bash
git log -1 --format='%an <%ae>'   # deve mostrar a segunda conta
git remote -v                      # deve mostrar github-alvorada
```

## Rotina de trabalho

Nada muda em relação ao git normal:

```bash
git checkout -b feature/relatorio-margem
# ... alterações ...
git add -A
git commit -m "Adiciona relatório de margem por canal"
git push -u origin feature/relatorio-margem
```

Abra o Pull Request pela interface do GitHub, revise e faça o merge. Se quiser fazer
isso pelo terminal, o `gh` CLI **não está instalado** nesta máquina — para instalar:

```bash
winget install GitHub.cli
gh auth login --hostname github.com   # escolha a segunda conta
```

## Cuidado com segredos

O `.gitignore` já bloqueia `.env`, backups e credenciais do túnel. O
`BLING_CLIENT_SECRET` é especialmente sensível: além de obter tokens, ele assina os
webhooks — quem o tiver pode forjar eventos. Se vazar, gere um novo no painel do
Bling.

Antes do primeiro push, confirme que nada sensível entrou:

```bash
git status --short
git diff --cached --name-only    # nenhum .env deve aparecer
```
