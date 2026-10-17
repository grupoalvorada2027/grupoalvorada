// Ponte do retorno do Google.
//
// O Google devolve o resultado do login depois do "#" da URL (response_mode=
// fragment). Essa parte nunca vai ao servidor, e é por isso que o ModSecurity
// da HostGator deixa de bloquear o retorno: entre os parâmetros está
// iss=https://accounts.google.com, e o firewall recusa valores que começam com
// https://.
//
// Aqui lemos o fragmento e reenviamos ao servidor apenas o necessário: code e
// state (ou error, se a pessoa cancelou). O iss não precisa ir — ele também
// vem dentro do token assinado e é conferido lá.
//
// location.replace troca a entrada do histórico: o código não fica guardado
// para ser reaberto pelo botão Voltar.
(function () {
  'use strict';

  var fragmento = new URLSearchParams(window.location.hash.slice(1));
  var destino = new URLSearchParams();

  ['code', 'state', 'error'].forEach(function (chave) {
    var valor = fragmento.get(chave);
    if (valor) destino.set(chave, valor);
  });

  if (!destino.has('state')) {
    window.location.replace('login.php?aviso=falha');
    return;
  }

  destino.set('retorno', '1');
  window.location.replace('google-callback.php?' + destino.toString());
})();
