<?php
/**
 * Autenticacao e permissoes do painel.
 *
 * COMO SE ENTRA
 *   Pela conta Google. O Google confirma que a pessoa e dona do e-mail; quem
 *   decide se ela pode ver o painel e a LISTA DE USUARIOS deste sistema.
 *   Logar com Google nao basta: um e-mail fora da lista vira um pedido de
 *   acesso pendente e nao ve nada ate um administrador aprovar.
 *
 * POR QUE A PERMISSAO E CONFERIDA A CADA REQUISICAO
 *   O papel e o status sao relidos do arquivo de usuarios em toda chamada, nao
 *   guardados na sessao. Assim, bloquear alguem ou rebaixar o papel tem efeito
 *   no clique seguinte - nao so quando a sessao dele expirar.
 *
 * ONDE FICAM OS USUARIOS
 *   Em .usuarios.json, nesta pasta. O nome comeca com ponto e termina em .json:
 *   o .htaccess bloqueia os dois padroes, entao o arquivo nunca e servido pela
 *   web. So o PHP o le, pelo sistema de arquivos.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/** Tempo de inatividade antes de derrubar a sessao. */
const SESSAO_MINUTOS = 480; // 8 horas - um dia de trabalho

const PAPEIS = [
    'admin'    => 'Administrador',
    'gestor'   => 'Gestor',
    'operador' => 'Operador',
];

/** Limite de pedidos pendentes, para ninguem lotar o arquivo de usuarios. */
const MAX_PENDENTES = 50;

// O PHP anuncia a propria versao por padrao. Nao ha motivo para entregar a
// quem esta sondando o servidor qual versao procurar falhas.
header_remove('X-Powered-By');

// ============================================================
// Configuracao
// ============================================================

function googleConfigurado(): bool
{
    return defined('GOOGLE_CLIENT_ID') && GOOGLE_CLIENT_ID !== ''
        && defined('GOOGLE_CLIENT_SECRET') && GOOGLE_CLIENT_SECRET !== '';
}

function adminsIniciais(): array
{
    if (!defined('ADMINS_INICIAIS') || !is_array(ADMINS_INICIAIS)) {
        return [];
    }
    // Devolve [forma canônica => como foi escrito], para gravar o e-mail
    // legível no cadastro e comparar pela forma canônica.
    $lista = [];
    foreach (ADMINS_INICIAIS as $e) {
        $e = strtolower(trim((string) $e));
        if ($e !== '') {
            $lista[normalizarEmail($e)] = $e;
        }
    }
    return $lista;
}

// ============================================================
// Cadastro de usuarios (.usuarios.json)
// ============================================================

function arquivoUsuarios(): string
{
    return __DIR__ . '/.usuarios.json';
}

/** @return array<string, array<string, mixed>> */
function carregarUsuarios(): array
{
    $arq = arquivoUsuarios();
    if (!is_file($arq)) {
        return [];
    }
    $h = fopen($arq, 'rb');
    if ($h === false) {
        return [];
    }
    flock($h, LOCK_SH);
    $conteudo = stream_get_contents($h);
    flock($h, LOCK_UN);
    fclose($h);

    $dados = json_decode((string) $conteudo, true);
    if (!is_array($dados)) {
        return [];
    }

    // Reindexa pela forma canônica. Se duas entradas forem a mesma pessoa
    // (gravadas antes da normalização), fica a de maior acesso: ativo vence
    // pendente, e administrador vence os demais papéis.
    $peso = static fn (array $u): int =>
        (($u['status'] ?? '') === 'ativo' ? 10 : 0)
        + (['admin' => 3, 'gestor' => 2, 'operador' => 1][$u['papel'] ?? ''] ?? 0);

    $normalizados = [];
    foreach ($dados as $chave => $u) {
        if (!is_array($u)) {
            continue;
        }
        $k = normalizarEmail((string) $chave);
        $u['email'] = $u['email'] ?? (string) $chave;
        if (!isset($normalizados[$k]) || $peso($u) > $peso($normalizados[$k])) {
            $normalizados[$k] = $u;
        }
    }
    return $normalizados;
}

/**
 * Grava em arquivo temporario e troca de uma vez. Se o servidor cair no meio da
 * gravacao, o arquivo antigo continua inteiro - a alternativa seria um cadastro
 * corrompido e ninguem conseguindo entrar.
 */
