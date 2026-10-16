# Cria o banco e o usuario da aplicacao no PostgreSQL do servidor.
#
# ATENCAO: este script mexe SOMENTE na instancia do PostgreSQL 18 (porta 5433).
# A instancia 16, na porta 5432, contem cerca de 2,3 GB de dados de outro
# sistema e nao e tocada em nenhum momento.
#
# O que faz:
#   1. cria o usuario 'alvorada' com uma senha forte gerada na hora
#   2. cria o banco 'alvorada_bi' com esse usuario como dono
#   3. libera no pg_hba.conf o acesso da rede local e da VPN Radmin
#   4. abre a porta 5433 no firewall, apenas para LAN e VPN
#   5. imprime a DATABASE_URL pronta para colar no .env
#
# COMO USAR: PowerShell COMO ADMINISTRADOR no servidor.

$ErrorActionPreference = 'Stop'

$VERSAO   = 18
$PORTA    = 5433
$BANCO    = 'alvorada_bi'
$USUARIO  = 'alvorada'
$BASE     = "C:\Program Files\PostgreSQL\$VERSAO"
$PSQL     = "$BASE\bin\psql.exe"
$PGHBA    = "$BASE\data\pg_hba.conf"
$SERVICO  = "postgresql-x64-$VERSAO"

function Ok($t)    { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Erro($t)  { Write-Host "  [ERRO]  $t" -ForegroundColor Red }
function Titulo($t){ Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

function Finalizar {
    Write-Host ""
    Read-Host "Pressione ENTER para fechar"
}

$souAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $souAdmin) {
    Erro "Rode como Administrador (Iniciar -> Terminal (Admin))."
    Finalizar; exit 1
}

if (-not (Test-Path $PSQL)) {
    Erro "psql nao encontrado em $PSQL"
    Finalizar; exit 1
}

# ---------------------------------------------------------------
Titulo "Senha do superusuario"

Write-Host "Digite a senha do usuario 'postgres' da instancia $VERSAO"
Write-Host "(a que voce definiu hoje durante a instalacao):"
$sec = Read-Host -AsSecureString
$senhaPostgres = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

$env:PGPASSWORD = $senhaPostgres

# Confere a senha antes de seguir, para nao falhar no meio do caminho.
$teste = & $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d postgres -tAc "SELECT version();" 2>&1
if ($LASTEXITCODE -ne 0) {
    Erro "Nao consegui conectar. Verifique a senha."
    Write-Host $teste
    $env:PGPASSWORD = $null
    Finalizar; exit 1
}
Ok "Conectado: $($teste -replace '\s+', ' ')"

# ---------------------------------------------------------------
Titulo "Usuario e banco da aplicacao"

# Senha forte gerada aqui, sem caracteres que atrapalhem em URL de conexao.
$alfabeto = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$senhaApp = -join (1..28 | ForEach-Object { $alfabeto[(Get-Random -Maximum $alfabeto.Length)] })

# Out-String evita o erro de chamar .Trim() em $null: quando nao ha linhas, o
# psql devolve saida vazia e o PowerShell converte isso em $null.
$existeUser = (& $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d postgres -tAc `
    "SELECT 1 FROM pg_roles WHERE rolname='$USUARIO';" | Out-String).Trim()

if ($existeUser -eq '1') {
    & $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d postgres -c `
        "ALTER ROLE $USUARIO WITH LOGIN PASSWORD '$senhaApp';" | Out-Null
    Aviso "Usuario '$USUARIO' ja existia - senha redefinida"
} else {
    & $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d postgres -c `
        "CREATE ROLE $USUARIO WITH LOGIN PASSWORD '$senhaApp';" | Out-Null
    Ok "Usuario '$USUARIO' criado"
}

$existeDb = (& $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname='$BANCO';" | Out-String).Trim()

if ($existeDb -eq '1') {
    Aviso "Banco '$BANCO' ja existe - preservado como esta"
} else {
    & $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d postgres -c `
        "CREATE DATABASE $BANCO OWNER $USUARIO;" | Out-Null
    Ok "Banco '$BANCO' criado"
}

# O Prisma cria e altera tabelas no schema public durante as migrations.
& $PSQL -U postgres -h 127.0.0.1 -p $PORTA -d $BANCO -c `
    "GRANT ALL ON SCHEMA public TO $USUARIO;" | Out-Null
Ok "Permissoes concedidas no schema public"

$env:PGPASSWORD = $null

# ---------------------------------------------------------------
Titulo "Acesso pela rede (pg_hba.conf)"

# Faixas liberadas:
#   192.168.0.0/16 - rede local do servidor
#   26.0.0.0/8     - VPN Radmin (rede virtual protegida por senha)
# Nao liberamos 0.0.0.0/0 em hipotese alguma: banco exposto a internet e
# varrido e atacado em questao de horas.
$regras = @(
    "host    $BANCO    $USUARIO    192.168.0.0/16    scram-sha-256",
    "host    $BANCO    $USUARIO    26.0.0.0/8        scram-sha-256"
)

$conteudo = Get-Content $PGHBA -Raw
$marcador = '# --- Grupo Alvorada BI ---'

if ($conteudo -like "*$marcador*") {
    Aviso "pg_hba.conf ja continha as regras - nada alterado"
} else {
    Copy-Item $PGHBA "$PGHBA.bak-$(Get-Date -Format yyyyMMddHHmmss)"
    $novo = $conteudo.TrimEnd() + "`r`n`r`n$marcador`r`n" + ($regras -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($PGHBA, $novo, (New-Object System.Text.UTF8Encoding($false)))
    Ok "Regras adicionadas ao pg_hba.conf (backup salvo ao lado)"
}

Restart-Service $SERVICO
Start-Sleep -Seconds 3
$svc = Get-Service $SERVICO
if ($svc.Status -eq 'Running') { Ok "Servico $SERVICO reiniciado" }
else { Erro "Servico nao voltou: $($svc.Status)" }

# ---------------------------------------------------------------
Titulo "Firewall"

$nome = 'PostgreSQL-18-Alvorada'
if (Get-NetFirewallRule -Name $nome -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -Name $nome
}
New-NetFirewallRule -Name $nome -DisplayName 'PostgreSQL 5433 (LAN + Radmin VPN)' `
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow `
    -LocalPort $PORTA -RemoteAddress @('192.168.0.0/16','26.0.0.0/8') | Out-Null
Ok "Porta $PORTA liberada apenas para a rede local e a VPN"

# ---------------------------------------------------------------
Titulo "Resultado"

Write-Host ""
Write-Host "Cole esta linha no .env do seu PC (substituindo a existente):" -ForegroundColor Cyan
Write-Host ""
Write-Host "DATABASE_URL=`"postgresql://${USUARIO}:${senhaApp}@26.64.54.208:${PORTA}/${BANCO}?schema=public`"" -ForegroundColor White
Write-Host ""
Write-Host "Guarde a senha em lugar seguro. Ela nao sera exibida de novo." -ForegroundColor Yellow
Write-Host "(Para rodar no proprio servidor depois, troque o IP por localhost.)" -ForegroundColor Gray

Finalizar
