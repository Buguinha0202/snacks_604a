/**
 * Cliente oficial/compatível para leitura e clonagem de Expo Snacks.
 * - Lista Snacks da conta autenticada via https://api.expo.dev/graphql
 * - Lê detalhes completos (todos os arquivos, assets e dependências) via https://exp.host/--/api/v2/snack/<ref>
 * - Salva/clona Snacks via https://exp.host/--/api/v2/snack/save
 *
 * SEGURANÇA: Tokens/sessões são usados apenas em memória durante a requisição e nunca gravados em disco ou log.
 */

const EXPO_GRAPHQL_URL = 'https://api.expo.dev/graphql';
const SNACK_API_BASE = 'https://exp.host/--/api/v2/snack';
const SNACK_API_VERSION = '3.0.0';

/**
 * Monta headers de autenticação suportando Expo Access Token (Bearer) ou Expo-Session (sessionSecret).
 */
export function buildAuthHeaders(auth) {
  const headers = {};
  if (!auth) return headers;

  const raw = typeof auth === 'string' ? auth.trim() : String(auth.token || auth.sessionSecret || '').trim();
  if (!raw) return headers;

  const explicitType = typeof auth === 'object' ? auth.type : null;
  const looksLikeSession =
    explicitType === 'session' ||
    raw.startsWith('{') ||
    raw.includes('sessionSecret');

  if (looksLikeSession) {
    headers['Expo-Session'] = raw;
  } else {
    headers['Authorization'] = raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
  }
  return headers;
}

/**
 * Normaliza uma referência de Snack (URL completa ou @user/slug ou hashId) para o caminho da API.
 */
export function extractSnackRef(urlOrRef) {
  const s = String(urlOrRef || '').trim();
  if (!s) return '';
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      return u.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    } catch {
      return '';
    }
  }
  return s.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Busca os detalhes completos de um Snack público (todos os arquivos, assets, dependências e manifest).
 */
export async function fetchSnackDetail(urlOrRef, auth = null) {
  const ref = extractSnackRef(urlOrRef);
  if (!ref) {
    throw new Error('Referência de Snack inválida.');
  }

  const res = await fetch(`${SNACK_API_BASE}/${ref}`, {
    headers: {
      'Snack-Api-Version': SNACK_API_VERSION,
      ...buildAuthHeaders(auth),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao buscar Snack "${ref}" (HTTP ${res.status}): ${body.slice(0, 160)}`);
  }

  const data = await res.json();
  const files = data.code && typeof data.code === 'object' ? data.code : {};
  const manifest = data.manifest || {};
  const dependencies = {};

  if (data.dependencies && typeof data.dependencies === 'object') {
    for (const [pkg, info] of Object.entries(data.dependencies)) {
      if (typeof info === 'string') dependencies[pkg] = { version: info };
      else if (info && typeof info === 'object') {
        dependencies[pkg] = { version: info.version || info.wantedVersion || '*' };
      }
    }
  } else if (manifest.dependencies && typeof manifest.dependencies === 'object') {
    for (const [pkg, ver] of Object.entries(manifest.dependencies)) {
      dependencies[pkg] = { version: typeof ver === 'string' ? ver : ver?.version || '*' };
    }
  }

  const name = manifest.name || ref.split('/').pop() || 'Snack sem nome';
  const fullName = ref.startsWith('@') ? ref : data.fullName || ref;

  return {
    id: data.id || data.hashId || ref,
    hashId: data.hashId || '',
    name,
    nome: name,
    description: manifest.description || '',
    sdkVersion: data.sdkVersion || manifest.sdkVersion || '54.0.0',
    fullName,
    url: `https://snack.expo.dev/${fullName}`,
    origemUrl: `https://snack.expo.dev/${fullName}`,
    files,
    dependencies,
    isDraft: Boolean(data.isDraft),
    fileCount: Object.keys(files).length,
  };
}

/**
 * Busca a conta autenticada e TODOS os Snacks dela via GraphQL com paginação.
 */
export async function fetchAuthenticatedAccountSnacks(auth, { includeCode = true, concurrency = 6 } = {}) {
  const authHeaders = buildAuthHeaders(auth);
  if (!Object.keys(authHeaders).length) {
    throw new Error('Informe um Expo Access Token ou Session Secret válido.');
  }

  const query = `
    query($limit: Int!, $offset: Int!) {
      meUserActor {
        id
        username
        accounts {
          id
          name
          snacks(limit: $limit, offset: $offset) {
            id
            name
            slug
            fullName
            sdkVersion
            isDraft
          }
        }
      }
    }
  `;

  const allSnacks = [];
  let username = '';
  let accountName = '';
  const limit = 100;
  let offset = 0;

  while (true) {
    const res = await fetch(EXPO_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ query, variables: { limit, offset } }),
    });

    if (!res.ok) {
      throw new Error(`Erro ao consultar conta Expo (HTTP ${res.status}). Verifique seu token.`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0].message || 'Erro GraphQL ao consultar conta Expo.');
    }

    const actor = json.data?.meUserActor;
    if (!actor) {
      throw new Error('Token inválido ou expirado. Gere um Personal Access Token em expo.dev/settings/access-tokens.');
    }

    username = actor.username || '';
    const accounts = actor.accounts || [];
    const primaryAccount = accounts.find((a) => a.name === username) || accounts[0];
    if (!primaryAccount) break;

    accountName = primaryAccount.name;
    const batch = primaryAccount.snacks || [];
    for (const s of batch) {
      const fullName = s.fullName || `@${accountName}/${s.slug}`;
      allSnacks.push({
        id: s.id,
        name: s.name || s.slug,
        nome: s.name || s.slug,
        slug: s.slug,
        fullName,
        url: `https://snack.expo.dev/${fullName}`,
        sdkVersion: s.sdkVersion || '54.0.0',
        isDraft: Boolean(s.isDraft),
        files: {},
        dependencies: {},
      });
    }

    if (batch.length < limit) break;
    offset += limit;
    if (offset >= 1000) break;
  }

  if (includeCode && allSnacks.length > 0) {
    await mapWithConcurrency(allSnacks, concurrency, async (item) => {
      try {
        const detail = await fetchSnackDetail(item.fullName, auth);
        item.files = detail.files;
        item.dependencies = detail.dependencies;
        item.description = detail.description;
        item.sdkVersion = detail.sdkVersion || item.sdkVersion;
        item.fileCount = detail.fileCount;
      } catch {
        // Mantém metadados mesmo se algum snack específico falhar ao carregar código
      }
    });
  }

  return {
    username: username ? (username.startsWith('@') ? username : `@${username}`) : `@${accountName}`,
    accountName,
    snacks: allSnacks,
  };
}