function salvarUsuarios(array $usuarios): void
{
    $arq = arquivoUsuarios();
    $tmp = $arq . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents(
        $tmp,
        json_encode($usuarios, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        LOCK_EX
    );
    rename($tmp, $arq);
}

/**
 * Forma canônica do e-mail, usada como chave do cadastro.
 *
 * No Gmail, pontos no nome não importam e "+qualquercoisa" é apelido:
 * grupo.alvorada2027, grupoalvorada2027 e grupoalvorada2027+bi caem todos na
 * mesma caixa. O Google devolve o e-mail como a conta foi criada (com o ponto),
 * e o administrador pode ter digitado sem - sem esta normalização, a mesma
 * pessoa apareceria como desconhecida e cairia na fila de aprovação.
 *
 * Só vale para gmail.com/googlemail.com. Em outros domínios ponto é caractere
 * significativo e o e-mail é mantido como veio (em minúsculas).
 */
function normalizarEmail(string $email): string
{
    $email = strtolower(trim($email));
    $arroba = strrpos($email, '@');
    if ($arroba === false) {
        return $email; // login de reserva por senha ("felipe"), não é e-mail
    }

    $local   = substr($email, 0, $arroba);
    $dominio = substr($email, $arroba + 1);

    if ($dominio === 'gmail.com' || $dominio === 'googlemail.com') {
        $local   = str_replace('.', '', explode('+', $local, 2)[0]);
        $dominio = 'gmail.com';
    }

    return $local . '@' . $dominio;
}

/**
 * Garante que os administradores iniciais existam e estejam ativos. Sem isto, o
 * primeiro acesso cairia na fila de aprovacao - e nao haveria ninguem para
 * aprovar.
 */
function garantirAdminsIniciais(array &$usuarios): bool
{
    $mudou = false;
    foreach (adminsIniciais() as $email => $escrito) {
        if (!isset($usuarios[$email])) {
            $usuarios[$email] = [
                'email'    => $escrito,
                'nome'     => $escrito,
                'papel'    => 'admin',
                'status'   => 'ativo',
                'criadoEm' => time(),
            ];
            $mudou = true;
        }
    }
    return $mudou;
}

/**
 * Decide o que acontece com um e-mail que acabou de se autenticar no Google.
 *
 * @return array{resultado: string, usuario?: array}
 */
function registrarAcessoGoogle(string $emailGoogle, string $nome): array
{
    // O Google devolve o e-mail exatamente como a conta foi criada; é essa a
    // forma que guardamos para exibir. A chave é a forma canônica.
    $emailGoogle = strtolower(trim($emailGoogle));
    $email = normalizarEmail($emailGoogle);
    $usuarios = carregarUsuarios();
    garantirAdminsIniciais($usuarios);

    $u = $usuarios[$email] ?? null;

    if ($u === null) {
        $pendentes = array_filter($usuarios, static fn ($x) => ($x['status'] ?? '') === 'pendente');
        if (count($pendentes) < MAX_PENDENTES) {
            $usuarios[$email] = [
                'email'    => $emailGoogle,
                'nome'     => $nome !== '' ? $nome : $emailGoogle,
                'papel'    => 'operador',
                'status'   => 'pendente',
                'criadoEm' => time(),
            ];
            salvarUsuarios($usuarios);
        }
        return ['resultado' => 'pendente'];
    }

    $status = (string) ($u['status'] ?? 'pendente');
    if ($status !== 'ativo') {
        // Pendente e bloqueado recebem a mesma resposta: dizer "voce foi
        // bloqueado" confirma a quem tenta que aquela conta existe aqui.
        return ['resultado' => 'pendente'];
    }

    // Atualiza nome e ultimo acesso. O nome do Google substitui o e-mail
    // provisorio que o administrador inicial recebe ao ser criado.
    $nomeAtual = (string) ($u['nome'] ?? '');
    if ($nome !== '' && ($nomeAtual === '' || str_contains($nomeAtual, '@'))) {
        $u['nome'] = $nome;
    }
    $u['email'] = $emailGoogle;
    $u['ultimoAcesso'] = time();
    $usuarios[$email] = $u;
    salvarUsuarios($usuarios);

    return ['resultado' => 'ativo', 'usuario' => $u];
}

// ============================================================
// Sessao
// ============================================================

function iniciarSessao(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    // O cookie nao pode ser lido por JavaScript nem trafegar sem TLS. SameSite
    // Lax, e nao Strict, porque a volta do Google e uma navegacao vinda de outro
    // site: com Strict o cookie nao iria junto e o login nunca se completaria.
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

function abrirSessao(string $email, string $metodo): void
{
    iniciarSessao();
    // Troca o id da sessao no login, para impedir fixacao de sessao.
    session_regenerate_id(true);
    $_SESSION['email']    = normalizarEmail($email);
    $_SESSION['metodo']   = $metodo;
    $_SESSION['visto_em'] = time();
}

/**
 * Usuario da sessao atual, ou null.
 *
 * Confere o cadastro a cada chamada: quem foi bloqueado ou removido perde o
 * acesso imediatamente, mesmo com a sessao ainda aberta no navegador.
 */
function usuarioLogado(): ?array
{
    iniciarSessao();

    $email = (string) ($_SESSION['email'] ?? '');
    if ($email === '') {
        return null;
    }

    $ultimo = (int) ($_SESSION['visto_em'] ?? 0);
    if ($ultimo > 0 && (time() - $ultimo) > SESSAO_MINUTOS * 60) {
        encerrarSessao();
        return null;
    }

    if (($_SESSION['metodo'] ?? '') === 'senha') {
        // Login de reserva por senha: so vale enquanto o Google nao estiver
        // configurado. Configurou, todas as sessoes por senha caem.
        if (googleConfigurado() || !isset(USUARIOS[$email])) {
            encerrarSessao();
            return null;
        }
        $u = USUARIOS[$email];
        $_SESSION['visto_em'] = time();
        return ['login' => $email, 'nome' => (string) $u['nome'], 'papel' => (string) $u['papel']];
    }

    $usuarios = carregarUsuarios();
    $u = $usuarios[$email] ?? null;
    if ($u === null || ($u['status'] ?? '') !== 'ativo') {
        encerrarSessao();
        return null;
    }

    $papel = (string) ($u['papel'] ?? 'operador');
    if (!isset(PAPEIS[$papel])) {
        $papel = 'operador';
    }

    $_SESSION['visto_em'] = time();
    return ['login' => $email, 'nome' => (string) ($u['nome'] ?? $email), 'papel' => $papel];
}

function exigirLogin(): array
{
    $u = usuarioLogado();
    if ($u === null) {
        header('Location: login.php');
        exit;
    }
    // Paginas autenticadas nunca vao para o cache do navegador: depois de sair,
    // o botao Voltar nao pode reexibir custos e margens.
    header('Cache-Control: no-store, max-age=0');
    return $u;
}

function exigirAdmin(): array
{
    $u = exigirLogin();
    if ($u['papel'] !== 'admin') {
        http_response_code(403);
        exit('Acesso restrito a administradores.');
    }
    return $u;
}

function encerrarSessao(): void
{
    iniciarSessao();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }
    session_destroy();
}

/** Papeis que podem ver custo e margem. */
function podeVerMargem(array $usuario): bool
{
    return in_array($usuario['papel'], ['admin', 'gestor'], true);
}

/** Token anti-CSRF da sessao, criado sob demanda. */
function tokenCsrf(): string
{
    iniciarSessao();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf'];
}

function csrfValido(?string $recebido): bool
{
    iniciarSessao();
    return hash_equals((string) ($_SESSION['csrf'] ?? ''), (string) $recebido);
}

// ============================================================
// Login de reserva por senha
//
// Existe so para o periodo antes de o Google ser configurado - sem ele, o
// sistema ficaria inacessivel ate la. Depois, autenticarSenha() recusa tudo.
// ============================================================

function autenticarSenha(string $login, string $senha): bool
{
    if (googleConfigurado() || !defined('USUARIOS')) {
        return false;
    }

    $login = strtolower(trim($login));
    $dados = USUARIOS[$login] ?? null;

    // Com usuario inexistente, verifica um hash falso mesmo assim: o tempo de
    // resposta fica parecido e nao da para descobrir logins validos medindo-o.
    if ($dados === null) {
        password_verify($senha, '$2y$12$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalid');
        return false;
    }

    if (!password_verify($senha, (string) $dados['hash'])) {
        return false;
    }

    abrirSessao($login, 'senha');
    return true;
}

// ============================================================
// Protecao contra forca bruta
// ============================================================

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
    $dados = is_array($registro) ? ($registro[$ip] ?? null) : null;
    if (!is_array($dados) || (time() - (int) $dados['em']) > JANELA_SEGUNDOS) {
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
