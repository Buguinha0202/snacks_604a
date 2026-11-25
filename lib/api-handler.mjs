/**
 * Handler compartilhado das rotas /api/* — funciona tanto no servidor local (server.mjs)
 * quanto em função Serverless na Vercel (api/index.mjs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchAuthenticatedAccountSnacks,
  fetchSnackDetail,
  saveSnackToAccount,
  mapWithConcurrency,
} from './expo-api.mjs';
import { compareSnackLists, diffLines } from './matcher.mjs';
import { loadLegacyCatalogFromDir, parseRawInput } from './catalog-importer.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const BUNDLED_CATALOG = path.join(ROOT_DIR, 'data', 'catalogo-604a.json');
const CACHE_FILE = path.join(ROOT_DIR, 'cache-catalogo.json');

export function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

export function sendError(res, status, code, message, details = null) {
  sendJson(res, status, {
    error: {
      code,
      message,
      status,
      ...(details ? { details } : {}),
    },
  });
}

async function readJsonBody(req, maxBytes = 15 * 1024 * 1024) {
  // Na Vercel, req.body pode já vir parseado
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload excede o limite permitido (15 MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', reject);
  });
}

function loadBundledCatalog() {
  try {
    if (!fs.existsSync(BUNDLED_CATALOG)) return null;
    const data = JSON.parse(fs.readFileSync(BUNDLED_CATALOG, 'utf8'));
    if (Array.isArray(data.snacks) && data.snacks.length > 0) {
      return {
        found: true,
        fileName: 'data/catalogo-604a.json',
        withCode: data.withCode ?? data.snacks.length,
        snacks: data.snacks,
      };
    }
  } catch {
    // Fallback para catálogo legado
  }
  return null;
}

async function loadAndHydrateCatalog() {
  const bundled = loadBundledCatalog();
  if (bundled) return bundled;

  const legacy = loadLegacyCatalogFromDir(ROOT_DIR);
  if (!legacy.found || !legacy.snacks.length) return legacy;

  let cache = {};
  try {
    if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
  } catch {
    cache = {};
  }

  let cacheDirty = false;
  const snacks = legacy.snacks.map((item) => {
    const hasCode = (item.files && Object.keys(item.files).length > 0) || Boolean(item.code && item.code.trim());
    if (hasCode) return item;
    const cached = item.origemUrl ? cache[item.origemUrl] : null;
    if (cached && cached.files && Object.keys(cached.files).length > 0) {
      return {
        ...item,
        files: cached.files,
        dependencies: cached.dependencies || item.dependencies || {},
        sdkVersion: cached.sdkVersion || item.sdkVersion || '54.0.0',
        description: cached.description || item.description || '',
        fileCount: Object.keys(cached.files).length,
      };
    }
    return item;
  });

  const missing = snacks
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => !(item.files && Object.keys(item.files).length > 0) && item.origemUrl);

  if (missing.length > 0) {
    await mapWithConcurrency(missing, 6, async ({ item, idx }) => {
      try {
        const detail = await fetchSnackDetail(item.origemUrl);
        if (detail.files && Object.keys(detail.files).length > 0) {
          snacks[idx] = {
            ...item,
            files: detail.files,
            dependencies: detail.dependencies || {},
            sdkVersion: detail.sdkVersion || item.sdkVersion || '54.0.0',
            description: detail.description || '',
            fileCount: detail.fileCount,
          };
          cache[item.origemUrl] = {
            files: detail.files,
            dependencies: detail.dependencies || {},
            sdkVersion: detail.sdkVersion || '54.0.0',
            description: detail.description || '',
            cachedAt: new Date().toISOString(),
          };
          cacheDirty = true;
        }
      } catch {
        // Segue sem interromper
      }
    });
  }

  if (cacheDirty) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      // Ambiente read-only (serverless) ignora gravação em disco
    }
  }

  const withCode = snacks.filter(
    (s) => (s.files && Object.keys(s.files).length > 0) || Boolean(s.code && s.code.trim())
  ).length;

  return { ...legacy, withCode, snacks };
}

/**
 * Trata qualquer rota /api/*. Retorna `true` se tratou a rota, ou `false` se não for rota de API.
 */
