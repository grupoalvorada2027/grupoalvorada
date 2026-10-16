<?php
/**
 * Entrega os dados do painel, somente para quem esta autenticado.
 *
 * Este arquivo existe porque proteger apenas a pagina seria inutil: o
 * dados.json tem custos e margens, e bastaria pedi-lo direto para baixar tudo.
 * O .htaccess bloqueia o acesso ao .json, e este script e a unica porta.
 *
 * O FILTRO POR PAPEL ACONTECE AQUI, NO SERVIDOR. Um operador nao recebe os
 * campos de custo e margem - eles sao removidos antes do envio. Esconder na
 * tela nao serviria de nada: a pessoa abriria a aba de rede do navegador e
 * leria o que quisesse.
 */

declare(strict_types=1);
require_once __DIR__ . '/auth.php';

$usuario = usuarioLogado();

if ($usuario === null) {
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['erro' => 'nao autenticado']);
    exit;
}

$arquivo = __DIR__ . '/dados.json';

if (!is_file($arquivo)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'erro' => 'dados ainda nao publicados',
        'detalhe' => 'O servidor nao enviou nenhuma analise ainda. Verifique se o worker esta rodando.',
    ]);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, must-revalidate');
header('X-Content-Type-Options: nosniff');

$conteudo = (string) file_get_contents($arquivo);

// Admin e gestor recebem o arquivo como esta.
if (podeVerMargem($usuario)) {
    echo $conteudo;
    exit;
}

// ------------------------------------------------------------
// Operador: remove tudo que revela custo ou margem.
// ------------------------------------------------------------
$dados = json_decode($conteudo, true);

if (!is_array($dados)) {
    http_response_code(500);
    echo json_encode(['erro' => 'arquivo de dados invalido']);
    exit;
}

$camposProibidos = ['custo', 'margem', 'margemPct', 'margemPercentual', 'taxas', 'imposto'];

$limpar = static function (array $linha) use ($camposProibidos): array {
    foreach ($camposProibidos as $campo) {
        unset($linha[$campo]);
    }
    return $linha;
};

foreach (['canais', 'canalMes', 'skuCanal'] as $secao) {
    if (!empty($dados[$secao]) && is_array($dados[$secao])) {
        $dados[$secao] = array_map($limpar, $dados[$secao]);
    }
}

// Estas secoes existem apenas para comparar margem: nao fazem sentido sem ela.
$dados['prejuizo'] = [];
$dados['comparativoCanais'] = [];

$dados['restrito'] = true;
$dados['papel'] = $usuario['papel'];

echo json_encode($dados);
