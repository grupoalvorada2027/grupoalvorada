/**
 * Servidor estatico minimo para pre-visualizar o painel sem publicar.
 * Nao vai para producao: a hospedagem serve os arquivos sozinha.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const RAIZ = join(process.cwd(), 'web');
const PORTA = Number(process.env.PORTA ?? 8080);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const caminho = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let arquivo = join(RAIZ, caminho === '/' ? 'index.html' : caminho);

    // Impede sair da pasta web via ../
    if (!arquivo.startsWith(RAIZ)) {
      res.writeHead(403).end('Proibido');
      return;
    }

    const info = await stat(arquivo).catch(() => null);
    if (info?.isDirectory()) arquivo = join(arquivo, 'index.html');

    const conteudo = await readFile(arquivo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nao encontrado');
  }
}).listen(PORTA, () => {
  console.log(`Painel em http://localhost:${PORTA}`);
});
