<?php
/**
 * Callback do OAuth do Bling no caminho cadastrado no aplicativo:
 *   https://grupoalvorada1029.com.br/painel/oauth-callback.php
 *
 * O app Bling foi cadastrado com /painel/ no endereço. Este arquivo só repassa
 * para a implementação na raiz, que usa __DIR__ da própria pasta para achar o
 * config.php e o arquivo de troca - então nada é duplicado.
 */
require __DIR__ . '/../oauth-callback.php';
