<?php
/**
 * Autenticação e permissões do painel.
 *
 * NÃO EXISTE AUTOCADASTRO. Só um administrador cria contas; quem não foi criado
 * não entra, e não há como pedir acesso. Essa é a diferença central em relação
 * a um login comum na internet: aqui a lista de quem pode entrar é fechada.
 *
 * Camadas, da borda para o centro:
 *
 *   1. Limite por IP      - trava a máquina que fica tentando
 *   2. Limite por conta   - trava a conta alvo, mesmo se o ataque trocar de IP
 *   3. Espera crescente   - cada erro atrasa mais a resposta seguinte
 *   4. Senha com Argon2id - desenhado para resistir a quebra em placa de vídeo
 *   5. Tempo constante    - erro de senha e conta inexistente demoram o mesmo
 *   6. Segundo fator      - código do aplicativo, opcional por conta
 *   7. Sessão endurecida  - id trocado, prazo máximo, prazo de inatividade
 *   8. Permissão relida   - bloquear alguém tem efeito no clique seguinte
 *
 * Senha e segredos ficam em .usuarios.json, que o .htaccess impede de ser
 * servido pela web: o nome começa com ponto e termina em .json, dois padrões
 * bloqueados. Só o PHP o lê, pelo sistema de arquivos.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

// ============================================================
// Parâmetros
// ============================================================

/** Inatividade até a sessão cair. */
const SESSAO_MINUTOS = 240;          // 4 horas

/** Prazo máximo de uma sessão, mesmo em uso contínuo. */
const SESSAO_MAX_HORAS = 12;

/** Tamanho mínimo da senha. Comprimento protege mais que obrigar símbolos. */
const SENHA_MINIMA = 12;

/** Erros seguidos até travar (por conta e por IP). */
const MAX_FALHAS = 5;

/** Janela do contador de erros. */
const JANELA_FALHAS = 900;           // 15 minutos

/** Validade da senha provisória que o administrador entrega. */
const PROVISORIA_HORAS = 48;

const PAPEIS = [
    'admin'    => 'Administrador',
    'gestor'   => 'Gestor',
    'operador' => 'Operador',
];

// O PHP anuncia a própria versão por padrão; não há motivo para informar a
// quem sonda o servidor qual versão procurar falhas.
header_remove('X-Powered-By');

// ============================================================
// Hash de senha
// ============================================================

/**
 * Argon2id quando houver (é o recomendado atualmente: além de lento, exige
 * memória, o que encarece muito a quebra em placa de vídeo). Confirmado
 * disponível no servidor, com bcrypt de custo 12 como reserva.
 */
function algoritmoSenha(): string
{
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
}

function opcoesSenha(): array
{
    if (defined('PASSWORD_ARGON2ID')) {
        return ['memory_cost' => 65536, 'time_cost' => 4, 'threads' => 2];
    }
    return ['cost' => 12];
}

function gerarHashSenha(string $senha): string
{
    return password_hash($senha, algoritmoSenha(), opcoesSenha());
}

/**
 * Regras da senha. Exigimos comprimento e variedade mínima, e recusamos as
 * sequências mais previsíveis. Não forçamos troca periódica: isso leva as
 * pessoas a criar variações óbvias da mesma senha.
 *
 * @return string '' quando aceita, ou o motivo da recusa.
 */
/** Tamanho em caracteres, sem depender de a extensão mbstring estar instalada. */
function tamanhoTexto(string $t): int
{
    return function_exists('mb_strlen') ? mb_strlen($t, 'UTF-8') : strlen($t);
}

function problemaNaSenha(string $senha, string $email = '', string $nome = ''): string
{
    $tamanho = tamanhoTexto($senha);

    if ($tamanho < SENHA_MINIMA) {
        return 'A senha precisa de pelo menos ' . SENHA_MINIMA . ' caracteres.';
    }
    if ($tamanho > 200) {
        return 'A senha é longa demais.';
    }

    $classes = (int) preg_match('/[a-z]/u', $senha)
             + (int) preg_match('/[A-Z]/u', $senha)
             + (int) preg_match('/\d/', $senha)
             + (int) preg_match('/[^\p{L}\p{N}]/u', $senha);
    if ($classes < 3) {
        return 'Combine pelo menos três entre: minúsculas, maiúsculas, números e símbolos.';
    }

    $simples = strtolower($senha);
    $proibidas = ['senha', 'password', '123456', 'qwerty', 'alvorada', 'admin',
                  'abc123', '12345678', 'mudar123', 'teste'];
    foreach ($proibidas as $p) {
        if (str_contains($simples, $p)) {
            return 'Essa senha contém uma sequência muito comum. Escolha outra.';
        }
    }

    // Parte do próprio e-mail ou do nome é das primeiras coisas que se tenta.
    foreach ([explode('@', $email)[0], $nome] as $pessoal) {
        $pessoal = strtolower(trim((string) $pessoal));
        if ($pessoal !== '' && tamanhoTexto($pessoal) >= 4 && str_contains($simples, $pessoal)) {
            return 'A senha não pode conter seu nome ou e-mail.';
        }
    }

    if (preg_match('/(.)\1{3,}/u', $senha)) {
        return 'Evite repetir o mesmo caractere várias vezes seguidas.';
    }

    return '';
}

