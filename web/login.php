<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';

iniciarSessao();

// Já logado? Vai direto ao painel.
if (usuarioLogado() !== null) {
    header('Location: index.php');
    exit;
}

$erro = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (tentativasExcedidas()) {
        $erro = 'Muitas tentativas seguidas. Aguarde 15 minutos antes de tentar de novo.';
    } elseif (!hash_equals((string) ($_SESSION['csrf'] ?? ''), (string) ($_POST['csrf'] ?? ''))) {
        // Impede que um site de terceiros submeta este formulário.
        $erro = 'Sessão expirada. Recarregue a página e tente novamente.';
    } else {
        $login = (string) ($_POST['login'] ?? '');
        $senha = (string) ($_POST['senha'] ?? '');

        if (autenticar($login, $senha)) {
            limparFalhas();
            header('Location: index.php');
            exit;
        }

        registrarFalha();
        // Mensagem genérica de propósito: dizer "usuário não existe" entregaria
        // quais logins são válidos para quem estiver tentando adivinhar.
        $erro = 'Usuário ou senha incorretos.';
    }
}

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}
$csrf = (string) $_SESSION['csrf'];

header('X-Robots-Tag: noindex, nofollow');
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · Grupo Alvorada</title>
<meta name="theme-color" content="#CF0C0C">
<link rel="icon" href="logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="login.css">
</head>
<body>

<!-- Ícones desenhados uma vez e reutilizados com <use>. Traço de 1.75 e cantos
     arredondados, no mesmo desenho em todos, para parecerem da mesma família. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
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
    <symbol id="i-seta" viewBox="0 0 24 24">
      <path d="M5 12h13.5"/>
      <path d="M13 6.5 18.5 12 13 17.5"/>
    </symbol>
  </defs>
</svg>

<div class="tela">

  <!-- ===================== MARCA ===================== -->
  <section class="marca">
    <!-- A casa da logo, ampliada e cortada pela borda, em vermelho sobre
         vermelho. Vem da própria marca, então não parece fundo genérico. -->
    <svg class="marca-casa" viewBox="0 0 200 200" aria-hidden="true">
      <path d="M14 104 100 26l86 78"/>
      <path d="M44 84v112M156 84v112"/>
      <path d="M86 196v-54h28v54"/>
      <path d="M140 52V22"/>
    </svg>

    <div class="logo-caixa">
      <img src="logo.png" alt="Grupo Alvorada">
    </div>

    <div class="marca-texto">
      <h1>
        Materiais de construção
        <em>com inteligência de dados.</em>
      </h1>
    </div>

    <div class="marca-rodape">Dados sincronizados do ERP Bling</div>
  </section>

  <!-- ===================== FORMULÁRIO ===================== -->
  <section class="area-form">
    <form class="form-caixa" method="post" autocomplete="on">

      <h2>Bem-vindo de volta</h2>
      <p class="sub">Entre com suas credenciais para acessar o painel.</p>

      <?php if ($erro !== ''): ?>
        <div class="erro" role="alert">
          <svg class="icone erro-ico" aria-hidden="true"><use href="#i-alerta"/></svg>
          <span><?= htmlspecialchars($erro, ENT_QUOTES) ?></span>
        </div>
      <?php endif; ?>

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

      <p class="rodape-form">
        Acesso restrito à equipe. Após 8 tentativas incorretas, novas tentativas
        ficam bloqueadas por 15 minutos.
      </p>
    </form>
  </section>

</div>

<script>
  // Revelar a senha reduz erro de digitação — e aqui errar 8 vezes bloqueia
  // o acesso por 15 minutos.
  (function () {
    var botao = document.getElementById('ver-senha');
    var icone = document.getElementById('ver-senha-ico');
    var campo = document.getElementById('senha');
    botao.addEventListener('click', function () {
      var oculta = campo.type === 'password';
      campo.type = oculta ? 'text' : 'password';
      icone.setAttribute('href', oculta ? '#i-olho-fechado' : '#i-olho');
      botao.setAttribute('aria-label', oculta ? 'Ocultar senha' : 'Mostrar senha');
      campo.focus();
    });
  })();
</script>

</body>
</html>
