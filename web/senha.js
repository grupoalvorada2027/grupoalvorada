// Indicador de força da senha, enquanto a pessoa digita.
//
// É só orientação visual: a regra que vale é a do servidor, em
// problemaNaSenha(). Medir aqui não protege nada — qualquer um poderia desligar
// este arquivo — mas evita que a pessoa só descubra o problema ao enviar.
(function () {
  'use strict';

  var campo = document.getElementById('nova');
  var caixa = document.getElementById('forca');
  var nivel = document.getElementById('forca-nivel');
  var texto = document.getElementById('forca-texto');
  if (!campo || !caixa) return;

  var COMUNS = ['senha', 'password', '123456', 'qwerty', 'alvorada', 'admin', 'abc123', 'teste'];

  function avaliar(s) {
    if (!s) return { p: 0, r: '' };

    var classes = (/[a-z]/.test(s) ? 1 : 0) + (/[A-Z]/.test(s) ? 1 : 0) +
                  (/\d/.test(s) ? 1 : 0) + (/[^A-Za-z0-9]/.test(s) ? 1 : 0);
    var baixo = s.toLowerCase();

    for (var i = 0; i < COMUNS.length; i++) {
      if (baixo.indexOf(COMUNS[i]) !== -1) return { p: 1, r: 'Contém uma sequência muito comum' };
    }
    if (/(.)\1{3,}/.test(s)) return { p: 1, r: 'Muitos caracteres repetidos' };
    if (s.length < 12) return { p: 1, r: 'Curta demais: mínimo de 12 caracteres' };
    if (classes < 3) return { p: 2, r: 'Combine pelo menos três tipos de caractere' };
    if (s.length < 16) return { p: 3, r: 'Boa' };
    return { p: 4, r: 'Muito boa' };
  }

  campo.addEventListener('input', function () {
    var r = avaliar(campo.value);
    caixa.hidden = campo.value.length === 0;
    nivel.className = 'nivel-' + r.p;
    nivel.style.width = (r.p * 25) + '%';
    texto.textContent = r.r;
  });
})();
