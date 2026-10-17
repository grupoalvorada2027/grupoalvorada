<?php
/**
 * Administração de acesso: quem pode entrar e o que pode ver.
 *
 * Somente administrador. Cada ação é um POST com token anti-CSRF — um link ou
 * imagem em outro site não consegue aprovar, bloquear ou promover ninguém em
 * nome de um administrador logado.
 *
 * Duas travas contra trancar a empresa para fora do próprio sistema:
 *   - ninguém altera o próprio papel nem se bloqueia ou se remove;
 *   - sempre sobra pelo menos um administrador ativo.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

$usuario = exigirAdmin();
header('X-Robots-Tag: noindex, nofollow');

$mensagem = '';
$erro     = '';

function contarAdminsAtivos(array $usuarios): int
{
    return count(array_filter(
        $usuarios,
        static fn ($u) => ($u['papel'] ?? '') === 'admin' && ($u['status'] ?? '') === 'ativo'
    ));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'Sessão expirada. Recarregue a página e repita a ação.';
    } else {
        $acao  = (string) ($_POST['acao'] ?? '');
        $emailDigitado = strtolower(trim((string) ($_POST['email'] ?? '')));
        // Chave canônica: no Gmail, com ou sem ponto é a mesma conta.
        $email = normalizarEmail($emailDigitado);
        $papel = (string) ($_POST['papel'] ?? 'operador');

        $usuarios = carregarUsuarios();
        $alvo = $usuarios[$email] ?? null;
        $proprio = $email === $usuario['login'];

        if (!isset(PAPEIS[$papel])) {
            $erro = 'Papel inválido.';
        } elseif ($acao === 'adicionar') {
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $erro = 'Informe um e-mail válido.';
            } elseif ($alvo !== null) {
                $erro = 'Este e-mail já está cadastrado.';
            } else {
                $usuarios[$email] = [
                    'email' => $emailDigitado, 'nome' => $emailDigitado, 'papel' => $papel, 'status' => 'ativo',
                    'criadoEm' => time(), 'liberadoPor' => $usuario['login'],
                ];
                salvarUsuarios($usuarios);
                $mensagem = "$emailDigitado liberado como " . PAPEIS[$papel] . '. Já pode entrar com o Google.';
            }
        } elseif ($alvo === null) {
            $erro = 'Usuário não encontrado.';
        } elseif ($proprio) {
            $erro = 'Você não pode alterar o seu próprio acesso. Peça a outro administrador.';
        } else {
            $eraAdminAtivo = ($alvo['papel'] ?? '') === 'admin' && ($alvo['status'] ?? '') === 'ativo';
            $ficaSemAdmin = $eraAdminAtivo && contarAdminsAtivos($usuarios) <= 1;

            switch ($acao) {
                case 'aprovar':
                case 'reativar':
                    $alvo['status'] = 'ativo';
                    $alvo['papel']  = $acao === 'aprovar' ? $papel : ($alvo['papel'] ?? 'operador');
                    $alvo['liberadoPor'] = $usuario['login'];
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    $mensagem = ($alvo['nome'] ?? $email) . ' agora tem acesso como ' . PAPEIS[$alvo['papel']] . '.';
                    break;

                case 'papel':
                    if ($ficaSemAdmin && $papel !== 'admin') {
                        $erro = 'Este é o último administrador ativo. Promova outra pessoa antes.';
                        break;
                    }
                    $alvo['papel'] = $papel;
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    $mensagem = 'Papel de ' . ($alvo['nome'] ?? $email) . ' alterado para ' . PAPEIS[$papel] . '.';
                    break;

                case 'bloquear':
                    if ($ficaSemAdmin) {
                        $erro = 'Este é o último administrador ativo. Promova outra pessoa antes.';
                        break;
                    }
                    $alvo['status'] = 'bloqueado';
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    $mensagem = ($alvo['nome'] ?? $email) . ' foi bloqueado. O acesso cai no próximo clique dele.';
                    break;

                case 'remover':
                    if ($ficaSemAdmin) {
                        $erro = 'Este é o último administrador ativo. Promova outra pessoa antes.';
                        break;
                    }
                    unset($usuarios[$email]);
                    salvarUsuarios($usuarios);
                    $mensagem = 'Cadastro de ' . $email . ' removido.';
                    break;

                default:
                    $erro = 'Ação desconhecida.';
            }
        }
    }
}

$usuarios = carregarUsuarios();
if (garantirAdminsIniciais($usuarios)) {
    salvarUsuarios($usuarios);
}
uasort($usuarios, static fn ($a, $b) => strcasecmp((string) ($a['nome'] ?? ''), (string) ($b['nome'] ?? '')));

$grupos = ['pendente' => [], 'ativo' => [], 'bloqueado' => []];
foreach ($usuarios as $email => $u) {
    $grupos[$u['status'] ?? 'pendente'][$email] = $u;
}

$csrf = tokenCsrf();
$h = static fn ($v): string => htmlspecialchars((string) $v, ENT_QUOTES);

function quando(?int $ts): string
{
    return $ts ? date('d/m/Y H:i', $ts) : '—';
}

function seletorPapel(string $atual): string
{
    $html = '<select name="papel" aria-label="Papel">';
    foreach (PAPEIS as $valor => $rotulo) {
        $sel = $valor === $atual ? ' selected' : '';
        $html .= '<option value="' . $valor . '"' . $sel . '>' . $rotulo . '</option>';
    }
    return $html . '</select>';
}

$pagina = 'usuarios';
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#CF0C0C">
<link rel="icon" href="logo.png">
<title>Usuários · Grupo Alvorada</title>
<link rel="stylesheet" href="estilo.css">
</head>
<body>

<?php require __DIR__ . '/_lateral.php'; ?>

<div class="conteudo">
  <header class="barra-topo">
    <div>
      <h1 class="titulo-pagina">Usuários e permissões</h1>
      <p class="caminho">Quem pode entrar no painel e o que cada um vê</p>
    </div>
    <div class="acoes-topo">
      <div class="usuario-bloco">
        <strong><?= $h($usuario['nome']) ?></strong>
        <span><?= $h(PAPEIS[$usuario['papel']]) ?></span>
      </div>
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

    <section class="cartao legenda-papeis">
      <div class="papel-item"><strong>Administrador</strong><span>Vê tudo e gerencia quem tem acesso.</span></div>
      <div class="papel-item"><strong>Gestor</strong><span>Vê tudo, inclusive custo e margem. Não gerencia usuários.</span></div>
      <div class="papel-item"><strong>Operador</strong><span>Vê vendas e faturamento. Custo e margem não chegam ao navegador dele.</span></div>
    </section>

    <?php if ($grupos['pendente']): ?>
      <section class="cartao">
        <div class="cartao-cabeca"><h2>Aguardando aprovação <span class="contagem"><?= count($grupos['pendente']) ?></span></h2></div>
        <p class="cartao-nota">Pessoas que entraram com o Google e ainda não têm acesso. Nada do painel é mostrado a elas até você aprovar.</p>
        <div class="lista-usuarios">
          <?php foreach ($grupos['pendente'] as $email => $u): ?>
            <div class="linha-usuario">
              <div class="usr-id">
                <strong><?= $h($u['nome'] ?? $email) ?></strong>
                <span><?= $h($u['email'] ?? $email) ?></span>
                <small>Pedido em <?= quando($u['criadoEm'] ?? null) ?></small>
              </div>
              <form method="post" class="usr-acoes">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
                <input type="hidden" name="email" value="<?= $h($email) ?>">
                <?= seletorPapel('operador') ?>
                <button class="btn btn-primario" name="acao" value="aprovar">Aprovar</button>
                <button class="btn btn-fantasma" name="acao" value="remover" data-confirmar="Recusar o pedido de <?= $h($email) ?>?">Recusar</button>
              </form>
            </div>
          <?php endforeach; ?>
        </div>
      </section>
    <?php endif; ?>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Com acesso <span class="contagem"><?= count($grupos['ativo']) ?></span></h2></div>
      <div class="lista-usuarios">
        <?php foreach ($grupos['ativo'] as $email => $u): $proprio = $email === $usuario['login']; ?>
          <div class="linha-usuario">
            <div class="usr-id">
              <strong><?= $h($u['nome'] ?? $email) ?><?= $proprio ? ' <em class="voce">você</em>' : '' ?></strong>
              <span><?= $h($u['email'] ?? $email) ?></span>
              <small>Último acesso: <?= quando($u['ultimoAcesso'] ?? null) ?></small>
            </div>
            <?php if ($proprio): ?>
              <div class="usr-acoes"><span class="selo-papel"><?= $h(PAPEIS[$u['papel']] ?? $u['papel']) ?></span></div>
            <?php else: ?>
              <form method="post" class="usr-acoes">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
                <input type="hidden" name="email" value="<?= $h($email) ?>">
                <?= seletorPapel((string) ($u['papel'] ?? 'operador')) ?>
                <button class="btn btn-secundario" name="acao" value="papel">Salvar</button>
                <button class="btn btn-perigo" name="acao" value="bloquear" data-confirmar="Bloquear o acesso de <?= $h($email) ?>?">Bloquear</button>
              </form>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Liberar um e-mail</h2></div>
      <p class="cartao-nota">Libera antes do primeiro acesso: a pessoa entra direto, sem passar pela fila de aprovação.</p>
      <form method="post" class="form-adicionar">
        <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
        <input type="email" name="email" placeholder="nome@gmail.com" required autocomplete="off">
        <?= seletorPapel('operador') ?>
        <button class="btn btn-primario" name="acao" value="adicionar">Liberar acesso</button>
      </form>
    </section>

    <?php if ($grupos['bloqueado']): ?>
      <section class="cartao">
        <div class="cartao-cabeca"><h2>Bloqueados <span class="contagem"><?= count($grupos['bloqueado']) ?></span></h2></div>
        <div class="lista-usuarios">
          <?php foreach ($grupos['bloqueado'] as $email => $u): ?>
            <div class="linha-usuario">
              <div class="usr-id">
                <strong><?= $h($u['nome'] ?? $email) ?></strong>
                <span><?= $h($u['email'] ?? $email) ?></span>
              </div>
              <form method="post" class="usr-acoes">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
                <input type="hidden" name="email" value="<?= $h($email) ?>">
                <input type="hidden" name="papel" value="<?= $h($u['papel'] ?? 'operador') ?>">
                <button class="btn btn-secundario" name="acao" value="reativar">Reativar</button>
                <button class="btn btn-fantasma" name="acao" value="remover" data-confirmar="Remover o cadastro de <?= $h($email) ?>?">Remover</button>
              </form>
            </div>
          <?php endforeach; ?>
        </div>
      </section>
    <?php endif; ?>
  </main>
</div>

<script src="usuarios.js"></script>
</body>
</html>
