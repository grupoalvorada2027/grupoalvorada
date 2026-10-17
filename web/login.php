<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';

iniciarSessao();

// Já logado? Vai direto ao painel.
if (usuarioLogado() !== null) {
    header('Location: index.php');
    exit;
}

$google = googleConfigurado();
$erro   = '';
$info   = '';

// Mensagens da volta do Google. Textos fixos, escolhidos por chave: o que vem
// na URL nunca é impresso na tela, então não há como injetar conteúdo por ali.
$avisos = [
    'pendente'     => ['info', 'Seu acesso foi solicitado. Assim que um administrador liberar, você poderá entrar com esta conta.'],
    'cancelado'    => ['info', 'Login cancelado.'],
    'expirado'     => ['erro', 'A tentativa de login expirou. Tente novamente.'],
    'bloqueado'    => ['erro', 'Muitas tentativas seguidas. Aguarde 15 minutos antes de tentar de novo.'],
    'falha'        => ['erro', 'Não foi possível confirmar o login. Tente novamente.'],
    'indisponivel' => ['erro', 'Login com Google ainda não está configurado.'],
];
$chaveAviso = (string) ($_GET['aviso'] ?? '');
if (isset($avisos[$chaveAviso])) {
    [$tipo, $texto] = $avisos[$chaveAviso];
    if ($tipo === 'erro') {
        $erro = $texto;
    } else {
        $info = $texto;
    }
}

// Login de reserva por senha: só existe enquanto o Google não está configurado.
if (!$google && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (tentativasExcedidas()) {
        $erro = 'Muitas tentativas seguidas. Aguarde 15 minutos antes de tentar de novo.';
    } elseif (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'Sessão expirada. Recarregue a página e tente novamente.';
    } elseif (autenticarSenha((string) ($_POST['login'] ?? ''), (string) ($_POST['senha'] ?? ''))) {
        limparFalhas();
        header('Location: index.php');
        exit;
    } else {
        registrarFalha();
        // Genérica de propósito: não revela se o usuário existe.
        $erro = 'Usuário ou senha incorretos.';
    }
}

$csrf = tokenCsrf();

// Nonce desta tentativa: vai no botao e volta dentro do token assinado, onde e
// conferido. Impede que um token capturado antes seja reenviado depois.
if ($google) {
    $_SESSION['google_nonce'] = bin2hex(random_bytes(24));
}
header('X-Robots-Tag: noindex, nofollow');
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Entrar · Grupo Alvorada</title>
<meta name="theme-color" content="#CF0C0C">
<link rel="icon" href="logo.png">
<link rel="stylesheet" href="login.css">
</head>
<body>

<svg width="0" height="0" class="sprite" aria-hidden="true">
  <defs>
    <symbol id="i-usuario" viewBox="0 0 24 24">
      <circle cx="12" cy="8.2" r="3.7"/>
      <path d="M4.8 20c.9-3.6 3.8-5.6 7.2-5.6s6.3 2 7.2 5.6"/>
    </symbol>
    <symbol id="i-cadeado" viewBox="0 0 24 24">
      <rect x="4.75" y="10.5" width="14.5" height="10" rx="2.6"/>
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/>
      <path d="M12 14.6v2"/>
    </symbol>
    <symbol id="i-olho" viewBox="0 0 24 24">
      <path d="M2.6 12.3C4.5 8.4 8 6.2 12 6.2s7.5 2.2 9.4 6.1c-1.9 3.9-5.4 6.1-9.4 6.1s-7.5-2.2-9.4-6.1Z"/>
      <circle cx="12" cy="12.3" r="2.9"/>
    </symbol>
    <symbol id="i-olho-fechado" viewBox="0 0 24 24">
      <path d="M9.9 6.5A9.6 9.6 0 0 1 12 6.2c4 0 7.5 2.2 9.4 6.1a11 11 0 0 1-2.3 3.2"/>
      <path d="M6.3 8.2a11 11 0 0 0-3.7 4.1c1.9 3.9 5.4 6.1 9.4 6.1a9.7 9.7 0 0 0 4.6-1.1"/>
      <path d="M10 10.2a2.9 2.9 0 0 0 4 4.1"/>
      <path d="M3.5 3.5l17 17"/>
    </symbol>
    <symbol id="i-alerta" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.8"/>
      <path d="M12 7.6v5.2"/>
      <path d="M12 16.3h.01"/>
    </symbol>
    <symbol id="i-relogio" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.8"/>
      <path d="M12 7.4V12l3.1 2"/>
    </symbol>
    <symbol id="i-seta" viewBox="0 0 24 24">
      <path d="M5 12h13.5"/>
      <path d="M13 6.5 18.5 12 13 17.5"/>
    </symbol>
  </defs>
