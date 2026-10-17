<?php
/**
 * Administração de acesso. Somente administrador.
 *
 * Aqui nascem as contas: não há cadastro aberto nem pedido de acesso. Criar
 * uma conta gera uma senha provisória, mostrada UMA vez nesta tela — não fica
 * guardada em lugar nenhum, só o hash dela.
 *
 * Cada ação é um POST com token anti-CSRF: um link ou imagem em outro site não
 * consegue criar, promover ou bloquear ninguém em nome de um administrador
 * logado.
 *
 * Duas travas contra trancar a empresa para fora do próprio sistema:
 *   - ninguém altera, bloqueia ou remove a própria conta;
 *   - sempre sobra pelo menos um administrador ativo.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

$usuario = exigirAdmin();
header('X-Robots-Tag: noindex, nofollow');

$mensagem = '';
$erro = '';
$senhaGerada = null;   // mostrada uma única vez, logo após criar ou redefinir
$emailGerado = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!csrfValido($_POST['csrf'] ?? null)) {
        $erro = 'A página expirou. Recarregue e repita a ação.';
    } else {
        $acao  = (string) ($_POST['acao'] ?? '');
        $email = normalizarEmail((string) ($_POST['email'] ?? ''));
        $papel = (string) ($_POST['papel'] ?? 'operador');

        $usuarios = carregarUsuarios();
        $alvo = $usuarios[$email] ?? null;
        $proprio = $email === $usuario['login'];
        $ultimoAdmin = $alvo !== null
            && ($alvo['papel'] ?? '') === 'admin'
            && ($alvo['status'] ?? '') === 'ativo'
            && contarAdminsAtivos($usuarios) <= 1;

        if (!isset(PAPEIS[$papel])) {
            $erro = 'Papel inválido.';
        } elseif ($acao === 'criar') {
            $nome = trim((string) ($_POST['nome'] ?? ''));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $erro = 'Informe um e-mail válido.';
            } elseif ($nome === '') {
                $erro = 'Informe o nome da pessoa.';
            } elseif ($alvo !== null) {
                $erro = 'Já existe uma conta com este e-mail.';
            } else {
                $senhaGerada = criarUsuario((string) ($_POST['email'] ?? ''), $nome, $papel, $usuario['login']);
                $emailGerado = (string) ($_POST['email'] ?? '');
                $mensagem = "Conta criada para $nome.";
            }
        } elseif ($alvo === null) {
            $erro = 'Conta não encontrada.';
        } elseif ($proprio) {
            $erro = 'Você não pode alterar a sua própria conta aqui. Peça a outro administrador.';
        } else {
            switch ($acao) {
                case 'papel':
                    if ($ultimoAdmin && $papel !== 'admin') {
                        $erro = 'Este é o último administrador ativo. Promova outra pessoa antes.';
                        break;
                    }
                    $alvo['papel'] = $papel;
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    $mensagem = 'Papel de ' . ($alvo['nome'] ?? $email) . ' alterado para ' . PAPEIS[$papel] . '.';
                    break;

                case 'bloquear':
                    if ($ultimoAdmin) {
                        $erro = 'Este é o último administrador ativo. Promova outra pessoa antes.';
                        break;
                    }
                    $alvo['status'] = 'bloqueado';
                    $alvo['bloqueadoEm'] = time();
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    $mensagem = ($alvo['nome'] ?? $email) . ' foi bloqueado. O acesso cai no próximo clique dele.';
                    break;

                case 'reativar':
                    $alvo['status'] = 'ativo';
                    unset($alvo['bloqueadoEm']);
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    limparFalhas($email);
                    $mensagem = ($alvo['nome'] ?? $email) . ' voltou a ter acesso.';
                    break;

                case 'redefinir':
                    $senhaGerada = gerarSenhaProvisoria();
                    $alvo['senhaHash'] = gerarHashSenha($senhaGerada);
                    $alvo['senhaProvisoria'] = true;
                    $alvo['provisoriaAte'] = time() + PROVISORIA_HORAS * 3600;
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    limparFalhas($email);
                    $emailGerado = (string) ($alvo['email'] ?? $email);
                    $mensagem = 'Senha provisória gerada para ' . ($alvo['nome'] ?? $email) . '.';
                    break;

                case 'limpar-2fa':
                    unset($alvo['totp']);
                    $usuarios[$email] = $alvo;
                    salvarUsuarios($usuarios);
                    $mensagem = 'Verificação em duas etapas removida de ' . ($alvo['nome'] ?? $email)
                              . '. Ela pode configurar de novo em Minha conta.';
                    break;

                case 'destravar':
                    limparFalhas($email);
                    $mensagem = 'Bloqueio por tentativas liberado para ' . ($alvo['nome'] ?? $email) . '.';
                    break;

                case 'remover':
                    if ($ultimoAdmin) {
                        $erro = 'Este é o último administrador ativo. Promova outra pessoa antes.';
                        break;
                    }
                    unset($usuarios[$email]);
                    salvarUsuarios($usuarios);
                    $mensagem = 'Conta de ' . $email . ' removida.';
                    break;

                default:
                    $erro = 'Ação desconhecida.';
            }
        }
    }
}

$usuarios = carregarUsuarios();
uasort($usuarios, static fn ($a, $b) => strcasecmp((string) ($a['nome'] ?? ''), (string) ($b['nome'] ?? '')));

$ativos = array_filter($usuarios, static fn ($u) => ($u['status'] ?? '') === 'ativo');
$bloqueados = array_filter($usuarios, static fn ($u) => ($u['status'] ?? '') !== 'ativo');

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
        $html .= '<option value="' . $valor . '"' . ($valor === $atual ? ' selected' : '') . '>'
               . $rotulo . '</option>';
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

    <?php if ($senhaGerada !== null): ?>
      <section class="cartao cartao-senha">
        <h2>Senha provisória</h2>
        <p class="cartao-nota">
          Anote agora e entregue a <?= $h($emailGerado) ?> por um canal seguro.
          <strong>Ela não será exibida de novo</strong> — o sistema guarda apenas uma
          versão embaralhada, que não permite recuperar a senha. No primeiro acesso,
          a pessoa é obrigada a definir uma senha própria. Esta provisória vale por
          <?= PROVISORIA_HORAS ?> horas.
        </p>
        <div class="senha-gerada">
          <code id="senha-provisoria"><?= $h($senhaGerada) ?></code>
          <button type="button" class="btn btn-secundario" id="copiar-senha"
                  data-alvo="senha-provisoria">Copiar</button>
        </div>
      </section>
    <?php endif; ?>

    <section class="cartao legenda-papeis">
      <div class="papel-item"><strong>Administrador</strong><span>Vê tudo e gerencia quem tem acesso.</span></div>
      <div class="papel-item"><strong>Gestor</strong><span>Vê tudo, inclusive custo e margem. Não gerencia usuários.</span></div>
      <div class="papel-item"><strong>Operador</strong><span>Vê vendas e faturamento. Custo e margem não chegam ao navegador dele.</span></div>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Criar acesso</h2></div>
      <p class="cartao-nota">
        Não existe cadastro aberto: toda conta nasce aqui. O sistema gera uma senha
        provisória que você entrega à pessoa.
      </p>
      <form method="post" class="form-criar">
        <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
        <input type="text" name="nome" placeholder="Nome da pessoa" required autocomplete="off">
        <input type="email" name="email" placeholder="email@empresa.com" required autocomplete="off">
        <?= seletorPapel('operador') ?>
        <button class="btn btn-primario" name="acao" value="criar">Criar acesso</button>
      </form>
    </section>

    <section class="cartao">
      <div class="cartao-cabeca"><h2>Com acesso <span class="contagem"><?= count($ativos) ?></span></h2></div>
      <div class="lista-usuarios">
        <?php foreach ($ativos as $email => $u): $proprio = $email === $usuario['login']; ?>
          <div class="linha-usuario">
            <div class="usr-id">
              <strong>
                <?= $h($u['nome'] ?? $email) ?>
                <?= $proprio ? '<em class="voce">você</em>' : '' ?>
                <?php if ($u['totp']['ativo'] ?? false): ?>
                  <em class="selo-2fa" title="Verificação em duas etapas ativa">2FA</em>
                <?php endif; ?>
                <?php if ($u['senhaProvisoria'] ?? false): ?>
                  <em class="selo-aviso" title="Ainda não definiu senha própria">senha provisória</em>
                <?php endif; ?>
              </strong>
              <span><?= $h($u['email'] ?? $email) ?></span>
              <small>
                Último acesso: <?= quando($u['ultimoAcesso'] ?? null) ?>
                <?php if (bloqueioRestante('conta:' . $email) > 0): ?>
                  · <span class="travado">travada por tentativas</span>
                <?php endif; ?>
              </small>
            </div>

            <?php if ($proprio): ?>
              <div class="usr-acoes">
                <span class="selo-papel"><?= $h(PAPEIS[$u['papel']] ?? $u['papel']) ?></span>
                <a class="btn btn-secundario" href="conta.php">Minha conta</a>
              </div>
            <?php else: ?>
              <form method="post" class="usr-acoes">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
                <input type="hidden" name="email" value="<?= $h($email) ?>">
                <?= seletorPapel((string) ($u['papel'] ?? 'operador')) ?>
                <button class="btn btn-secundario" name="acao" value="papel">Salvar</button>
                <button class="btn btn-fantasma" name="acao" value="redefinir"
                        data-confirmar="Gerar nova senha provisória para <?= $h($email) ?>? A senha atual deixa de funcionar.">Nova senha</button>
                <?php if ($u['totp']['ativo'] ?? false): ?>
                  <button class="btn btn-fantasma" name="acao" value="limpar-2fa"
                          data-confirmar="Remover a verificação em duas etapas de <?= $h($email) ?>?">Remover 2FA</button>
                <?php endif; ?>
                <?php if (bloqueioRestante('conta:' . $email) > 0): ?>
                  <button class="btn btn-secundario" name="acao" value="destravar">Destravar</button>
                <?php endif; ?>
                <button class="btn btn-perigo" name="acao" value="bloquear"
                        data-confirmar="Bloquear o acesso de <?= $h($email) ?>?">Bloquear</button>
              </form>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>
    </section>

    <?php if ($bloqueados): ?>
      <section class="cartao">
        <div class="cartao-cabeca"><h2>Bloqueados <span class="contagem"><?= count($bloqueados) ?></span></h2></div>
        <div class="lista-usuarios">
          <?php foreach ($bloqueados as $email => $u): ?>
            <div class="linha-usuario">
              <div class="usr-id">
                <strong><?= $h($u['nome'] ?? $email) ?></strong>
                <span><?= $h($u['email'] ?? $email) ?></span>
                <small>Bloqueado em <?= quando($u['bloqueadoEm'] ?? null) ?></small>
              </div>
              <form method="post" class="usr-acoes">
                <input type="hidden" name="csrf" value="<?= $h($csrf) ?>">
                <input type="hidden" name="email" value="<?= $h($email) ?>">
                <input type="hidden" name="papel" value="<?= $h($u['papel'] ?? 'operador') ?>">
                <button class="btn btn-secundario" name="acao" value="reativar">Reativar</button>
                <button class="btn btn-fantasma" name="acao" value="remover"
                        data-confirmar="Remover definitivamente a conta de <?= $h($email) ?>?">Remover</button>
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
