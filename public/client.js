/**
 * Painel Turma 604A — Assistente Passo a Passo (4 etapas) + Painel Completo com Atualização de Código.
 */

const state = {
  mode: 'wizard', // 'wizard' | 'full'
  wizardStep: 1,  // 1 | 2 | 3 | 4
  sourceSnacks: [],
  targetSnacks: [],
  comparison: [],
  summary: { totalSource: 0, totalTarget: 0, duplicatasExatas: 0, duplicatasCodigo: 0, duplicatasNome: 0, faltantes: 0 },
  manualLinks: {},
  selectedForClone: new Set(),
  openCompare: new Set(),
  previewTargetIdx: {},
  cloningIndices: new Set(),
  accountLoaded: false,
  selectTabFn: null,
  customDocLinks: [], // [{ nome, url }]
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
  setTimeout(() => el.remove(), durationMs);
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

function getToken() {
  return ($('wizToken').value || $('targetToken').value || '').trim();
}

function setToken(val) {
  $('wizToken').value = val;
  $('targetToken').value = val;
}

/* ===========================
   NAVEGAÇÃO: WIZARD ↔ PAINEL COMPLETO
=========================== */
function setViewMode(mode) {
  state.mode = mode;
  $('wizardView').hidden = mode !== 'wizard';
  $('fullView').hidden = mode !== 'full';
  $('btnSwitchMode').textContent = mode === 'wizard' ? 'Abrir Painel Completo' : '← Voltar ao Passo a Passo';
  if (mode === 'full') renderAll();
  else renderWizard();
}

function goToWizardStep(step) {
  state.wizardStep = step;
  for (let i = 1; i <= 4; i++) {
    const sec = $(`wizardStep${i}`);
    const pill = $(`stepPill${i}`);
    sec.hidden = i !== step;
    pill.classList.toggle('active', i === step);
    pill.classList.toggle('done', i < step);
  }
  renderWizard();
  if (step === 4) renderDocument();
}

function shortMatchLabel(cmp) {
  if (cmp.status === 'duplicata_exata') return 'mesmo nome';
  if (cmp.status === 'duplicata_nome') return 'mesmo nome, código diferente';
  if (cmp.similarity && cmp.similarity < 100) return `${cmp.similarity}% igual`;
  return 'código idêntico';
}

function renderFullStats() {
  const card = $('fullStatsCard');
  if (!card) return;
  if (!state.accountLoaded || state.sourceSnacks.length === 0) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  const total = state.summary.totalSource || 1;
  const missingItems = state.comparison.filter((c) => c.status === 'faltante');
  const errorItems = state.comparison.filter((c) => c.hasCodeError);
  const draftItems = state.comparison.filter((c) => c.isDraft);
  const doneItems = state.comparison.filter((c) => c.status !== 'faltante');
  const pct = Math.round((doneItems.length / total) * 100);

  $('statsTitle').textContent = `Estatísticas da sua Conta (${pct}% concluído)`;
  $('statsSubtitle').textContent = `${doneItems.length} de ${state.summary.totalSource} Snacks feitos · ${missingItems.length} faltando · ${errorItems.length} com erro · ${draftItems.length} em rascunho. Role abaixo para ver o código de qualquer um.`;
  $('statsProgressFill').style.width = `${pct}%`;

  const draftBadge = $('statsDraftBadge');
  if (draftItems.length > 0) {
    draftBadge.hidden = false;
    draftBadge.textContent = `${draftItems.length} em rascunho`;
  } else {
    draftBadge.hidden = true;
  }

  $('statsMissingBox').innerHTML = missingItems.length
    ? `<h3>❌ Faltam na sua conta (${missingItems.length})</h3>
       <ul class="stats-list">${missingItems
         .map((c) => {
           const s = state.sourceSnacks[c.sourceIndex];
           return `<li><b>#${c.sourceIndex + 1} ${escapeHtml(s.name)}</b></li>`;
         })
         .join('')}</ul>`
    : `<h3>✅ Nenhum Snack faltando!</h3><p class="snack-meta" style="margin:0;">Todos os ${state.summary.totalSource} Snacks da turma já existem na sua conta.</p>`;

  const errBox = $('statsErrorsBox');
  if (errorItems.length > 0) {
    errBox.hidden = false;
    errBox.innerHTML = `<h3>⚠️ Com erro no código (${errorItems.length})</h3>
      <ul class="stats-list">${errorItems
        .map((c) => {
          const s = state.sourceSnacks[c.sourceIndex];
          const t = c.targetIndex !== null ? state.targetSnacks[c.targetIndex] : null;
          return `<li><b>${escapeHtml(s.name)}</b>${t ? ` ("${escapeHtml(t.name)}")` : ''}: <span style="color:#fca5a5;">${escapeHtml(c.targetErrors.join(' · '))}</span></li>`;
        })
        .join('')}</ul>`;
  } else {
    errBox.hidden = true;
  }

  const draftBox = $('statsDraftsBox');
  if (draftItems.length > 0) {
    draftBox.hidden = false;
    draftBox.innerHTML = `<h3>📝 Em Rascunho / Draft (${draftItems.length})</h3>
      <ul class="stats-list">${draftItems
        .map((c) => {
          const t = c.targetIndex !== null ? state.targetSnacks[c.targetIndex] : null;
          return `<li><b>${escapeHtml(t?.name || state.sourceSnacks[c.sourceIndex].name)}</b> — rascunho não publicado</li>`;
        })
        .join('')}</ul>`;
  } else {
    draftBox.hidden = true;
  }

  $('statsDoneBox').innerHTML = doneItems.length
    ? `<details><summary style="cursor:pointer; font-weight:700; font-size:0.9rem;">✅ Ver lista dos ${doneItems.length} Snacks que você já tem</summary>
       <ul class="stats-list" style="margin-top:8px;">${doneItems
         .map((c) => {
           const s = state.sourceSnacks[c.sourceIndex];
           const t = c.targetIndex !== null ? state.targetSnacks[c.targetIndex] : null;
           const tName = t?.name || '';
           return `<li><b>#${c.sourceIndex + 1} ${escapeHtml(s.name)}</b> → "${escapeHtml(tName)}" <span style="color:var(--text-muted);">(${escapeHtml(shortMatchLabel(c))})</span></li>`;
         })
         .join('')}</ul></details>`
    : `<h3>Nenhum Snack da lista encontrado ainda</h3>`;
}

function renderWizard() {
  const existing = state.summary.duplicatasExatas + state.summary.duplicatasCodigo;
  const attention = state.summary.duplicatasNome;
  const missing = state.summary.faltantes;
  const withErrors = state.summary.comErro || 0;

  $('wizKpiTotal').textContent = String(state.summary.totalSource);
  $('wizKpiExisting').textContent = String(existing);
  $('wizKpiAttention').textContent = String(attention + withErrors);
  $('wizKpiMissing').textContent = String(missing);

  const errBox = $('wizErrorAlert');
  if (errBox) {
    if (withErrors > 0 && state.accountLoaded) {
      const errNames = state.comparison
        .filter((c) => c.hasCodeError)
        .slice(0, 5)
        .map((c) => state.sourceSnacks[c.sourceIndex]?.name || '')
        .filter(Boolean);
      const more = withErrors > 5 ? ` e mais ${withErrors - 5}` : '';
      errBox.hidden = false;
      errBox.innerHTML = `
        <span>⚠ Encontramos <b>${withErrors} Snack(s)</b> na sua conta com erro no código (${escapeHtml(errNames.join(', '))}${more}).</span>
        <button type="button" class="btn btn-warn btn-sm" id="btnWizFixErrors">Corrigir os ${withErrors} com Erro</button>
      `;
      $('btnWizFixErrors').addEventListener('click', () => fixAllCodeErrors(true));
    } else {
      errBox.hidden = true;
    }
  }

  if (missing === 0 && state.accountLoaded) {
    $('wizDiagTitle').textContent = `Passo 2: Você já tem todos os ${state.summary.totalSource} Snacks!`;
    $('wizMissingPreview').textContent = attention > 0
      ? `Observação: ${attention} Snack(s) têm o mesmo nome mas código diferente. Você pode revisá-los ou atualizá-los no Painel Completo depois.`
      : 'Nenhum Snack faltando — pode ir direto gerar o documento da turma.';
    $('btnWizStartClone').textContent = 'Ir para o Documento Final →';
  } else {
    $('wizDiagTitle').textContent = `Passo 2: Faltam ${missing} Snack${missing > 1 ? 's' : ''} na sua conta`;
    const missingNames = state.comparison
      .filter((c) => !c.shouldSkipClone)
      .slice(0, 8)
      .map((c) => state.sourceSnacks[c.sourceIndex]?.name || '')
      .filter(Boolean);
    const extra = missing > 8 ? ` e mais ${missing - 8}...` : '';
    $('wizMissingPreview').textContent = missingNames.length
      ? `Faltantes: ${missingNames.join(', ')}${extra}`
      : '';
    $('btnWizStartClone').textContent = `Copiar os ${missing} Faltantes Agora →`;
  }
}

/* ===========================
   TABS DO PAINEL COMPLETO
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
      if (!panel) return;
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
      if (e.key === 'ArrowRight') { e.preventDefault(); selectTab((idx + 1) % tabs.length, true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); selectTab((idx - 1 + tabs.length) % tabs.length, true); }
      else if (e.key === 'Home') { e.preventDefault(); selectTab(0, true); }
      else if (e.key === 'End') { e.preventDefault(); selectTab(tabs.length - 1, true); }
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
    renderWizard();
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
    comErro: state.comparison.filter((r) => r.hasCodeError).length,
  };

  state.selectedForClone = new Set(
    state.comparison.filter((r) => !r.shouldSkipClone).map((r) => r.sourceIndex)
  );

  renderAll();
  renderWizard();
}

function getPrimaryCodeText(snack) {
  if (!snack) return '';
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

function buildQuickOpenUrl(snack) {
  if (snack.urlCriar) return snack.urlCriar;
  const code = getPrimaryCodeText(snack);
  const name = snack.name || snack.nome || 'Snack';
  if (code && code.length < 3500) {
    return `https://snack.expo.dev/?name=${encodeURIComponent(name)}&code=${encodeURIComponent(code)}`;
  }
  return snack.origemUrl || snack.url || 'https://snack.expo.dev/';
}