export async function handleApiRequest(req, res) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const { pathname } = urlObj;

  if (!pathname.startsWith('/api/')) return false;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'expo-snack-cloner-studio', version: '1.1.0' });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/legacy-catalog') {
      const result = await loadAndHydrateCatalog();
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/parse-input') {
      const body = await readJsonBody(req);
      sendJson(res, 200, parseRawInput(body.raw || ''));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/account/snacks') {
      const body = await readJsonBody(req);
      const auth = body.auth || body.token;
      if (!auth) {
        sendError(res, 400, 'AUTH_REQUIRED', 'Informe seu Expo Access Token ou Session Secret.');
        return true;
      }
      const includeCode = body.includeCode !== false;
      const result = await fetchAuthenticatedAccountSnacks(auth, { includeCode });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/snacks/resolve') {
      const body = await readJsonBody(req);
      const items = Array.isArray(body.snacks) ? body.snacks : [];
      if (items.length === 0) {
        sendError(res, 400, 'EMPTY_LIST', 'Envie ao menos um Snack com URL ou referência.');
        return true;
      }

      const resolved = await mapWithConcurrency(items, 6, async (item) => {
        const ref = item.origemUrl || item.url || item.fullName;
        if (!ref) return { ...item, _resolveStatus: 'skipped' };
        try {
          const detail = await fetchSnackDetail(ref);
          return {
            ...item,
            ...detail,
            name: item.name || item.nome || detail.name,
            nome: item.nome || item.name || detail.name,
            apelidos: item.apelidos || [],
            _resolveStatus: 'ok',
          };
        } catch (err) {
          return { ...item, _resolveStatus: 'error', _resolveError: err.message };
        }
      });

      sendJson(res, 200, {
        total: resolved.length,
        resolvedOk: resolved.filter((x) => x._resolveStatus === 'ok').length,
        snacks: resolved,
      });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/compare') {
      const body = await readJsonBody(req);
      const source = Array.isArray(body.source) ? body.source : [];
      const target = Array.isArray(body.target) ? body.target : [];
      sendJson(res, 200, compareSnackLists(source, target));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/diff') {
      const body = await readJsonBody(req);
      sendJson(res, 200, { lines: diffLines(body.left || '', body.right || '') });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/clone') {
      const body = await readJsonBody(req);
      const auth = body.auth || body.token;
      const snacksToClone = Array.isArray(body.snacks) ? body.snacks : [];
      const existingTargetSnacks = Array.isArray(body.existingTargetSnacks) ? body.existingTargetSnacks : [];
      const skipDuplicates = body.skipDuplicates !== false;
      const dryRun = Boolean(body.dryRun);

      if (!auth && !dryRun) {
        sendError(res, 400, 'AUTH_REQUIRED', 'Informe seu Expo Access Token ou Session Secret para clonar.');
        return true;
      }
      if (snacksToClone.length === 0) {
        sendError(res, 400, 'EMPTY_LIST', 'Nenhum Snack selecionado para clonagem.');
        return true;
      }

      const { results: checkResults } = compareSnackLists(snacksToClone, existingTargetSnacks);
      const report = [];
      const clonedSessionSet = new Set();

      for (let i = 0; i < snacksToClone.length; i++) {
        const item = snacksToClone[i];
        const check = checkResults[i];
        const itemName = item.name || item.nome || `Snack ${i + 1}`;
        const dedupeKey = itemName.toLowerCase().trim();

        if (skipDuplicates && check.shouldSkipClone) {
          report.push({
            index: i,
            name: itemName,
            status: 'skipped_duplicate',
            reason: check.reason,
            matchStatus: check.status,
          });
          continue;
        }

        if (clonedSessionSet.has(dedupeKey)) {
          report.push({
            index: i,
            name: itemName,
            status: 'skipped_duplicate',
            reason: 'Duplicata dentro da própria fila de clonagem',
          });
          continue;
        }

        if (dryRun) {
          clonedSessionSet.add(dedupeKey);
          report.push({
            index: i,
            name: itemName,
            status: 'would_clone',
            reason: 'Simulação (dry-run): pronto para ser clonado',
          });
          continue;
        }

        try {
          const saved = await saveSnackToAccount(item, auth);
          clonedSessionSet.add(dedupeKey);
          report.push({
            index: i,
            name: saved.name,
            status: 'cloned',
            url: saved.url,
            id: saved.id,
            savedToAccount: saved.savedToAccount,
            warning: saved.savedToAccount
              ? null
              : 'Salvo no Expo, mas retornou ID anônimo. Para vincular ao seu @usuario, verifique as permissões do token.',
          });
        } catch (err) {
          report.push({
            index: i,
            name: itemName,
            status: 'error',
            error: err.message,
          });
        }
      }

      const summary = {
        total: report.length,
        cloned: report.filter((r) => r.status === 'cloned').length,
        wouldClone: report.filter((r) => r.status === 'would_clone').length,
        skipped: report.filter((r) => r.status === 'skipped_duplicate').length,
        errors: report.filter((r) => r.status === 'error').length,
      };

      sendJson(res, 200, { summary, report });
      return true;
    }

    sendError(res, 404, 'ROUTE_NOT_FOUND', `Rota ${req.method} ${pathname} não encontrada.`);
    return true;
  } catch (err) {
    sendError(res, 500, 'INTERNAL_ERROR', err.message || 'Erro interno no servidor.');
    return true;
  }
}
