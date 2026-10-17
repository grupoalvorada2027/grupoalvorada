<?php
/**
 * Barra lateral, compartilhada entre as páginas autenticadas.
 *
 * Espera $usuario (de exigirLogin) e $pagina ('lucratividade' | 'usuarios').
 * O prefixo "_" faz o .htaccess recusar o acesso direto: é um pedaço de
 * página, não uma página.
 *
 * O link "Usuários" só aparece para administrador — mas esconder o link não é
 * a proteção: usuarios.php confere o papel no servidor de qualquer jeito.
 */
declare(strict_types=1);

$ativo = static fn (string $p): string => ($pagina ?? '') === $p ? ' ativo' : '';
?>
<svg width="0" height="0" class="sprite" aria-hidden="true">
  <defs>
    <symbol id="i-grafico" viewBox="0 0 24 24">
      <path d="M4 19.5h16"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/>
    </symbol>
    <symbol id="i-caixa" viewBox="0 0 24 24">
      <path d="M3.8 7.6 12 3.5l8.2 4.1v8.8L12 20.5l-8.2-4.1Z"/><path d="M3.8 7.6 12 11.7l8.2-4.1"/><path d="M12 11.7v8.8"/>
    </symbol>
    <symbol id="i-tabela" viewBox="0 0 24 24">
      <rect x="3.8" y="4.8" width="16.4" height="14.4" rx="2.4"/><path d="M3.8 9.8h16.4"/><path d="M9.6 9.8v9.4"/>
    </symbol>
    <symbol id="i-estoque" viewBox="0 0 24 24">
      <path d="M3.5 20V9.2L12 4l8.5 5.2V20"/><path d="M7.5 20v-6.5h9V20"/><path d="M7.5 17h9"/>
    </symbol>
    <symbol id="i-dinheiro" viewBox="0 0 24 24">
      <rect x="3" y="6.5" width="18" height="11" rx="2.4"/><circle cx="12" cy="12" r="2.4"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>
    </symbol>
    <symbol id="i-pessoas" viewBox="0 0 24 24">
      <circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 19.2c.7-3.2 3.2-5 6.2-5s5.5 1.8 6.2 5"/>
      <path d="M15.6 5.4a3.3 3.3 0 0 1 0 6.3"/><path d="M17.6 14.4c1.9.6 3.2 2.3 3.6 4.8"/>
    </symbol>
    <symbol id="i-sol" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>
    </symbol>
    <symbol id="i-receita" viewBox="0 0 24 24">
      <path d="M12 3.5v17"/><path d="M16.2 7.2c-.7-1.2-2.2-1.9-4.2-1.9-2.5 0-4.1 1.2-4.1 3s1.5 2.6 4.1 3.2c2.7.6 4.3 1.5 4.3 3.4s-1.8 3.2-4.4 3.2c-2.1 0-3.7-.8-4.4-2.2"/>
    </symbol>
    <symbol id="i-tendencia" viewBox="0 0 24 24">
      <path d="m3.5 16.5 5.6-5.6 3.8 3.8 7.6-7.6"/><path d="M15 7h5.5v5.5"/>
    </symbol>
    <symbol id="i-porcento" viewBox="0 0 24 24">
      <path d="M18.5 5.5l-13 13"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/>
    </symbol>
    <symbol id="i-etiqueta" viewBox="0 0 24 24">
      <path d="M3.8 12.6V4.8a1 1 0 0 1 1-1h7.8l7.6 7.6a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0Z"/><circle cx="8.3" cy="8.3" r="1.3"/>
    </symbol>
    <symbol id="i-trofeu" viewBox="0 0 24 24">
      <path d="M7.5 4h9v5.5a4.5 4.5 0 0 1-9 0Z"/><path d="M7.5 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16.5 6h3v1.5A3.5 3.5 0 0 1 16 11"/><path d="M12 14v3.5"/><path d="M8.5 20.5h7"/>
    </symbol>
    <symbol id="i-seta-cima" viewBox="0 0 24 24">
      <path d="M12 19V5.5"/><path d="M6.5 11 12 5.5 17.5 11"/>
    </symbol>
    <symbol id="i-exclamacao" viewBox="0 0 24 24">
      <path d="M12 5v9"/><path d="M12 18.6h.01"/>
    </symbol>
    <symbol id="i-info" viewBox="0 0 24 24">
      <path d="M12 10.5v8"/><path d="M12 5.8h.01"/>
    </symbol>
    <symbol id="i-perfil" viewBox="0 0 24 24">
      <circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20c.9-3.6 3.8-5.6 7.2-5.6s6.3 2 7.2 5.6"/>
    </symbol>
    <symbol id="i-sair" viewBox="0 0 24 24">
      <path d="M14.5 4.5h3.2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3.2"/><path d="M10 16.5 5.5 12 10 7.5"/><path d="M5.5 12H15"/>
    </symbol>
  </defs>
</svg>

<nav class="lateral" aria-label="Navegação principal">
  <div class="marca-topo">
    <div class="marca-icone"><img src="logo-casa.png" alt="" width="134" height="95"></div>
    <div>
      <div class="marca-nome">Grupo Alvorada</div>
      <div class="marca-sub">Inteligência de vendas</div>
    </div>
  </div>

  <div class="menu">
    <div class="menu-grupo">Vendas</div>
    <a class="menu-item<?= $ativo('lucratividade') ?>" href="index.php">
      <svg class="icone" aria-hidden="true"><use href="#i-grafico"/></svg> Lucratividade
    </a>
    <span class="menu-item desabilitado">
      <svg class="icone" aria-hidden="true"><use href="#i-caixa"/></svg> Produtos <span class="menu-tag">em breve</span>
    </span>
    <span class="menu-item desabilitado">
      <svg class="icone" aria-hidden="true"><use href="#i-tabela"/></svg> Tabela dinâmica <span class="menu-tag">em breve</span>
    </span>

    <div class="menu-grupo">Estoque</div>
    <span class="menu-item desabilitado">
      <svg class="icone" aria-hidden="true"><use href="#i-estoque"/></svg> Estoque <span class="menu-tag">em breve</span>
    </span>

    <div class="menu-grupo">Financeiro</div>
    <span class="menu-item desabilitado">
      <svg class="icone" aria-hidden="true"><use href="#i-dinheiro"/></svg> Fluxo de caixa <span class="menu-tag">em breve</span>
    </span>

    <div class="menu-grupo">Conta</div>
    <a class="menu-item<?= $ativo('conta') ?>" href="conta.php">
      <svg class="icone" aria-hidden="true"><use href="#i-perfil"/></svg> Minha conta
    </a>

    <?php if (($usuario['papel'] ?? '') === 'admin'): ?>
      <div class="menu-grupo">Administração</div>
      <a class="menu-item<?= $ativo('usuarios') ?>" href="usuarios.php">
        <svg class="icone" aria-hidden="true"><use href="#i-pessoas"/></svg> Usuários
      </a>
    <?php endif; ?>
  </div>
</nav>
