// Tela de usuários: confirmação das ações irreversíveis e alternância de tema.
// Em arquivo próprio porque a CSP proíbe script embutido na página.
(function () {
  'use strict';

  // Bloquear, remover e recusar pedem confirmação: um toque errado no celular
  // não pode tirar o acesso de alguém.
  document.addEventListener('click', function (e) {
    var botao = e.target.closest('button[data-confirmar]');
    if (botao && !window.confirm(botao.getAttribute('data-confirmar'))) {
      e.preventDefault();
    }
  });

  try {
    var salvo = localStorage.getItem('tema');
    if (salvo) document.documentElement.setAttribute('data-theme', salvo);
  } catch (e) { /* navegação privada bloqueia o storage */ }

  var tema = document.getElementById('alternar-tema');
  if (tema) {
    tema.addEventListener('click', function () {
      var claro = document.documentElement.getAttribute('data-theme') === 'light';
      var novo = claro ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', novo);
      try { localStorage.setItem('tema', novo); } catch (e) { /* ignora */ }
    });
  }
})();

// Botões "Copiar". A senha provisória e os códigos de recuperação aparecem uma
// única vez; copiar à mão convida a erro de transcrição.
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var botao = e.target.closest('[data-alvo]');
    if (!botao) return;

    var alvo = document.getElementById(botao.getAttribute('data-alvo'));
    if (!alvo) return;

    var texto = alvo.tagName === 'CODE'
      ? alvo.textContent.trim()
      : Array.prototype.map.call(alvo.querySelectorAll('code'), function (c) {
          return c.textContent.trim();
        }).join('\n');

    var original = botao.textContent;
    function feito(ok) {
      botao.textContent = ok ? 'Copiado' : 'Copie à mão';
      setTimeout(function () { botao.textContent = original; }, 2000);
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texto).then(function () { feito(true); }, function () { feito(false); });
    } else {
      feito(false);
    }
  });
})();
