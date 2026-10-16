// Revelar a senha reduz erro de digitação — e aqui errar 8 vezes bloqueia o
// acesso por 15 minutos.
//
// Em arquivo próprio, e não dentro do login.php, porque a política de
// segurança (CSP) proíbe script embutido na página: assim, mesmo que alguém
// conseguisse injetar HTML, o navegador se recusaria a executar o código.
(function () {
  'use strict';
  var botao = document.getElementById('ver-senha');
  var icone = document.getElementById('ver-senha-ico');
  var campo = document.getElementById('senha');
  if (!botao || !icone || !campo) return; // tela com login Google não tem campo de senha

  botao.addEventListener('click', function () {
    var oculta = campo.type === 'password';
    campo.type = oculta ? 'text' : 'password';
    icone.setAttribute('href', oculta ? '#i-olho-fechado' : '#i-olho');
    botao.setAttribute('aria-label', oculta ? 'Ocultar senha' : 'Mostrar senha');
    campo.focus();
  });
})();
