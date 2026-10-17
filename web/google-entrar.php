<?php
/**
 * Envia a pessoa para a tela de login do Google.
 *
 * Gera dois valores aleatorios e os guarda na sessao:
 *   state - conferido na volta; impede que um link forjado complete um login
 *           em nome de outra pessoa (CSRF no fluxo OAuth).
 *   nonce - vai dentro do token assinado pelo Google; impede que um token
 *           antigo, capturado em outro momento, seja reaproveitado.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

if (!googleConfigurado()) {
    header('Location: login.php');
    exit;
}

if (tentativasExcedidas()) {
    header('Location: login.php?aviso=bloqueado');
    exit;
}

iniciarSessao();
$_SESSION['google_state'] = bin2hex(random_bytes(24));
$_SESSION['google_nonce'] = bin2hex(random_bytes(24));
$_SESSION['google_em']    = time();

$parametros = http_build_query([
    'client_id'     => GOOGLE_CLIENT_ID,
    'redirect_uri'  => GOOGLE_REDIRECT_URI,
    'response_type' => 'code',
    // So identidade: nome e e-mail. Nenhum acesso a Gmail, Drive ou agenda.
    'scope'         => 'openid email profile',
    // A resposta volta depois do "#" da URL, que o navegador nunca envia ao
    // servidor. Necessário por causa do ModSecurity da HostGator: o Google
    // devolve iss=https://accounts.google.com, e o firewall bloqueia (erro 406)
    // qualquer parâmetro cujo valor comece com https://. google-retorno.js lê o
    // fragmento e reenvia só code e state. O iss continua sendo conferido -
    // dentro do token assinado, em google-callback.php.
    'response_mode' => 'fragment',
    'state'         => $_SESSION['google_state'],
    'nonce'         => $_SESSION['google_nonce'],
    // Sempre mostra a escolha de conta: em computador compartilhado, evita
    // entrar sem querer com a conta de outra pessoa ja logada no navegador.
    'prompt'        => 'select_account',
]);

header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . $parametros);
exit;
