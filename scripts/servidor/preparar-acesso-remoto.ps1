# Prepara o servidor Windows para acesso remoto.
#
# Habilita duas coisas:
#   1. Area de Trabalho Remota (RDP) - para voce operar a tela do servidor
#   2. OpenSSH Server             - para o VS Code (e o Claude Code) agirem nele
#
# SEGURANCA: as duas regras de firewall criadas aqui liberam SOMENTE a rede local
# (-RemoteAddress LocalSubnet). Nem RDP nem SSH devem ser expostos a internet:
# ambos sao varridos e atacados por forca bruta continuamente. O acesso externo
# ao sistema acontecera pela API, com HTTPS e login, atraves do tunel Cloudflare.
#
# COMO USAR: no servidor, abra o PowerShell COMO ADMINISTRADOR e execute.

$ErrorActionPreference = 'Stop'

# Guarda tudo o que aparecer na tela num arquivo. Serve para o caso de a janela
# fechar antes de voce ler o resultado - basta abrir o log depois.
$log = 'C:\preparar-acesso-remoto.log'
try { Start-Transcript -Path $log -Force | Out-Null } catch {}

function Titulo($texto) {
    Write-Host ""
    Write-Host "=== $texto ===" -ForegroundColor Cyan
}
function Ok($texto)     { Write-Host "  [OK]    $texto" -ForegroundColor Green }
function Aviso($texto)  { Write-Host "  [AVISO] $texto" -ForegroundColor Yellow }
function Erro($texto)   { Write-Host "  [ERRO]  $texto" -ForegroundColor Red }

# Mantem a janela aberta no final, inclusive se der erro no meio. Sem isso, rodar
# o script pelo menu de contexto do Windows fecha tudo antes de dar para ler.
function Finalizar {
    Write-Host ""
    Write-Host "Log salvo em: $log" -ForegroundColor Cyan
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ""
    Read-Host "Pressione ENTER para fechar"
}

# Verificacao de administrador feita aqui, e nao com #Requires, para poder avisar
# de forma legivel em vez de a janela sumir instantaneamente.
$souAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $souAdmin) {
    Write-Host ""
    Write-Host "Este script precisa ser executado COMO ADMINISTRADOR." -ForegroundColor Red
    Write-Host ""
    Write-Host "Clicar com o botao direito e usar 'Executar com PowerShell' NAO eleva." -ForegroundColor Yellow
    Write-Host "Faca assim:" -ForegroundColor Yellow
    Write-Host "  1. Botao direito no menu Iniciar -> Terminal (Admin) ou PowerShell (Admin)"
    Write-Host "  2. Set-ExecutionPolicy Bypass -Scope Process -Force"
    Write-Host "  3. & '$PSCommandPath'"
    Finalizar
    exit 1
}

# ---------------------------------------------------------------
Titulo "Identificacao da maquina"

$os = Get-CimInstance Win32_OperatingSystem
Write-Host "  Nome......: $env:COMPUTERNAME"
Write-Host "  Windows...: $($os.Caption)"
Write-Host "  Usuario...: $env:USERNAME"

# O Windows Home NAO aceita conexoes RDP de entrada (so funciona como cliente).
# Se for esse o caso, o SSH resolve do mesmo jeito e o AnyDesk cobre a parte
# grafica - nao vale a pena trocar a licenca so por isso.
$ehHome = $os.Caption -match 'Home'
if ($ehHome) {
    Aviso "Esta edicao e Home: o Windows nao aceita RDP de ENTRADA."
    Aviso "O SSH vai funcionar normalmente. Para a tela, siga usando o AnyDesk."
}

# ---------------------------------------------------------------
Titulo "Area de Trabalho Remota (RDP)"