/**
 * Salva/clona um Snack completo na conta autenticada (todos os arquivos, assets e dependências).
 */
export async function saveSnackToAccount(snack, auth) {
  const authHeaders = buildAuthHeaders(auth);
  if (!Object.keys(authHeaders).length) {
    throw new Error('Autenticação obrigatória para salvar na sua conta.');
  }

  let files = snack.files && Object.keys(snack.files).length ? snack.files : null;
  let dependencies = snack.dependencies || {};
  let sdkVersion = snack.sdkVersion || '54.0.0';
  let description = snack.description || '';

  // Se o item só tiver URL (sem arquivos completos), busca os arquivos da origem antes de clonar
  if (!files && (snack.origemUrl || snack.url || snack.fullName)) {
    const detail = await fetchSnackDetail(snack.origemUrl || snack.url || snack.fullName);
    files = detail.files;
    dependencies = detail.dependencies;
    sdkVersion = detail.sdkVersion || sdkVersion;
    description = detail.description || description;
  }

  // Fallback para snacks que só possuem string `code` (ex.: catálogo legado)
  if ((!files || Object.keys(files).length === 0) && typeof snack.code === 'string' && snack.code.trim()) {
    files = {
      'App.js': {
        type: 'CODE',
        contents: snack.code,
      },
    };
  }

  if (!files || Object.keys(files).length === 0) {
    throw new Error(`Snack "${snack.name || snack.nome}" não possui arquivos de código para clonar.`);
  }

  const name = (snack.name || snack.nome || 'Snack Clonado').trim();
  const manifestDeps = {};
  for (const [pkg, info] of Object.entries(dependencies || {})) {
    manifestDeps[pkg] = typeof info === 'string' ? info : info?.version || '*';
  }

  const payload = {
    manifest: {
      sdkVersion,
      name,
      description: description || `Clonado via Expo Snack Cloner Studio`,
      dependencies: manifestDeps,
    },
    code: files,
    dependencies,
    isDraft: false,
  };

  const res = await fetch(`${SNACK_API_BASE}/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Snack-Api-Version': SNACK_API_VERSION,
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Expo recusou salvamento de "${name}" (HTTP ${res.status}): ${errText.slice(0, 180)}`);
  }

  const saved = await res.json();
  const id = saved.id || saved.hashId || saved.key;
  return {
    id,
    snackId: saved.snackId || '',
    name,
    url: `https://snack.expo.dev/${id}`,
    savedToAccount: Boolean(id && id.startsWith('@')),
    raw: saved,
  };
}

/**
 * Executa tarefas assíncronas com limite de concorrência para não sobrecarregar a API do Expo.
 */
export async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
