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
import CATALOGO_604A from '../data/catalogo-604a.mjs';
import {
  recordPageLoad,
  recordAccountConnect,
  recordSnacksCloned,
  getUsageStats,
} from './usage-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const CACHE_FILE = path.join(ROOT_DIR, 'cache-catalogo.json');
const STATS_KEY = process.env.STATS_KEY || 'buu604a';

function trackEvent(evento, extra = {}) {
  console.log(JSON.stringify({ tag: 'USO-604A', evento, ...extra, at: new Date().toISOString() }));
}

function escapeHtmlBasic(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStatsHtml(stats) {
  const formatDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch {
      return iso;
    }
  };
  const userRows = stats.usuarios.length
    ? stats.usuarios
        .map(
          (u) => `<tr>
            <td><strong>@${escapeHtmlBasic(u.usuario)}</strong></td>
            <td>${Number(u.connects) || 0}</td>
            <td>${Number(u.totalSnacks) || 0}</td>
            <td>${escapeHtmlBasic(formatDate(u.lastSeen))}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="4" style="color:#94a3b8;text-align:center;">Nenhum aluno conectou ainda desde o início da contagem.</td></tr>';

  const eventRows = (stats.eventosRecentes || []).slice(0, 20)
    .map((ev) => {
      const detail = ev.usuario
        ? `@${escapeHtmlBasic(ev.usuario)} (${ev.totalSnacks ?? 0} snacks)`
        : ev.clonados != null
          ? `${ev.clonados} clonado(s), ${ev.pulados ?? 0} pulado(s)`
          : 'Abertura da página';
      return `<li><span class="ev-tag">${escapeHtmlBasic(ev.evento)}</span> ${detail} <span class="ev-time">${escapeHtmlBasic(formatDate(ev.at))}</span></li>`;
    })
    .join('');

  const warnBox = stats.persistente
    ? `<div class="ok-box">✓ Armazenamento persistente ativo (${escapeHtmlBasic(stats.armazenamento)}). Os dados não somem quando a Vercel dorme.</div>`
    : `<div class="warn-box">⚠️ Modo temporário em memória. Para nunca zerar na Vercel: abra o projeto na Vercel → aba <b>Storage</b> → <b>Create Database</b> → <b>Upstash Redis</b> (grátis) e conecte ao projeto (faz redeploy e pronto).</div>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Estatísticas — Painel 604A</title>
  <style>
    body{margin:0;padding:24px 16px;background:#0b0e14;color:#f1f5f9;font-family:system-ui,-apple-system,sans-serif}
    .wrap{max-width:860px;margin:0 auto}
    h1{margin:0 0 6px;font-size:1.4rem}
    .sub{color:#94a3b8;font-size:.88rem;margin-bottom:16px}
    .ok-box,.warn-box{padding:12px 14px;border-radius:10px;font-size:.86rem;margin-bottom:16px;line-height:1.45}
    .ok-box{background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.45);color:#6ee7b7}
    .warn-box{background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.45);color:#fcd34d}
    .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:18px}
    .kpi{background:#151a24;border:1px solid #2c3549;border-radius:12px;padding:14px}
    .kpi span{display:block;color:#94a3b8;font-size:.78rem;margin-bottom:4px}
    .kpi strong{font-size:1.6rem}
    .card{background:#151a24;border:1px solid #2c3549;border-radius:12px;padding:16px;margin-bottom:16px;overflow-x:auto}
    h2{margin:0 0 12px;font-size:1rem}
    table{width:100%;border-collapse:collapse;font-size:.88rem}
    th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #242c3d}
    th{color:#94a3b8;font-weight:600}
    ul{margin:0;padding-left:18px;font-size:.84rem;color:#cbd5e1;display:flex;flex-direction:column;gap:6px}
    .ev-tag{background:#1e293b;padding:2px 7px;border-radius:6px;font-family:monospace;font-size:.78rem;color:#93c5fd}
    .ev-time{color:#64748b;font-size:.78rem;margin-left:6px}
  </style></head><body><div class="wrap">
    <h1>📊 Acessos — Painel Turma 604A</h1>
    <div class="sub">Contando desde: ${escapeHtmlBasic(formatDate(stats.desde))} · <a href="?key=${encodeURIComponent(STATS_KEY)}&format=json" style="color:#818cf8">Ver JSON</a></div>
    ${warnBox}
    <div class="kpis">
      <div class="kpi"><span>Aberturas do site</span><strong>${stats.aberturasDoSite}</strong></div>
      <div class="kpi"><span>Pessoas únicas (@expo)</span><strong>${stats.pessoasUnicasConectadas}</strong></div>
      <div class="kpi"><span>Snacks clonados</span><strong>${stats.totalSnacksClonados}</strong></div>
    </div>
    <div class="card"><h2>Alunos que conectaram</h2>
      <table><thead><tr><th>Usuário Expo</th><th>Conexões</th><th>Snacks na conta</th><th>Último acesso</th></tr></thead><tbody>${userRows}</tbody></table>
    </div>
    <div class="card"><h2>Últimos eventos</h2><ul>${eventRows || '<li style="color:#94a3b8;">Sem eventos ainda.</li>'}</ul></div>
  </div></body></html>`;
}

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
  if (CATALOGO_604A && Array.isArray(CATALOGO_604A.snacks) && CATALOGO_604A.snacks.length > 0) {
    return {
      found: true,
      fileName: 'data/catalogo-604a.mjs',
      withCode: CATALOGO_604A.withCode ?? CATALOGO_604A.snacks.length,
      snacks: CATALOGO_604A.snacks,
    };
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

    if (req.method === 'GET' && pathname === '/api/stats') {
      const key = urlObj.searchParams.get('key');
      if (key !== STATS_KEY) {
        sendError(res, 404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.');
        return true;
      }
      const stats = await getUsageStats();
      const wantsJson = urlObj.searchParams.get('format') === 'json';
      const acceptsHtml = String(req.headers?.accept || '').includes('text/html');
      if (acceptsHtml && !wantsJson) {
        const html = renderStatsHtml(stats);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return true;
      }
      sendJson(res, 200, stats);
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/legacy-catalog') {
      await recordPageLoad();
      trackEvent('site_aberto');
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
      await recordAccountConnect(result.username, result.snacks.length);
      trackEvent('conta_conectada', { usuario: result.username, totalSnacks: result.snacks.length });
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
          const saved = await saveSnackToAccount(item, auth, {
            overrideName: item.overrideName || null,
          });
          clonedSessionSet.add(dedupeKey);
          report.push({
            index: i,
            name: saved.name,
            status: item.overrideName ? 'updated' : 'cloned',
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
        cloned: report.filter((r) => r.status === 'cloned' || r.status === 'updated').length,
        updated: report.filter((r) => r.status === 'updated').length,
        wouldClone: report.filter((r) => r.status === 'would_clone').length,
        skipped: report.filter((r) => r.status === 'skipped_duplicate').length,
        errors: report.filter((r) => r.status === 'error').length,
      };

      if (!dryRun && summary.cloned > 0) {
        await recordSnacksCloned(summary.cloned, summary.skipped, summary.errors);
        trackEvent('snacks_clonados', { clonados: summary.cloned, pulados: summary.skipped, erros: summary.errors });
      }

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
