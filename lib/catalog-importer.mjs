/**
 * Importador de catálogos e listas de Expo Snacks a partir de:
 * - Pacote .json do Expo Snack Cloner Studio
 * - JSON simples [{ nome, url, code? }]
 * - Arquivo HTML salvo da página Snacks do Expo ou painel-completo-turma-604A
 * - Texto puro com URLs https://snack.expo.dev/@usuario/slug
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Tenta extrair o array CATALOGO embutido no arquivo painel-completo-turma-604A (1).html da pasta.
 */
export function loadLegacyCatalogFromDir(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath);
    const htmlFile = entries.find((f) => /^painel-completo.*\.html?$/i.test(f));
    if (!htmlFile) return { found: false, fileName: null, snacks: [] };

    const content = fs.readFileSync(path.join(dirPath, htmlFile), 'utf8');
    const match = content.match(/const\s+CATALOGO\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return { found: false, fileName: htmlFile, snacks: [] };

    const parsed = JSON.parse(match[1]);
    const snacks = parsed.map((item, idx) => ({
      id: `legacy-${idx + 1}`,
      name: item.nome || `Snack ${idx + 1}`,
      nome: item.nome || `Snack ${idx + 1}`,
      apelidos: item.apelidos || [],
      url: item.origemUrl || '',
      origemUrl: item.origemUrl || '',
      urlCriar: item.urlCriar || item.origemUrl || '',
      pronto: Boolean(item.pronto),
      code: item.code || '',
      files: item.code
        ? { 'App.js': { type: 'CODE', contents: item.code } }
        : {},
      dependencies: {},
      sdkVersion: '54.0.0',
    }));

    return { found: true, fileName: htmlFile, snacks };
  } catch {
    return { found: false, fileName: null, snacks: [] };
  }
}

/**
 * Extrai lista normalizada de Snacks de um texto colado (JSON, pacote, HTML ou URLs).
 */
export function parseRawInput(rawText) {
  const clean = String(rawText || '').trim();
  if (!clean) return { meta: {}, snacks: [] };

  // 1. JSON (Pacote oficial { format: 'expo-snack-pack', snacks: [...] } ou Array [...])
  if (clean.startsWith('{') || clean.startsWith('[')) {
    try {
      const parsed = JSON.parse(clean);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.snacks)
          ? parsed.snacks
          : [];
      const meta = !Array.isArray(parsed) && parsed.meta ? parsed.meta : {};
      const seen = new Set();
      const snacks = [];

      for (const item of list) {
        const url = String(item.url || item.origemUrl || '').split('?')[0].replace(/\/$/, '');
        const name = String(item.name || item.nome || '').trim() || (url ? url.split('/').pop() : '');
        if (!name && !url) continue;
        const key = url || name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const files =
          item.files && typeof item.files === 'object' && Object.keys(item.files).length
            ? item.files
            : item.code && typeof item.code === 'object'
              ? item.code
              : typeof item.code === 'string' && item.code.trim()
                ? { 'App.js': { type: 'CODE', contents: item.code } }
                : {};

        snacks.push({
          id: item.id || key,
          name,
          nome: name,
          apelidos: Array.isArray(item.apelidos) ? item.apelidos : [],
          url,
          origemUrl: url,
          fullName: item.fullName || (url.match(/snack\.expo\.dev\/(.+)$/)?.[1] || ''),
          description: item.description || '',
          sdkVersion: item.sdkVersion || '54.0.0',
          files,
          code: typeof item.code === 'string' ? item.code : '',
          dependencies: item.dependencies || {},
          fileCount: Object.keys(files).length,
        });
      }
      return { meta, snacks };
    } catch {
      // Continua para os parsers de HTML/URL
    }
  }

  // 2. Links de Snack em HTML ou texto puro
  const snacks = [];
  const seen = new Set();

  // Tenta extrair tags <a href="...snack.expo.dev/@...">Nome</a>
  const anchorRegex = /<a[^>]+href=["'](https?:\/\/snack\.expo\.dev\/@[^"'?#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRegex.exec(clean)) !== null) {
    const url = m[1].replace(/\/$/, '');
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const slug = url.split('/').pop() || 'Snack';
    snacks.push({
      id: url,
      name: text || slug,
      nome: text || slug,
      url,
      origemUrl: url,
      fullName: url.replace(/^https?:\/\/snack\.expo\.dev\//, ''),
      files: {},
      dependencies: {},
      sdkVersion: '54.0.0',
      fileCount: 0,
    });
  }

  if (snacks.length > 0) return { meta: {}, snacks };

  // 3. URLs soltas em texto puro (uma por linha ou misturadas)
  const urlRegex = /https?:\/\/snack\.expo\.dev\/(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_-]{8,})/g;
  while ((m = urlRegex.exec(clean)) !== null) {
    const url = m[0].replace(/\/$/, '');
    if (seen.has(url)) continue;
    seen.add(url);
    const fullName = m[1];
    const slug = fullName.split('/').pop() || fullName;
    snacks.push({
      id: url,
      name: slug,
      nome: slug,
      url,
      origemUrl: url,
      fullName,
      files: {},
      dependencies: {},
      sdkVersion: '54.0.0',
      fileCount: 0,
    });
  }

  return { meta: {}, snacks };
}