/* ===========================
   RENDERIZAÇÃO DO PAINEL COMPLETO
=========================== */
function renderAll() {
  $('targetCountLabel').textContent = state.targetSnacks.length
    ? `${state.targetSnacks.length} Snacks encontrados na sua conta.`
    : 'Nenhum Snack da sua conta carregado ainda — conecte seu token ou importe sua lista.';

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
  renderFullStats();
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
  const withErrors = state.summary.comErro || 0;
  el.hidden = false;

  if (missing === 0 && withErrors === 0) {
    el.className = 'guided-banner done';
    el.innerHTML = `
      <div>
        <strong>Tudo completo! Todos os ${state.summary.totalSource} Snacks estão na sua conta sem erros.</strong>
        <p>Você pode gerar o documento na Aba 2 ou usar "Atualizar Código" em qualquer card abaixo.</p>
      </div>
      <button type="button" class="btn btn-success" id="btnGoToDoc">Gerar Documento da Turma →</button>
    `;
    $('btnGoToDoc').addEventListener('click', () => state.selectTabFn?.(1, true));
  } else if (missing === 0 && withErrors > 0) {
    el.className = 'guided-banner';
    el.innerHTML = `
      <div>
        <strong>⚠ Todos os 41 existem, mas ${withErrors} Snack(s) têm erro no código</strong>
        <p>Sugerimos atualizar esses códigos pela versão corrigida do site antes de entregar.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-warn" id="btnGuidedFixErrors">Corrigir os ${withErrors} com Erro</button>
        <button type="button" class="btn btn-secondary" id="btnGoToDoc">Ir para o Documento →</button>
      </div>
    `;
    $('btnGuidedFixErrors').addEventListener('click', () => fixAllCodeErrors(false));
    $('btnGoToDoc').addEventListener('click', () => state.selectTabFn?.(1, true));
  } else {
    el.className = 'guided-banner';
    el.innerHTML = `
      <div>
        <strong>Faltam ${missing} Snack${missing > 1 ? 's' : ''} na sua conta${withErrors > 0 ? ` · ⚠ ${withErrors} com erro no código` : ''}</strong>
        <p>Os ${state.summary.duplicatasExatas + state.summary.duplicatasCodigo + state.summary.duplicatasNome} que você já tem serão pulados automaticamente.</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${withErrors > 0 ? `<button type="button" class="btn btn-warn" id="btnGuidedFixErrors">Corrigir ${withErrors} com Erro</button>` : ''}
        <button type="button" class="btn btn-success" id="btnGuidedCloneAll">Copiar todos os ${missing} faltantes</button>
      </div>
    `;
    if (withErrors > 0) $('btnGuidedFixErrors').addEventListener('click', () => fixAllCodeErrors(false));
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
    container.innerHTML = `<div class="empty-state">Nenhum Snack encontrado na lista base.</div>`;
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
    if (filter === 'com_erro' && !cmp.hasCodeError) return;
    if (filter === 'duplicatas' && !['duplicata_exata', 'duplicata_codigo'].includes(cmp.status)) return;
    if (filter === 'duplicata_nome' && cmp.status !== 'duplicata_nome') return;

    const checked = state.selectedForClone.has(idx) ? 'checked' : '';
    const isOpen = state.openCompare.has(idx);
    const linkedTarget = cmp.targetIndex !== null ? state.targetSnacks[cmp.targetIndex] : null;
    const pIdx = state.previewTargetIdx[idx] !== undefined ? state.previewTargetIdx[idx] : cmp.targetIndex;
    const previewTarget = pIdx !== null && pIdx !== undefined ? state.targetSnacks[pIdx] : null;
    const srcCode = getPrimaryCodeText(src);
    const tgtCode = previewTarget ? getPrimaryCodeText(previewTarget) : '';
    const isBusy = state.cloningIndices.has(idx);

    const compareHtml = isOpen
      ? `
        <div class="compare-panel">
          <div class="code-pane">
            <div class="code-pane-head">
              <span>Código Oficial (${escapeHtml(name)})</span>
              ${src.origemUrl ? `<a href="${escapeHtml(src.origemUrl)}" target="_blank" rel="noopener">Abrir original ↗</a>` : ''}
            </div>
            <pre class="code-block">${srcCode ? escapeHtml(srcCode) : 'Projeto com múltiplos arquivos/assets.'}</pre>
          </div>
          <div class="code-pane">
            <div class="code-pane-head">
              <span>Seu Snack na Conta</span>
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
                      ? (tgtCode ? escapeHtml(tgtCode) : 'Código não carregado. Conecte com Token ou clique em "Baixar Códigos dos Meus Snacks".')
                      : 'Selecione um Snack da sua conta acima para comparar.'
                  }</pre>`
                : `<pre class="code-block">Conecte sua conta para comparar lado a lado.</pre>`
            }
          </div>
        </div>
      `
      : '';

    const isMissing = cmp.status === 'faltante';
    const canUpdateCode = !isMissing && linkedTarget !== null;

    rows.push(`
      <article class="snack-item status-${cmp.status}">
        <div class="snack-item-head">
          <div class="snack-title-wrap">
            <input type="checkbox" data-action="toggle-select" data-idx="${idx}" ${checked} aria-label="Selecionar ${escapeHtml(name)}">
            <div>
              <div class="snack-name">
                ${idx + 1}. ${escapeHtml(name)} ${statusBadgeHtml(cmp)}
                ${cmp.hasCodeError ? '<span class="badge badge-err">⚠ Erro no código</span>' : ''}
                ${cmp.isDraft ? '<span class="badge badge-warn">⚠ Rascunho (Draft)</span>' : ''}
              </div>
              <div class="snack-meta">
                ${
                  linkedTarget
                    ? `Meu Snack: <b>${escapeHtml(linkedTarget.name || linkedTarget.nome)}</b> · ${escapeHtml(shortMatchLabel(cmp))}`
                    : escapeHtml(cmp.reason)
                }
              </div>
              ${
                cmp.hasCodeError
                  ? `<div class="snack-meta" style="color:#fca5a5; margin-top:2px;">⚠ ${escapeHtml(cmp.targetErrors.join(' · '))} — sugerimos clicar em <b>Corrigir Código</b>.</div>`
                  : ''
              }
              ${
                cmp.isDraft
                  ? `<div class="snack-meta" style="color:#fcd34d; margin-top:2px;">⚠ Salvo como Rascunho (Draft) — pode não abrir para o professor. Clique em <b>Publicar Agora</b>.</div>`
                  : ''
              }
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
                ? `<button type="button" class="btn btn-success btn-sm" data-action="clone-one" data-idx="${idx}" ${isBusy ? 'disabled' : ''}>${isBusy ? 'Copiando...' : 'Copiar p/ Minha Conta'}</button>`
                : ''
            }
            ${
              canUpdateCode
                ? `<button type="button" class="btn ${cmp.hasCodeError || cmp.isDraft || cmp.status === 'duplicata_nome' ? 'btn-warn' : 'btn-secondary'} btn-sm" data-action="update-one" data-idx="${idx}" ${isBusy ? 'disabled' : ''} title="Publicar / atualizar o código do seu Snack pelo oficial">${isBusy ? 'Atualizando...' : (cmp.hasCodeError ? 'Corrigir Código' : (cmp.isDraft ? 'Publicar Agora' : 'Atualizar Código'))}</button>`
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
function syncDocFields(fromWizard = false) {
  if (fromWizard) {
    $('docAluno').value = $('wizDocAluno').value;
    $('docUsuario').value = $('wizDocUsuario').value;
    $('docTurma').value = $('wizDocTurma').value;
  } else {
    $('wizDocAluno').value = $('docAluno').value;
    $('wizDocUsuario').value = $('docUsuario').value;
    $('wizDocTurma').value = $('docTurma').value;
  }
  renderDocument();
}

function renderDocument() {
  const aluno = $('docAluno').value.trim() || 'Nome do Aluno';
  let user = $('docUsuario').value.trim() || '@usuario';
  if (!user.startsWith('@')) user = '@' + user;
  const turma = $('docTurma').value.trim() || '604A';

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

  state.customDocLinks.forEach((item) => {
    rows.push({ nome: item.nome, url: item.url });
  });

  renderCustomLinksLists();
  renderDraftAlerts();

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
    : `<tr><td colspan="3" style="text-align:center;color:#6b7280;">Conecte sua conta para montar o documento.</td></tr>`;

  const docHtml = `
    <h2>Links dos Snacks — Expo (Turma ${escapeHtml(turma)})</h2>
    <p style="font-size:0.94rem; margin-bottom:16px;">
      <b>Aluno:</b> ${escapeHtml(aluno)}<br>
      <b>Turma:</b> ${escapeHtml(turma)}<br>
      <b>Usuário Expo:</b> ${escapeHtml(user)}
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

  $('docPreview').innerHTML = docHtml;
  if ($('wizDocPreview')) $('wizDocPreview').innerHTML = docHtml;
}

function renderDraftAlerts() {
  const drafts = state.targetSnacks.filter((t) => t.isDraft);
  const linkedDraftIndices = state.comparison.filter((c) => c.isDraft).map((c) => c.sourceIndex);
  const boxes = [$('wizDraftAlert'), $('docDraftAlert')];

  boxes.forEach((box) => {
    if (!box) return;
    if (drafts.length === 0) {
      box.hidden = true;
      return;
    }
    const names = drafts.slice(0, 4).map((d) => d.name || d.nome).join(', ');
    const more = drafts.length > 4 ? ` e mais ${drafts.length - 4}` : '';
    box.hidden = false;
    box.innerHTML = `
      <span>⚠ <b>${drafts.length} Snack(s) em Rascunho (Draft)</b> na sua conta (${escapeHtml(names)}${more}) — links em rascunho podem não abrir para o professor!</span>
      ${linkedDraftIndices.length > 0 ? `<button type="button" class="btn btn-warn btn-sm" data-publish-drafts="1">Publicar Rascunhos Agora</button>` : ''}
    `;
  });
}

async function publishAllDrafts() {
  const token = getToken();
  if (!token) {
    showBanner('Cole seu Token do Expo para publicar os rascunhos na sua conta.', 'warn');
    return;
  }
  const indices = state.comparison.filter((c) => c.isDraft).map((c) => c.sourceIndex);
  if (indices.length === 0) return;
  showBanner(`Publicando ${indices.length} rascunho(s) na sua conta Expo...`, 'ok');
  for (const idx of indices) {
    await updateSingleSnackCode(idx);
  }
  showBanner(`Pronto! ${indices.length} rascunho(s) publicado(s) com sucesso.`, 'ok');
}

function saveAsPdf() {
  renderDocument();
  const content = $('docPreview').innerHTML;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    // Fallback se o navegador bloquear popup
    window.print();
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Links dos Snacks — Turma ${escapeHtml($('docTurma').value.trim() || '604A')}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 28px; line-height: 1.45; }
    h2 { margin-top: 0; font-size: 20px; }
    p { font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    caption { text-align: left; font-weight: 700; margin-bottom: 8px; font-size: 14px; }
    th, td { border: 1px solid #9ca3af; padding: 7px 9px; text-align: left; }
    th { background: #f3f4f6; font-weight: 700; }
    a { color: #1d4ed8; text-decoration: none; word-break: break-all; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>${content}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 250);
}

function renderCustomLinksLists() {
  const html = state.customDocLinks.length
    ? state.customDocLinks
        .map(
          (item, i) => `
          <span class="badge badge-info" style="margin:3px 6px 3px 0; gap:6px;">
            ${escapeHtml(item.nome)}
            <button type="button" data-remove-extra="${i}" aria-label="Remover ${escapeHtml(item.nome)}" style="background:none;border:none;color:inherit;cursor:pointer;font-weight:700;padding:0 2px;">×</button>
          </span>`
        )
        .join('')
    : '';
  if ($('docExtraList')) $('docExtraList').innerHTML = html;
  if ($('wizExtraList')) $('wizExtraList').innerHTML = html;
}

function addCustomDocLink(nameInputId, urlInputId) {
  const rawUrl = $(urlInputId).value.trim();
  if (!rawUrl) {
    showBanner('Cole o link (URL) antes de adicionar ao documento.', 'warn');
    $(urlInputId).focus();
    return;
  }
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let nome = $(nameInputId).value.trim();
  if (!nome) {
    try {
      const u = new URL(url);
      nome = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    } catch {
      nome = 'Link Extra';
    }
  }
  state.customDocLinks.push({ nome, url });
  $(nameInputId).value = '';
  $(urlInputId).value = '';
  renderDocument();
  showBanner(`Link "${nome}" adicionado ao documento!`, 'ok');
}

async function copyDocumentToClipboard() {
  renderDocument();
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
}

function downloadWordDocument() {
  renderDocument();
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
}

/* ===========================
   CÓPIA E ATUALIZAÇÃO DE CÓDIGO
=========================== */
async function fixAllCodeErrors(inWizard = false) {
  const token = getToken();
  if (!token) {
    showBanner('Cole seu código de Token do Expo para corrigir os Snacks na sua conta.', 'warn');
    return;
  }
  const errorIndices = state.comparison.filter((c) => c.hasCodeError).map((c) => c.sourceIndex);
  if (errorIndices.length === 0) return;

  if (inWizard) {
    goToWizardStep(3);
    $('wizCloneTitle').textContent = `Corrigindo ${errorIndices.length} Snack(s) com erro...`;
    $('btnWizToStep4').disabled = true;
  }

  let fixed = 0;
  for (const idx of errorIndices) {
    await updateSingleSnackCode(idx);
    fixed++;
    if (inWizard) {
      $('wizProgressText').textContent = `Corrigido ${fixed} de ${errorIndices.length}...`;
      $('wizProgressCount').textContent = `${fixed} / ${errorIndices.length}`;
      $('wizProgressFill').style.width = `${Math.round((fixed / errorIndices.length) * 100)}%`;
    }
  }

  if (inWizard) {
    $('wizCloneTitle').textContent = 'Correção concluída!';
    $('btnWizToStep4').disabled = false;
  }
  showBanner(`Pronto! ${fixed} Snack(s) com erro foram atualizados pelo código oficial corrigido.`, 'ok');
}

async function updateSingleSnackCode(idx) {
  const token = getToken();
  if (!token) {
    showBanner('Cole seu código de Token do Expo para atualizar o código do Snack na sua conta.', 'warn');
    return;
  }

  const src = state.sourceSnacks[idx];
  const cmp = state.comparison.find((c) => c.sourceIndex === idx);
  const linked = cmp && cmp.targetIndex !== null ? state.targetSnacks[cmp.targetIndex] : null;
  const targetName = linked?.name || linked?.nome || src.name || src.nome;

  state.cloningIndices.add(idx);
  renderSnackList();

  try {
    const res = await apiPost('/api/clone', {
      auth: token,
      snacks: [{ ...src, overrideName: targetName }],
      existingTargetSnacks: [],
      skipDuplicates: false,
      dryRun: false,
    });

    const item = res.report?.[0];
    if (item && (item.status === 'updated' || item.status === 'cloned')) {
      if (linked) {
        linked.files = src.files || {};
        linked.code = src.code || '';
        linked.dependencies = src.dependencies || {};
        linked.url = item.url || linked.url;
        linked.isDraft = false;
      }
      await recomputeComparison();
      showBanner(`Código de "${targetName}" atualizado com a versão oficial do site!`, 'ok');
    } else {
      showBanner(`Erro ao atualizar "${targetName}": ${item?.error || 'Falha desconhecida'}`, 'err');
    }
  } catch (err) {
    showBanner(`Erro ao atualizar "${targetName}": ${err.message}`, 'err');
  } finally {
    state.cloningIndices.delete(idx);
    renderSnackList();
  }
}

async function runClone(indices, dryRun = false, { forceSingle = false, inWizard = false } = {}) {
  if (!indices || indices.length === 0) return;

  const token = getToken();
  if (!dryRun && !token) {
    showBanner('Cole seu código de Token do Expo para copiar direto para a sua conta.', 'warn');
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

  const progressText = inWizard ? $('wizProgressText') : $('cloneProgressText');
  const progressCount = inWizard ? $('wizProgressCount') : $('cloneProgressCount');
  const progressFill = inWizard ? $('wizProgressFill') : $('cloneProgressFill');
  const log = inWizard ? $('wizCloneLog') : $('cloneLog');

  if (!inWizard) $('cloneProgressBox').hidden = false;
  if (inWizard) $('btnWizToStep4').disabled = true;
  log.innerHTML = '';

  const total = indices.length;
  let clonedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  progressText.textContent = dryRun ? 'Simulando cópia...' : `Preparando cópia de ${total} Snack(s)...`;
  progressCount.textContent = `0 / ${total}`;
  progressFill.style.width = '4%';

  $('btnCloneSelected').disabled = true;
  $('btnDryRun').disabled = true;

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

      progressFill.style.width = '100%';
      progressCount.textContent = `${res.summary.total} / ${res.summary.total}`;
      log.innerHTML = res.report
        .map((item) =>
          item.status === 'would_clone'
            ? `<div>● [Simulação] <b>${escapeHtml(item.name)}</b> seria copiado.</div>`
            : `<div>↷ <b>${escapeHtml(item.name)}</b> pulado (${escapeHtml(item.reason)}).</div>`
        )
        .join('');
      progressText.textContent = `Simulação: ${res.summary.wouldClone} prontos para copiar, ${res.summary.skipped} repetidos pulados.`;
      showBanner(`Simulação OK: ${res.summary.wouldClone} seriam copiados e ${res.summary.skipped} repetidos foram pulados.`, 'ok');
    } catch (err) {
      progressText.textContent = 'Erro na simulação.';
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
      if (state.mode === 'full') renderSnackList();

      progressText.textContent = `Copiando ${step + 1} de ${total}: ${name}...`;
      progressCount.textContent = `${step} / ${total}`;
      progressFill.style.width = `${Math.max(5, Math.round((step / total) * 100))}%`;

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

      progressCount.textContent = `${step + 1} / ${total}`;
      progressFill.style.width = `${Math.round(((step + 1) / total) * 100)}%`;
      await recomputeComparison();
    }

    progressText.textContent = `Concluído! ${clonedCount} copiados, ${skippedCount} repetidos pulados, ${errorCount} erros.`;
    if (inWizard) {
      $('wizCloneTitle').textContent = 'Passo 3: Cópia concluída!';
      $('btnWizToStep4').disabled = false;
    }
    showBanner(
      `Cópia concluída: ${clonedCount} criados na sua conta, ${skippedCount} repetidos pulados${errorCount ? `, ${errorCount} erros` : ''}.`,
      errorCount ? 'warn' : 'ok'
    );
  } finally {
    indices.forEach((i) => state.cloningIndices.delete(i));
    $('btnCloneSelected').disabled = state.selectedForClone.size === 0;
    $('btnDryRun').disabled = state.selectedForClone.size === 0;
    if (state.mode === 'full') renderSnackList();
  }
}

/* ===========================
   CONEXÃO COM A CONTA EXPO
=========================== */
async function connectAccount({ advanceWizard = false } = {}) {
  const token = getToken();
  if (!token) {
    showBanner('Cole seu código de Token do Expo primeiro.', 'warn');
    return;
  }

  setToken(token);
  showBanner('Lendo todos os Snacks da sua conta Expo e conferindo o que falta...', 'ok');
  $('btnLoadTargetAccount').disabled = true;
  $('btnWizConnect').disabled = true;

  try {
    const data = await apiPost('/api/account/snacks', { auth: token, includeCode: true });
    state.targetSnacks = data.snacks || [];
    state.accountLoaded = true;
    if (data.username) {
      if (!$('docUsuario').value.trim()) $('docUsuario').value = data.username;
      if (!$('wizDocUsuario').value.trim()) $('wizDocUsuario').value = data.username;
    }
    await recomputeComparison();
    if (advanceWizard && state.mode === 'wizard') {
      goToWizardStep(2);
    } else if (state.summary.faltantes > 0) {
      $('filterStatus').value = 'faltante';
      renderSnackList();
    }
    showBanner(
      `Conta ${data.username} conectada (${data.codesLoaded ?? state.targetSnacks.length}/${state.targetSnacks.length} códigos lidos)! Você já tem ${state.summary.duplicatasExatas + state.summary.duplicatasCodigo} e faltam ${state.summary.faltantes}.`,
      'ok'
    );
  } catch (err) {
    showBanner(`Falha ao conectar conta: ${err.message}`, 'err');
  } finally {
    $('btnLoadTargetAccount').disabled = false;
    $('btnWizConnect').disabled = false;
  }
}

/* ===========================
   EVENTOS & BOOTSTRAP
=========================== */
function bindEvents() {
  // Alternância Wizard ↔ Painel Completo
  $('btnSwitchMode').addEventListener('click', () => {
    setViewMode(state.mode === 'wizard' ? 'full' : 'wizard');
  });

  // Sincronização dos campos de token
  $('wizToken').addEventListener('input', (e) => { $('targetToken').value = e.target.value; });
  $('targetToken').addEventListener('input', (e) => { $('wizToken').value = e.target.value; });

  // Wizard Etapa 1
  $('btnWizToggle').addEventListener('click', () => {
    const masked = $('wizToken').classList.toggle('masked-token');
    $('targetToken').classList.toggle('masked-token', masked);
    $('btnWizToggle').textContent = masked ? 'Mostrar' : 'Ocultar';
    $('btnToggleToken').textContent = masked ? 'Mostrar' : 'Ocultar';
  });

  async function pasteTokenInto(inputEl, { advanceWizard }) {
    const guideManualPaste = () => {
      inputEl.focus();
      inputEl.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      inputEl.classList.remove('input-pulse');
      void inputEl.offsetWidth;
      inputEl.classList.add('input-pulse');
      setTimeout(() => inputEl.classList.remove('input-pulse'), 2000);
      const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
      const msg = isTouch
        ? 'Seu navegador bloqueou o botão Colar — toque e segure no campo acima e escolha "Colar" (conecta sozinho!).'
        : 'Clique no campo acima e aperte Ctrl+V (conecta sozinho!).';
      showBanner(msg, 'warn');
      showToast(msg, 'warn');
    };

    if (!navigator.clipboard?.readText) {
      guideManualPaste();
      return;
    }
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (!clip) {
        showBanner('Sua área de transferência está vazia. Copie o token no Expo primeiro.', 'warn');
        showToast('Área de transferência vazia.', 'warn');
        return;
      }
      setToken(clip);
      connectAccount({ advanceWizard });
    } catch {
      guideManualPaste();
    }
  }

  $('btnWizPaste').addEventListener('click', () => pasteTokenInto($('wizToken'), { advanceWizard: true }));

  $('wizToken').addEventListener('paste', () => {
    setTimeout(() => {
      if ($('wizToken').value.trim().length >= 16) connectAccount({ advanceWizard: true });
    }, 60);
  });

  $('btnWizConnect').addEventListener('click', () => connectAccount({ advanceWizard: true }));
  $('btnWizSkipToFull').addEventListener('click', () => setViewMode('full'));

  // Wizard Etapa 2 -> Painel Completo com Estatísticas no topo
  $('btnWizBack1').addEventListener('click', () => goToWizardStep(1));
  $('btnWizReviewInFull').addEventListener('click', () => setViewMode('full'));
  $('btnWizOnlyStats').addEventListener('click', () => {
    setViewMode('full');
    if (state.summary.faltantes > 0) {
      $('filterStatus').value = 'faltante';
      renderSnackList();
    }
    $('fullStatsCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  async function runWizardAutoFlow() {
    const missingIndices = state.comparison.filter((r) => !r.shouldSkipClone).map((r) => r.sourceIndex);
    const errorIndices = state.comparison.filter((r) => r.hasCodeError).map((r) => r.sourceIndex);

    if (missingIndices.length === 0 && errorIndices.length === 0) {
      goToWizardStep(4);
      return;
    }

    goToWizardStep(3);
    if (missingIndices.length > 0) {
      await runClone(missingIndices, false, { inWizard: true });
    }
    if (errorIndices.length > 0) {
      await fixAllCodeErrors(true);
    }
  }

  $('btnWizStartClone').addEventListener('click', runWizardAutoFlow);

  // Wizard Etapa 3 & 4
  $('btnWizOpenFullFrom3').addEventListener('click', () => setViewMode('full'));
  $('btnWizToStep4').addEventListener('click', () => goToWizardStep(4));
  $('btnWizDoneToFull').addEventListener('click', () => setViewMode('full'));

  ['wizDocAluno', 'wizDocUsuario', 'wizDocTurma'].forEach((id) => {
    $(id).addEventListener('input', () => syncDocFields(true));
  });
  $('btnWizCopyDoc').addEventListener('click', copyDocumentToClipboard);
  $('btnWizSavePdf').addEventListener('click', saveAsPdf);
  $('btnWizDownloadWord').addEventListener('click', downloadWordDocument);
  $('btnWizAddExtra').addEventListener('click', () => addCustomDocLink('wizExtraName', 'wizExtraUrl'));
  $('btnDocAddExtra').addEventListener('click', () => addCustomDocLink('docExtraName', 'docExtraUrl'));

  ['wizDraftAlert', 'docDraftAlert'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target.closest('[data-publish-drafts]')) publishAllDrafts();
    });
  });

  ['docExtraList', 'wizExtraList'].forEach((listId) => {
    $(listId).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-extra]');
      if (!btn) return;
      const idx = Number(btn.dataset.removeExtra);
      state.customDocLinks.splice(idx, 1);
      renderDocument();
    });
  });

  // Painel Completo: Delegação na lista
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
    } else if (action === 'update-one') {
      updateSingleSnackCode(idx);
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
    const masked = $('targetToken').classList.toggle('masked-token');
    $('wizToken').classList.toggle('masked-token', masked);
    $('btnToggleToken').textContent = masked ? 'Mostrar' : 'Ocultar';
    $('btnWizToggle').textContent = masked ? 'Mostrar' : 'Ocultar';
  });

  $('btnPasteToken').addEventListener('click', () => pasteTokenInto($('targetToken'), { advanceWizard: false }));

  $('targetToken').addEventListener('paste', () => {
    setTimeout(() => {
      if ($('targetToken').value.trim().length >= 16) connectAccount({ advanceWizard: false });
    }, 60);
  });

  $('btnLoadTargetAccount').addEventListener('click', () => connectAccount({ advanceWizard: false }));

  $('btnUploadTarget').addEventListener('click', () => $('fileTarget').click());
  $('fileTarget').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = await apiPost('/api/parse-input', { raw: text });
    state.targetSnacks = parsed.snacks || [];
    state.accountLoaded = true;
    const firstUser = state.targetSnacks[0]?.url?.match(/snack\.expo\.dev\/(@[^/]+)/)?.[1];
    if (firstUser && !$('docUsuario').value.trim()) {
      $('docUsuario').value = firstUser;
      $('wizDocUsuario').value = firstUser;
    }
    await recomputeComparison();
    showBanner(`Lista importada (${state.targetSnacks.length} Snacks). Faltam ${state.summary.faltantes}.`, 'ok');
  });

  $('btnParseTarget').addEventListener('click', async () => {
    const raw = $('rawTargetInput').value;
    const parsed = await apiPost('/api/parse-input', { raw });
    state.targetSnacks = parsed.snacks || [];
    state.accountLoaded = true;
    const firstUser = state.targetSnacks[0]?.url?.match(/snack\.expo\.dev\/(@[^/]+)/)?.[1];
    if (firstUser && !$('docUsuario').value.trim()) {
      $('docUsuario').value = firstUser;
      $('wizDocUsuario').value = firstUser;
    }
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
      showBanner(`Códigos baixados (${res.resolvedOk}/${res.total}). Faltam ${state.summary.faltantes}.`, 'ok');
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
  ['docAluno', 'docUsuario', 'docTurma'].forEach((id) => {
    $(id).addEventListener('input', () => syncDocFields(false));
  });
  $('docIncludeExtras').addEventListener('change', (e) => {
    if ($('wizDocIncludeExtras')) $('wizDocIncludeExtras').checked = e.target.checked;
    renderDocument();
  });
  $('wizDocIncludeExtras')?.addEventListener('change', (e) => {
    $('docIncludeExtras').checked = e.target.checked;
    renderDocument();
  });
  $('btnCopyDoc').addEventListener('click', copyDocumentToClipboard);
  $('btnSavePdf').addEventListener('click', saveAsPdf);
  $('btnDownloadWord').addEventListener('click', downloadWordDocument);
}

async function bootstrap() {
  initTabs();
  bindEvents();

  try {
    const res = await fetch('/api/legacy-catalog');
    const data = await res.json();
    if (data.found && data.snacks.length > 0) {
      state.sourceSnacks = data.snacks;
      const comCodigo = data.withCode ?? data.snacks.length;
      $('catalogStatus').innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${data.snacks.length} Snacks (${comCodigo} com código)</span>`;
      await recomputeComparison();
    } else {
      $('catalogStatus').innerHTML = `<span>Catálogo não encontrado</span>`;
      renderAll();
    }
  } catch (err) {
    $('catalogStatus').innerHTML = `<span>Erro ao carregar catálogo</span>`;
    showBanner(`Erro ao carregar lista de Snacks: ${err.message}`, 'err');
  }
}

bootstrap();
