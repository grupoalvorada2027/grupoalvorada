<?php
/**
 * Segredos do painel. NAO VAI PARA O GIT (bloqueado no .gitignore).
 *
 * Aqui ficam as credenciais que nao podem entrar no repositorio: os hashes das
 * senhas dos usuarios e a chave compartilhada da ponte OAuth. O resto do codigo
 * e publico e pode ser versionado sem risco.
 *
 * Ao publicar o painel numa hospedagem nova, copie o config.exemplo.php para
 * config.php e preencha. Gere os hashes com gerar-senha.php.
 */

declare(strict_types=1);

// Precisa ser IDENTICA a OAUTH_PONTE_CHAVE do .env do servidor.
const PONTE_CHAVE = 'COLE_AQUI_O_VALOR_DE_OAUTH_PONTE_CHAVE';

// Segredo deste servidor, usado para amarrar a sessao ao aparelho de quem
// entrou. Trocar este valor derruba todas as sessoes abertas - util se houver
// suspeita de vazamento.
const CHAVE_SESSAO = 'GERE_UM_VALOR_ALEATORIO_DE_64_CARACTERES';

// Senha do primeiro administrador. Usada UMA vez, por instalar.php, e depois
// pode ser apagada daqui.
const SENHA_PRIMEIRO_ADMIN = 'DEFINA_UMA_SENHA_FORTE_E_APAGUE_DEPOIS';
const EMAIL_PRIMEIRO_ADMIN = 'grupo.alvorada2027@gmail.com';
const NOME_PRIMEIRO_ADMIN  = 'Felipe';