</svg>

<div class="tela">

  <section class="marca">
    <svg class="marca-casa" viewBox="0 0 200 200" aria-hidden="true">
      <path d="M14 104 100 26l86 78"/>
      <path d="M44 84v112M156 84v112"/>
      <path d="M86 196v-54h28v54"/>
      <path d="M140 52V22"/>
    </svg>

    <img class="logo" src="logo-branca.png" alt="Alvorada" width="134" height="128">

    <div class="marca-texto">
      <h1>
        Materiais de construção
        <em>com inteligência de dados.</em>
      </h1>
    </div>
  </section>

  <section class="area-form">
    <div class="form-caixa">

      <h2>Bem-vindo de volta</h2>
      <p class="sub">
        <?= $google ? 'Entre com sua conta Google autorizada.' : 'Entre com suas credenciais para acessar o painel.' ?>
      </p>

      <?php if ($erro !== ''): ?>
        <div class="aviso aviso-erro" role="alert">
          <svg class="icone" aria-hidden="true"><use href="#i-alerta"/></svg>
          <span><?= htmlspecialchars($erro, ENT_QUOTES) ?></span>
        </div>
      <?php endif; ?>

      <?php if ($info !== ''): ?>
        <div class="aviso aviso-info" role="status">
          <svg class="icone" aria-hidden="true"><use href="#i-relogio"/></svg>
          <span><?= htmlspecialchars($info, ENT_QUOTES) ?></span>
        </div>
      <?php endif; ?>

      <?php if ($google): ?>

<div id="area-google" class="area-google" data-csrf="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
          <div id="g_id_onload"
               data-client_id="<?= htmlspecialchars(GOOGLE_CLIENT_ID, ENT_QUOTES) ?>"
               data-callback="aoReceberLogin"
               data-nonce="<?= htmlspecialchars($_SESSION['google_nonce'], ENT_QUOTES) ?>"
               data-auto_prompt="false"
               data-itp_support="true"></div>
          <!-- Botao renderizado pelo proprio Google: usa a identidade visual
               oficial deles, que e o que as pessoas reconhecem como legitimo. -->
          <div class="g_id_signin"
               data-type="standard"
               data-theme="outline"
               data-size="large"
               data-text="signin_with"
               data-shape="rectangular"
               data-logo_alignment="left"
               data-locale="pt-BR"
               data-width="340"></div>
          <noscript>
            <p class="nota-acesso">Este login precisa de JavaScript ativado no navegador.</p>
          </noscript>
        </div>

        <p id="aviso-dinamico" class="aviso aviso-erro" role="alert" hidden></p>

        <p class="nota-acesso">
          Só entram contas liberadas por um administrador. No primeiro acesso,
          seu pedido fica aguardando aprovação.
        </p>

      <?php else: ?>

        <form method="post" autocomplete="on">
          <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">

          <div class="campo">
            <label for="login">Usuário</label>
            <div class="entrada">
              <input type="text" id="login" name="login" placeholder="seu usuário"
                     autocomplete="username" required autofocus>
              <svg class="icone ico" aria-hidden="true"><use href="#i-usuario"/></svg>
            </div>
          </div>

          <div class="campo">
            <label for="senha">Senha</label>
            <div class="entrada">
              <input type="password" id="senha" name="senha" placeholder="sua senha"
                     autocomplete="current-password" required>
              <svg class="icone ico" aria-hidden="true"><use href="#i-cadeado"/></svg>
              <button type="button" class="ver-senha" id="ver-senha" aria-label="Mostrar senha">
                <svg class="icone" aria-hidden="true"><use id="ver-senha-ico" href="#i-olho"/></svg>
              </button>
            </div>
          </div>

          <button type="submit" class="btn-entrar">
            <span>Entrar no painel</span>
            <svg class="icone" aria-hidden="true"><use href="#i-seta"/></svg>
          </button>
        </form>

      <?php endif; ?>

      <p class="rodape-form">
        Acesso restrito à equipe. Após 8 tentativas incorretas, novas tentativas
        ficam bloqueadas por 15 minutos.
      </p>
    </div>
  </section>

</div>

<script src="https://accounts.google.com/gsi/client" async defer></script>
<script src="login-google.js"></script>
<script src="login.js"></script>
</body>
</html>
