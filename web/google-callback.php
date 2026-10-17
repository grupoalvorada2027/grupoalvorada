<?php
/**
 * Recebe e confere o login do Google.
 *
 * POR QUE POST, E NÃO O REDIRECIONAMENTO CLÁSSICO
 * O ModSecurity da HostGator devolve 406 para qualquer parâmetro cujo valor
 * comece com https:// (regra contra inclusão remota de arquivos), e o Google
 * devolve iss=https://accounts.google.com no retorno. Testado: acontece em GET
 * e em POST, em PHP e até em arquivo estático; e as diretivas para desligar a
 * regra não são permitidas no .htaccess desta hospedagem. A saída foi trocar o
 * fluxo: o botão do Google entrega um token em base64, sem "://" em texto, que
 * passa pelo firewall sem precisar afrouxá-lo.
 *
 * O TOKEN PASSA PELO NAVEGADOR, ENTÃO A CONFERÊNCIA É MAIS RIGOROSA
 * No fluxo anterior o token vinha do Google direto para o servidor, por uma
 * conexão que nós mesmos abrimos — dava para confiar na origem. Agora ele passa
 * pela máquina da pessoa, onde poderia ser trocado. Por isso a assinatura é
 * verificada com o Google antes de qualquer outra coisa:
 *
 *   1. CSRF            -> o envio partiu da nossa própria tela
 *   2. assinatura      -> conferida pelo Google (endpoint tokeninfo)
 *   3. aud             -> token emitido para ESTE aplicativo, não outro
 *   4. iss / exp       -> emissor correto e dentro da validade
 *   5. nonce           -> token desta tentativa, não um reaproveitado
 *   6. email_verified  -> a pessoa é dona do endereço
 *   7. cadastro ativo  -> a pessoa tem permissão aqui
 *
 * Os passos 1 a 6 provam QUEM é. Só o 7 diz se PODE entrar.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/** Responde e encerra. O motivo detalhado vai para o log, nunca para a tela. */
function responder(bool $ok, string $destinoOuAviso, ?string $log = null): never
{
    if ($log !== null) {
        error_log('Login Google: ' . $log);
    }
    echo json_encode($ok ? ['ok' => true, 'destino' => $destinoOuAviso]
                         : ['ok' => false, 'aviso' => $destinoOuAviso]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    // Alguém abriu o endereço no navegador, ou o Google ainda está configurado
    // com o fluxo antigo de redirecionamento.
    header('Content-Type: text/html; charset=utf-8');
    header('Location: login.php');
    exit;
}

if (!googleConfigurado()) {
    responder(false, 'indisponivel');
}

if (tentativasExcedidas()) {
    responder(false, 'bloqueado');
}

iniciarSessao();

// --- 1. O envio partiu da nossa tela ---------------------------------------
if (!csrfValido($_POST['csrf'] ?? null)) {
    responder(false, 'expirado', 'csrf inválido');
}

$credencial = (string) ($_POST['credential'] ?? '');
// Formato de JWT: três blocos base64url separados por ponto. Confere antes de
// enviar ao Google, para não gastar requisição com lixo.
if (!preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $credencial)) {
    registrarFalha();
    responder(false, 'falha', 'credencial com formato inválido');
}

$nonceEsperado = (string) ($_SESSION['google_nonce'] ?? '');
unset($_SESSION['google_nonce']); // vale uma vez só

// --- 2. Assinatura conferida pelo Google ------------------------------------
// Usamos o endpoint oficial de verificação em vez de validar a assinatura RS256
// por conta própria: são poucos logins por dia, e código criptográfico escrito
// à mão é onde moram as falhas difíceis de enxergar.
$ch = curl_init('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($credencial));
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);
$resposta = curl_exec($ch);
$status   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($status !== 200 || !is_string($resposta)) {
    registrarFalha();
    responder(false, 'falha', "tokeninfo recusou o token (HTTP $status)");
}

$t = json_decode($resposta, true);
if (!is_array($t)) {
    responder(false, 'falha', 'resposta do tokeninfo ilegível');
}

// --- 3 a 6. Conteúdo do token ----------------------------------------------
$emailVerificado = ($t['email_verified'] ?? '') === true || ($t['email_verified'] ?? '') === 'true';

$conferencias = [
    'aud'   => hash_equals(GOOGLE_CLIENT_ID, (string) ($t['aud'] ?? '')),
    'iss'   => in_array((string) ($t['iss'] ?? ''), ['https://accounts.google.com', 'accounts.google.com'], true),
    'exp'   => (int) ($t['exp'] ?? 0) > time(),
    'nonce' => $nonceEsperado !== '' && hash_equals($nonceEsperado, (string) ($t['nonce'] ?? '')),
    'email' => $emailVerificado && filter_var($t['email'] ?? '', FILTER_VALIDATE_EMAIL) !== false,
];

$falhou = array_keys(array_filter($conferencias, static fn ($v) => !$v));
if ($falhou !== []) {
    registrarFalha();
    responder(false, 'falha', 'token recusado em: ' . implode(', ', $falhou));
}

// --- 7. Permissão -----------------------------------------------------------
$acesso = registrarAcessoGoogle((string) $t['email'], trim((string) ($t['name'] ?? '')));

if ($acesso['resultado'] !== 'ativo') {
    // Pendente e bloqueado recebem a mesma resposta, de propósito.
    responder(false, 'pendente');
}

limparFalhas();
abrirSessao((string) $t['email'], 'google');
responder(true, 'index.php');
