/**
 * Painel Turma 604A — Conferir & Copiar Snacks Faltantes (Frontend).
 * Carrega automaticamente os 41 Snacks do HTML da pasta ao abrir.
 */

const state = {
  sourceSnacks: [],
  targetSnacks: [],
  comparison: [],
  summary: { totalSource: 0, totalTarget: 0, duplicatasExatas: 0, duplicatasCodigo: 0, duplicatasNome: 0, faltantes: 0 },
  manualLinks: {},
  selectedForClone: new Set(),
  openCompare: new Set(),
  previewTargetIdx: {},
  selectedFileByRow: {},
  cloningIndices: new Set(),
  accountLoaded: false,
  selectTabFn: null,
};

const $ = (id) => document.getElementById(id);

const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function showToast(message, type = 'ok', durationMs = 4500) {
  const stack = $('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, durationMs);
}

function showBanner(message, type = 'ok') {
  const el = $('liveBanner');
  el.textContent = message;
  el.className = `live-banner ${type}`;
  el.hidden = false;
  showToast(message, type);
}

async function apiPost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Erro HTTP ${res.status}`);
  }
  return data;
}

/* ===========================
   TABS ACESSÍVEIS (Modern Web Guidance)
=========================== */
function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [$('panel-clonar'), $('panel-doc')];

  function selectTab(index, moveFocus = false) {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.toggleAttribute('focusgroupstart', active);
      const panel = panels[i];
      if (active) {
        panel.removeAttribute('hidden');
        panel.setAttribute('tabindex', '0');
      } else {
        panel.hidden = 'until-found';
        panel.removeAttribute('tabindex');
      }
    });
    tabs[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (moveFocus) tabs[index].focus();
    if (index === 1) renderDocument();
  }

  state.selectTabFn = selectTab;

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => selectTab(idx));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectTab((idx + 1) % tabs.length, true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectTab((idx - 1 + tabs.length) % tabs.length, true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        selectTab(0, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        selectTab(tabs.length - 1, true);
      }
    });
  });

  panels.forEach((panel, idx) => {
    panel.addEventListener('beforematch', () => selectTab(idx));
  });
}

/* ===========================
   COMPARAÇÃO E ESTADO
=========================== */
async function recomputeComparison() {
  if (state.sourceSnacks.length === 0) {
    state.comparison = [];
    state.summary = { totalSource: 0, totalTarget: state.targetSnacks.length, duplicatasExatas: 0, duplicatasCodigo: 0, duplicatasNome: 0, faltantes: 0 };
    state.selectedForClone.clear();
    renderAll();
    return;
  }

  const data = await apiPost('/api/compare', {
    source: state.sourceSnacks,
    target: state.targetSnacks,
  });

  state.comparison = data.results.map((r) => {
    const manual = state.manualLinks[r.sourceIndex];
    if (manual !== undefined) {
      return {
        ...r,
        targetIndex: manual,
        status: 'duplicata_exata',
        reason: `Vinculado manualmente a "${state.targetSnacks[manual]?.name || state.targetSnacks[manual]?.nome}"`,
        shouldSkipClone: true,
      };
    }
    return r;
  });

  state.summary = {
    totalSource: state.sourceSnacks.length,
    totalTarget: state.targetSnacks.length,
    duplicatasExatas: state.comparison.filter((r) => r.status === 'duplicata_exata').length,
    duplicatasCodigo: state.comparison.filter((r) => r.status === 'duplicata_codigo').length,
    duplicatasNome: state.comparison.filter((r) => r.status === 'duplicata_nome').length,
    faltantes: state.comparison.filter((r) => r.status === 'faltante').length,
  };

  // Marca automaticamente apenas os faltantes
  state.selectedForClone = new Set(
    state.comparison.filter((r) => !r.shouldSkipClone).map((r) => r.sourceIndex)
  );

  renderAll();
}

function getPrimaryCodeText(snack, preferredFile = null) {
  if (!snack) return '';
  if (preferredFile && snack.files?.[preferredFile]?.contents) {
    return snack.files[preferredFile].contents;
  }
  if (snack.files && typeof snack.files === 'object') {
    for (const k of ['App.js', 'App.tsx', 'App.jsx', 'App.ts']) {
      if (snack.files[k]?.contents) return snack.files[k].contents;
    }
    for (const val of Object.values(snack.files)) {
      if (val?.type === 'CODE' && val.contents) return val.contents;
    }
  }
  return typeof snack.code === 'string' ? snack.code : '';
}

function getFileList(snack) {
  if (!snack?.files || typeof snack.files !== 'object') return [];
  return Object.keys(snack.files).filter((k) => snack.files[k]?.type === 'CODE' || typeof snack.files[k]?.contents === 'string');
}

function buildQuickOpenUrl(snack) {
  if (snack.urlCriar) return snack.urlCriar;
  const code = getPrimaryCodeText(snack);
  const name = snack.name || snack.nome || 'Snack';
  if (code && code.length < 3500 && getFileList(snack).length <= 1) {
    return `https://snack.expo.dev/?name=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`;
  }
  return snack.origemUrl || snack.url || 'https://snack.expo.dev/';
}

