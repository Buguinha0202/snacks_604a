/**
 * Motor de normalização, detecção de duplicatas e diff de Expo Snacks.
 * Módulo puro (sem I/O) para facilitar testes unitários e reutilização (Web + CLI).
 */

import crypto from 'node:crypto';

/**
 * Normaliza nome de Snack para comparação tolerante a acentos, espaços e variações comuns.
 */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '')
    .replace(/^(60[45])a(?=[a-z])/g, '$1')
    .replace('texinput', 'textinput')
    .replace('scrollview2', 'scrollview');
}

/**
 * Normaliza código-fonte removendo comentários e espaços em branco.
 */
export function normalizeCode(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Normaliza a ESTRUTURA do código ignorando:
 * - comentários, espaços, ponto-e-vírgula e trailing commas
 * - presença/ausência de `import React from 'react'` e ordem dos imports nomeados `{ B, A }` -> `{ A, B }`
 * - textos puros dentro de JSX (`<Text>...</Text>`) e strings literais (preservando nomes de pacotes em import/require)
 * - valores numéricos em estilos (`fontSize: 45` -> `fontSize: N`)
 * - variação entre `const App = () =>` e `function App()`
 */
export function normalizeCodeStructure(code) {
  let s = String(code || '').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  // Remove `import React from 'react'` / `import * as React from 'react'` (opcional no Expo moderno)
  s = s.replace(/^\s*import\s+(?:\*\s+as\s+)?React\s+from\s+['"]react['"]\s*;?\s*$/gm, '');
  s = s.replace(/import\s+React\s*,\s*\{/g, 'import {');

  // Ordena imports nomeados: import { Text, View } -> import { Text, View } (sempre alfabético)
  s = s.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2/g, (_, list, quote, mod) => {
    const sorted = list
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .sort()
      .join(',');
    return `import{${sorted}}from${quote}${mod}${quote}`;
  });

  // Protege caminhos de import/require para manter a diferenciação entre bibliotecas
  const preserved = [];
  s = s.replace(
    /(\bfrom\s*|require\s*\(\s*)(['"`])([^'"`]+)\2/g,
    (_, prefix, quote, mod) => {
      const id = `__MOD${preserved.length}__`;
      preserved.push(`${prefix}${quote}${mod}${quote}`);
      return id;
    }
  );

  // Uniformiza declarações de função/componente (function X() vs const X = () =>)
  s = s
    .replace(/\bexport\s+default\s+function\s+[A-Za-z0-9_]*\s*\(/g, 'fn(')
    .replace(/\bfunction\s+[A-Za-z0-9_]+\s*\(/g, 'fn(')
    .replace(/\bconst\s+[A-Za-z0-9_]+\s*=\s*\(/g, 'fn(')
    .replace(/\bexport\s+default\s+[A-Za-z0-9_]+\s*;?/g, 'expdef');

  let structural = s
    // Texto puro dentro de tags JSX (ex.: <Text>Qualquer frase</Text> -> <Text>T</Text>)
    .replace(/>([^<>{}]+)</g, (m, inner) => (inner.trim() ? '>T<' : '><'))
    // Strings literais (títulos de botão, placeholders, alertas, cores, nomes)
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '"S"')
    // Números em propriedades de estilo (ex.: fontSize: 45 -> fontSize: N)
    .replace(/:\s*-?\d+(?:\.\d+)?\b/g, ':N')
    // Remove ponto-e-vírgula e vírgulas finais opcionais
    .replace(/;/g, '')
    .replace(/,\s*([}\])])/g, '$1')
    .replace(/\s+/g, '')
    .trim();

  for (let i = 0; i < preserved.length; i++) {
    structural = structural.replace(`__MOD${i}__`, preserved[i].replace(/\s+/g, ''));
  }

  return structural;
}

/**
 * Extrai todo o código autoral de um Snack (concatenando arquivos CODE relevantes como screens/*.js,
 * ignorando boilerplate padrão do Expo Snack como AssetExample.js e README.md).
 */
export function getCombinedAuthorCode(snack) {
  if (!snack) return '';
  const files = snack.files || (typeof snack.code === 'object' ? snack.code : null);
  if (files && typeof files === 'object') {
    const keys = Object.keys(files)
      .filter((k) => {
        const f = files[k];
        if (!f || (f.type !== 'CODE' && typeof f.contents !== 'string')) return false;
        if (/^(components\/AssetExample\.js|README\.md|package\.json)$/i.test(k)) return false;
        return Boolean(String(f.contents || '').trim());
      })
      .sort((a, b) => {
        if (/^App\./i.test(a)) return -1;
        if (/^App\./i.test(b)) return 1;
        return a.localeCompare(b);
      });
    if (keys.length > 0) {
      return keys.map((k) => files[k].contents).join('\n');
    }
  }
  return getPrimaryCode(snack);
}

/**
 * Extrai o código principal (App.js / App.tsx / primeiro arquivo CODE) de um Snack.
 */
export function getPrimaryCode(snack) {
  if (!snack) return '';
  const files = snack.files || (typeof snack.code === 'object' ? snack.code : null);
  if (files && typeof files === 'object') {
    const preferred = ['App.js', 'App.tsx', 'App.jsx', 'App.ts', 'index.js'];
    for (const key of preferred) {
      if (files[key]?.contents && String(files[key].contents).trim()) {
        return files[key].contents;
      }
    }
    for (const [, val] of Object.entries(files)) {
      if (val && val.type === 'CODE' && typeof val.contents === 'string' && val.contents.trim()) {
        return val.contents;
      }
    }
  }
  if (typeof snack.code === 'string' && snack.code.trim()) return snack.code;
  return '';
}

/**
 * Gera uma assinatura estável de todos os arquivos CODE do Snack para detecção exata de duplicatas.
 */
export function computeSnackFingerprint(snack) {
  const files = snack?.files || (typeof snack?.code === 'object' ? snack.code : null);
  const parts = [];

  if (files && typeof files === 'object') {
    const keys = Object.keys(files).sort();
    for (const k of keys) {
      const f = files[k];
      if (!f) continue;
      if (f.type === 'CODE' || typeof f.contents === 'string') {
        const norm = normalizeCode(f.contents);
        if (norm) parts.push(`${k.toLowerCase()}:${norm}`);
      } else if (f.type === 'ASSET' && f.contents) {
        parts.push(`${k.toLowerCase()}:ASSET:${String(f.contents).trim()}`);
      }
    }
  } else if (typeof snack?.code === 'string') {
    const norm = normalizeCode(snack.code);
    if (norm) parts.push(`app:${norm}`);
  }

  if (parts.length === 0) return '';
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Verifica se duas strings normalizadas diferem por no máximo 1 edição (Levenshtein <= 1).
 */
export function isEditDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (a.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let errors = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++errors > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return true;
}

function diceTrigrams(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 20 || b.length < 20) return 0;

  const gramsA = new Map();
  for (let i = 0; i <= a.length - 3; i++) {
    const g = a.slice(i, i + 3);
    gramsA.set(g, (gramsA.get(g) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i <= b.length - 3; i++) {
    const g = b.slice(i, i + 3);
    const count = gramsA.get(g) || 0;
    if (count > 0) {
      intersection++;
      gramsA.set(g, count - 1);
    }
  }

  const totalGrams = (a.length - 2) + (b.length - 2);
  return totalGrams > 0 ? (2 * intersection) / totalGrams : 0;
}

/**
 * Calcula similaridade (0 a 1) entre dois códigos usando o maior valor entre:
 * 1) Similaridade literal (código normalizado sem espaços/comentários)
 * 2) Similaridade estrutural (ignorando textos dentro de <Text> e strings literais)
 */
export function codeSimilarity(codeA, codeB) {
  const litA = normalizeCode(codeA);
  const litB = normalizeCode(codeB);
  const literalScore = diceTrigrams(litA, litB);
  if (literalScore >= 0.99) return literalScore;

  const strA = normalizeCodeStructure(codeA);
  const strB = normalizeCodeStructure(codeB);
  if (strA.length < 45 || strB.length < 45) return literalScore;

  const structuralScore = diceTrigrams(strA, strB);
  return Math.max(literalScore, structuralScore);
}

export const DEFAULT_SIMILARITY_THRESHOLD = 0.70;

const KNOWN_RN_EXPORTS = new Set([
  'View', 'Text', 'Image', 'ScrollView', 'TextInput', 'StyleSheet', 'Button',
  'Alert', 'TouchableOpacity', 'TouchableHighlight', 'Pressable', 'FlatList',
  'SectionList', 'SafeAreaView', 'Switch', 'ActivityIndicator', 'Modal',
  'StatusBar', 'KeyboardAvoidingView', 'ImageBackground', 'Platform', 'Dimensions',
  'Animated', 'RefreshControl', 'TouchableWithoutFeedback', 'Linking', 'Vibration',
  'SafeAreaProvider', 'PixelRatio', 'PermissionsAndroid', 'Share', 'ToastAndroid'
]);

/**
 * Inspeciona o código de um Snack React Native em busca de erros comuns que quebram no Expo.
 * Retorna lista de mensagens curtas e claras para o usuário.
 */
export function inspectSnackCodeErrors(snack) {
  const code = getPrimaryCode(snack);
  if (!code || !code.trim()) return [];

  const errs = [];

  if (/StyleSheet\s*\(\s*\{/.test(code)) {
    errs.push('StyleSheet({...}) sem .create (quebra ao abrir)');
  }
  if (/<SafeAreaview\b/.test(code)) {
    errs.push('Tag <SafeAreaview> com "v" minúsculo (deveria ser <SafeAreaView>)');
  }
  if (/\bpaddng\s*:/.test(code)) {
    errs.push('Propriedade "paddng" escrita errada (deveria ser "padding")');
  }
  if (/const\s+[A-Za-z0-9_]+\s*\{/.test(code)) {
    errs.push('Função declarada sem "= () =>"');
  }
  if (/import\s+React\s*,\s*\{[^}]*\bcomponent\b/.test(code)) {
    errs.push('Import inválido "{ Component, component }" de react');
  }

  const rnImport = code.match(/import\s*\{([^}]+)\}\s*from\s*['"]react-native['"]/);
  if (rnImport) {
    const items = rnImport[1]
      .split(',')
      .map((x) => x.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    for (const item of items) {
      if (!KNOWN_RN_EXPORTS.has(item)) {
        errs.push(`Import escrito errado de react-native: "${item}"`);
      }
    }
    for (const comp of ['View', 'Text', 'Image', 'ScrollView', 'TextInput', 'Button', 'TouchableOpacity', 'FlatList', 'Alert', 'StyleSheet']) {
      const usedAsTag = new RegExp(`<${comp}\\b`).test(code);
      const usedAsObj = (comp === 'Alert' || comp === 'StyleSheet') && new RegExp(`\\b${comp}\\.`).test(code);
      if ((usedAsTag || usedAsObj) && !items.includes(comp)) {
        errs.push(`Usa "${comp}" sem importar de 'react-native'`);
      }
    }
  }

  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errs.push(`Chaves desbalanceadas ({=${openBraces}, }=${closeBraces})`);
  }

  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errs.push(`Parênteses desbalanceados ((=${openParens}, )=${closeParens})`);
  }

  if (!/export\s+default\b/.test(code)) {
    errs.push('Falta "export default"');
  }

  return errs;
}

/**
 * Compara a lista de Snacks de origem (pacote/amigo) com os Snacks já existentes no destino.
 * Retorna status detalhado por item para impedir clonagem de repetidos.
 *
 * Status possíveis:
 * - 'duplicata_exata': mesmo nome (ou apelido) e código igual (ou sem código para divergir)
 * - 'duplicata_codigo': nome diferente, mas o código é idêntico ou parecido (>= 75%)
 * - 'duplicata_nome': nome igual/parecido, mas o código difere (requer atenção)
 * - 'faltante': não encontrado na conta de destino, pronto para clonar
 */
export function compareSnackLists(sourceSnacks = [], targetSnacks = [], { similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD } = {}) {
  const usedTargetIndices = new Set();
  const results = new Array(sourceSnacks.length).fill(null);

  const targetMeta = targetSnacks.map((t, idx) => {
    const rawCode = getCombinedAuthorCode(t);
    const primary = normalizeCode(rawCode);
    return {
      idx,
      snack: t,
      normName: normalizeName(t.name || t.nome || t.slug),
      rawCode,
      primaryCode: primary,
      fingerprint: computeSnackFingerprint(t),
    };
  });

  const sourceMeta = sourceSnacks.map((s, idx) => {
    const rawCode = getCombinedAuthorCode(s);
    const primary = normalizeCode(rawCode);
    const aliases = [
      normalizeName(s.name || s.nome || s.slug),
      ...(Array.isArray(s.apelidos) ? s.apelidos.map(normalizeName) : []),
    ].filter(Boolean);
    return {
      idx,
      snack: s,
      aliases,
      rawCode,
      primaryCode: primary,
      fingerprint: computeSnackFingerprint(s),
    };
  });

  const codesMatch = (src, tgt) => {
    if (src.fingerprint && tgt.fingerprint && src.fingerprint === tgt.fingerprint) return true;
    if (src.primaryCode.length >= 20 && tgt.primaryCode.length >= 20 && src.primaryCode === tgt.primaryCode) {
      return true;
    }
    return false;
  };

  // Passada 1: Nome exato ou apelido COM código compatível (ou quando algum lado não tem código)
  // Se o nome bater mas o código for muito diferente, adiamos para a Passada 4 para não roubar um target que pertence a outro item pelo código.
  for (const src of sourceMeta) {
    const match = targetMeta.find((tgt) => {
      if (usedTargetIndices.has(tgt.idx)) return false;
      if (!src.aliases.includes(tgt.normName)) return false;
      const bothHaveCode = src.primaryCode.length >= 20 && tgt.primaryCode.length >= 20;
      if (!bothHaveCode) return true;
      return codesMatch(src, tgt) || codeSimilarity(src.rawCode, tgt.rawCode) >= 0.60;
    });
    if (match) {
      usedTargetIndices.add(match.idx);
      const bothHaveCode = src.primaryCode.length >= 20 && match.primaryCode.length >= 20;
      const sim = bothHaveCode ? codeSimilarity(src.rawCode, match.rawCode) : 1;
      const sameCode = !bothHaveCode || codesMatch(src, match) || sim >= similarityThreshold;
      results[src.idx] = {
        sourceIndex: src.idx,
        targetIndex: match.idx,
        status: sameCode ? 'duplicata_exata' : 'duplicata_nome',
        reason: sameCode
          ? 'Já existe na sua conta com o mesmo nome'
          : 'Existe com o mesmo nome, mas o código é diferente',
        shouldSkipClone: true,
      };
    }
  }

  // Passada 2: Código 100% idêntico (mesmo salvo com nome totalmente diferente!)
  for (const src of sourceMeta) {
    if (results[src.idx]) continue;
    if (!src.fingerprint && src.primaryCode.length < 20) continue;
    const match = targetMeta.find(
      (tgt) => !usedTargetIndices.has(tgt.idx) && codesMatch(src, tgt)
    );
    if (match) {
      usedTargetIndices.add(match.idx);
      results[src.idx] = {
        sourceIndex: src.idx,
        targetIndex: match.idx,
        status: 'duplicata_codigo',
        similarity: 100,
        reason: `Código idêntico ao seu Snack "${match.snack.name || match.snack.nome}"`,
        shouldSkipClone: true,
      };
    }
  }

  // Passada 3: Matching GLOBAL Best-First por similaridade de código (>= similarityThreshold, padrão 70%)
  // Ordena todos os pares pelo maior score primeiro para que nenhum item de 72% roube o Snack de um item de 98%.
  const candidatePairs = [];
  for (const src of sourceMeta) {
    if (results[src.idx] || src.primaryCode.length < 30) continue;
    for (const tgt of targetMeta) {
      if (usedTargetIndices.has(tgt.idx) || tgt.primaryCode.length < 30) continue;
      const score = codeSimilarity(src.rawCode, tgt.rawCode);
      if (score >= similarityThreshold) {
        candidatePairs.push({ src, tgt, score });
      }
    }
  }
  candidatePairs.sort((a, b) => b.score - a.score);

  for (const { src, tgt, score } of candidatePairs) {
    if (results[src.idx] || usedTargetIndices.has(tgt.idx)) continue;
    usedTargetIndices.add(tgt.idx);
    const pct = Math.round(score * 100);
    results[src.idx] = {
      sourceIndex: src.idx,
      targetIndex: tgt.idx,
      status: 'duplicata_codigo',
      similarity: pct,
      reason: `Código ~${pct}% parecido com o seu Snack "${tgt.snack.name || tgt.snack.nome}"`,
      shouldSkipClone: true,
    };
  }

  // Passada 4: Nome exato (código divergente) ou nome parecido (distância <= 1 ou substring >= 6 chars)
  for (const src of sourceMeta) {
    if (results[src.idx]) continue;
    const match = targetMeta.find((tgt) => {
      if (usedTargetIndices.has(tgt.idx)) return false;
      return src.aliases.some(
        (alias) =>
          tgt.normName === alias ||
          isEditDistanceAtMostOne(tgt.normName, alias) ||
          (alias.length >= 6 && tgt.normName.includes(alias))
      );
    });
    if (match) {
      usedTargetIndices.add(match.idx);
      const bothHaveCode = src.primaryCode.length >= 20 && match.primaryCode.length >= 20;
      const sameCode = bothHaveCode
        ? (codesMatch(src, match) || codeSimilarity(src.rawCode, match.rawCode) >= similarityThreshold)
        : true;
      results[src.idx] = {
        sourceIndex: src.idx,
        targetIndex: match.idx,
        status: sameCode ? 'duplicata_exata' : 'duplicata_nome',
        reason: sameCode
          ? `Nome parecido com "${match.snack.name || match.snack.nome}"`
          : `Existe como "${match.snack.name || match.snack.nome}", mas o código é diferente`,
        shouldSkipClone: true,
      };
    }
  }

  // Passada 5: Reuso de código igual/muito parecido (>= 85%) para exercícios gêmeos na lista
  // Ex.: se o aluno já tem o código de "Hello World" / "cores" / "604A" na conta, não marca o exercício gêmeo como faltante!
  for (const src of sourceMeta) {
    if (results[src.idx] || src.primaryCode.length < 30) continue;
    let bestTgt = null;
    let bestScore = 0;
    for (const tgt of targetMeta) {
      if (tgt.primaryCode.length < 30) continue;
      const exact = codesMatch(src, tgt);
      const score = exact ? 1 : codeSimilarity(src.rawCode, tgt.rawCode);
      if (score >= 0.85 && score > bestScore) {
        bestScore = score;
        bestTgt = tgt;
      }
    }
    if (bestTgt) {
      const pct = Math.round(bestScore * 100);
      results[src.idx] = {
        sourceIndex: src.idx,
        targetIndex: bestTgt.idx,
        status: 'duplicata_codigo',
        similarity: pct,
        reason:
          pct === 100
            ? `Mesmo código do seu Snack "${bestTgt.snack.name || bestTgt.snack.nome}"`
            : `Código ~${pct}% igual ao seu Snack "${bestTgt.snack.name || bestTgt.snack.nome}"`,
        shouldSkipClone: true,
      };
    }
  }

  // Restante: Faltantes (prontos para clonar)
  for (const src of sourceMeta) {
    if (!results[src.idx]) {
      results[src.idx] = {
        sourceIndex: src.idx,
        targetIndex: null,
        status: 'faltante',
        reason: 'Ainda não existe na sua conta',
        shouldSkipClone: false,
      };
    }
  }

  // Inspeciona erros e status de rascunho (Draft) no Snack vinculado na conta do usuário
  for (const r of results) {
    if (r.targetIndex !== null && targetSnacks[r.targetIndex]) {
      const targetSnack = targetSnacks[r.targetIndex];
      const targetErrors = inspectSnackCodeErrors(targetSnack);
      r.targetErrors = targetErrors;
      r.hasCodeError = targetErrors.length > 0;
      r.isDraft = Boolean(targetSnack.isDraft);
    } else {
      r.targetErrors = [];
      r.hasCodeError = false;
      r.isDraft = false;
    }
  }

  const summary = {
    totalSource: sourceSnacks.length,
    totalTarget: targetSnacks.length,
    duplicatasExatas: results.filter((r) => r.status === 'duplicata_exata').length,
    duplicatasCodigo: results.filter((r) => r.status === 'duplicata_codigo').length,
    duplicatasNome: results.filter((r) => r.status === 'duplicata_nome').length,
    faltantes: results.filter((r) => r.status === 'faltante').length,
    comErro: results.filter((r) => r.hasCodeError).length,
    rascunhos: results.filter((r) => r.isDraft).length,
  };

  return { results, summary };
}

/**
 * Gera um diff linha a linha simples (LCS limitado) para exibição lado a lado.
 */
export function diffLines(originalText = '', targetText = '') {
  const a = String(originalText || '').replace(/\r\n/g, '\n').split('\n');
  const b = String(targetText || '').replace(/\r\n/g, '\n').split('\n');

  const maxLines = 400;
  const aSlice = a.slice(0, maxLines);
  const bSlice = b.slice(0, maxLines);

  const m = aSlice.length;
  const n = bSlice.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aSlice[i] === bSlice[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
    }
  }

  const output = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aSlice[i] === bSlice[j]) {
      output.push({ type: 'same', left: aSlice[i], right: bSlice[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      output.push({ type: 'removed', left: aSlice[i], right: null });
      i++;
    } else {
      output.push({ type: 'added', left: null, right: bSlice[j] });
      j++;
    }
  }
  while (i < m) {
    output.push({ type: 'removed', left: aSlice[i++], right: null });
  }
  while (j < n) {
    output.push({ type: 'added', left: null, right: bSlice[j++] });
  }

  return output;
}