/** Senha provisória legível, para o administrador entregar à pessoa. */
function gerarSenhaProvisoria(): string
{
    // Sem caracteres que se confundem (O/0, l/1), porque esta senha é ditada
    // ou copiada à mão.
    $letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    $numeros = '23456789';
    $simbolos = '!@#$%&*?';
    $senha = '';
    for ($i = 0; $i < 10; $i++) {
        $senha .= $letras[random_int(0, strlen($letras) - 1)];
    }
    for ($i = 0; $i < 3; $i++) {
        $senha .= $numeros[random_int(0, strlen($numeros) - 1)];
    }
    $senha .= $simbolos[random_int(0, strlen($simbolos) - 1)];
    return str_shuffle($senha);
}

// ============================================================
// Cadastro de usuários
// ============================================================

function arquivoUsuarios(): string
{
    return __DIR__ . '/.usuarios.json';
}

/**
 * Forma canônica do e-mail, usada como chave.
 *
 * No Gmail, pontos no nome não importam e "+apelido" é a mesma caixa, então
 * grupo.alvorada e grupoalvorada são a mesma pessoa. Em outros domínios o
 * ponto é significativo e o endereço fica como veio.
 */
function normalizarEmail(string $email): string
{
    $email = strtolower(trim($email));
    $arroba = strrpos($email, '@');
    if ($arroba === false) {
        return $email;
    }

    $local   = substr($email, 0, $arroba);
    $dominio = substr($email, $arroba + 1);

    if ($dominio === 'gmail.com' || $dominio === 'googlemail.com') {
        $local   = str_replace('.', '', explode('+', $local, 2)[0]);
        $dominio = 'gmail.com';
    }

    return $local . '@' . $dominio;
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

    $normalizados = [];
    foreach ($dados as $chave => $u) {
        if (is_array($u)) {
            $normalizados[normalizarEmail((string) $chave)] = $u;
        }
    }
    return $normalizados;
}

/**
 * Grava num temporário e troca de uma vez. Se o servidor cair no meio da
 * gravação, o arquivo antigo continua inteiro — a alternativa seria um cadastro
 * corrompido e ninguém conseguindo entrar.
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
    @chmod($tmp, 0600);
    rename($tmp, $arq);
}

function buscarUsuario(string $email): ?array
{
    return carregarUsuarios()[normalizarEmail($email)] ?? null;
}

function gravarUsuario(string $email, array $dados): void
{
    $usuarios = carregarUsuarios();
    $usuarios[normalizarEmail($email)] = $dados;
    salvarUsuarios($usuarios);
}

function contarAdminsAtivos(?array $usuarios = null): int
{
    $usuarios ??= carregarUsuarios();
    return count(array_filter(
        $usuarios,
        static fn ($u) => ($u['papel'] ?? '') === 'admin' && ($u['status'] ?? '') === 'ativo'
    ));
}

/** Cria a conta. Devolve a senha provisória, que é mostrada uma única vez. */
function criarUsuario(string $email, string $nome, string $papel, string $criadoPor): string
{
    $provisoria = gerarSenhaProvisoria();

    gravarUsuario($email, [
        'email'           => strtolower(trim($email)),
        'nome'            => $nome,
        'papel'           => $papel,
        'status'          => 'ativo',
        'senhaHash'       => gerarHashSenha($provisoria),
        'senhaProvisoria' => true,
        'provisoriaAte'   => time() + PROVISORIA_HORAS * 3600,
        'criadoEm'        => time(),
        'criadoPor'       => $criadoPor,
    ]);

    return $provisoria;
}