/* ===========================
   RENDERIZAÇÃO
=========================== */
function renderAll() {
  $('targetCountLabel').textContent = state.targetSnacks.length
    ? `${state.targetSnacks.length} Snacks encontrados na sua conta.`
    : 'Nenhum Snack da sua conta carregado ainda — conecte seu token ou importe sua lista para ver o que falta.';

  $('btnResolveTarget').disabled = state.targetSnacks.length === 0;

  $('kpiTotal').textContent = String(state.summary.totalSource);
  $('kpiExisting').textContent = String(state.summary.duplicatasExatas + state.summary.duplicatasCodigo);
  $('kpiAttention').textContent = String(state.summary.duplicatasNome);
  $('kpiMissing').textContent = String(state.summary.faltantes);

  const selectedCount = state.selectedForClone.size;
  $('btnCloneSelected').textContent = `Copiar Faltantes para Minha Conta (${selectedCount})`;
  $('btnCloneSelected').disabled = selectedCount === 0;
  $('btnDryRun').disabled = selectedCount === 0;

  renderGuidedBanner();
  renderSnackList();
  renderDocument();
}

function renderGuidedBanner() {
  const el = $('guidedBanner');
  if (!el) return;
  if (!state.accountLoaded || state.sourceSnacks.length === 0) {
    el.hidden = true;
    return;
  }

  const missing = state.summary.faltantes;
  el.hidden = false;

  if (missing === 0) {
    el.className = 'guided-banner done';
    el.innerHTML = `
      <div>
        <strong>Tudo completo! Todos os ${state.summary.totalSource} Snacks estão na sua conta.</strong>
        <p>Agora é só ir para a Aba 2 para copiar a tabela no Google Docs ou baixar o arquivo Word (.doc).</p>
      </div>
      <button type="button" class="btn btn-success" id="btnGoToDoc">Gerar Documento da Turma →</button>
    `;
    $('btnGoToDoc').addEventListener('click', () => state.selectTabFn?.(1, true));
  } else {
    el.className = 'guided-banner';
    el.innerHTML = `
      <div>
        <strong>Faltam ${missing} Snack${missing > 1 ? 's' : ''} na sua conta</strong>
        <p>Os ${state.summary.duplicatasExatas + state.summary.duplicatasCodigo + state.summary.duplicatasNome} que você já tem serão pulados automaticamente.</p>
      </div>
      <button type="button" class="btn btn-success" id="btnGuidedCloneAll">Copiar todos os ${missing} faltantes de uma vez</button>
    `;
    $('btnGuidedCloneAll').addEventListener('click', () => {
      const missingIndices = state.comparison.filter((r) => !r.shouldSkipClone).map((r) => r.sourceIndex);
      runClone(missingIndices, false);
    });
  }
}

