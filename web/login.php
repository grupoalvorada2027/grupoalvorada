<?php
/**
 * Entrada do painel.
 *
 * Duas etapas: e-mail e senha; se a conta tiver segundo fator, o código do
 * aplicativo. Entre uma e outra, a sessão guarda apenas um "pré-login" com
 * prazo curto — a sessão autenticada só nasce quando as duas etapas passam.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

iniciarSessao();

if (usuarioLogado() !== null) {
    header('Location: index.php');
    exit;
}

/** Tempo para digitar o código do segundo fator. */
const PRELOGIN_SEGUNDOS = 300;

$erro = '';
$info = '';
$etapa = 'senha';

// Pré-login em andamento?
$pre = $_SESSION['prelogin'] ?? null;
if (is_array($pre) && (time() - (int) $pre['em']) <= PRELOGIN_SEGUNDOS) {
    $etapa = 'codigo';
} else {
    unset($_SESSION['prelogin']);
    $pre = null;
}

if (($_GET['aviso'] ?? '') === 'sessao') {
    $info = 'Sua sessão foi encerrada. Entre novamente.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $espera = bloqueado((string) ($_POST['email'] ?? ($pre['email'] ?? '')));

    if ($espera > 0) {
        $minutos = (int) ceil($espera / 60);
        $erro = "Muitas tentativas. Tente de novo em $minutos "
              . ($minutos === 1 ? 'minuto' : 'minutos') . '.';
    } elseif (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'A página expirou. Recarregue e tente de novo.';
    } elseif (($_POST['etapa'] ?? '') === 'codigo' && $pre !== null) {

        // --- Etapa 2: código do aplicativo ---
        $u = buscarUsuario((string) $pre['email']);
        if ($u === null || ($u['status'] ?? '') !== 'ativo') {
            unset($_SESSION['prelogin']);
            $erro = 'Não foi possível concluir o login.';
            $etapa = 'senha';
        } elseif (verificarSegundoFator($u, (string) ($_POST['codigo'] ?? ''), (string) $pre['email'])) {
            unset($_SESSION['prelogin']);
            limparFalhas((string) $pre['email']);
            abrirSessao((string) $pre['email'], buscarUsuario((string) $pre['email']) ?? $u);
            header('Location: index.php');
            exit;
        } else {
            registrarFalha((string) $pre['email']);
            $erro = 'Código incorreto. Confira o aplicativo e tente de novo.';
            // Espera crescente também aqui, para não virar a porta mais fraca.
            usleep(400000);
        }

    } else {

        // --- Etapa 1: e-mail e senha ---
        $email = (string) ($_POST['email'] ?? '');
        $senha = (string) ($_POST['senha'] ?? '');
        $r = verificarSenha($email, $senha);

        if ($r['ok'] ?? false) {
            if ($r['exigeTotp'] ?? false) {
                $_SESSION['prelogin'] = ['email' => normalizarEmail($email), 'em' => time()];
                $etapa = 'codigo';
                $info = 'Digite o código do seu aplicativo autenticador.';
            } else {
                limparFalhas($email);
                abrirSessao($email, $r['usuario']);
                header('Location: index.php');
                exit;
            }
        } elseif (($r['motivo'] ?? '') === 'provisoria_vencida') {
            $erro = 'Sua senha provisória expirou. Peça a um administrador para gerar outra.';
        } else {
            registrarFalha($email);
            // Mensagem única para senha errada, conta inexistente e conta
            // bloqueada: qualquer diferença entregaria quais e-mails existem.
            $erro = 'E-mail ou senha incorretos.';
            usleep(random_int(250000, 600000));
        }
    }
}

$csrf = tokenCsrf();
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
    <symbol id="i-email" viewBox="0 0 24 24">
      <rect x="3.2" y="5.3" width="17.6" height="13.4" rx="2.4"/>
      <path d="m3.6 7 8.4 6 8.4-6"/>
    </symbol>
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
    <symbol id="i-relogio" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.8"/><path d="M12 7.4V12l3.1 2"/>
    </symbol>
    <symbol id="i-celular" viewBox="0 0 24 24">
      <rect x="7" y="2.8" width="10" height="18.4" rx="2.4"/><path d="M11 18.4h2"/>
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

      <?php if ($etapa === 'codigo'): ?>
        <h2>Verificação em duas etapas</h2>
        <p class="sub">Digite o código de 6 dígitos do seu aplicativo autenticador.</p>
      <?php else: ?>
        <h2>Bem-vindo de volta</h2>
        <p class="sub">Entre com sua conta para acessar o painel.</p>
      <?php endif; ?>

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

      <?php if ($etapa === 'codigo'): ?>

        <form method="post" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
          <input type="hidden" name="etapa" value="codigo">

          <div class="campo">
            <label for="codigo">Código de verificação</label>
            <div class="entrada">
              <input type="text" id="codigo" name="codigo" required autofocus
                     inputmode="numeric" pattern="[0-9A-Za-z]*" maxlength="8"
                     autocomplete="one-time-code" placeholder="000000" class="campo-codigo">
              <svg class="icone ico" aria-hidden="true"><use href="#i-celular"/></svg>
            </div>
          </div>

          <button type="submit" class="btn-entrar">
            <span>Confirmar</span>
            <svg class="icone" aria-hidden="true"><use href="#i-seta"/></svg>
          </button>
        </form>

        <p class="rodape-form">
          Perdeu o acesso ao aplicativo? Use um dos códigos de recuperação que
          você guardou, ou peça a um administrador para refazer a configuração.
        </p>

      <?php else: ?>

        <form method="post" autocomplete="on">
          <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">

          <div class="campo">
            <label for="email">E-mail</label>
            <div class="entrada">
              <input type="email" id="email" name="email" placeholder="nome@empresa.com"
                     autocomplete="username" required autofocus
                     value="<?= htmlspecialchars((string) ($_POST['email'] ?? ''), ENT_QUOTES) ?>">
              <svg class="icone ico" aria-hidden="true"><use href="#i-email"/></svg>
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

        <p class="rodape-form">
          O acesso é criado por um administrador — não há cadastro aberto.
          Após <?= MAX_FALHAS ?> tentativas incorretas, novas tentativas ficam
          bloqueadas temporariamente.
        </p>

      <?php endif; ?>

    </div>
  </section>

</div>

<script src="login.js"></script>
</body>
</html>
