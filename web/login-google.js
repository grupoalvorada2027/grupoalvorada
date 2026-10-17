// Botão de login do Google.
//
// O Google chama aoReceberLogin() com um token assinado. Mandamos esse token
// ao servidor por POST, onde ele é conferido. Nada é decidido aqui: este
// arquivo roda na máquina da pessoa e, portanto, não é confiável — ele só
// transporta.
(function () {
  'use strict';

  var area = document.getElementById('area-google');
  if (!area) return;

  var csrf = area.getAttribute('data-csrf');
  var aviso = document.getElementById('aviso-dinamico');

  var mensagens = {
    pendente: 'Seu acesso foi solicitado. Assim que um administrador liberar, você poderá entrar com esta conta.',
    expirado: 'A tentativa de login expirou. Recarregue a página e tente de novo.',
    bloqueado: 'Muitas tentativas seguidas. Aguarde 15 minutos antes de tentar de novo.',
    indisponivel: 'Login com Google ainda não está configurado.',
    falha: 'Não foi possível confirmar o login. Tente novamente.',
    rede: 'Sem resposta do servidor. Verifique a conexão e tente de novo.'
  };

  function mostrar(chave) {
    if (!aviso) return;
    aviso.textContent = mensagens[chave] || mensagens.falha;
    aviso.hidden = false;
    aviso.scrollIntoView({ block: 'nearest' });
  }

  function carregando(ligado) {
    area.classList.toggle('carregando', ligado);
  }

  window.aoReceberLogin = function (resposta) {
    if (!resposta || !resposta.credential) {
      mostrar('falha');
      return;
    }

    carregando(true);

    var corpo = new URLSearchParams();
    corpo.set('credential', resposta.credential);
    corpo.set('csrf', csrf);

    fetch('google-callback.php', {
      method: 'POST',
      body: corpo,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          // replace, e não href: o login não fica no histórico, então o botão
          // Voltar depois de sair não retorna para cá com o token na memória.
          window.location.replace(d.destino || 'index.php');
          return;
        }
        carregando(false);
        mostrar(d && d.aviso);
      })
      .catch(function () {
        carregando(false);
        mostrar('rede');
      });
  };
})();
