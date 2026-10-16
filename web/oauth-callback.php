<?php
/**
 * Ponte de autorizacao do Bling.
 *
 * O Bling exige um redirect HTTPS publico, e o servidor da empresa fica atras de
 * um roteador doméstico, sem porta aberta. Esta pagina resolve o impasse: ela
 * recebe o `code` do Bling aqui na hospedagem e o deixa disponivel por alguns
 * segundos para o worker, que esta rodando no servidor e consulta esta URL.
 *
 * POR QUE O client_secret NAO ESTA AQUI: a troca do code pelo token exige o
 * segredo do aplicativo. Ele fica somente no servidor da empresa. Esta pagina
 * nunca o ve, entao um vazamento da hospedagem compartilhada nao da acesso ao
 * ERP. O `code` sozinho e inutil sem o segredo, e ainda expira em 1 minuto.
 *
 * O arquivo de troca tem nome derivado de uma chave secreta compartilhada com o
 * worker, para nao ficar adivinhavel, e e apagado assim que lido.
 */

declare(strict_types=1);

// A chave vem de config.php, que NAO vai para o Git.
require_once __DIR__ . '/config.php';

/** Tempo que o code permanece disponivel. O Bling expira em 60s de qualquer forma. */
const VALIDADE_SEGUNDOS = 120;

function arquivoPonte(): string
{
    return __DIR__ . '/.ponte-' . substr(hash('sha256', PONTE_CHAVE), 0, 32) . '.json';
}

header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

$code  = isset($_GET['code'])  ? (string) $_GET['code']  : '';
$state = isset($_GET['state']) ? (string) $_GET['state'] : '';
$erro  = isset($_GET['error']) ? (string) $_GET['error'] : '';

// ---------------------------------------------------------------
// Modo "entrega": o worker chama com ?buscar=<chave> para pegar o code.
// ---------------------------------------------------------------
if (isset($_GET['buscar'])) {
    header('Content-Type: application/json; charset=utf-8');

    // hash_equals compara em tempo constante, para nao vazar a chave pelo tempo
    // de resposta.
    if (!hash_equals(PONTE_CHAVE, (string) $_GET['buscar'])) {
        http_response_code(403);
        echo json_encode(['erro' => 'chave invalida']);
        exit;
    }

    $arquivo = arquivoPonte();
    if (!is_file($arquivo)) {
        echo json_encode(['pendente' => true]);
        exit;
    }

    $conteudo = json_decode((string) file_get_contents($arquivo), true);
    @unlink($arquivo); // entrega uma unica vez

    if (!is_array($conteudo) || (time() - (int) ($conteudo['em'] ?? 0)) > VALIDADE_SEGUNDOS) {
        echo json_encode(['pendente' => true, 'motivo' => 'expirado']);
        exit;
    }

    echo json_encode($conteudo);
    exit;
}

// ---------------------------------------------------------------
// Modo normal: o Bling redirecionou o navegador para ca.
// ---------------------------------------------------------------
if ($erro !== '') {
    $mensagem = 'O Bling recusou a autorizacao: ' . htmlspecialchars($erro, ENT_QUOTES);
    $ok = false;
} elseif ($code === '') {
    $mensagem = 'Nenhum codigo recebido. Inicie a autorizacao pelo worker.';
    $ok = false;
} else {
    $gravou = file_put_contents(arquivoPonte(), json_encode([
        'code'  => $code,
        'state' => $state,
        'em'    => time(),
    ]), LOCK_EX);

    if ($gravou === false) {
        $mensagem = 'Nao foi possivel gravar o codigo. Verifique a permissao de escrita da pasta.';
        $ok = false;
    } else {
        $mensagem = 'Autorizacao recebida. O servidor vai concluir em instantes.';
        $ok = true;
    }
}
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorização do Bling</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; background: #f4f4f1; color: #0b0b0b;
         display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 20px; }
  .cartao { background: #fff; border: 1px solid #dedcd5; border-radius: 12px;
            padding: 32px; max-width: 480px; text-align: center; }
  h1 { font-size: 1.2rem; margin: 0 0 12px; }
  p { color: #52514e; margin: 0 0 8px; }
  .ok { color: #008300; } .falha { color: #e34948; }
  .icone { font-size: 2.4rem; margin-bottom: 8px; }
  @media (prefers-color-scheme: dark) {
    body { background: #121211; color: #f0efec; }
    .cartao { background: #1a1a19; border-color: #343432; }
    p { color: #c3c2b7; }
  }
</style>
</head>
<body>
  <div class="cartao">
    <div class="icone"><?= $ok ? '✓' : '✕' ?></div>
    <h1 class="<?= $ok ? 'ok' : 'falha' ?>">
      <?= $ok ? 'Bling autorizado' : 'Falha na autorização' ?>
    </h1>
    <p><?= htmlspecialchars($mensagem, ENT_QUOTES) ?></p>
    <?php if ($ok): ?>
      <p>Pode fechar esta janela e voltar ao terminal do servidor.</p>
    <?php endif; ?>
  </div>
</body>
</html>
