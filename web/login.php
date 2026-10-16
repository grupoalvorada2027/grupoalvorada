<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';

iniciarSessao();

// Ja logado? Vai direto ao painel.
if (usuarioLogado() !== null) {
    header('Location: index.php');
    exit;
}

$erro = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (tentativasExcedidas()) {
        $erro = 'Muitas tentativas. Aguarde 15 minutos antes de tentar de novo.';
    } elseif (!hash_equals((string) ($_SESSION['csrf'] ?? ''), (string) ($_POST['csrf'] ?? ''))) {
        // Protege contra um site de terceiros submeter este formulario.
        $erro = 'Sessao expirada. Recarregue a pagina e tente novamente.';
    } else {
        $login = (string) ($_POST['login'] ?? '');
        $senha = (string) ($_POST['senha'] ?? '');

        if (autenticar($login, $senha)) {
            limparFalhas();
            header('Location: index.php');
            exit;
        }

        registrarFalha();
        // Mensagem generica de proposito: dizer "usuario nao existe" entregaria
        // quais logins sao validos.
        $erro = 'Usuario ou senha incorretos.';
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
<title>Entrar — Lucratividade</title>
<link rel="stylesheet" href="estilo.css">
<style>
  body { display: grid; place-items: center; min-height: 100vh; padding: 20px; }
  .cartao-login {
    background: var(--surface-1); border: 1px solid var(--borda);
    border-radius: var(--raio); padding: 32px; width: 100%; max-width: 380px;
  }
  .cartao-login h1 { font-size: 1.15rem; margin: 0 0 4px; }
  .cartao-login .sub { color: var(--text-secondary); font-size: 0.86rem; margin: 0 0 24px; }
  .campo-login { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
  .campo-login span { font-size: 0.82rem; color: var(--text-secondary); }
  .campo-login input {
    background: var(--surface-2); color: var(--text-primary);
    border: 1px solid var(--borda); border-radius: 8px;
    padding: 11px 12px; font-size: 0.95rem; font-family: inherit; width: 100%;
  }
  .campo-login input:focus {
    outline: 2px solid var(--series-1); outline-offset: 1px; border-color: transparent;
  }
  .botao-entrar {
    width: 100%; padding: 12px; border: none; border-radius: 8px;
    background: var(--series-1); color: #fff; font-size: 0.95rem;
    font-weight: 600; cursor: pointer; font-family: inherit;
  }
  .botao-entrar:hover { filter: brightness(1.08); }
  .erro-login {
    background: color-mix(in srgb, var(--critico) 12%, transparent);
    border: 1px solid var(--critico); color: var(--critico);
    border-radius: 8px; padding: 10px 12px; font-size: 0.86rem; margin-bottom: 18px;
  }
</style>
</head>
<body>
  <form class="cartao-login" method="post" autocomplete="on">
    <h1>Lucratividade por canal</h1>
    <p class="sub">Entre para ver os dados.</p>

    <?php if ($erro !== ''): ?>
      <div class="erro-login" role="alert"><?= htmlspecialchars($erro, ENT_QUOTES) ?></div>
    <?php endif; ?>

    <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">

    <label class="campo-login">
      <span>Usuário</span>
      <input type="text" name="login" autocomplete="username" required autofocus>
    </label>

    <label class="campo-login">
      <span>Senha</span>
      <input type="password" name="senha" autocomplete="current-password" required>
    </label>

    <button type="submit" class="botao-entrar">Entrar</button>
  </form>
</body>
</html>
