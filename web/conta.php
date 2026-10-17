<?php
/**
 * Minha conta: trocar senha e configurar a verificação em duas etapas.
 *
 * Ativar o segundo fator exige confirmar um código do aplicativo antes de valer.
 * Sem essa confirmação, alguém poderia ativar com um segredo que não conseguiu
 * cadastrar direito e se trancar fora na próxima entrada.
 *
 * Desativar exige a senha atual: se um aparelho ficar aberto e esquecido,
 * quem o encontrar não consegue derrubar a proteção sem saber a senha.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

$usuario = exigirLogin();
header('X-Robots-Tag: noindex, nofollow');

$mensagem = '';
$erro = '';
$codigosNovos = null;

$u = buscarUsuario($usuario['login']) ?? [];
$totpAtivo = (bool) ($u['totp']['ativo'] ?? false);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'A página expirou. Recarregue e tente de novo.';
    } else {
        $acao = (string) ($_POST['acao'] ?? '');

        if ($acao === 'ativar-2fa') {
            $segredo = (string) ($_SESSION['totp_pendente'] ?? '');
            $codigo = (string) ($_POST['codigo'] ?? '');

            if ($segredo === '') {
                $erro = 'A configuração expirou. Comece de novo.';
            } elseif (!totpConfere($segredo, $codigo)) {
                $erro = 'Código incorreto. Confira o aplicativo e tente de novo.';
            } else {
                $codigosNovos = gerarCodigosRecuperacao();
                $u['totp'] = [
                    'ativo'       => true,
                    'segredo'     => $segredo,
                    'ativadoEm'   => time(),
                    'recuperacao' => hashCodigosRecuperacao($codigosNovos),
                ];
                gravarUsuario($usuario['login'], $u);
                unset($_SESSION['totp_pendente']);
                $totpAtivo = true;
                $mensagem = 'Verificação em duas etapas ativada.';
            }
        } elseif ($acao === 'desativar-2fa') {
            $r = verificarSenha($usuario['login'], (string) ($_POST['senha'] ?? ''));
            if (!($r['ok'] ?? false)) {
                registrarFalha($usuario['login']);
                $erro = 'Senha incorreta.';
                usleep(400000);
            } else {
                unset($u['totp']);
                gravarUsuario($usuario['login'], $u);
                $totpAtivo = false;
                $mensagem = 'Verificação em duas etapas desativada.';
            }
        }
    }
}

// Segredo da configuração em andamento, guardado só na sessão até ser confirmado.
if (!$totpAtivo && empty($_SESSION['totp_pendente'])) {
    $_SESSION['totp_pendente'] = gerarSegredoTotp();
}
$segredoPendente = (string) ($_SESSION['totp_pendente'] ?? '');

$csrf = tokenCsrf();
$h = static fn ($v): string => htmlspecialchars((string) $v, ENT_QUOTES);
$pagina = 'conta';
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#CF0C0C">
<link rel="icon" href="logo.png">
<title>Minha conta · Grupo Alvorada</title>
<link rel="stylesheet" href="estilo.css">
</head>
<body>

<?php require __DIR__ . '/_lateral.php'; ?>

<div class="conteudo">
  <header class="barra-topo">
    <div>
      <h1 class="titulo-pagina">Minha conta</h1>
      <p class="caminho"><?= $h($usuario['email']) ?> · <?= $h(PAPEIS[$usuario['papel']]) ?></p>
    </div>
    <div class="acoes-topo">
      <button type="button" id="alternar-tema" class="btn-icone" aria-label="Alternar tema" title="Alternar tema"><svg class="icone" aria-hidden="true"><use href="#i-sol"/></svg></button>
      <a href="sair.php" class="btn-icone" title="Sair" aria-label="Sair"><svg class="icone" aria-hidden="true"><use href="#i-sair"/></svg></a>
    </div>
  </header>

  <main>
    <?php if ($mensagem !== ''): ?>
      <div class="faixa faixa-ok" role="status"><?= $h($mensagem) ?></div>
    <?php endif; ?>
    <?php if ($erro !== ''): ?>
      <div class="faixa faixa-erro" role="alert"><?= $h($erro) ?></div>
    <?php endif; ?>

    <?php if ($codigosNovos !== null): ?>
      <section class="cartao cartao-senha">
        <h2>Códigos de recuperação</h2>
        <p class="cartao-nota">
          Guarde em lugar seguro, fora do celular. Cada um vale <strong>uma vez</strong> e
          serve para entrar se você perder o aplicativo.
          <strong>Não serão exibidos de novo.</strong>
        </p>
        <div class="codigos-recuperacao" id="codigos">
          <?php foreach ($codigosNovos as $c): ?><code><?= $h($c) ?></code><?php endforeach; ?>
        </div>
        <button type="button" class="btn btn-secundario" id="copiar-codigos" data-alvo="codigos">Copiar todos</button>
      </section>
    <?php endif; ?>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Senha</h2></div>
      <p class="cartao-nota">
        Mínimo de <?= SENHA_MINIMA ?> caracteres, combinando pelo menos três entre
        minúsculas, maiúsculas, números e símbolos.
        <?php if (!empty($u['senhaAlteradaEm'])): ?>
          Alterada em <?= date('d/m/Y', (int) $u['senhaAlteradaEm']) ?>.
        <?php endif; ?>
      </p>
      <a class="btn btn-secundario" href="trocar-senha.php">Trocar minha senha</a>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca">
        <h2>Verificação em duas etapas</h2>
        <?php if ($totpAtivo): ?><span class="selo-ok">ativa</span><?php endif; ?>
      </div>

      <?php if ($totpAtivo): ?>

        <p class="cartao-nota">
          Ao entrar, além da senha será pedido um código do seu aplicativo. É a
          proteção mais eficaz aqui: mesmo que alguém descubra sua senha, não
          entra sem o seu celular.
          <?php $restantes = count((array) ($u['totp']['recuperacao'] ?? [])); ?>
          Você tem <?= $restantes ?> código<?= $restantes === 1 ? '' : 's' ?> de recuperação
          não usado<?= $restantes === 1 ? '' : 's' ?>.
        </p>
        <form method="post" class="form-linha">
          <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
          <input type="password" name="senha" placeholder="Sua senha atual" required autocomplete="current-password">
          <button class="btn btn-perigo" name="acao" value="desativar-2fa"
                  data-confirmar="Desativar a verificação em duas etapas? Sua conta fica protegida só pela senha.">Desativar</button>
        </form>

      <?php else: ?>

        <p class="cartao-nota">
          Recomendado. Com ela, entrar exige sua senha <em>e</em> um código que só
          aparece no seu celular — descobrir a senha deixa de ser suficiente.
        </p>

        <ol class="passos">
          <li>
            Instale um aplicativo autenticador no celular (Google Authenticator,
            Microsoft Authenticator, Authy ou o gerenciador de senhas que você usa).
          </li>
          <li>
            No aplicativo, escolha adicionar conta manualmente e informe esta chave:
            <div class="senha-gerada">
              <code id="segredo-totp"><?= $h(trim(chunk_split($segredoPendente, 4, ' '))) ?></code>
              <button type="button" class="btn btn-secundario" id="copiar-segredo"
                      data-alvo="segredo-totp">Copiar</button>
            </div>
            <small class="dica-passo">
              Nome da conta: <strong>Grupo Alvorada</strong> ·
              Tipo: <strong>baseado em tempo</strong> · 6 dígitos · 30 segundos
            </small>
          </li>
          <li>
            Digite abaixo o código de 6 dígitos que o aplicativo mostrar:
            <form method="post" class="form-linha">
              <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
              <input type="text" name="codigo" inputmode="numeric" maxlength="6"
                     placeholder="000000" required autocomplete="one-time-code" class="campo-codigo">
              <button class="btn btn-primario" name="acao" value="ativar-2fa">Ativar</button>
            </form>
          </li>
        </ol>

      <?php endif; ?>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Último acesso</h2></div>
      <p class="cartao-nota">
        <?= !empty($u['ultimoAcesso']) ? date('d/m/Y \à\s H:i', (int) $u['ultimoAcesso']) : '—' ?>
        <?php if (!empty($u['ultimoIp'])): ?>
          · endereço <?= $h($u['ultimoIp']) ?>
        <?php endif; ?>
        <br>
        <small>Se não reconhecer este acesso, troque sua senha e avise um administrador.</small>
      </p>
    </section>
  </main>
</div>

<script src="usuarios.js"></script>
</body>
</html>