// ============================================================
// Controle de tentativas
//
// Dois contadores. O do IP trava a máquina que está tentando; o da conta trava
// o alvo mesmo que o ataque venha de vários endereços. Sem o segundo, uma
// botnet contornaria o primeiro sem esforço.
// ============================================================

function arquivoTentativas(): string
{
    return __DIR__ . '/.tentativas.json';
}

function ipAtual(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'desconhecido');
}

function lerTentativas(): array
{
    $d = @json_decode((string) @file_get_contents(arquivoTentativas()), true);
    return is_array($d) ? $d : [];
}

function escreverTentativas(array $dados): void
{
    // Limpa o que já venceu, para o arquivo não crescer indefinidamente.
    foreach ($dados as $chave => $v) {
        if ((time() - (int) ($v['em'] ?? 0)) > JANELA_FALHAS * 4) {
            unset($dados[$chave]);
        }
    }
    @file_put_contents(arquivoTentativas(), json_encode($dados), LOCK_EX);
}

/** Segundos restantes de bloqueio, ou 0. */
function bloqueioRestante(string $chave): int
{
    $d = lerTentativas()[$chave] ?? null;
    if (!is_array($d) || ($d['n'] ?? 0) < MAX_FALHAS) {
        return 0;
    }
    // Espera cresce a cada bloco de falhas: 15 min, depois 30, 60, até 4 horas.
    $nivel = (int) floor(((int) $d['n'] - MAX_FALHAS) / MAX_FALHAS);
    $espera = min(JANELA_FALHAS * (2 ** $nivel), 14400);
    $fim = (int) $d['em'] + $espera;
    return max(0, $fim - time());
}

function bloqueado(string $email = ''): int
{
    $porIp = bloqueioRestante('ip:' . ipAtual());
    $porConta = $email === '' ? 0 : bloqueioRestante('conta:' . normalizarEmail($email));
    return max($porIp, $porConta);
}

function registrarFalha(string $email = ''): void
{
    $dados = lerTentativas();
    $chaves = ['ip:' . ipAtual()];
    if ($email !== '') {
        $chaves[] = 'conta:' . normalizarEmail($email);
    }

    foreach ($chaves as $chave) {
        $d = $dados[$chave] ?? ['n' => 0, 'em' => time()];
        if ((time() - (int) $d['em']) > JANELA_FALHAS && ($d['n'] ?? 0) < MAX_FALHAS) {
            $d = ['n' => 0, 'em' => time()];
        }
        $d['n'] = (int) $d['n'] + 1;
        $d['em'] = time();
        $dados[$chave] = $d;
    }

    escreverTentativas($dados);
}

function limparFalhas(string $email = ''): void
{
    $dados = lerTentativas();
    unset($dados['ip:' . ipAtual()]);
    if ($email !== '') {
        unset($dados['conta:' . normalizarEmail($email)]);
    }
    escreverTentativas($dados);
}

// ============================================================
// Segundo fator (TOTP, o código que muda a cada 30 segundos)
// ============================================================

function base32Codificar(string $bytes): string
{
    $alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($bytes) as $b) {
        $bits .= str_pad(decbin(ord($b)), 8, '0', STR_PAD_LEFT);
    }
    $saida = '';
    foreach (str_split($bits, 5) as $pedaco) {
        $saida .= $alfabeto[bindec(str_pad($pedaco, 5, '0', STR_PAD_RIGHT))];
    }
    return $saida;
}

function base32Decodificar(string $texto): string
{
    $alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $texto = strtoupper(preg_replace('/[^A-Z2-7]/i', '', $texto) ?? '');
    $bits = '';
    foreach (str_split($texto) as $c) {
        $pos = strpos($alfabeto, $c);
        if ($pos === false) {
            continue;
        }
        $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $pedaco) {
        if (strlen($pedaco) === 8) {
            $bytes .= chr(bindec($pedaco));
        }
    }
    return $bytes;
}

function gerarSegredoTotp(): string
{
    return base32Codificar(random_bytes(20));
}

/** Código de 6 dígitos de um instante (RFC 6238). */
function codigoTotp(string $segredo, int $instante): string
{
    $contador = pack('J', intdiv($instante, 30));
    $hash = hash_hmac('sha1', $contador, base32Decodificar($segredo), true);
    $desloc = ord($hash[19]) & 0x0F;
    $valor = ((ord($hash[$desloc]) & 0x7F) << 24)
           | ((ord($hash[$desloc + 1]) & 0xFF) << 16)
           | ((ord($hash[$desloc + 2]) & 0xFF) << 8)
           | (ord($hash[$desloc + 3]) & 0xFF);
    return str_pad((string) ($valor % 1000000), 6, '0', STR_PAD_LEFT);
}

