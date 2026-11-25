import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeName,
  normalizeCode,
  computeSnackFingerprint,
  codeSimilarity,
  inspectSnackCodeErrors,
  compareSnackLists,
  diffLines,
} from '../lib/matcher.mjs';
import { loadLegacyCatalogFromDir, parseRawInput } from '../lib/catalog-importer.mjs';
import { createAppServer } from '../server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

test('normalizeName trata acentos, espaços, hífens e variações comuns', () => {
  // Arrange & Act
  const a = normalizeName('604A TextInput 2');
  const b = normalizeName('604_texinput-2');

  // Assert
  assert.equal(a, b);
});

test('compareSnackLists detecta duplicata por código idêntico mesmo com nome totalmente diferente', () => {
  // Arrange
  const source = [
    {
      name: 'Contador Oficial',
      files: {
        'App.js': {
          type: 'CODE',
          contents: `
            // comentário diferente
            import React, { useState } from 'react';
            export default function App() {
              const [n, setN] = useState(0);
              return n;
            }
          `,
        },
      },
    },
  ];
  const target = [
    {
      name: 'Meu Projeto Sem Nome',
      files: {
        'App.js': {
          type: 'CODE',
          contents: `import React, { useState } from 'react';
export default function App() {
  const [n, setN] = useState(0);
  return n;
}`,
        },
      },
    },
  ];

  // Act
  const { results, summary } = compareSnackLists(source, target);

  // Assert
  assert.equal(results[0].status, 'duplicata_codigo');
  assert.equal(results[0].shouldSkipClone, true);
  assert.equal(results[0].targetIndex, 0);
  assert.equal(summary.duplicatasCodigo, 1);
  assert.equal(summary.faltantes, 0);
});

test('compareSnackLists alerta quando o nome é igual mas o código é diferente', () => {
  // Arrange
  const source = [
    {
      name: '604A6',
      code: 'export default function App() { return "VERSAO_ORIGINAL_COMPLETA_123456"; }',
    },
  ];
  const target = [
    {
      name: '604A6',
      code: 'export default function App() { return "OUTRO_CODIGO_DIFERENTE_999999"; }',
    },
  ];

  // Act
  const { results, summary } = compareSnackLists(source, target);

  // Assert
  assert.equal(results[0].status, 'duplicata_nome');
  assert.equal(results[0].shouldSkipClone, true);
  assert.equal(summary.duplicatasNome, 1);
});

test('compareSnackLists identifica corretamente Snacks faltantes e múltiplos arquivos', () => {
  // Arrange
  const source = [
    { name: 'Hello World', code: 'export default () => "hello world 12345678901234567890";' },
    { name: 'Atividade Nova', code: 'export default () => "atividade nova ainda nao feita";' },
  ];
  const target = [
    { name: 'hello-world', code: 'export default () => "hello world 12345678901234567890";' },
  ];

  // Act
  const { results, summary } = compareSnackLists(source, target);

  // Assert
  assert.equal(results[0].status, 'duplicata_exata');
  assert.equal(results[1].status, 'faltante');
  assert.equal(results[1].shouldSkipClone, false);
  assert.equal(summary.faltantes, 1);
  assert.ok(computeSnackFingerprint(source[0]).length === 16);
  assert.ok(normalizeCode('// x\n const a = 1; ') === 'consta=1;');
});

test('compareSnackLists detecta código parecido (>= 85%) quando aluno só mudou o próprio nome no texto', () => {
  // Arrange
  const source = [
    {
      name: '604A2',
      code: `
        import React from 'react';
        import { StyleSheet, Text, View } from 'react-native';
        export default function App() {
          return (
            <View style={styles.container}>
              <Text style={styles.title}>Hello World</Text>
              <Text style={styles.titulo}>Luciano Rocha</Text>
            </View>
          );
        }
        const styles = StyleSheet.create({
          container: { flex: 1, backgroundColor: '#5c5c5c', alignItems: 'center', justifyContent: 'center' },
          title: { fontSize: 45 },
          titulo: { fontSize: 25 }
        });
      `,
    },
  ];
  const target = [
    {
      name: 'atividade-aula-2-ana',
      code: `
        import React from 'react';
        import { StyleSheet, Text, View } from 'react-native';
        export default function App() {
          return (
            <View style={styles.container}>
              <Text style={styles.title}>Hello World</Text>
              <Text style={styles.titulo}>Anna Julia</Text>
            </View>
          );
        }
        const styles = StyleSheet.create({
          container: { flex: 1, backgroundColor: '#5c5c5c', alignItems: 'center', justifyContent: 'center' },
          title: { fontSize: 45 },
          titulo: { fontSize: 25 }
        });
      `,
    },
  ];

  // Act
  const sim = codeSimilarity(source[0].code, target[0].code);
  const { results } = compareSnackLists(source, target);

  // Assert
  assert.ok(sim >= 0.75, `Esperava similaridade >= 0.75, veio ${sim}`);
  assert.equal(results[0].status, 'duplicata_codigo');
  assert.equal(results[0].shouldSkipClone, true);
  assert.ok(results[0].similarity >= 75);
});

