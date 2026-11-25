#!/usr/bin/env node
/**
 * Expo Snack Cloner Studio — CLI
 *
 * Comandos:
 *   node cli.mjs export --token=SEU_TOKEN --out=meus-snacks.json
 *   node cli.mjs compare --pack=meus-snacks.json --token=TOKEN_DESTINO
 *   node cli.mjs clone --pack=meus-snacks.json --token=TOKEN_DESTINO [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  fetchAuthenticatedAccountSnacks,
  saveSnackToAccount,
} from './lib/expo-api.mjs';
import { compareSnackLists } from './lib/matcher.mjs';
import { parseRawInput } from './lib/catalog-importer.mjs';

function parseArgs(argv) {
  const cmd = argv[2] || 'help';
  const flags = {};
  for (const arg of argv.slice(3)) {
    if (arg.startsWith('--')) {
      const [k, ...rest] = arg.slice(2).split('=');
      flags[k] = rest.length ? rest.join('=') : true;
    }
  }
  return { cmd, flags };
}

function printHelp() {
  console.log(`
Expo Snack Cloner Studio — CLI

Uso:
  node cli.mjs export --token=<TOKEN> [--out=meus-snacks.json]
    Exporta todos os Snacks da sua conta (com arquivos e dependências) para enviar aos amigos.

  node cli.mjs compare --pack=<ARQUIVO.json> --token=<TOKEN_DESTINO>
    Compara o pacote recebido com os Snacks já existentes na conta destino e mostra duplicatas/faltantes.

  node cli.mjs clone --pack=<ARQUIVO.json> --token=<TOKEN_DESTINO> [--dry-run]
    Clona apenas os Snacks faltantes para a conta destino, pulando repetidos automaticamente.

Dica: você também pode passar o token via variável de ambiente EXPO_TOKEN.
`);
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv);
  const token = flags.token || process.env.EXPO_TOKEN || '';

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === 'export') {
    if (!token) {
      console.error('Erro: informe --token=<SEU_EXPO_TOKEN> (ou defina EXPO_TOKEN).');
      process.exit(1);
    }
    console.log('Carregando seus Snacks na API do Expo...');
    const account = await fetchAuthenticatedAccountSnacks(token, { includeCode: true });
    const outFile = path.resolve(flags.out || `pacote-snacks-${account.accountName || 'expo'}.json`);
    const pack = {
      format: 'expo-snack-pack',
      version: 1,
      exportedAt: new Date().toISOString(),
      meta: {
        author: account.username,
        total: account.snacks.length,
      },
      snacks: account.snacks,
    };
    fs.writeFileSync(outFile, JSON.stringify(pack, null, 2), 'utf8');
    console.log(`Sucesso! ${account.snacks.length} Snacks exportados para: ${outFile}`);
    return;
  }

  if (cmd === 'compare' || cmd === 'clone') {
    const packPath = flags.pack;
    if (!packPath || !fs.existsSync(packPath)) {
      console.error('Erro: informe --pack=<caminho-do-pacote.json> válido.');
      process.exit(1);
    }
    if (!token) {
      console.error('Erro: informe --token=<TOKEN_DESTINO> (ou defina EXPO_TOKEN).');
      process.exit(1);
    }

    const raw = fs.readFileSync(packPath, 'utf8');
    const { snacks: sourceSnacks } = parseRawInput(raw);
    console.log(`Pacote carregado: ${sourceSnacks.length} Snacks de origem.`);

    console.log('Lendo Snacks já existentes na conta de destino...');
    const targetAccount = await fetchAuthenticatedAccountSnacks(token, { includeCode: true });
    console.log(`Conta destino (${targetAccount.username}): ${targetAccount.snacks.length} Snacks encontrados.`);

    const { results, summary } = compareSnackLists(sourceSnacks, targetAccount.snacks);
    console.log('\nResumo da comparação:');
    console.log(`  - Duplicatas exatas: ${summary.duplicatasExatas}`);
    console.log(`  - Mesmo código (outro nome): ${summary.duplicatasCodigo}`);
    console.log(`  - Mesmo nome (código diferente): ${summary.duplicatasNome}`);
    console.log(`  - Faltantes (prontos para clonar): ${summary.faltantes}\n`);

    if (cmd === 'compare') {
      for (const r of results) {
        const s = sourceSnacks[r.sourceIndex];
        const tag = r.status === 'faltante' ? '[FALTANTE]' : `[${r.status.toUpperCase()}]`;
        console.log(`  ${tag.padEnd(20)} ${s.name || s.nome} — ${r.reason}`);
      }
      return;
    }

    const dryRun = Boolean(flags['dry-run']);
    const missing = results.filter((r) => !r.shouldSkipClone);
    if (missing.length === 0) {
      console.log('Nada a clonar: todos os Snacks já existem na conta de destino!');
      return;
    }

    console.log(dryRun
      ? `Simulando clonagem (--dry-run) de ${missing.length} Snacks...`
      : `Clonando ${missing.length} Snacks faltantes para ${targetAccount.username}...`);

    for (const r of missing) {
      const snack = sourceSnacks[r.sourceIndex];
      if (dryRun) {
        console.log(`  [DRY-RUN] Clonaria: ${snack.name || snack.nome}`);
        continue;
      }
      try {
        const saved = await saveSnackToAccount(snack, token);
        console.log(`  [OK] ${saved.name} -> ${saved.url}`);
      } catch (err) {
        console.error(`  [ERRO] ${snack.name || snack.nome}: ${err.message}`);
      }
    }
    return;
  }

  console.error(`Comando desconhecido: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