/**
 * Confere o código. Aceita a janela anterior e a seguinte, porque o relógio do
 * celular quase nunca está perfeitamente igual ao do servidor.
 */
function totpConfere(string $segredo, string $codigo): bool
{
    $codigo = preg_replace('/\D/', '', $codigo) ?? '';
    if (strlen($codigo) !== 6) {
        return false;
    }
    $agora = time();
    for ($i = -1; $i <= 1; $i++) {
        if (hash_equals(codigoTotp($segredo, $agora + $i * 30), $codigo)) {
            return true;
        }
    }
    return false;
}

/** Endereço que o aplicativo autenticador entende. */
function uriTotp(string $email, string $segredo): string
{
    return 'otpauth://totp/' . rawurlencode('Grupo Alvorada:' . $email)
         . '?secret=' . $segredo
         . '&issuer=' . rawurlencode('Grupo Alvorada')
         . '&algorithm=SHA1&digits=6&period=30';
}

/** Códigos de recuperação, para quando a pessoa perde o celular. */
function gerarCodigosRecuperacao(): array
{
    $codigos = [];
    for ($i = 0; $i < 8; $i++) {
        $codigos[] = strtoupper(bin2hex(random_bytes(4)));
    }
    return $codigos;
}

function hashCodigosRecuperacao(array $codigos): array
{
    // Guardados como hash: nem com o arquivo em mãos dá para lê-los.
    return array_map(static fn ($c) => hash('sha256', $c), $codigos);
}

// ============================================================
// Sessão
// ============================================================

function iniciarSessao(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => true,     // só por HTTPS
        'httponly' => true,     // JavaScript não lê
        'samesite' => 'Strict', // não acompanha navegação vinda de outro site
    ]);
    session_name('painel_alvorada');
    session_start();
}

function abrirSessao(string $email, array $usuario): void
{
    iniciarSessao();
    // Novo id no login: impede que um id plantado antes vire sessão autenticada.
    session_regenerate_id(true);

    $_SESSION = [
        'email'     => normalizarEmail($email),
        'aberta_em' => time(),
        'visto_em'  => time(),
        // Guardamos a impressão do navegador: um cookie roubado e usado de
        // outro aparelho não bate e a sessão cai.
        'marca'     => marcaDoCliente(),
        'csrf'      => bin2hex(random_bytes(32)),
    ];

    $usuario['ultimoAcesso'] = time();
    $usuario['ultimoIp'] = ipAtual();
    gravarUsuario($email, $usuario);
}

function marcaDoCliente(): string
{
    return hash('sha256', ($_SERVER['HTTP_USER_AGENT'] ?? '') . '|' . CHAVE_SESSAO);
}

/** Usuário da sessão atual, ou null. */
function usuarioLogado(): ?array
{
    iniciarSessao();

    $email = (string) ($_SESSION['email'] ?? '');
    if ($email === '') {
        return null;
    }

    // Prazo máximo, inatividade e aparelho.
    $abertaEm = (int) ($_SESSION['aberta_em'] ?? 0);
    $vistoEm  = (int) ($_SESSION['visto_em'] ?? 0);
    if ($abertaEm > 0 && (time() - $abertaEm) > SESSAO_MAX_HORAS * 3600) {
        encerrarSessao();
        return null;
    }
    if ($vistoEm > 0 && (time() - $vistoEm) > SESSAO_MINUTOS * 60) {
        encerrarSessao();
        return null;
    }
    if (!hash_equals((string) ($_SESSION['marca'] ?? ''), marcaDoCliente())) {
        encerrarSessao();
        return null;
    }

    // Permissão relida do cadastro a cada requisição: bloquear ou rebaixar
    // alguém tem efeito no clique seguinte, não só quando a sessão expirar.
    $u = buscarUsuario($email);
    if ($u === null || ($u['status'] ?? '') !== 'ativo') {
        encerrarSessao();
        return null;
    }

    $papel = (string) ($u['papel'] ?? 'operador');
    if (!isset(PAPEIS[$papel])) {
        $papel = 'operador';
    }

    $_SESSION['visto_em'] = time();

    return [
        'login'      => normalizarEmail($email),
        'email'      => (string) ($u['email'] ?? $email),
        'nome'       => (string) ($u['nome'] ?? $email),
        'papel'      => $papel,
        'provisoria' => (bool) ($u['senhaProvisoria'] ?? false),
        'totpAtivo'  => (bool) ($u['totp']['ativo'] ?? false),
    ];
}