test('inspectSnackCodeErrors detecta erros comuns no código do aluno e sinaliza para atualização', () => {
  // Arrange
  const source = [
    {
      name: '604A',
      code: "import React from 'react'; import { View, StyleSheet } from 'react-native'; const styles = StyleSheet.create({ c: { padding: 20 } }); export default () => <View style={styles.c} />;",
    },
  ];
  const targetBroken = [
    {
      name: '604A',
      code: "import React from 'react'; import { View, StyleSheet } from 'react-native'; const styles = StyleSheet({ c: { paddng: 20 } }); export default () => <View style={styles.c} />;",
    },
  ];

  // Act
  const errs = inspectSnackCodeErrors(targetBroken[0]);
  const { results, summary } = compareSnackLists(source, targetBroken);

  // Assert
  assert.ok(errs.some((e) => e.includes('StyleSheet')));
  assert.ok(errs.some((e) => e.includes('paddng')));
  assert.equal(results[0].hasCodeError, true);
  assert.equal(summary.comErro, 1);
});

test('diffLines marca linhas removidas, mantidas e adicionadas', () => {
  // Arrange & Act
  const diff = diffLines('linha 1\nlinha 2\nlinha 3', 'linha 1\nlinha 2 editada\nlinha 3');

  // Assert
  assert.ok(diff.some((d) => d.type === 'same' && d.left === 'linha 1'));
  assert.ok(diff.some((d) => d.type === 'removed' && d.left === 'linha 2'));
  assert.ok(diff.some((d) => d.type === 'added' && d.right === 'linha 2 editada'));
});

test('parseRawInput aceita pacote JSON, HTML e URLs soltas', () => {
  // Arrange
  const urlsText = 'https://snack.expo.dev/@amigo/app1\nhttps://snack.expo.dev/@amigo/app2';

  // Act
  const parsed = parseRawInput(urlsText);

  // Assert
  assert.equal(parsed.snacks.length, 2);
  assert.equal(parsed.snacks[0].name, 'app1');
  assert.equal(parsed.snacks[1].fullName, '@amigo/app2');
});

test('loadLegacyCatalogFromDir carrega o catálogo da Turma 604A presente na pasta', () => {
  // Act
  const legacy = loadLegacyCatalogFromDir(ROOT_DIR);

  // Assert
  assert.equal(legacy.found, true);
  assert.ok(legacy.snacks.length >= 30);
});