function statusBadgeHtml(cmp) {
  switch (cmp.status) {
    case 'duplicata_exata':
      return '<span class="badge badge-ok">✓ Já tenho</span>';
    case 'duplicata_codigo':
      return cmp.similarity && cmp.similarity < 100
        ? `<span class="badge badge-ok">✓ Código ~${cmp.similarity}% igual</span>`
        : '<span class="badge badge-ok">✓ Mesmo código</span>';
    case 'duplicata_nome':
      return '<span class="badge badge-warn">! Mesmo nome, código diferente</span>';
    default:
      return '<span class="badge badge-info">● Faltante</span>';
  }
}

function renderSnackList() {
  const container = $('snackListContainer');
  if (state.sourceSnacks.length === 0) {
    container.innerHTML = `<div class="empty-state">Nenhum Snack encontrado na lista base da pasta.</div>`;
    return;
  }

  const query = $('searchSnacks').value.trim().toLowerCase();
  const filter = $('filterStatus').value;

  const targetOptions = (selectedIdx, placeholder) => {
    const opts = [`<option value="">${escapeHtml(placeholder)}</option>`];
    state.targetSnacks.forEach((t, i) => {
      const sel = selectedIdx === i ? 'selected' : '';
      opts.push(`<option value="${i}" ${sel}>${escapeHtml(t.name || t.nome)}</option>`);
    });
    return opts.join('');
  };

  const rows = [];
  state.comparison.forEach((cmp) => {
    const idx = cmp.sourceIndex;
    const src = state.sourceSnacks[idx];
    const name = src.name || src.nome || `Snack ${idx + 1}`;

    if (query && !name.toLowerCase().includes(query)) return;
    if (filter === 'faltante' && cmp.status !== 'faltante') return;
    if (filter === 'duplicatas' && !['duplicata_exata', 'duplicata_codigo'].includes(cmp.status)) return;
    if (filter === 'duplicata_nome' && cmp.status !== 'duplicata_nome') return;

    const checked = state.selectedForClone.has(idx) ? 'checked' : '';
    const isOpen = state.openCompare.has(idx);
    const linkedTarget = cmp.targetIndex !== null ? state.targetSnacks[cmp.targetIndex] : null;
    const pIdx = state.previewTargetIdx[idx] !== undefined ? state.previewTargetIdx[idx] : cmp.targetIndex;
    const previewTarget = pIdx !== null && pIdx !== undefined ? state.targetSnacks[pIdx] : null;

    const files = getFileList(src);
    const activeFile = state.selectedFileByRow[idx] || files[0] || null;
    const srcCode = getPrimaryCodeText(src, activeFile);
    const tgtCode = previewTarget ? getPrimaryCodeText(previewTarget, activeFile) : '';

    const compareHtml = isOpen
      ? `
        <div class="compare-panel">
          <div class="code-pane">
            <div class="code-pane-head">
              <span>Código Original (${escapeHtml(name)})</span>
              ${src.origemUrl ? `<a href="${escapeHtml(src.origemUrl)}" target="_blank" rel="noopener">Abrir original ↗</a>` : ''}
            </div>
            <pre class="code-block">${srcCode ? escapeHtml(srcCode) : 'Projeto com múltiplos arquivos/assets — ao clicar em "Copiar para Minha Conta", todos os arquivos são baixados automaticamente da API do Expo.'}</pre>
          </div>

          <div class="code-pane">
            <div class="code-pane-head">
              <span>Comparar com Snack da sua conta</span>
              ${previewTarget?.url ? `<a href="${escapeHtml(previewTarget.url)}" target="_blank" rel="noopener">Abrir meu Snack ↗</a>` : ''}
            </div>
            ${
              state.targetSnacks.length
                ? `<div style="display:flex; gap:6px; align-items:center;">
                    <select data-action="preview-target" data-idx="${idx}" aria-label="Escolher Snack seu para comparar">${targetOptions(pIdx, 'Escolha um Snack seu...')}</select>
                    ${pIdx !== null && pIdx !== undefined && pIdx !== cmp.targetIndex
                      ? `<button type="button" class="btn btn-success btn-sm" data-action="confirm-link" data-idx="${idx}">✓ É este!</button>`
                      : ''}
                  </div>
                  <pre class="code-block">${
                    previewTarget
                      ? (tgtCode ? escapeHtml(tgtCode) : 'Código não carregado na importação rápida. Clique em "Baixar Códigos dos Meus Snacks" ou conecte com Token.')
                      : 'Selecione um Snack da sua conta acima para comparar lado a lado.'
                  }</pre>`
                : `<pre class="code-block">Conecte sua conta ou importe sua lista acima para comparar seus projetos aqui.</pre>`
            }
          </div>
        </div>
      `
      : '';

    const isMissing = cmp.status === 'faltante';

    rows.push(`
      <article class="snack-item status-${cmp.status}">
        <div class="snack-item-head">
          <div class="snack-title-wrap">
            <input type="checkbox" data-action="toggle-select" data-idx="${idx}" ${checked} aria-label="Selecionar ${escapeHtml(name)} para copiar">
            <div>
              <div class="snack-name">${idx + 1}. ${escapeHtml(name)} ${statusBadgeHtml(cmp)}</div>
              <div class="snack-meta">
                ${escapeHtml(cmp.reason)}
                ${linkedTarget ? ` · Meu Snack: <b>${escapeHtml(linkedTarget.name || linkedTarget.nome)}</b>` : ''}
              </div>
            </div>
          </div>

          <div class="snack-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-compare" data-idx="${idx}">
              ${isOpen ? 'Fechar Código' : 'Ver / Comparar'}
            </button>
            ${
              state.targetSnacks.length
                ? `<select data-action="manual-link" data-idx="${idx}" aria-label="Vincular ${escapeHtml(name)} manualmente">${targetOptions(cmp.targetIndex, 'Já tenho como...')}</select>`
                : ''
            }
            ${
              isMissing
                ? `<button type="button" class="btn btn-success btn-sm" data-action="clone-one" data-idx="${idx}" ${state.cloningIndices.has(idx) ? 'disabled' : ''}>${state.cloningIndices.has(idx) ? 'Copiando...' : 'Copiar p/ Minha Conta'}</button>`
                : ''
            }
            <a class="btn btn-secondary btn-sm" href="${escapeHtml(buildQuickOpenUrl(src))}" target="_blank" rel="noopener">Abrir no Expo ↗</a>
          </div>
        </div>
        ${compareHtml}
      </article>
    `);
  });

  container.innerHTML = rows.length
    ? rows.join('')
    : '<div class="empty-state">Nenhum Snack corresponde ao filtro atual.</div>';
}

