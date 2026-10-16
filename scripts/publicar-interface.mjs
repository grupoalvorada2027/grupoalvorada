#!/usr/bin/env node
/**
 * Envia os arquivos do painel (HTML, CSS, JS, PHP, .htaccess) para a hospedagem.
 *
 * Separado do worker de proposito: o worker exige uma empresa ja autorizada no
 * Bling para subir, e a interface precisa estar publicada ANTES disso - e a
 * pagina oauth-callback.php que torna a autorizacao possivel.
 *
 * Uso: npm run publicar:interface
 */
import 'dotenv/config';
import { Client } from 'basic-ftp';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const RAIZ = join(process.cwd(), 'web');

const host = process.env.FTP_HOST;
const user = process.env.FTP_USER;
const senha = process.env.FTP_SENHA;
const dir = process.env.FTP_DIR ?? '/public_html/painel';
const seguro = (process.env.FTP_SEGURO ?? 'true') !== 'false';

if (!host || !user || !senha) {
  console.error('Faltam FTP_HOST, FTP_USER ou FTP_SENHA no .env');
  process.exit(1);
}

async function listarArquivos(pasta) {
  const itens = await readdir(pasta, { withFileTypes: true });
  const arquivos = [];
  for (const item of itens) {
    const caminho = join(pasta, item.name);
    if (item.isDirectory()) {
      arquivos.push(...(await listarArquivos(caminho)));
    } else {
      arquivos.push(caminho);
    }
  }
  return arquivos;
}

const cliente = new Client(30_000);
cliente.ftp.verbose = false;

try {
  console.log(`Conectando em ${host} como ${user}...`);
  await cliente.access({
    host,
    user,
    password: senha,
    secure: seguro,
    // A HostGator usa o certificado do servidor compartilhado, que nao casa com
    // o hostname. O canal segue criptografado; so nao exigimos o casamento.
    secureOptions: { rejectUnauthorized: false },
  });

  console.log(`Conectado (${seguro ? 'FTPS' : 'FTP simples'}).`);

  // Contas de FTP do cPanel ficam presas ao proprio diretorio: ao entrar, o
  // usuario ja esta na pasta configurada. Nesse caso um caminho absoluto como
  // /public_html/painel simplesmente nao existe para ela. Descobrimos onde
  // estamos antes de tentar navegar.
  const raizDaConta = await cliente.pwd();
  console.log(`Diretorio inicial da conta: ${raizDaConta}`);

  const conteudoRaiz = await cliente.list();
  console.log(
    `Conteudo: ${conteudoRaiz.map((i) => i.name).join(', ') || '(vazio)'}`,
  );

  // Se o destino configurado existir, usamos. Se nao, ficamos onde a conta
  // abriu - que para uma conta restrita ja e a pasta certa.
  let destinoFinal = raizDaConta;
  if (dir && dir !== '/' && dir !== raizDaConta) {
    try {
      await cliente.cd(dir);
      destinoFinal = await cliente.pwd();
    } catch {
      console.log(
        `Aviso: ${dir} nao existe nesta conta. Publicando em ${raizDaConta}, ` +
          `que ja e a pasta a que a conta esta restrita.`,
      );
      await cliente.cd(raizDaConta);
      destinoFinal = raizDaConta;
    }
  }
  console.log(`Destino: ${destinoFinal}\n`);

  const arquivos = await listarArquivos(RAIZ);
  let enviados = 0;
  let bytes = 0;

  for (const arquivo of arquivos) {
    const destino = relative(RAIZ, arquivo).split('\\').join('/');
    const info = await stat(arquivo);

    // Subpasta: cria pelo caminho RELATIVO ao destino e volta para ele. Nunca
    // caminho absoluto - foi assim que nasceu a pasta aninhada
    // public_html/painel/public_html/painel que o site não servia.
    const barra = destino.lastIndexOf('/');
    if (barra > 0) {
      await cliente.ensureDir(destino.slice(0, barra));
      await cliente.uploadFrom(arquivo, destino.slice(barra + 1));
      await cliente.cd(destinoFinal);
    } else {
      await cliente.uploadFrom(arquivo, destino);
    }
    enviados += 1;
    bytes += info.size;
    console.log(`  enviado  ${destino}  (${Math.round(info.size / 1024)} KB)`);
  }

  console.log(`\n${enviados} arquivos, ${Math.round(bytes / 1024)} KB no total.`);
} catch (erro) {
  console.error('\nFalha ao publicar:', erro.message);
  if (String(erro.message).includes('530')) {
    console.error('Erro 530 e autenticacao: confira FTP_USER e FTP_SENHA.');
  }
  process.exit(1);
} finally {
  cliente.close();
}