if ($ehHome) {
    Aviso "Pulando RDP - nao suportado nesta edicao do Windows."
} else {
    try {
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
            -Name 'fDenyTSConnections' -Value 0
        Ok "RDP habilitado"

        # Exige autenticacao ANTES de abrir a sessao grafica. Reduz bastante a
        # superficie de ataque e e o padrao recomendado.
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' `
            -Name 'UserAuthentication' -Value 1
        Ok "Autenticacao em nivel de rede (NLA) exigida"

        Enable-NetFirewallRule -DisplayGroup "Area de Trabalho Remota" -ErrorAction SilentlyContinue
        Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue

        # Restringe as regras de RDP a rede local.
        Get-NetFirewallRule -DisplayGroup "Area de Trabalho Remota" -ErrorAction SilentlyContinue |
            Set-NetFirewallRule -RemoteAddress LocalSubnet
        Get-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue |
            Set-NetFirewallRule -RemoteAddress LocalSubnet
        Ok "Firewall do RDP limitado a rede local"
    } catch {
        Erro "Falha ao configurar RDP: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------
Titulo "OpenSSH Server"

$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' |
       Select-Object -First 1

if ($null -eq $cap) {
    Erro "Componente OpenSSH.Server nao disponivel nesta versao do Windows."
    Erro "Instale manualmente: https://github.com/PowerShell/Win32-OpenSSH/releases"
} else {
    if ($cap.State -ne 'Installed') {
        Write-Host "  Instalando OpenSSH Server (pode demorar um pouco)..."
        Add-WindowsCapability -Online -Name $cap.Name | Out-Null
        Ok "OpenSSH Server instalado"
    } else {
        Ok "OpenSSH Server ja estava instalado"
    }

    Set-Service -Name sshd -StartupType Automatic
    Start-Service sshd
    Ok "Servico sshd ativo e configurado para iniciar com o Windows"

    # Regra de firewall propria, restrita a LAN. Nao reaproveitamos a regra que o
    # Windows cria sozinho porque ela costuma vir liberada para qualquer origem.
    $nomeRegra = 'OpenSSH-Server-LAN'
    if (Get-NetFirewallRule -Name $nomeRegra -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -Name $nomeRegra -RemoteAddress LocalSubnet -Enabled True
    } else {
        New-NetFirewallRule -Name $nomeRegra -DisplayName 'OpenSSH Server (rede local)' `
            -Enabled True -Direction Inbound -Protocol TCP -Action Allow `
            -LocalPort 22 -RemoteAddress LocalSubnet | Out-Null
    }
    Ok "Firewall do SSH liberado apenas para a rede local"

    # O shell padrao do OpenSSH no Windows e o cmd.exe. O VS Code Remote-SSH
    # funciona muito melhor com PowerShell, e varios comandos do projeto assumem
    # PowerShell.
    $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path 'HKLM:\SOFTWARE\OpenSSH')) {
        New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
    }
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell `
        -Value $ps -PropertyType String -Force | Out-Null
    Ok "Shell padrao do SSH definido como PowerShell"
}

# ---------------------------------------------------------------
Titulo "Endereco deste servidor"

$ips = Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }

foreach ($ip in $ips) {
    Write-Host "  $($ip.IPAddress)  ($($ip.InterfaceAlias))" -ForegroundColor White
}

Write-Host ""
Write-Host "Anote o IP acima e reserve-o no DHCP do roteador," -ForegroundColor Yellow
Write-Host "para que ele nao mude e quebre a conexao depois." -ForegroundColor Yellow

# ---------------------------------------------------------------
Titulo "Conferencia final"

$sshd = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshd -and $sshd.Status -eq 'Running') {
    Ok "sshd rodando"
} else {
    Erro "sshd NAO esta rodando"
}

$porta22 = Get-NetTCPConnection -State Listen -LocalPort 22 -ErrorAction SilentlyContinue
if ($porta22) { Ok "Porta 22 escutando" } else { Erro "Porta 22 nao esta escutando" }

Write-Host ""
Write-Host "Pronto. Do seu PC, teste com:" -ForegroundColor Cyan
Write-Host "  ssh $env:USERNAME@<IP-DO-SERVIDOR>" -ForegroundColor White
Write-Host ""
Write-Host "Informe ao Claude: o IP acima e o nome de usuario '$env:USERNAME'." -ForegroundColor Cyan

Finalizar
