/**
 * Expo Snack Cloner Studio — Entrypoint Unificado (Vercel + Servidor Local).
 * - Na Vercel: exporta `default async function handler(req, res)` atendendo `/api/*` e `/`
 * - Localmente (`node server.mjs` ou `iniciar.bat`): sobe servidor HTTP em http://localhost:3456
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest, sendError } from './lib/api-handler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3456);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, 'FORBIDDEN', 'Acesso negado.');
    return;
  }

  try {
    const content = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch {
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    sendError(res, 404, 'NOT_FOUND', 'Recurso não encontrado.');
  }
}

export default async function handler(req, res) {
  try {
    const handled = await handleApiRequest(req, res);
    if (handled) return;

    const urlObj = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, urlObj.pathname);
      return;
    }

    sendError(res, 404, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${urlObj.pathname} não encontrada.`);
  } catch (err) {
    sendError(res, 500, 'SERVER_ERROR', err?.message || 'Erro interno no servidor.');
  }
}

export function createAppServer() {
  return http.createServer(handler);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun && !process.env.VERCEL) {
  const server = createAppServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  ======================================================');
    console.log('   Expo Snack Cloner Studio — Pronto para uso!');
    console.log(`   Acesse no navegador: http://localhost:${PORT}`);
    console.log('   Pressione Ctrl + C para encerrar.');
    console.log('  ======================================================');
    console.log('');
  });
}
