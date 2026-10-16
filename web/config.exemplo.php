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

const USUARIOS = [
    'felipe' => [
        // Senha inicial: trocar no primeiro acesso usando gerar-senha.php
        'hash'  => 'COLE_AQUI_O_HASH_GERADO_EM_gerar-senha.php',
        'nome'  => 'Felipe',
        'papel' => 'admin',
    ],
];