/* ===========================
   DOCUMENTO (GOOGLE DOCS / WORD)
=========================== */
function renderDocument() {
  const aluno = $('docAluno').value.trim() || 'Nome do Aluno';
  let user = $('docUsuario').value.trim() || '@usuario';
  if (!user.startsWith('@')) user = '@' + user;
  const turma = $('docTurma').value.trim() || '604A';
  const data = $('docData').value.trim();

  const rows = [];
  const usedTargets = new Set();

  state.comparison.forEach((cmp) => {
    if (cmp.targetIndex !== null && state.targetSnacks[cmp.targetIndex]) {
      usedTargets.add(cmp.targetIndex);
      const t = state.targetSnacks[cmp.targetIndex];
      const urlFinal = (t.url || '').replace(/snack\.expo\.dev\/@[^/]+/, `snack.expo.dev/${user}`);
      rows.push({ nome: t.name || t.nome, url: urlFinal });
    }
  });

  if ($('docIncludeExtras').checked) {
    state.targetSnacks.forEach((t, idx) => {
      if (!usedTargets.has(idx)) {
        const urlFinal = (t.url || '').replace(/snack\.expo\.dev\/@[^/]+/, `snack.expo.dev/${user}`);
        rows.push({ nome: t.name || t.nome, url: urlFinal });
      }
    });
  }

  const tbody = rows.length
    ? rows
        .map(
          (r, i) => `
          <tr>
            <th scope="row">${i + 1}</th>
            <td>${escapeHtml(r.nome)}</td>
            <td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="text-align:center;color:#6b7280;">Conecte ou importe seus Snacks na Aba 1 para montar o documento.</td></tr>`;

  $('docPreview').innerHTML = `
    <h2>Links dos Snacks — Expo (Turma ${escapeHtml(turma)})</h2>
    <p style="font-size:0.94rem; margin-bottom:16px;">
      <b>Aluno:</b> ${escapeHtml(aluno)}<br>
      <b>Turma:</b> ${escapeHtml(turma)}<br>
      <b>Usuário Expo:</b> ${escapeHtml(user)}<br>
      <b>Data:</b> ${escapeHtml(data)}
    </p>
    <div tabindex="0" role="region" aria-labelledby="doc-table-caption" class="table-wrapper">
      <table class="doc-table">
        <caption id="doc-table-caption">Lista de Projetos (${rows.length})</caption>
        <thead>
          <tr>
            <th style="width:52px;">#</th>
            <th>Projeto / Snack</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

/* ===========================
   CÓPIA EM LOTE OU INDIVIDUAL (PROGRESSO AO VIVO ITEM POR ITEM)
=========================== */
async function runClone(indices, dryRun = false, { forceSingle = false } = {}) {
  if (!indices || indices.length === 0) return;

  const token = $('targetToken').value.trim();
  if (!dryRun && !token) {
    showBanner('Cole seu código de Token do Expo no topo para copiar direto para a sua conta.', 'warn');
    $('targetToken').focus();
    return;
  }

  const selectedSet = new Set(indices);
  const boundToOtherIndices = new Set();
  state.comparison.forEach((cmp) => {
    if (!selectedSet.has(cmp.sourceIndex) && cmp.targetIndex !== null) {
      boundToOtherIndices.add(cmp.targetIndex);
    }
  });
  const unboundTargetSnacks = state.targetSnacks.filter((_, tIdx) => !boundToOtherIndices.has(tIdx));

  const box = $('cloneProgressBox');
  const log = $('cloneLog');
  box.hidden = false;
  log.innerHTML = '';

  const total = indices.length;
  let clonedCount = 0;
  let wouldCloneCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  $('cloneProgressText').textContent = dryRun
    ? 'Simulando cópia...'
    : `Preparando cópia de ${total} Snack(s)...`;
  $('cloneProgressCount').textContent = `0 / ${total}`;
  $('cloneProgressFill').style.width = '4%';

  $('btnCloneSelected').disabled = true;
  $('btnDryRun').disabled = true;

  // Modo Dry-Run vai em 1 chamada rápida; cópia real vai 1 por 1 para progresso ao vivo e zero timeout na Vercel
  if (dryRun) {
    try {
      const selectedSnacks = indices.map((i) => state.sourceSnacks[i]);
      const res = await apiPost('/api/clone', {
        auth: token,
        snacks: selectedSnacks,
        existingTargetSnacks: unboundTargetSnacks,
        skipDuplicates: !forceSingle,
        dryRun: true,
      });

      $('cloneProgressFill').style.width = '100%';
      $('cloneProgressCount').textContent = `${res.summary.total} / ${res.summary.total}`;
      log.innerHTML = res.report
        .map((item) =>
          item.status === 'would_clone'
            ? `<div>● [Simulação] <b>${escapeHtml(item.name)}</b> seria copiado.</div>`
            : `<div>↷ <b>${escapeHtml(item.name)}</b> pulado (${escapeHtml(item.reason)}).</div>`
        )
        .join('');
      $('cloneProgressText').textContent = `Simulação: ${res.summary.wouldClone} prontos para copiar, ${res.summary.skipped} repetidos pulados.`;
      showBanner(`Simulação OK: ${res.summary.wouldClone} seriam copiados e ${res.summary.skipped} repetidos foram pulados.`, 'ok');
    } catch (err) {
      $('cloneProgressText').textContent = 'Erro na simulação.';
      showBanner(`Erro: ${err.message}`, 'err');
    } finally {
      $('btnCloneSelected').disabled = state.selectedForClone.size === 0;
      $('btnDryRun').disabled = state.selectedForClone.size === 0;
    }
    return;
  }

  try {
    for (let step = 0; step < total; step++) {
      const idx = indices[step];
      const snack = state.sourceSnacks[idx];
      const name = snack.name || snack.nome || `Snack ${idx + 1}`;

      state.cloningIndices.add(idx);
      renderSnackList();

      $('cloneProgressText').textContent = `Copiando ${step + 1} de ${total}: ${name}...`;
      $('cloneProgressCount').textContent = `${step} / ${total}`;
      $('cloneProgressFill').style.width = `${Math.max(5, Math.round((step / total) * 100))}%`;

      try {
        const res = await apiPost('/api/clone', {
          auth: token,
          snacks: [snack],
          existingTargetSnacks: unboundTargetSnacks,
          skipDuplicates: !forceSingle,
          dryRun: false,
        });

        const item = res.report?.[0];
        if (item?.status === 'cloned') {
          clonedCount++;
          const warn = item.warning ? ` ⚠ ${escapeHtml(item.warning)}` : '';
          log.insertAdjacentHTML(
            'beforeend',
            `<div>✓ <b>${escapeHtml(item.name)}</b> copiado → <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a>${warn}</div>`
          );
          const created = {
            id: item.id,
            name: item.name,
            nome: item.name,
            url: item.url,
            files: snack.files || {},
            code: snack.code || '',
            dependencies: snack.dependencies || {},
          };
          state.targetSnacks.push(created);
          unboundTargetSnacks.push(created);
        } else if (item?.status === 'skipped_duplicate') {
          skippedCount++;
          log.insertAdjacentHTML(
            'beforeend',
            `<div>↷ <b>${escapeHtml(item.name)}</b> pulado (${escapeHtml(item.reason)}).</div>`
          );
        } else {
          errorCount++;
          log.insertAdjacentHTML(
            'beforeend',
            `<div style="color:var(--err);">✕ <b>${escapeHtml(name)}</b>: ${escapeHtml(item?.error || 'Erro desconhecido')}</div>`
          );
        }
      } catch (err) {
        errorCount++;
        log.insertAdjacentHTML(
          'beforeend',
          `<div style="color:var(--err);">✕ <b>${escapeHtml(name)}</b>: ${escapeHtml(err.message)}</div>`
        );
      } finally {
        state.cloningIndices.delete(idx);
        log.scrollTop = log.scrollHeight;
      }

      $('cloneProgressCount').textContent = `${step + 1} / ${total}`;
      $('cloneProgressFill').style.width = `${Math.round(((step + 1) / total) * 100)}%`;
      await recomputeComparison();
    }

    $('cloneProgressText').textContent = `Concluído! ${clonedCount} copiados, ${skippedCount} repetidos pulados, ${errorCount} erros.`;
    showBanner(
      `Cópia concluída: ${clonedCount} criados na sua conta, ${skippedCount} repetidos pulados${errorCount ? `, ${errorCount} erros` : ''}.`,
      errorCount ? 'warn' : 'ok'
    );
  } finally {
    indices.forEach((i) => state.cloningIndices.delete(i));
    $('btnCloneSelected').disabled = state.selectedForClone.size === 0;
    $('btnDryRun').disabled = state.selectedForClone.size === 0;
    renderSnackList();
  }
}

/* ===========================
   EVENTOS & BOOTSTRAP
=========================== */
function bindEvents() {
  $('snackListContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = Number(btn.dataset.idx);

    if (action === 'toggle-compare') {
      if (state.openCompare.has(idx)) state.openCompare.delete(idx);
      else state.openCompare.add(idx);
      renderSnackList();
    } else if (action === 'confirm-link') {
      if (state.previewTargetIdx[idx] !== undefined) {
        state.manualLinks[idx] = state.previewTargetIdx[idx];
        recomputeComparison();
      }
    } else if (action === 'clone-one') {
      runClone([idx], false, { forceSingle: true });
    }
  });

  $('snackListContainer').addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const idx = Number(el.dataset.idx);

    if (action === 'toggle-select') {
      if (el.checked) state.selectedForClone.add(idx);
      else state.selectedForClone.delete(idx);
      renderAll();
    } else if (action === 'manual-link') {
      if (el.value === '') delete state.manualLinks[idx];
      else {
        state.manualLinks[idx] = Number(el.value);
        state.previewTargetIdx[idx] = Number(el.value);
      }
      recomputeComparison();
    } else if (action === 'preview-target') {
      if (el.value === '') delete state.previewTargetIdx[idx];
      else state.previewTargetIdx[idx] = Number(el.value);
      renderSnackList();
    }
  });

  $('btnToggleToken').addEventListener('click', () => {
    const input = $('targetToken');
    const masked = input.classList.toggle('masked-token');
    $('btnToggleToken').textContent = masked ? 'Mostrar' : 'Ocultar';
  });

  async function connectAccount() {
    const token = $('targetToken').value.trim();
    if (!token) {
      showBanner('Cole seu código de Token do Expo primeiro (veja os 3 passos acima).', 'warn');
      return;
    }
    showBanner('Lendo todos os Snacks da sua conta Expo e conferindo o que falta...', 'ok');
    $('btnLoadTargetAccount').disabled = true;
    try {
      const data = await apiPost('/api/account/snacks', { auth: token, includeCode: true });
      state.targetSnacks = data.snacks || [];
      state.accountLoaded = true;
      if (data.username && !$('docUsuario').value.trim()) {
        $('docUsuario').value = data.username;
      }
      await recomputeComparison();
      if (state.summary.faltantes > 0) {
        $('filterStatus').value = 'faltante';
        renderSnackList();
      }
      showBanner(`Conta ${data.username} carregada! Você já tem ${state.summary.duplicatasExatas + state.summary.duplicatasCodigo} e faltam ${state.summary.faltantes}.`, 'ok');
    } catch (err) {
      showBanner(`Falha ao conectar conta: ${err.message}`, 'err');
    } finally {
      $('btnLoadTargetAccount').disabled = false;
    }
  }

  $('btnLoadTargetAccount').addEventListener('click', connectAccount);

  // Botão Colar (prático no celular) + conexão automática ao colar o token
  $('btnPasteToken').addEventListener('click', async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        showBanner('Sua área de transferência está vazia.', 'warn');
        return;
      }
      $('targetToken').value = clip;
      connectAccount();
    } catch {
      $('targetToken').focus();
      showBanner('Toque no campo e aperte Ctrl+V (ou segure para colar).', 'warn');
    }
  });

  $('targetToken').addEventListener('paste', () => {
    setTimeout(() => {
      if ($('targetToken').value.trim().length >= 16) {
        connectAccount();
      }
    }, 60);
  });

  $('btnUploadTarget').addEventListener('click', () => $('fileTarget').click());
  $('fileTarget').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = await apiPost('/api/parse-input', { raw: text });
    state.targetSnacks = parsed.snacks || [];
    state.accountLoaded = true;
    const firstUser = state.targetSnacks[0]?.url?.match(/snack\.expo\.dev\/(@[^/]+)/)?.[1];
    if (firstUser && !$('docUsuario').value.trim()) $('docUsuario').value = firstUser;
    await recomputeComparison();
    showBanner(`Lista importada (${state.targetSnacks.length} Snacks). Faltam ${state.summary.faltantes}.`, 'ok');
  });

  $('btnParseTarget').addEventListener('click', async () => {
    const raw = $('rawTargetInput').value;
    const parsed = await apiPost('/api/parse-input', { raw });
    state.targetSnacks = parsed.snacks || [];
    state.accountLoaded = true;
    const firstUser = state.targetSnacks[0]?.url?.match(/snack\.expo\.dev\/(@[^/]+)/)?.[1];
    if (firstUser && !$('docUsuario').value.trim()) $('docUsuario').value = firstUser;
    await recomputeComparison();
    showBanner(`Lista importada (${state.targetSnacks.length} Snacks). Faltam ${state.summary.faltantes}.`, 'ok');
  });

  $('btnResolveTarget').addEventListener('click', async () => {
    showBanner('Baixando códigos dos seus Snacks para detectar duplicatas mesmo com nome diferente...', 'ok');
    $('btnResolveTarget').disabled = true;
    try {
      const res = await apiPost('/api/snacks/resolve', { snacks: state.targetSnacks });
      state.targetSnacks = res.snacks;
      await recomputeComparison();
      showBanner(`Códigos baixados (${res.resolvedOk}/${res.total}). Faltam ${state.summary.faltantes} Snacks.`, 'ok');
    } catch (err) {
      showBanner(`Erro ao baixar códigos: ${err.message}`, 'err');
    } finally {
      $('btnResolveTarget').disabled = false;
    }
  });

  $('searchSnacks').addEventListener('input', renderSnackList);
  $('filterStatus').addEventListener('change', renderSnackList);

  $('btnSelectMissing').addEventListener('click', () => {
    state.selectedForClone = new Set(
      state.comparison.filter((r) => !r.shouldSkipClone).map((r) => r.sourceIndex)
    );
    renderAll();
  });

  $('btnSelectNone').addEventListener('click', () => {
    state.selectedForClone.clear();
    renderAll();
  });

  $('btnDryRun').addEventListener('click', () => runClone([...state.selectedForClone].sort((a, b) => a - b), true));
  $('btnCloneSelected').addEventListener('click', () => runClone([...state.selectedForClone].sort((a, b) => a - b), false));

  // Aba 2: Documento
  ['docAluno', 'docUsuario', 'docTurma', 'docData'].forEach((id) => {
    $(id).addEventListener('input', renderDocument);
  });
  $('docIncludeExtras').addEventListener('change', renderDocument);

  $('btnCopyDoc').addEventListener('click', async () => {
    const el = $('docPreview');
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([el.innerHTML], { type: 'text/html' }),
          'text/plain': new Blob([el.innerText], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('copy');
      sel.removeAllRanges();
    }
    showBanner('Tabela copiada! Abra docs.new e aperte Ctrl + V.', 'ok');
  });

  $('btnDownloadWord').addEventListener('click', () => {
    const user = ($('docUsuario').value.trim() || 'aluno').replace('@', '');
    const turma = $('docTurma').value.trim() || '604A';
    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
      <head><meta charset="utf-8"><style>
        body { font-family: Arial, sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #888; padding: 6px 8px; text-align: left; }
        th { background: #f2f2f2; }
      </style></head>
      <body>${$('docPreview').innerHTML}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' }));
    a.download = `Links_Snacks_${turma}_${user}.doc`;
    a.click();
    showBanner('Arquivo .doc baixado com sucesso!', 'ok');
  });
}

async function bootstrap() {
  initTabs();
  bindEvents();
  $('docData').value = new Date().toLocaleDateString('pt-BR');

  // Carrega automaticamente os 41 Snacks do HTML da pasta assim que abre
  try {
    const res = await fetch('/api/legacy-catalog');
    const data = await res.json();
    if (data.found && data.snacks.length > 0) {
      state.sourceSnacks = data.snacks;
      const comCodigo = data.withCode ?? data.snacks.length;
      $('catalogStatus').innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${data.snacks.length} Snacks carregados (${comCodigo} com código)</span>`;
      await recomputeComparison();
    } else {
      $('catalogStatus').innerHTML = `<span>Catálogo não encontrado na pasta</span>`;
      renderAll();
    }
  } catch (err) {
    $('catalogStatus').innerHTML = `<span>Erro ao carregar catálogo</span>`;
    showBanner(`Erro ao carregar lista de Snacks: ${err.message}`, 'err');
  }
}

bootstrap();
