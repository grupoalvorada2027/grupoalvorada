/* Painel de lucratividade — Grupo Alvorada
 *
 * Le o dados.php (que confere a sessao e filtra os campos conforme o papel do
 * usuario) e monta a tela. Sem framework de proposito: o arquivo roda direto na
 * hospedagem compartilhada, sem build.
 */

(function () {
  'use strict';

  var SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  var cores = {};
  var dados = null;
  var dica = null;

  var moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var umaCasa = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  });

  function $(id) { return document.getElementById(id); }
  function cor(canal) { return 'var(' + (cores[canal] || '--s5') + ')'; }
  function pct(v) { return umaCasa.format(v) + '%'; }
  function classe(v) { return v < 0 ? 'neg' : 'pos'; }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Identidade do canal nunca depende so da cor: vem com o nome ao lado. */
  function chip(canal) {
    return '<span class="chip"><span class="chip-cor" style="background:' + cor(canal) +
           '"></span>' + esc(canal) + '</span>';
  }

  // -------------------------------------------------- tooltip

  function mostrarDica(e, titulo, linhas) {
    if (!dica) dica = $('dica');
    dica.innerHTML = '<div class="dica-t">' + esc(titulo) + '</div>' +
      linhas.map(function (l) { return '<div class="dica-l">' + l + '</div>'; }).join('');
    dica.classList.add('visivel');
    dica.setAttribute('aria-hidden', 'false');
    posDica(e);
  }

  function posDica(e) {
    if (!dica) return;
    var r = dica.getBoundingClientRect();
    var x = e.clientX + 14;
    var y = e.clientY + 14;
    if (x + r.width > window.innerWidth - 10) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 10) y = e.clientY - r.height - 14;
    dica.style.left = Math.max(8, x) + 'px';
    dica.style.top = Math.max(8, y) + 'px';
  }

  function esconderDica() {
    if (!dica) return;
    dica.classList.remove('visivel');
    dica.setAttribute('aria-hidden', 'true');
  }

  // -------------------------------------------------- KPIs

  function montarKpis(d) {
    var receita = 0, margem = 0, pedidos = 0;
    d.canais.forEach(function (c) {
      receita += c.receita;
      pedidos += c.pedidos;
      if (c.margem != null) margem += c.margem;
    });

    var temMargem = !d.restrito;
    var mPct = receita === 0 ? 0 : (margem / receita) * 100;
    var ticket = pedidos === 0 ? 0 : receita / pedidos;

    // Canal de menos de 30 pedidos nao entra no "melhor canal": a margem dele
    // oscila demais para servir de recomendacao.
    var melhor = temMargem
      ? d.canais.filter(function (c) { return c.pedidos >= 30; })
          .sort(function (a, b) { return b.margemPct - a.margemPct; })[0]
      : null;

    var itens = [
      { ico: '◉', cor: 'var(--s2)', rotulo: 'Receita', valor: moeda.format(receita),
        nota: inteiro.format(pedidos) + ' pedidos' },
    ];

    if (temMargem) {
      itens.push(
        { ico: '▲', cor: 'var(--lucro)', rotulo: 'Margem de contribuição',
          valor: moeda.format(margem), nota: 'após custo, comissão, frete e imposto' },
        { ico: '%', cor: 'var(--atencao)', rotulo: 'Margem sobre a receita',
          valor: pct(mPct), nota: 'média de todos os canais' },
      );
    }

    itens.push({ ico: '◆', cor: 'var(--s4)', rotulo: 'Ticket médio',
      valor: moeda.format(ticket),
      nota: inteiro.format(d.cobertura.pedidos) + ' pedidos na análise' });

    if (melhor) {
      itens.push({ ico: '★', cor: 'var(--marca-clara)', rotulo: 'Melhor canal por margem',
        valor: melhor.canal, nota: pct(melhor.margemPct) + ' de margem' });
    }

    $('kpis').innerHTML = itens.map(function (k) {
      return '<div class="kpi">' +
        '<div class="kpi-ico" style="background:color-mix(in srgb,' + k.cor +
          ' 16%,transparent);color:' + k.cor + '">' + k.ico + '</div>' +
        '<div class="kpi-corpo">' +
          '<div class="kpi-rotulo">' + esc(k.rotulo) + '</div>' +
          '<div class="kpi-valor" title="' + esc(k.valor) + '">' + esc(k.valor) + '</div>' +
          '<div class="kpi-nota">' + esc(k.nota) + '</div>' +
        '</div></div>';
    }).join('');
  }

  // -------------------------------------------------- insights

  function montarInsights(lista) {
    if (!lista || !lista.length) {
      $('insights').innerHTML = '<p class="vazio">Sem observações para este período.</p>';
      return;
    }
    var ico = { oportunidade: '↑', alerta: '!', informacao: 'i' };
    $('insights').innerHTML = lista.map(function (i) {
      return '<div class="insight">' +
        '<div class="insight-ico insight-' + esc(i.tipo) + '">' + (ico[i.tipo] || 'i') + '</div>' +
        '<div><div class="insight-titulo">' + esc(i.titulo) + '</div>' +
        '<div class="insight-texto">' + esc(i.texto) + '</div></div></div>';
    }).join('');
  }

  // -------------------------------------------------- avisos

  function montarAvisos(c) {
    var a = [];

    if (c.pedidosDuplicados > 0) {
      a.push('<strong>' + inteiro.format(c.pedidosDuplicados) + '</strong> vendas apareciam mais ' +
        'de uma vez no Bling, com números de pedido diferentes para a mesma venda do ' +
        'marketplace. Foram contadas uma única vez aqui — senão o faturamento desses canais ' +
        'apareceria dobrado. <strong>Indica integração duplicada no Bling</strong>, que vale ' +
        'corrigir na origem.');
    }
    if (c.itensSemCusto > 0) {
      a.push('<strong>' + inteiro.format(c.itensSemCusto) + '</strong> de ' +
        inteiro.format(c.itens) + ' itens não têm custo cadastrado (' +
        pct(c.percentualItensComCusto) + ' têm). A margem desses fica em branco de propósito: ' +
        'sem o custo o lucro é desconhecido, e mostrá-lo como zero inflaria o resultado.');
    }
    if (c.taxasEstimadas > 0) {
      var tot = c.taxasReais + c.taxasEstimadas;
      a.push('<strong>' + inteiro.format(c.taxasEstimadas) + '</strong> taxas são estimadas por ' +
        'regra (' + pct(tot ? (c.taxasReais / tot) * 100 : 0) + ' são reais do marketplace).');
    }
    if (c.pedidosForaDaAnalise > 0) {
      a.push(inteiro.format(c.pedidosForaDaAnalise) +
        ' pedidos cancelados foram excluídos da análise.');
    }

    if (!a.length) return;
    $('lista-avisos').innerHTML = a.map(function (x) { return '<li>' + x + '</li>'; }).join('');
    $('avisos').hidden = false;
  }

  // -------------------------------------------------- canais

  function legenda(id, canais) {
    $(id).innerHTML = canais.map(function (c) {
      return '<span class="legenda-item"><span class="legenda-cor" style="background:' +
        cor(c) + '"></span>' + esc(c) + '</span>';
    }).join('');
  }

  function barrasCanais(canais, restrito) {
    // Operador nao recebe margem: a barra dele compara receita.
    var campo = restrito ? 'receita' : 'margem';
    var maior = Math.max.apply(null, canais.map(function (c) {
      return Math.abs(c[campo] || 0);
    }).concat([1]));

    $('barras-canais').innerHTML = canais.map(function (c) {
      var v = c[campo] || 0;
      var larg = Math.max(2, (Math.abs(v) / maior) * 100);
      var extra = restrito ? '' : '<small>' + pct(c.margemPct) + '</small>';
      return '<div class="barra-linha">' +
        '<div class="barra-rotulo" title="' + esc(c.canal) + '">' + esc(c.canal) + '</div>' +
        '<div class="barra-trilho">' +
          '<div class="barra-preenchida" style="width:' + larg + '%;background:' +
            cor(c.canal) + '"></div>' +
          '<span class="barra-valor">' + moeda.format(v) + extra + '</span>' +
        '</div></div>';
    }).join('');
  }

  function tabelaCanais(canais, restrito) {
    if (restrito) {
      // Tira do cabecalho as colunas que o servidor nao enviou.
      var ths = document.querySelectorAll('#tabela-canais thead th');
      Array.prototype.slice.call(ths).forEach(function (th) {
        var t = th.textContent.trim();
        if (t === 'Custo' || t === 'Margem' || t === 'Margem %') th.remove();
      });
    }

    var maiorM = Math.max.apply(null, canais.map(function (c) {
      return Math.abs(c.margemPct || 0);
    }).concat([1]));

    document.querySelector('#tabela-canais tbody').innerHTML = canais.map(function (c) {
      var celMargem = restrito ? '' :
        '<td class="num ' + classe(c.margem) + '">' + moeda.format(c.margem) + '</td>' +
        '<td><div class="cel-barra">' +
          '<span class="' + classe(c.margem) + '">' + pct(c.margemPct) + '</span>' +
          '<span class="cel-barra-trilho"><span class="cel-barra-fill" style="width:' +
            Math.max(2, (Math.abs(c.margemPct) / maiorM) * 100) + '%;background:' +
            cor(c.canal) + '"></span></span>' +
        '</div></td>';

      return '<tr>' +
        '<td>' + chip(c.canal) + '</td>' +
        '<td class="num">' + inteiro.format(c.pedidos) + '</td>' +
        '<td class="num">' + moeda.format(c.receita) + '</td>' +
        (restrito ? '' : '<td class="num">' + moeda.format(c.custo) + '</td>') +
        '<td class="num">' + (c.taxas != null ? moeda.format(c.taxas) : '—') + '</td>' +
        '<td class="num">' + moeda.format(c.frete || 0) + '</td>' +
        celMargem +
        '<td class="num">' + moeda.format(c.ticketMedio) + '</td>' +
      '</tr>';
    }).join('');
  }

  // -------------------------------------------------- mensal

  function rotuloMes(iso) {
    var m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
             'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    var p = iso.split('-');
    return m[parseInt(p[1], 10) - 1] + '/' + p[0].slice(2);
  }

  function graficoMensal(linhas, canais, restrito) {
    var campo = restrito ? 'receita' : 'margem';
    var meses = [];
    var porMes = {};

    linhas.forEach(function (l) {
      if (!porMes[l.mes]) { porMes[l.mes] = {}; meses.push(l.mes); }
      porMes[l.mes][l.canal] = l;
    });
    meses.sort();

    var maior = Math.max.apply(null, linhas.map(function (l) {
      return Math.abs(l[campo] || 0);
    }).concat([1]));

    $('grafico-mensal').innerHTML = meses.map(function (mes) {
      var barras = canais.map(function (canal) {
        var l = porMes[mes][canal];
        var v = l ? (l[campo] || 0) : 0;
        var alt = Math.max(3, (Math.abs(v) / maior) * 160);
        return '<div class="mes-barra" style="height:' + alt + 'px;background:' + cor(canal) +
          '" data-mes="' + esc(mes) + '" data-canal="' + esc(canal) + '"' +
          ' role="img" aria-label="' + esc(canal) + ' em ' + esc(rotuloMes(mes)) + ': ' +
          moeda.format(v) + '"></div>';
      }).join('');

      return '<div class="mes-col"><div class="mes-barras">' + barras + '</div>' +
        '<div class="mes-rot">' + esc(rotuloMes(mes)) + '</div></div>';
    }).join('');

    var g = $('grafico-mensal');
    g.addEventListener('mouseover', function (e) {
      var alvo = e.target.closest('.mes-barra');
      if (!alvo) return;
      var l = porMes[alvo.getAttribute('data-mes')] &&
              porMes[alvo.getAttribute('data-mes')][alvo.getAttribute('data-canal')];
      if (!l) return;
      var ls = ['Receita: ' + moeda.format(l.receita),
                'Pedidos: ' + inteiro.format(l.pedidos)];
      if (!restrito) {
        ls.splice(1, 0, 'Margem: ' + moeda.format(l.margem) + ' (' + pct(l.margemPct) + ')');
      }
      mostrarDica(e, alvo.getAttribute('data-canal') + ' · ' +
        rotuloMes(alvo.getAttribute('data-mes')), ls);
    });
    g.addEventListener('mousemove', function (e) {
      if (e.target.closest('.mes-barra')) posDica(e);
    });
    g.addEventListener('mouseout', function (e) {
      if (e.target.closest('.mes-barra')) esconderDica();
    });
  }

  // -------------------------------------------------- tabelas

  function tabelaComparativo(lista) {
    if (!lista || !lista.length) { $('vazio-comp').hidden = false; return; }
    document.querySelector('#tabela-comp tbody').innerHTML = lista.slice(0, 40).map(function (c) {
      var m = c.canais[0];
      var p = c.canais[c.canais.length - 1];
      return '<tr>' +
        '<td title="' + esc(c.descricao) + '">' + esc(c.sku) + '</td>' +
        '<td>' + chip(m.canal) + '</td>' +
        '<td class="num ' + classe(m.margemPct) + '">' + pct(m.margemPct) + '</td>' +
        '<td>' + chip(p.canal) + '</td>' +
        '<td class="num ' + classe(p.margemPct) + '">' + pct(p.margemPct) + '</td>' +
        '<td class="num">' + pct(c.diferencaPct) + '</td>' +
      '</tr>';
    }).join('');
  }

  function tabelaPrejuizo(lista) {
    if (!lista || !lista.length) { $('vazio-prej').hidden = false; return; }
    document.querySelector('#tabela-prej tbody').innerHTML = lista.slice(0, 40).map(function (s) {
      return '<tr>' +
        '<td title="' + esc(s.descricao) + '">' + esc(s.sku) + '</td>' +
        '<td>' + chip(s.canal) + '</td>' +
        '<td class="num">' + inteiro.format(s.quantidade) + '</td>' +
        '<td class="num">' + moeda.format(s.receita) + '</td>' +
        '<td class="num neg">' + moeda.format(s.margem) + '</td>' +
        '<td class="num neg">' + pct(s.margemPct) + '</td>' +
      '</tr>';
    }).join('');
  }

  function tabelaSkus() {
    var busca = $('busca').value.trim().toLowerCase();
    var canal = $('filtro-canal').value;
    var soSem = $('filtro-sem-custo').checked;
    var restrito = !!dados.restrito;

    var lista = dados.skuCanal.filter(function (s) {
      if (canal && s.canal !== canal) return false;
      if (soSem && !s.semCusto) return false;
      if (busca && (s.sku + ' ' + s.descricao).toLowerCase().indexOf(busca) === -1) return false;
      return true;
    });

    document.querySelector('#tabela-skus tbody').innerHTML = lista.slice(0, 250)
      .map(function (s) {
        var cels = '<td>' + esc(s.sku) + '</td>' +
          '<td title="' + esc(s.descricao) + '">' + esc(s.descricao) + '</td>' +
          '<td>' + chip(s.canal) + '</td>' +
          '<td class="num">' + inteiro.format(s.quantidade) + '</td>' +
          '<td class="num">' + moeda.format(s.receita) + '</td>';

        if (!restrito) {
          cels += '<td class="num">' + (s.semCusto ? '—' : moeda.format(s.custo)) + '</td>';
        }
        cels += '<td class="num">' + (s.taxas != null ? moeda.format(s.taxas) : '—') + '</td>';
        if (!restrito) {
          cels += '<td class="num">' + (s.semCusto
            ? '<span class="etq">sem custo</span>'
            : '<span class="' + classe(s.margem) + '">' + moeda.format(s.margem) + '</span>') +
            '</td>';
          cels += '<td class="num">' + (s.semCusto
            ? '—'
            : '<span class="' + classe(s.margem) + '">' + pct(s.margemPct) + '</span>') + '</td>';
        }
        return '<tr>' + cels + '</tr>';
      }).join('');

    $('contador-skus').textContent = lista.length > 250
      ? 'Mostrando 250 de ' + inteiro.format(lista.length) + ' combinações. Refine a busca.'
      : inteiro.format(lista.length) + ' combinações de produto e canal.';
  }

  // -------------------------------------------------- tema

  function iniciarTema() {
    try {
      var s = localStorage.getItem('tema');
      if (s) document.documentElement.setAttribute('data-theme', s);
    } catch (e) { /* modo privado bloqueia o storage */ }

    $('alternar-tema').addEventListener('click', function () {
      var claro = document.documentElement.getAttribute('data-theme') === 'light';
      var novo = claro ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', novo);
      try { localStorage.setItem('tema', novo); } catch (e) { /* ignora */ }
    });
  }

  // -------------------------------------------------- início

  function render() {
    var nomes = dados.canais.map(function (c) { return c.canal; });
    nomes.forEach(function (n, i) { cores[n] = SERIES[i % SERIES.length]; });

    var restrito = !!dados.restrito;
    if (restrito) document.body.classList.add('modo-restrito');

    $('periodo').textContent = 'De ' +
      new Date(dados.periodo.inicio).toLocaleDateString('pt-BR') + ' a ' +
      new Date(dados.periodo.fim).toLocaleDateString('pt-BR');

    var g = new Date(dados.geradoEm);
    $('atualizacao').textContent = 'Atualizado ' + g.toLocaleDateString('pt-BR') + ' às ' +
      g.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    montarKpis(dados);
    montarAvisos(dados.cobertura);
    if (!restrito) montarInsights(dados.insights);

    legenda('legenda-canais', nomes);
    legenda('legenda-mensal', nomes);
    barrasCanais(dados.canais, restrito);
    tabelaCanais(dados.canais, restrito);
    graficoMensal(dados.canalMes, nomes, restrito);

    if (!restrito) {
      tabelaComparativo(dados.comparativoCanais);
      tabelaPrejuizo(dados.prejuizo);
    }

    var sel = $('filtro-canal');
    nomes.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    });

    $('busca').addEventListener('input', tabelaSkus);
    $('filtro-canal').addEventListener('change', tabelaSkus);
    $('filtro-sem-custo').addEventListener('change', tabelaSkus);
    tabelaSkus();

    $('carregando').hidden = true;
    $('painel').hidden = false;
  }

  iniciarTema();

  // Cache-busting: sem isto a hospedagem pode servir um JSON antigo depois de
  // uma atualizacao, e o usuario decidiria com numero velho sem perceber.
  fetch('dados.php?v=' + Date.now())
    .then(function (r) {
      // Sessao expirada: volta ao login em vez de mostrar erro tecnico.
      if (r.status === 401) { window.location.href = 'login.php'; return null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) {
      if (!json) return;
      dados = json;
      render();
    })
    .catch(function (erro) {
      $('carregando').hidden = true;
      var el = $('erro');
      el.hidden = false;
      el.innerHTML = '<p><strong>Não foi possível carregar os dados.</strong></p>' +
        '<p>' + esc(String(erro.message || erro)) + '</p>' +
        '<p>Se o servidor ainda não publicou, verifique se o worker está rodando.</p>';
    });
})();
