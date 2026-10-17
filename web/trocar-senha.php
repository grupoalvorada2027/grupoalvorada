<?php
/**
 * Troca de senha.
 *
 * Obrigatória no primeiro acesso: a senha provisória foi entregue pelo
 * administrador — por mensagem, papel ou voz — e não deve continuar valendo.
 * Enquanto não for trocada, exigirLogin() redireciona para cá.
 *
 * Trocar a senha encerra a sessão e pede login de novo. É assim de propósito:
 * se a senha foi trocada por suspeita de vazamento, continuar com a sessão
 * aberta esvaziaria o sentido da troca.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

$usuario = exigirLogin();
header('X-Robots-Tag: noindex, nofollow');

$erro = '';
$obrigatoria = $usuario['provisoria'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'A página expirou. Recarregue e tente de novo.';
    } else {
        $atual = (string) ($_POST['atual'] ?? '');
        $nova  = (string) ($_POST['nova'] ?? '');
        $conf  = (string) ($_POST['confirmacao'] ?? '');

        $r = verificarSenha($usuario['login'], $atual);
        $u = buscarUsuario($usuario['login']);

        if (!($r['ok'] ?? false) || $u === null) {
            registrarFalha($usuario['login']);
            $erro = 'A senha atual está incorreta.';
            usleep(400000);
        } elseif (!hash_equals($nova, $conf)) {
            $erro = 'A confirmação não é igual à nova senha.';
        } elseif (hash_equals($atual, $nova)) {
            $erro = 'A nova senha precisa ser diferente da atual.';
        } elseif (($problema = problemaNaSenha($nova, $usuario['email'], $usuario['nome'])) !== '') {
            $erro = $problema;
        } else {
            $u['senhaHash'] = gerarHashSenha($nova);
            $u['senhaProvisoria'] = false;
            $u['senhaAlteradaEm'] = time();
            unset($u['provisoriaAte']);
            gravarUsuario($usuario['login'], $u);

            encerrarSessao();
            header('Location: login.php?aviso=sessao');
            exit;
        }
    }
}

$csrf = tokenCsrf();
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Trocar senha · Grupo Alvorada</title>
<meta name="theme-color" content="#CF0C0C">
<link rel="icon" href="logo.png">
<link rel="stylesheet" href="login.css">
</head>
<body>

<svg width="0" height="0" class="sprite" aria-hidden="true">
  <defs>
    <symbol id="i-cadeado" viewBox="0 0 24 24">
      <rect x="4.75" y="10.5" width="14.5" height="10" rx="2.6"/>
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/><path d="M12 14.6v2"/>
    </symbol>
    <symbol id="i-olho" viewBox="0 0 24 24">
      <path d="M2.6 12.3C4.5 8.4 8 6.2 12 6.2s7.5 2.2 9.4 6.1c-1.9 3.9-5.4 6.1-9.4 6.1s-7.5-2.2-9.4-6.1Z"/>
      <circle cx="12" cy="12.3" r="2.9"/>
    </symbol>
    <symbol id="i-olho-fechado" viewBox="0 0 24 24">
      <path d="M9.9 6.5A9.6 9.6 0 0 1 12 6.2c4 0 7.5 2.2 9.4 6.1a11 11 0 0 1-2.3 3.2"/>
      <path d="M6.3 8.2a11 11 0 0 0-3.7 4.1c1.9 3.9 5.4 6.1 9.4 6.1a9.7 9.7 0 0 0 4.6-1.1"/>
      <path d="M10 10.2a2.9 2.9 0 0 0 4 4.1"/><path d="M3.5 3.5l17 17"/>
    </symbol>
    <symbol id="i-alerta" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.8"/><path d="M12 7.6v5.2"/><path d="M12 16.3h.01"/>
    </symbol>
    <symbol id="i-seta" viewBox="0 0 24 24">
      <path d="M5 12h13.5"/><path d="M13 6.5 18.5 12 13 17.5"/>
    </symbol>
  </defs>
</svg>

<div class="tela">

  <section class="marca">
    <svg class="marca-casa" viewBox="0 0 200 200" aria-hidden="true">
      <path d="M14 104 100 26l86 78"/><path d="M44 84v112M156 84v112"/>
      <path d="M86 196v-54h28v54"/><path d="M140 52V22"/>
    </svg>
    <img class="logo" src="logo-branca.png" alt="Alvorada" width="134" height="128">
    <div class="marca-texto">
      <h1>Materiais de construção <em>com inteligência de dados.</em></h1>
    </div>
  </section>

  <section class="area-form">
    <div class="form-caixa">

      <h2><?= $obrigatoria ? 'Defina sua senha' : 'Trocar senha' ?></h2>
      <p class="sub">
        <?= $obrigatoria
            ? 'Este é seu primeiro acesso. Escolha uma senha pessoal para substituir a provisória.'
            : 'Escolha uma nova senha para sua conta.' ?>
      </p>

      <?php if ($erro !== ''): ?>
        <div class="aviso aviso-erro" role="alert">
          <svg class="icone" aria-hidden="true"><use href="#i-alerta"/></svg>
          <span><?= htmlspecialchars($erro, ENT_QUOTES) ?></span>
        </div>
      <?php endif; ?>

      <form method="post" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">

        <div class="campo">
          <label for="atual"><?= $obrigatoria ? 'Senha provisória' : 'Senha atual' ?></label>
          <div class="entrada">
            <input type="password" id="atual" name="atual" required autofocus
                   autocomplete="current-password">
            <svg class="icone ico" aria-hidden="true"><use href="#i-cadeado"/></svg>
          </div>
        </div>

        <div class="campo">
          <label for="nova">Nova senha</label>
          <div class="entrada">
            <input type="password" id="nova" name="nova" required
                   autocomplete="new-password" minlength="<?= SENHA_MINIMA ?>">
            <svg class="icone ico" aria-hidden="true"><use href="#i-cadeado"/></svg>
            <button type="button" class="ver-senha" id="ver-senha" aria-label="Mostrar senha">
              <svg class="icone" aria-hidden="true"><use id="ver-senha-ico" href="#i-olho"/></svg>
            </button>
          </div>
          <div class="forca" id="forca" hidden>
            <div class="forca-barra"><span id="forca-nivel"></span></div>
            <span id="forca-texto"></span>
          </div>
        </div>

        <div class="campo">
          <label for="confirmacao">Repita a nova senha</label>
          <div class="entrada">
            <input type="password" id="confirmacao" name="confirmacao" required
                   autocomplete="new-password" minlength="<?= SENHA_MINIMA ?>">
            <svg class="icone ico" aria-hidden="true"><use href="#i-cadeado"/></svg>
          </div>
        </div>

        <button type="submit" class="btn-entrar">
          <span>Salvar nova senha</span>
          <svg class="icone" aria-hidden="true"><use href="#i-seta"/></svg>
        </button>
      </form>

      <p class="rodape-form">
        Mínimo de <?= SENHA_MINIMA ?> caracteres, combinando pelo menos três entre
        minúsculas, maiúsculas, números e símbolos. Evite seu nome, seu e-mail e
        sequências comuns. Depois de salvar, você entra de novo com a senha nova.
      </p>

    </div>
  </section>

</div>

<script src="senha.js"></script>
<script src="login.js"></script>
</body>
</html>
