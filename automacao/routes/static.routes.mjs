import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

/**
 * Despachante modular para arquivos estáticos da interface web.
 * Evita repetição de rotas manuais e garante proteção contra path traversal.
 * 
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, send: Function }} ctx
 * @returns {Promise<boolean>}
 */
export async function handleStaticRoutes(req, res, { root, send }) {
  if (req.method !== 'GET') return false;

  const url = new URL(req.url, 'http://127.0.0.1');
  let pathname = url.pathname;

  if (pathname === '/' || pathname === '/login') {
    pathname = '/ui/index.html';
  } else if (pathname === '/favicon.ico') {
    pathname = '/ui/jb-favicon.svg';
  }

  // Apenas arquivos dentro do diretório /ui/ são servidos
  if (!pathname.startsWith('/ui/')) return false;

  // Proteção contra path traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(root, safePath);

  // Garante que o arquivo resolvido reside estritamente dentro da pasta ui
  const uiDir = path.join(root, 'ui');
  if (!filePath.startsWith(uiDir)) return false;

  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.readFile(filePath);
    send(res, 200, content, contentType);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      send(res, 404, { error: 'Arquivo estático não encontrado' });
      return true;
    }
    throw err;
  }
}
