<?php
/**
 * Volta do Google: confere tudo, troca o codigo pelo token e decide o acesso.
 *
 * A ordem das verificacoes importa - cada uma fecha uma porta diferente:
 *
 *   1. state       igual ao gerado aqui        -> o login comecou neste site
 *   2. codigo      trocado com o client_secret -> so este servidor completa
 *   3. iss / aud   Google, para este cliente   -> token nao e de outro app
 *   4. exp         dentro da validade          -> token nao e antigo
 *   5. nonce       igual ao gerado aqui        -> token nao e reaproveitado
 *   6. e-mail      verificado pelo Google      -> a pessoa e dona do endereco
 *   7. cadastro    ativo na lista de usuarios  -> a pessoa tem permissao
 *
 * Os passos 1 a 6 provam QUEM e a pessoa. So o 7 diz se ela PODE entrar.
 *
 * Sobre a assinatura do token: ele chega aqui direto do Google, numa conexao
 * TLS que este servidor abriu e autenticou com o client_secret. A especificacao
 * do OpenID Connect (secao 3.1.3.7) dispensa validar a assinatura nesse caso,
 * porque nao ha intermediario que pudesse adultera-lo.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

function voltarComAviso(string $aviso): void
{
    header('Location: login.php?aviso=' . rawurlencode($aviso));
    exit;
}

if (!googleConfigurado()) {
    voltarComAviso('indisponivel');
}

iniciarSessao();

$stateEsperado = (string) ($_SESSION['google_state'] ?? '');
$nonceEsperado = (string) ($_SESSION['google_nonce'] ?? '');
$iniciadoEm    = (int) ($_SESSION['google_em'] ?? 0);

// Usados uma unica vez: some da sessao antes de qualquer outra coisa.
unset($_SESSION['google_state'], $_SESSION['google_nonce'], $_SESSION['google_em']);

if (isset($_GET['error'])) {
    // A pessoa cancelou na tela do Google. Nao e tentativa suspeita.
    voltarComAviso('cancelado');
}

$state = (string) ($_GET['state'] ?? '');
$code  = (string) ($_GET['code'] ?? '');

if ($stateEsperado === '' || !hash_equals($stateEsperado, $state) || $code === '') {
    registrarFalha();
    voltarComAviso('falha');
}

if ($iniciadoEm === 0 || (time() - $iniciadoEm) > 600) {
    voltarComAviso('expirado');
}

// --- 2. Troca o codigo pelo token, de servidor para servidor ---------------
$ch = curl_init('https://oauth2.googleapis.com/token');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_POSTFIELDS     => http_build_query([
        'code'          => $code,
        'client_id'     => GOOGLE_CLIENT_ID,
        'client_secret' => GOOGLE_CLIENT_SECRET,
        'redirect_uri'  => GOOGLE_REDIRECT_URI,
        'grant_type'    => 'authorization_code',
    ]),
]);
$resposta = curl_exec($ch);
$status   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$token = is_string($resposta) ? json_decode($resposta, true) : null;
if ($status !== 200 || !is_array($token) || empty($token['id_token'])) {
    // O detalhe vai so para o log do servidor - nunca para a tela, onde
    // ajudaria quem esta tentando entender o fluxo para ataca-lo.
    error_log('Login Google: troca de codigo falhou, HTTP ' . $status);
    voltarComAviso('falha');
}

// --- 3 a 6. Confere o conteudo do token ------------------------------------
$partes = explode('.', (string) $token['id_token']);
if (count($partes) !== 3) {
    voltarComAviso('falha');
}

$conteudo = json_decode(
    (string) base64_decode(strtr($partes[1], '-_', '+/') . str_repeat('=', (4 - strlen($partes[1]) % 4) % 4)),
    true
);

$iss = (string) ($conteudo['iss'] ?? '');
$ok = is_array($conteudo)
    && in_array($iss, ['https://accounts.google.com', 'accounts.google.com'], true)
    && hash_equals(GOOGLE_CLIENT_ID, (string) ($conteudo['aud'] ?? ''))
    && (int) ($conteudo['exp'] ?? 0) > time()
    && $nonceEsperado !== ''
    && hash_equals($nonceEsperado, (string) ($conteudo['nonce'] ?? ''))
    && ($conteudo['email_verified'] ?? false) === true
    && filter_var($conteudo['email'] ?? '', FILTER_VALIDATE_EMAIL);

if (!$ok) {
    registrarFalha();
    error_log('Login Google: token recusado na conferencia de iss/aud/exp/nonce/email');
    voltarComAviso('falha');
}

// --- 7. Permissao ----------------------------------------------------------
$email = (string) $conteudo['email'];
$nome  = trim((string) ($conteudo['name'] ?? ''));

$acesso = registrarAcessoGoogle($email, $nome);

if ($acesso['resultado'] !== 'ativo') {
    voltarComAviso('pendente');
}

limparFalhas();
abrirSessao($email, 'google');
header('Location: index.php');
exit;
