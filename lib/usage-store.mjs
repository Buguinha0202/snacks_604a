/**
 * Armazenamento persistente de estatísticas de uso (sem tokens ou dados sensíveis).
 * - Em produção na Vercel: usa Upstash Redis / Vercel KV via REST API (zero dependências)
 *   quando KV_REST_API_URL + KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL/TOKEN) estiverem definidos.
 * - Sem Redis configurado: mantém em memória (+ arquivo local quando gravável) para desenvolvimento/fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const LOCAL_STATS_FILE = path.join(ROOT_DIR, '.usage-stats.json');

const PREFIX = '604a:stats';
const KEY_SINCE = `${PREFIX}:since`;
const KEY_PAGE_LOADS = `${PREFIX}:pageLoads`;
const KEY_TOTAL_CLONES = `${PREFIX}:totalClones`;
const KEY_USERS = `${PREFIX}:users`;
const KEY_EVENTS = `${PREFIX}:events`;

const memStore = {
  startedAt: new Date().toISOString(),
  pageLoads: 0,
  totalClones: 0,
  users: {}, // username -> { connects, lastSeen, totalSnacks }
  events: [],
};

let localLoaded = false;
function loadLocalFileOnce() {
  if (localLoaded || process.env.VERCEL) return;
  localLoaded = true;
  try {
    if (fs.existsSync(LOCAL_STATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_STATS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        memStore.startedAt = parsed.startedAt || memStore.startedAt;
        memStore.pageLoads = Number(parsed.pageLoads) || 0;
        memStore.totalClones = Number(parsed.totalClones) || 0;
        memStore.users = parsed.users && typeof parsed.users === 'object' ? parsed.users : {};
        memStore.events = Array.isArray(parsed.events) ? parsed.events.slice(0, 50) : [];
      }
    }
  } catch {
    // Ignora falha de leitura local
  }
}

function saveLocalFile() {
  if (process.env.VERCEL) return;
  try {
    fs.writeFileSync(LOCAL_STATS_FILE, JSON.stringify(memStore, null, 2), 'utf8');
  } catch {
    // Ignora em sistema read-only
  }
}

function getRedisConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url, token };
}

async function redisPipeline(commands) {
  const cfg = getRedisConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    throw new Error(`Redis REST HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Resposta inesperada do Redis REST');
  return data;
}

function pushMemEvent(evento, extra) {
  memStore.events.unshift({ evento, ...extra, at: new Date().toISOString() });
  if (memStore.events.length > 50) memStore.events.length = 50;
}

export async function recordPageLoad() {
  loadLocalFileOnce();
  const now = new Date().toISOString();
  memStore.pageLoads += 1;
  pushMemEvent('site_aberto', {});
  saveLocalFile();

  const cfg = getRedisConfig();
  if (!cfg) return;
  try {
    await redisPipeline([
      ['SET', KEY_SINCE, now, 'NX'],
      ['INCR', KEY_PAGE_LOADS],
      ['LPUSH', KEY_EVENTS, JSON.stringify({ evento: 'site_aberto', at: now })],
      ['LTRIM', KEY_EVENTS, 0, 49],
    ]);
  } catch {
    // Não bloqueia o site se o Redis oscilar
  }
}

export async function recordAccountConnect(username, totalSnacks) {
  loadLocalFileOnce();
  const now = new Date().toISOString();
  const prev = memStore.users[username] || { connects: 0, lastSeen: '', totalSnacks: 0 };
  memStore.users[username] = {
    connects: prev.connects + 1,
    lastSeen: now,
    totalSnacks,
  };
  pushMemEvent('conta_conectada', { usuario: username, totalSnacks });
  saveLocalFile();

  const cfg = getRedisConfig();
  if (!cfg) return;
  try {
    const existingRes = await redisPipeline([['HGET', KEY_USERS, username]]);
    let redisPrev = { connects: 0, lastSeen: '', totalSnacks: 0 };
    const raw = existingRes?.[0]?.result;
    if (raw) {
      try {
        redisPrev = JSON.parse(raw) || redisPrev;
      } catch {
        // Segue padrão
      }
    }
    const updated = {
      connects: (Number(redisPrev.connects) || 0) + 1,
      lastSeen: now,
      totalSnacks,
    };
    await redisPipeline([
      ['SET', KEY_SINCE, now, 'NX'],
      ['HSET', KEY_USERS, username, JSON.stringify(updated)],
      ['LPUSH', KEY_EVENTS, JSON.stringify({ evento: 'conta_conectada', usuario: username, totalSnacks, at: now })],
      ['LTRIM', KEY_EVENTS, 0, 49],
    ]);
  } catch {
    // Não bloqueia o fluxo do aluno
  }
}

export async function recordSnacksCloned(clonedCount, skippedCount = 0, errorCount = 0) {
  loadLocalFileOnce();
  const now = new Date().toISOString();
  memStore.totalClones += clonedCount;
  pushMemEvent('snacks_clonados', { clonados: clonedCount, pulados: skippedCount, erros: errorCount });
  saveLocalFile();

  const cfg = getRedisConfig();
  if (!cfg) return;
  try {
    await redisPipeline([
      ['SET', KEY_SINCE, now, 'NX'],
      ['INCRBY', KEY_TOTAL_CLONES, clonedCount],
      [
        'LPUSH',
        KEY_EVENTS,
        JSON.stringify({ evento: 'snacks_clonados', clonados: clonedCount, pulados: skippedCount, erros: errorCount, at: now }),
      ],
      ['LTRIM', KEY_EVENTS, 0, 49],
    ]);
  } catch {
    // Não bloqueia o fluxo do aluno
  }
}

export async function getUsageStats() {
  loadLocalFileOnce();
  const cfg = getRedisConfig();
  if (cfg) {
    try {
      const res = await redisPipeline([
        ['GET', KEY_SINCE],
        ['GET', KEY_PAGE_LOADS],
        ['GET', KEY_TOTAL_CLONES],
        ['HGETALL', KEY_USERS],
        ['LRANGE', KEY_EVENTS, 0, 49],
      ]);

      const since = res?.[0]?.result || memStore.startedAt;
      const pageLoads = Number(res?.[1]?.result) || 0;
      const totalClones = Number(res?.[2]?.result) || 0;
      const rawUsers = res?.[3]?.result;
      const usuarios = [];

      if (Array.isArray(rawUsers)) {
        for (let i = 0; i < rawUsers.length; i += 2) {
          const usuario = rawUsers[i];
          try {
            const info = JSON.parse(rawUsers[i + 1]);
            usuarios.push({ usuario, ...info });
          } catch {
            // Ignora entrada inválida
          }
        }
      } else if (rawUsers && typeof rawUsers === 'object') {
        for (const [usuario, val] of Object.entries(rawUsers)) {
          try {
            const info = typeof val === 'string' ? JSON.parse(val) : val;
            usuarios.push({ usuario, ...info });
          } catch {
            // Ignora entrada inválida
          }
        }
      }

      usuarios.sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));

      const rawEvents = Array.isArray(res?.[4]?.result) ? res[4].result : [];
      const eventosRecentes = rawEvents
        .map((item) => {
          try {
            return typeof item === 'string' ? JSON.parse(item) : item;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return {
        persistente: true,
        armazenamento: 'upstash-redis',
        desde: since,
        aberturasDoSite: pageLoads,
        pessoasUnicasConectadas: usuarios.length,
        totalSnacksClonados: totalClones,
        usuarios,
        eventosRecentes,
      };
    } catch {
      // Cai pro fallback em memória se falhar
    }
  }

  const usuarios = Object.entries(memStore.users)
    .map(([usuario, info]) => ({ usuario, ...info }))
    .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));

  return {
    persistente: !process.env.VERCEL,
    armazenamento: process.env.VERCEL ? 'memoria-temporaria (configure Upstash Redis na Vercel)' : 'arquivo-local',
    desde: memStore.startedAt,
    aberturasDoSite: memStore.pageLoads,
    pessoasUnicasConectadas: usuarios.length,
    totalSnacksClonados: memStore.totalClones,
    usuarios,
    eventosRecentes: memStore.events,
  };
}