test('API REST local: /api/health, /api/compare e /api/clone (dryRun pulando duplicatas)', async () => {
  // Arrange
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // Act 1: Health
    const healthRes = await fetch(`${base}/api/health`);
    const health = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.equal(health.ok, true);

    // Act 2: Clone dry-run com 1 repetido e 1 faltante
    const cloneRes = await fetch(`${base}/api/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dryRun: true,
        snacks: [
          { name: 'Ja Tenho', code: 'export default () => "codigo repetido 12345678901234567890";' },
          { name: 'Novo Snack', code: 'export default () => "codigo novo 98765432109876543210";' },
        ],
        existingTargetSnacks: [
          { name: 'Outro Nome', code: 'export default () => "codigo repetido 12345678901234567890";' },
        ],
      }),
    });
    const cloneData = await cloneRes.json();

    // Assert
    assert.equal(cloneRes.status, 200);
    assert.equal(cloneData.summary.skipped, 1);
    assert.equal(cloneData.summary.wouldClone, 1);
    assert.equal(cloneData.report[0].status, 'skipped_duplicate');
    assert.equal(cloneData.report[1].status, 'would_clone');
  } finally {
    server.close();
  }
});

test('Cenários reais com os 41 Snacks: conta vazia, aluno misto, duplicata na fila e erros da API', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Carrega os 42 Snacks hidratados (do catálogo empacotado)
    const catRes = await fetch(`${base}/api/legacy-catalog`);
    const cat = await catRes.json();
    assert.equal(cat.snacks.length, 42);
    assert.equal(cat.withCode, 42);

    const getCode = (s) => s.files?.['App.js']?.contents || s.code || '';

    // Cenário 1: Conta vazia (0 Snacks) -> todos os 42 faltam
    const emptyCmp = await (await fetch(`${base}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: cat.snacks, target: [] }),
    })).json();
    assert.equal(emptyCmp.summary.faltantes, 42);

    // Cenário 2: Aluno real com 5 situações mistas + 1 Snack extra fora dos 41
    const s0Idx = cat.snacks.findIndex((s) => s.name === 'Hello World');
    const s1Idx = cat.snacks.findIndex((s) => s.name === 'Hello world 2');
    const s6Idx = cat.snacks.findIndex((s) => s.name === '604A2');
    const s9Idx = cat.snacks.findIndex((s) => s.name === '604A6');
    const sTiIdx = cat.snacks.findIndex((s) => s.name === '604AtextInput2');

    const alunoSnacks = [
      { name: cat.snacks[s0Idx].name, url: 'https://snack.expo.dev/@aluno/hello-world', code: getCode(cat.snacks[s0Idx]) },
      { name: 'meu-projeto-aula-02', url: 'https://snack.expo.dev/@aluno/meu-projeto-aula-02', code: getCode(cat.snacks[s1Idx]) },
      { name: 'trabalho-rocha-editado', url: 'https://snack.expo.dev/@aluno/trabalho-rocha-editado', code: getCode(cat.snacks[s6Idx]).replace('Luciano Rocha', 'Maria Clara') },
      { name: cat.snacks[s9Idx].name, url: 'https://snack.expo.dev/@aluno/604a6', code: 'import React from "react"; export default () => <Text>Codigo completamente diferente do exercicio original da aula</Text>;' },
      { name: '604texinput2', url: 'https://snack.expo.dev/@aluno/604texinput2', code: getCode(cat.snacks[sTiIdx]) },
      { name: 'projeto-pessoal-extra', url: 'https://snack.expo.dev/@aluno/projeto-pessoal-extra', code: 'export default () => "meu app pessoal fora da turma";' },
    ];

    const mixCmp = await (await fetch(`${base}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: cat.snacks, target: alunoSnacks }),
    })).json();

    assert.equal(mixCmp.results[s0Idx].status, 'duplicata_exata', 'Nome e código iguais');
    assert.equal(mixCmp.results[s1Idx].status, 'duplicata_codigo', 'Nome diferente e código 100% igual');
    assert.equal(mixCmp.results[s6Idx].status, 'duplicata_codigo', 'Nome diferente e código parecido (>=85%)');
    assert.ok(mixCmp.results[s6Idx].similarity >= 85);
    assert.equal(mixCmp.results[s9Idx].status, 'duplicata_nome', 'Mesmo nome mas código diferente -> alerta');
    assert.equal(mixCmp.results[sTiIdx].status, 'duplicata_exata', 'Typo no nome normalizado');
    assert.equal(mixCmp.summary.faltantes, 37, '42 - 5 reconhecidos = 37 faltantes');

    // Cenário 3: Dry-run tentando enviar TODOS os 42 -> deve pular os 5 e só listar os 37 faltantes
    const dryRes = await (await fetch(`${base}/api/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dryRun: true,
        snacks: cat.snacks,
        existingTargetSnacks: alunoSnacks,
        skipDuplicates: true,
      }),
    })).json();
    assert.equal(dryRes.summary.skipped, 5);
    assert.equal(dryRes.summary.wouldClone, 37);

    // Cenário 4: Proteção contra duplicata dentro da própria fila de envio
    const dupQueueRes = await (await fetch(`${base}/api/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dryRun: true,
        snacks: [cat.snacks[2], cat.snacks[2]],
        existingTargetSnacks: [],
      }),
    })).json();
    assert.equal(dupQueueRes.summary.wouldClone, 1);
    assert.equal(dupQueueRes.summary.skipped, 1);

    // Cenário 5: Erros padronizados da API (sem token em clonagem real)
    const noAuthRes = await fetch(`${base}/api/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snacks: [cat.snacks[2]], existingTargetSnacks: [] }),
    });
    const noAuthJson = await noAuthRes.json();
    assert.equal(noAuthRes.status, 400);
    assert.equal(noAuthJson.error.code, 'AUTH_REQUIRED');
  } finally {
    server.close();
  }
});