function exigirLogin(): array
{
    $u = usuarioLogado();
    if ($u === null) {
        header('Location: login.php');
        exit;
    }

    // Senha provisória: só a tela de troca é liberada, para a senha entregue
    // pelo administrador não continuar valendo indefinidamente.
    $aqui = basename((string) ($_SERVER['SCRIPT_NAME'] ?? ''));
    if ($u['provisoria'] && $aqui !== 'trocar-senha.php' && $aqui !== 'sair.php') {
        header('Location: trocar-senha.php');
        exit;
    }

    // Páginas autenticadas nunca vão para o cache: depois de sair, o botão
    // Voltar não pode reexibir custos e margens.
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
            'samesite' => 'Strict',
        ]);
    }
    session_destroy();
}

function podeVerMargem(array $usuario): bool
{
    return in_array($usuario['papel'], ['admin', 'gestor'], true);
}

// ============================================================
// CSRF
// ============================================================

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
    $esperado = (string) ($_SESSION['csrf'] ?? '');

    // Sem token na sessão nada pode ser aceito: comparar "" com "" daria igual.
    if ($esperado === '' || $recebido === null || $recebido === '') {
        return false;
    }
    return hash_equals($esperado, $recebido);
}

// ============================================================
// Entrada
// ============================================================

/**
 * Confere e-mail e senha.
 *
 * @return array{ok: bool, motivo?: string, usuario?: array, exigeTotp?: bool}
 */
function verificarSenha(string $email, string $senha): array
{
    $emailNorm = normalizarEmail($email);
    $u = buscarUsuario($emailNorm);

    // Conta inexistente também passa por uma verificação de hash, para o tempo
    // de resposta não denunciar quais e-mails existem no sistema.
    if ($u === null) {
        password_verify($senha, '$argon2id$v=19$m=65536,t=4,p=2$aW52YWxpZG9pbnZhbGlkbw$'
            . 'aW52YWxpZG9pbnZhbGlkb2ludmFsaWRvaW52YWxpZG9pbnY');
        return ['ok' => false, 'motivo' => 'credenciais'];
    }

    if (($u['status'] ?? '') !== 'ativo') {
        password_verify($senha, (string) ($u['senhaHash'] ?? ''));
        // Mesma mensagem de senha errada: dizer "conta bloqueada" confirma que
        // aquele e-mail existe aqui.
        return ['ok' => false, 'motivo' => 'credenciais'];
    }

    if (!password_verify($senha, (string) ($u['senhaHash'] ?? ''))) {
        return ['ok' => false, 'motivo' => 'credenciais'];
    }

    // Senha provisória vencida: o administrador precisa gerar outra.
    if (($u['senhaProvisoria'] ?? false) && time() > (int) ($u['provisoriaAte'] ?? 0)) {
        return ['ok' => false, 'motivo' => 'provisoria_vencida'];
    }

    // Reforça o hash se os parâmetros recomendados tiverem mudado.
    if (password_needs_rehash((string) $u['senhaHash'], algoritmoSenha(), opcoesSenha())) {
        $u['senhaHash'] = gerarHashSenha($senha);
        gravarUsuario($emailNorm, $u);
    }

    return [
        'ok' => true,
        'usuario' => $u,
        'exigeTotp' => (bool) ($u['totp']['ativo'] ?? false),
    ];
}

/** Confere o segundo fator: código do aplicativo ou de recuperação. */
function verificarSegundoFator(array $usuario, string $codigo, string $email): bool
{
    $segredo = (string) ($usuario['totp']['segredo'] ?? '');
    if ($segredo === '') {
        return false;
    }

    if (totpConfere($segredo, $codigo)) {
        return true;
    }

    // Código de recuperação: vale uma vez e é consumido no uso.
    $limpo = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $codigo) ?? '');
    $hashes = (array) ($usuario['totp']['recuperacao'] ?? []);
    foreach ($hashes as $i => $h) {
        if (hash_equals((string) $h, hash('sha256', $limpo))) {
            unset($hashes[$i]);
            $usuario['totp']['recuperacao'] = array_values($hashes);
            $usuario['totp']['recuperacaoUsadaEm'] = time();
            gravarUsuario($email, $usuario);
            return true;
        }
    }

    return false;
}
