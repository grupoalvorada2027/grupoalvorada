<?php
/**
 * Painel protegido. O guard roda ANTES de qualquer HTML sair: quem nao tem
 * sessao valida e redirecionado e nunca recebe a pagina.
 */
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
$usuario = exigirLogin();
header('X-Robots-Tag: noindex, nofollow');
?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#CF0C0C">
<link rel="icon" href="logo.png">
<title>Lucratividade por Canal</title>
<link rel="stylesheet" href="estilo.css">
</head>
<body>

<?php $pagina = 'lucratividade'; require __DIR__ . '/_lateral.php'; ?>

<!-- ===================== CONTEÚDO ===================== -->
<div class="conteudo">

  <header class="barra-topo">
    <div>
      <h1 class="titulo-pagina">Lucratividade por canal</h1>
      <p class="caminho" id="periodo">Carregando…</p>
    </div>
    <div class="acoes-topo">
      <span class="selo-atualizacao" id="atualizacao"></span>
      <div class="usuario-bloco">
        <strong><?= htmlspecialchars($usuario['nome'], ENT_QUOTES) ?></strong>
        <span><?= htmlspecialchars(PAPEIS[$usuario['papel']] ?? $usuario['papel'], ENT_QUOTES) ?></span>
      </div>
      <button type="button" id="alternar-tema" class="btn-icone" aria-label="Alternar tema" title="Alternar tema"><svg class="icone" aria-hidden="true"><use href="#i-sol"/></svg></button>
      <a href="sair.php" class="btn-icone" title="Sair" aria-label="Sair"><svg class="icone" aria-hidden="true"><use href="#i-sair"/></svg></a>
    </div>
  </header>

  <main id="painel" hidden>

    <!-- KPIs -->
    <section class="linha-kpi" id="kpis" aria-label="Indicadores do período"></section>

    <!-- Avisos de confiabilidade -->
    <div id="avisos" class="avisos" hidden>
      <strong class="cabeca">Atenção à confiabilidade destes números</strong>
      <ul id="lista-avisos"></ul>
    </div>

    <!-- Canais + Insights -->
    <div class="grade grade-2-1">
      <section class="cartao" aria-labelledby="t-canais">
        <div class="cartao-cabeca"><h2 id="t-canais">Qual canal dá mais lucro</h2></div>
        <p class="cartao-nota">
          Margem de contribuição = receita − custo do produto − comissão − frete do vendedor − impostos.
        </p>
        <div class="legenda" id="legenda-canais"></div>
        <div class="barras" id="barras-canais"></div>
      </section>

      <section class="cartao" aria-labelledby="t-insights" data-exige-margem>
        <div class="cartao-cabeca"><h2 id="t-insights">Insights</h2></div>
        <div class="insights" id="insights"></div>
      </section>
    </div>

    <!-- Tabela de canais -->
    <section class="cartao" aria-labelledby="t-tab-canais" style="margin-bottom:16px">
      <div class="cartao-cabeca"><h2 id="t-tab-canais">Resultado por canal</h2></div>
      <div class="rolavel">
        <table id="tabela-canais">
          <thead><tr>
            <th scope="col">Canal</th>
            <th scope="col" class="num">Pedidos</th>
            <th scope="col" class="num">Receita</th>
            <th scope="col" class="num">Custo</th>
            <th scope="col" class="num">Comissões</th>
            <th scope="col" class="num">Frete</th>
            <th scope="col" class="num">Margem</th>
            <th scope="col">Margem %</th>
            <th scope="col" class="num">Ticket médio</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <!-- Mensal -->
    <section class="cartao" aria-labelledby="t-mensal" style="margin-bottom:16px">
      <div class="cartao-cabeca"><h2 id="t-mensal">Margem mês a mês</h2></div>
      <div class="legenda" id="legenda-mensal"></div>
      <div class="mensal" id="grafico-mensal"></div>
    </section>

    <!-- Comparativo + Prejuízo -->
    <div class="grade grade-1-1">
      <section class="cartao" aria-labelledby="t-comp" data-exige-margem>
        <div class="cartao-cabeca"><h2 id="t-comp">Onde vale mais a pena anunciar</h2></div>
        <p class="cartao-nota">
          Produtos vendidos em mais de um canal, pela diferença de margem entre o melhor e o pior.
        </p>
        <div class="rolavel">
          <table id="tabela-comp">
            <thead><tr>
              <th scope="col">SKU</th>
              <th scope="col">Melhor canal</th>
              <th scope="col" class="num">Margem</th>
              <th scope="col">Pior canal</th>
              <th scope="col" class="num">Margem</th>
              <th scope="col" class="num">Dif.</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <p class="vazio" id="vazio-comp" hidden>Nenhum produto vendido em mais de um canal.</p>
      </section>

      <section class="cartao" aria-labelledby="t-prej" data-exige-margem>
        <div class="cartao-cabeca"><h2 id="t-prej">Vendendo no prejuízo</h2></div>
        <p class="cartao-nota">
          Margem negativa após todos os custos. Só itens com custo cadastrado.
        </p>
        <div class="rolavel">
          <table id="tabela-prej">
            <thead><tr>
              <th scope="col">SKU</th>
              <th scope="col">Canal</th>
              <th scope="col" class="num">Qtd</th>
              <th scope="col" class="num">Receita</th>
              <th scope="col" class="num">Prejuízo</th>
              <th scope="col" class="num">%</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <p class="vazio" id="vazio-prej" hidden>Nenhum produto com margem negativa.</p>
      </section>
    </div>

    <!-- Produtos -->
    <section class="cartao" aria-labelledby="t-skus">
      <div class="cartao-cabeca"><h2 id="t-skus">Produtos por canal</h2></div>
      <div class="filtros">
        <label class="campo">
          <span>Buscar SKU ou produto</span>
          <input type="search" id="busca" placeholder="Ex: tela, CAM-001" autocomplete="off">
        </label>
        <label class="campo">
          <span>Canal</span>
          <select id="filtro-canal"><option value="">Todos</option></select>
        </label>
        <label class="campo campo-check">
          <input type="checkbox" id="filtro-sem-custo">
          <span>Só itens sem custo</span>
        </label>
      </div>
      <div class="rolavel">
        <table id="tabela-skus">
          <thead><tr>
            <th scope="col">SKU</th>
            <th scope="col">Produto</th>
            <th scope="col">Canal</th>
            <th scope="col" class="num">Qtd</th>
            <th scope="col" class="num">Receita</th>
            <th scope="col" class="num" data-exige-margem>Custo</th>
            <th scope="col" class="num">Comissões</th>
            <th scope="col" class="num" data-exige-margem>Margem</th>
            <th scope="col" class="num" data-exige-margem>Margem %</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="contador" id="contador-skus"></p>
    </section>

  </main>

  <div id="carregando" class="estado">Carregando dados…</div>
  <div id="erro" class="estado estado-erro" hidden></div>
</div>

<div id="dica" class="dica" role="tooltip" aria-hidden="true"></div>

<script src="app.js"></script>
</body>
</html>
