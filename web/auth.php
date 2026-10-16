<?php
/**
 * Autenticacao do painel.
 *
 * POR QUE UM LOGIN EM PHP E NAO SO UMA TELA EM JAVASCRIPT:
 *
 * Esconder o painel com JavaScript nao protege nada - bastaria abrir
 * /dados.json diretamente para baixar custos e margens inteiras. Por isso:
 *
 *   1. o arquivo de dados e bloqueado pelo .htaccess (ninguem o acessa direto);
 *   2. quem entrega os dados e o dados.php, que so responde com sessao valida;
 *   3. o filtro por papel acontece AQUI, no servidor: o operador nao recebe os
 *      campos de custo e margem, em vez de recebe-los e a tela escondo-los.
 *
 * As senhas ficam como hash (password_hash / bcrypt), nunca em texto. Mesmo com
 * acesso aos arquivos da hospedagem, nao da para ler a senha de ninguem.
 */

declare(strict_types=1);

// Os usuarios e seus hashes ficam em config.php, que NAO vai para o Git.
// Veja config.exemplo.php para o formato.
require_once __DIR__ . '/config.php';

/** Tempo de inatividade antes de derrubar a sessao. */
const SESSAO_MINUTOS = 480; // 8 horas - um dia de trabalho

function iniciarSessao(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    // O cookie de sessao nao deve ser lido por JavaScript nem trafegar sem TLS.
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('painel_alvorada');
    session_start();
}

function usuarioLogado(): ?array
{
    iniciarSessao();

    if (empty($_SESSION['usuario'])) {
        return null;
    }

    // Expira por inatividade.
    $ultimo = (int) ($_SESSION['visto_em'] ?? 0);
    if ($ultimo > 0 && (time() - $ultimo) > SESSAO_MINUTOS * 60) {
        encerrarSessao();
        return null;
    }
    $_SESSION['visto_em'] = time();

    return [
        'login' => (string) $_SESSION['usuario'],
        'nome'  => (string) ($_SESSION['nome'] ?? $_SESSION['usuario']),
        'papel' => (string) ($_SESSION['papel'] ?? 'operador'),
    ];
}

function exigirLogin(): array
{
    $u = usuarioLogado();
    if ($u === null) {
        header('Location: login.php');
        exit;
    }
    return $u;
}

function autenticar(string $login, string $senha): bool
{
    $login = strtolower(trim($login));
    $dados = USUARIOS[$login] ?? null;

    // password_verify com um hash falso mantem o tempo de resposta parecido
    // quando o usuario nao existe - sem isso, daria para descobrir quais logins
    // sao validos medindo o tempo da resposta.
    if ($dados === null) {
        password_verify($senha, '$2y$12$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalid');
        return false;
    }

    if (!password_verify($senha, $dados['hash'])) {
        return false;
    }

    iniciarSessao();
    // Troca o id da sessao no login, para impedir fixacao de sessao.
    session_regenerate_id(true);

    $_SESSION['usuario']  = $login;
    $_SESSION['nome']     = $dados['nome'];
    $_SESSION['papel']    = $dados['papel'];
    $_SESSION['visto_em'] = time();

    return true;
}

function encerrarSessao(): void
{
    iniciarSessao();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

/** Papeis que podem ver custo e margem. */
function podeVerMargem(array $usuario): bool
{
    return in_array($usuario['papel'], ['admin', 'gestor'], true);
}

// ------------------------------------------------------------
// Protecao contra forca bruta
//
// Limite simples por IP, gravado em arquivo. Nao substitui um fail2ban, mas
// transforma "tentar 10.000 senhas" em algo inviavel por esta porta.
// ------------------------------------------------------------

const MAX_TENTATIVAS = 8;
const JANELA_SEGUNDOS = 900; // 15 minutos

function arquivoTentativas(): string
{
    return __DIR__ . '/.tentativas.json';
}

function tentativasExcedidas(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'desconhecido';
    $registro = @json_decode((string) @file_get_contents(arquivoTentativas()), true);
    if (!is_array($registro)) {
        return false;
    }
    $dados = $registro[$ip] ?? null;
    if (!is_array($dados)) {
        return false;
    }
    if ((time() - (int) $dados['em']) > JANELA_SEGUNDOS) {
        return false;
    }
    return ((int) $dados['n']) >= MAX_TENTATIVAS;
}

function registrarFalha(): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'desconhecido';
    $registro = @json_decode((string) @file_get_contents(arquivoTentativas()), true);
    if (!is_array($registro)) {
        $registro = [];
    }

    $dados = $registro[$ip] ?? ['n' => 0, 'em' => time()];
    if ((time() - (int) $dados['em']) > JANELA_SEGUNDOS) {
        $dados = ['n' => 0, 'em' => time()];
    }
    $dados['n'] = ((int) $dados['n']) + 1;
    $registro[$ip] = $dados;

    // Limpa registros velhos para o arquivo nao crescer sem limite.
    foreach ($registro as $chave => $v) {
        if ((time() - (int) ($v['em'] ?? 0)) > JANELA_SEGUNDOS * 4) {
            unset($registro[$chave]);
        }
    }

    @file_put_contents(arquivoTentativas(), json_encode($registro), LOCK_EX);
}

function limparFalhas(): void
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'desconhecido';
    $registro = @json_decode((string) @file_get_contents(arquivoTentativas()), true);
    if (is_array($registro)) {
        unset($registro[$ip]);
        @file_put_contents(arquivoTentativas(), json_encode($registro), LOCK_EX);
    }
}
