<?php
/**
 * Cria o primeiro administrador. Roda uma única vez.
 *
 * Problema de origem: só um administrador cria contas, mas no começo não existe
 * administrador nenhum. Este arquivo resolve isso, e por isso tem três travas:
 *
 *   1. só funciona se o cadastro estiver VAZIO — depois da primeira conta,
 *      recusa sempre, mesmo que o arquivo continue no servidor;
 *   2. exige a senha definida em config.php, que só quem tem acesso ao
 *      servidor consegue escrever;
 *   3. pede confirmação por POST com token, para não ser disparado por um link.
 *
 * Apague este arquivo depois de usar. As travas o tornam inofensivo, mas não há
 * motivo para deixar ferramenta extra exposta.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

header('X-Robots-Tag: noindex, nofollow');

$usuarios = carregarUsuarios();
$jaInstalado = $usuarios !== [];
$erro = '';
$pronto = false;

if (!$jaInstalado && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'A página expirou. Recarregue e tente de novo.';
    } elseif (!defined('SENHA_PRIMEIRO_ADMIN') || SENHA_PRIMEIRO_ADMIN === '') {
        $erro = 'Defina SENHA_PRIMEIRO_ADMIN no config.php antes de continuar.';
    } elseif (($problema = problemaNaSenha(SENHA_PRIMEIRO_ADMIN, EMAIL_PRIMEIRO_ADMIN, NOME_PRIMEIRO_ADMIN)) !== '') {
        $erro = 'A senha em config.php não atende às regras: ' . $problema;
    } elseif (!filter_var(EMAIL_PRIMEIRO_ADMIN, FILTER_VALIDATE_EMAIL)) {
        $erro = 'EMAIL_PRIMEIRO_ADMIN não é um e-mail válido.';
    } else {
        gravarUsuario(EMAIL_PRIMEIRO_ADMIN, [
            'email'           => strtolower(trim(EMAIL_PRIMEIRO_ADMIN)),
            'nome'            => NOME_PRIMEIRO_ADMIN,
            'papel'           => 'admin',
            'status'          => 'ativo',
            'senhaHash'       => gerarHashSenha(SENHA_PRIMEIRO_ADMIN),
            'senhaProvisoria' => false,
            'senhaAlteradaEm' => time(),
            'criadoEm'        => time(),
            'criadoPor'       => 'instalacao',
        ]);
        $pronto = true;
    }
}

$csrf = tokenCsrf();
$h = static fn ($v): string => htmlspecialchars((string) $v, ENT_QUOTES);
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instalação · Grupo Alvorada</title>
<link rel="stylesheet" href="login.css">
<style>
  .painel-inst { max-width: 560px; margin: 8vh auto; padding: 0 20px; }
  .painel-inst h1 { font-size: 1.4rem; margin: 0 0 8px; }
  .painel-inst p { color: var(--txt-2); line-height: 1.6; }
  .painel-inst code { background: var(--cinza-campo); padding: 2px 6px; border-radius: 5px; }
</style>
</head>
<body>
<div class="painel-inst">

  <?php if ($jaInstalado): ?>
    <h1>Instalação já concluída</h1>
    <p>
      Já existe pelo menos uma conta no sistema, então este instalador está
      desativado. Para criar novos acessos, entre como administrador e use a
      tela <strong>Usuários</strong>.
    </p>
    <p><strong>Apague o arquivo <code>instalar.php</code> do servidor.</strong></p>
    <p><a class="btn btn-primario" href="login.php">Ir para a entrada</a></p>

  <?php elseif ($pronto): ?>
    <h1>Administrador criado</h1>
    <p>
      A conta <strong><?= $h(EMAIL_PRIMEIRO_ADMIN) ?></strong> foi criada com a senha
      definida no <code>config.php</code>.
    </p>
    <p>
      Agora: <strong>apague o <code>instalar.php</code> do servidor</strong> e
      limpe o valor de <code>SENHA_PRIMEIRO_ADMIN</code> no <code>config.php</code> —
      a senha já está guardada embaralhada no cadastro e não precisa mais ficar
      em texto por lá.
    </p>
    <p><a class="btn btn-primario" href="login.php">Entrar</a></p>

  <?php else: ?>
    <h1>Criar o primeiro administrador</h1>
    <p>
      Esta tela só funciona enquanto não houver nenhuma conta. Ela vai criar o
      administrador com os dados do <code>config.php</code>:
    </p>
    <p>
      <strong><?= $h(defined('NOME_PRIMEIRO_ADMIN') ? NOME_PRIMEIRO_ADMIN : '—') ?></strong><br>
      <?= $h(defined('EMAIL_PRIMEIRO_ADMIN') ? EMAIL_PRIMEIRO_ADMIN : '—') ?>
    </p>

    <?php if ($erro !== ''): ?>
      <div class="aviso aviso-erro" role="alert"><span><?= $h($erro) ?></span></div>
    <?php endif; ?>

    <form method="post">
      <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
      <button class="btn-entrar" type="submit"><span>Criar administrador</span></button>
    </form>
  <?php endif; ?>

</div>
</body>
</html>
