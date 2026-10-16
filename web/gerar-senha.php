<?php
/**
 * Gera o hash de uma senha para colar em auth.php.
 *
 * Esta pagina nunca grava nada e nao altera usuarios: ela so transforma a senha
 * digitada no hash correspondente. A senha nao e salva, nem registrada em log,
 * nem enviada para lugar nenhum - o calculo acontece no proprio servidor e o
 * resultado volta na tela.
 *
 * E por isso que voce nunca precisa dizer sua senha para ninguem: cole aqui,
 * copie o hash, e coloque o HASH no auth.php.
 *
 * APAGUE ESTE ARQUIVO depois de criar os usuarios. Ele nao e perigoso por si
 * so, mas nao ha motivo para deixar ferramenta extra exposta.
 */

declare(strict_types=1);

header('X-Robots-Tag: noindex, nofollow');

$hash = '';
$erro = '';
$senhaLen = 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $senha = (string) ($_POST['senha'] ?? '');
    $senhaLen = strlen($senha);

    if ($senhaLen < 10) {
        $erro = 'Use pelo menos 10 caracteres. Esta senha protege custos e margens da operacao.';
    } else {
        $hash = password_hash($senha, PASSWORD_DEFAULT);
    }
}
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gerar hash de senha</title>
<link rel="stylesheet" href="estilo.css">
<style>
  body { display: grid; place-items: start center; min-height: 100vh; padding: 40px 20px; }
  .caixa { background: var(--surface-1); border: 1px solid var(--borda);
           border-radius: var(--raio); padding: 28px; width: 100%; max-width: 620px; }
  h1 { font-size: 1.1rem; margin: 0 0 6px; }
  p.sub { color: var(--text-secondary); font-size: 0.86rem; margin: 0 0 20px; }
  input[type=password] { width: 100%; padding: 11px 12px; font-size: 0.95rem;
    background: var(--surface-2); color: var(--text-primary);
    border: 1px solid var(--borda); border-radius: 8px; font-family: inherit; }
  button { margin-top: 14px; padding: 11px 20px; border: none; border-radius: 8px;
    background: var(--series-1); color: #fff; font-weight: 600; cursor: pointer;
    font-size: 0.92rem; font-family: inherit; }
  .saida { margin-top: 22px; padding: 14px; background: var(--surface-2);
    border: 1px solid var(--borda); border-radius: 8px; }
  .saida code { display: block; word-break: break-all; font-size: 0.84rem;
    color: var(--text-primary); margin-top: 8px; line-height: 1.5; }
  .erro { color: var(--critico); font-size: 0.86rem; margin-top: 12px; }
  .passos { font-size: 0.86rem; color: var(--text-secondary); margin-top: 18px; line-height: 1.7; }
  .passos code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="caixa">
  <h1>Gerar hash de senha</h1>
  <p class="sub">A senha digitada não é salva em lugar nenhum. Só o hash aparece na tela.</p>

  <form method="post">
    <input type="password" name="senha" placeholder="Digite a senha desejada" required autofocus>
    <button type="submit">Gerar hash</button>
  </form>

  <?php if ($erro !== ''): ?>
    <p class="erro"><?= htmlspecialchars($erro, ENT_QUOTES) ?></p>
  <?php endif; ?>

  <?php if ($hash !== ''): ?>
    <div class="saida">
      <strong style="font-size:0.88rem">Hash gerado (<?= $senhaLen ?> caracteres de senha):</strong>
      <code><?= htmlspecialchars($hash, ENT_QUOTES) ?></code>
    </div>
    <div class="passos">
      <strong>O que fazer com ele:</strong><br>
      1. Abra o arquivo <code>auth.php</code><br>
      2. Em <code>USUARIOS</code>, substitua o valor de <code>'hash' =&gt;</code> por este<br>
      3. Ajuste <code>'nome'</code> e <code>'papel'</code> (<code>admin</code>, <code>gestor</code> ou <code>operador</code>)<br>
      4. Publique o arquivo de novo<br>
      5. <strong>Apague este <code>gerar-senha.php</code> do servidor</strong>
    </div>
  <?php endif; ?>
</div>
</body>
</html>
