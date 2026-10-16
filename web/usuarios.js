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
