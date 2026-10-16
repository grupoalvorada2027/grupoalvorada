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

<div class="tela">

  <!-- ===================== MARCA ===================== -->
  <section class="marca">
    <div class="logo-caixa">
      <img src="logo.png" alt="Grupo Alvorada">
    </div>

    <div class="marca-texto">
      <h1>
        Materiais de construção
        <em>com inteligência de dados.</em>
      </h1>
      <p>
        Painel de lucratividade conectado ao Bling. Acompanhe margem real por
        canal, identifique produtos no prejuízo e decida onde vale a pena
        investir.
      </p>

      <div class="pontos">
        <div class="ponto">
          <span class="ponto-ico" aria-hidden="true">◧</span>
          <span>Margem de contribuição real, após custo, comissão, frete e imposto</span>
        </div>
        <div class="ponto">
          <span class="ponto-ico" aria-hidden="true">◆</span>
          <span>Comparação entre Mercado Livre, Shopee e TikTok Shop</span>
        </div>
        <div class="ponto">
          <span class="ponto-ico" aria-hidden="true">▲</span>
          <span>Alerta de produtos vendendo abaixo do custo</span>
        </div>
      </div>
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
          <span class="erro-ico" aria-hidden="true">!</span>
          <span><?= htmlspecialchars($erro, ENT_QUOTES) ?></span>
        </div>
      <?php endif; ?>

      <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">

      <div class="campo">
        <label for="login">Usuário</label>
        <div class="entrada">
          <input type="text" id="login" name="login" placeholder="seu usuário"
                 autocomplete="username" required autofocus>
          <span class="ico" aria-hidden="true">◍</span>
        </div>
      </div>

      <div class="campo">
        <label for="senha">Senha</label>
        <div class="entrada">
          <input type="password" id="senha" name="senha" placeholder="sua senha"
                 autocomplete="current-password" required>
          <span class="ico" aria-hidden="true">◈</span>
          <button type="button" class="ver-senha" id="ver-senha"
                  aria-label="Mostrar senha">mostrar</button>
        </div>
      </div>

      <button type="submit" class="btn-entrar">Entrar no painel</button>

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
    var campo = document.getElementById('senha');
    botao.addEventListener('click', function () {
      var oculta = campo.type === 'password';
      campo.type = oculta ? 'text' : 'password';
      botao.textContent = oculta ? 'ocultar' : 'mostrar';
      botao.setAttribute('aria-label', oculta ? 'Ocultar senha' : 'Mostrar senha');
      campo.focus();
    });
  })();
</script>

</body>
</html>
