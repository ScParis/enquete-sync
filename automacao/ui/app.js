// Sistema de Notificações Toast Enterprise não-intrusivo
class ToastManager {
  constructor() {
    this.container = null;
  }
  ensureContainer() {
    if (this.container && document.body.contains(this.container)) return;
    let existing = document.getElementById('toast-container');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'toast-container';
      existing.className = 'toast-container';
      existing.setAttribute('aria-live', 'polite');
      existing.setAttribute('aria-atomic', 'true');
      document.body.appendChild(existing);
    }
    this.container = existing;
  }
  show({ title, message, type = 'info', duration = 4000, action = null }) {
    this.ensureContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.textContent = icons[type] || 'ℹ';
    const contentEl = document.createElement('div');
    contentEl.className = 'toast-content';
    if (title) {
      const titleEl = document.createElement('strong');
      titleEl.className = 'toast-title';
      titleEl.textContent = title;
      contentEl.appendChild(titleEl);
    }
    if (message) {
      const msgEl = document.createElement('span');
      msgEl.className = 'toast-message';
      msgEl.textContent = message;
      contentEl.appendChild(msgEl);
    }
    toast.appendChild(iconEl);
    toast.appendChild(contentEl);
    if (action && typeof action.onClick === 'function') {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action';
      actionBtn.textContent = action.label || 'Ver';
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick();
        this.dismiss(toast);
      });
      toast.appendChild(actionBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Fechar notificação');
    closeBtn.addEventListener('click', () => this.dismiss(toast));
    toast.appendChild(closeBtn);
    if (duration > 0) {
      const progress = document.createElement('div');
      progress.className = 'toast-progress';
      progress.style.animationDuration = `${duration}ms`;
      toast.appendChild(progress);
    }
    this.container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    if (duration > 0) {
      toast._timer = setTimeout(() => this.dismiss(toast), duration);
    }
    return toast;
  }
  dismiss(toast) {
    if (!toast || toast.classList.contains('toast-hiding')) return;
    toast.classList.add('toast-hiding');
    if (toast._timer) clearTimeout(toast._timer);
    toast.addEventListener('transitionend', () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, { once: true });
  }
  success(message, title = 'Sucesso', options = {}) {
    return this.show({ ...options, title, message, type: 'success' });
  }
  error(message, title = 'Erro', options = {}) {
    return this.show({ ...options, title, message, type: 'error', duration: options.duration ?? 6000 });
  }
  warning(message, title = 'Atenção', options = {}) {
    return this.show({ ...options, title, message, type: 'warning', duration: options.duration ?? 5000 });
  }
  info(message, title = 'Informação', options = {}) {
    return this.show({ ...options, title, message, type: 'info' });
  }
}
const toast = new ToastManager();

const $ = id => document.getElementById(id);
let config = { accounts: [], savedMappings: [] };
let authToken = '', previewId = null, lastReport = null, working = false, downloadFiles = [], liveCatalog = null, catalogLive = false, taskCatalog = [], tasksAutoFilled = false, loginPoll = null, loginPollBusy = false, savedMappings = [], editingTask = null, selectedTasks = new Set();
let savedProfiles = [], targetModels = {}, availableFields = [];
let sourceVersion = 0, lastAuditKey = '', auditPoll = null, resultsPage = 0;
let importedTable = null, importedPage = 0;
const SOURCE_PAGE_SIZE = 25;
const RESULTS_PAGE_SIZE = 50;
const labels = { vazio: 'Sem resposta', ja_correto: 'Já correto', divergente: 'Divergente', nao_encontrado: 'Não localizado', bloqueado: 'Bloqueado', sem_mapeamento: 'Sem mapeamento', sem_tarefa: 'Sem obrigação na planilha', nao_verificado: 'Não verificado', a_conferir: 'A conferir', pronto: 'Elegível' };
let focusTask = null, auditRunning = false, auditMessage = '';
const ACCOUNT_KEY = 'gclick.lastAccount';

// Helper de Estado de Carregamento para Botões (Enterprise UX)
async function withButtonLoading(btnOrId, loadingLabel, asyncFn) {
  const btn = typeof btnOrId === 'string' ? $(btnOrId) : btnOrId;
  if (!btn) return asyncFn();
  if (btn.classList.contains('btn-loading')) return; // Evita duplo clique concorrente

  const originalText = btn.textContent;
  const originalDisabled = btn.disabled;

  btn.classList.add('btn-loading');
  btn.disabled = true;
  if (loadingLabel) btn.setAttribute('data-loading-text', loadingLabel);

  try {
    return await asyncFn();
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = originalDisabled;
    btn.removeAttribute('data-loading-text');
  }
}

const currentAccount = () => {
  const val = $('accountId')?.value?.trim();
  if (val && /^\d+$/.test(val)) return val;
  if (lastKnownAccountId && /^\d+$/.test(lastKnownAccountId)) return lastKnownAccountId;
  const topText = $('topAccountId')?.textContent?.trim();
  if (topText && topText !== '—' && /^\d+$/.test(topText)) return topText;
  return val || '';
};
function status(message, kind = '') { $('status').textContent = message; $('status').className = `status ${kind}`; }
// Planilhas guarda uma planilha por uso: a da Enquete (globais importedTable/taskCatalog) e a da Carteira (carteiraSheet).
const sourceUse = () => document.querySelector('input[name="sourceUse"]:checked')?.value || 'enquete';
const useTargetModel = () => sourceUse() === 'carteira' ? 'carteira_responsaveis' : 'enquete_automacao';
let carteiraSheet = null;
let carteiraUsers = [];
let carteiraMinha = null; // Minha Carteira de cada usuário, trazida na sincronização
let carteiraParsedData = null;
let carteiraAuditItems = [];
const sourceViewByUse = { enquete: null, carteira: null };
// carteira: 'switch' oferece usar a aba como planilha da Carteira; 'go' leva até a Carteira já carregada.
function sourceStatus(message, kind = '', { carteira = false } = {}) {
  sourceViewByUse[sourceUse()] = { message, kind, carteira };
  $('sourceStatus').textContent = message;
  $('sourceStatus').className = kind;
  $('sourceStatusBox').className = `source-status ${kind}`;
  const btn = $('btnSourceToCarteira');
  btn.hidden = !carteira;
  btn.dataset.mode = carteira || '';
  btn.textContent = carteira === 'switch' ? 'Usar como planilha da Carteira' : 'Ir para Carteira por Usuário';
}
// Nome curto da origem: o link inteiro da planilha não ajuda a leitura.
// Um DE/PARA só vale como "salvo" quando está na lista do escritório; o sugerido pelo servidor não está.
const isSavedProfile = profile => Boolean(profile?.id && savedProfiles.some(p => p.id === profile.id));
const profileLabel = profile => !profile ? 'sem DE/PARA' : isSavedProfile(profile) ? `DE/PARA salvo (v${profile.version})` : 'DE/PARA sugerido, ainda não salvo';
function renderProfileBadge() {
  const badge = $('profileVersionBadge');
  if (!badge) return;
  const saved = isSavedProfile(currentProfile);
  badge.textContent = saved ? `Salvo · v${currentProfile.version}` : 'Sugerido, não salvo';
  badge.className = `nav-badge ${saved ? 'badge-ok' : 'badge-warn'}`;
}
const sourceLabel = source => /^https?:\/\//i.test(String(source ?? '')) ? 'Google Sheets' : String(source ?? '');
function clearImportedTable() { importedTable = null; importedPage = 0; if (sourceUse() === 'enquete') { $('sourcePreview').hidden = true; $('sourceTable').replaceChildren(); } }
const shownTable = () => sourceUse() === 'carteira' ? carteiraSheet?.table ?? null : importedTable;
function renderImportedTable() {
  const shown = shownTable();
  if (!shown) { $('sourcePreview').hidden = true; return; }
  const { columns, rows } = shown;
  const start = importedPage * SOURCE_PAGE_SIZE;
  const table = $('sourceTable'); table.replaceChildren();
  const head = document.createElement('thead'), headerRow = document.createElement('tr');
  const number = document.createElement('th'); number.textContent = '#'; headerRow.append(number);
  for (const column of columns) {
    const cell = document.createElement('th'); cell.textContent = column.name;
    cell.title = `${column.filled} de ${rows.length} linha(s) preenchida(s) · ${column.distinct} valor(es) distinto(s)`;
    headerRow.append(cell);
  }
  head.append(headerRow); table.append(head);
  const body = document.createElement('tbody');
  for (let i = start; i < Math.min(start + SOURCE_PAGE_SIZE, rows.length); i++) {
    const row = document.createElement('tr'), numberCell = document.createElement('td'); numberCell.textContent = String(i + 1); row.append(numberCell);
    for (const value of rows[i]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    body.append(row);
  }
  table.append(body);
  $('sourcePreview').hidden = false;
  $('sourcePageInfo').textContent = rows.length ? `${start + 1}–${Math.min(start + SOURCE_PAGE_SIZE, rows.length)} de ${rows.length}` : '0 linhas';
  $('sourcePrev').disabled = importedPage === 0;
  $('sourceNext').disabled = start + SOURCE_PAGE_SIZE >= rows.length;
}
function sourceType() { return document.querySelector('input[name="sourceType"]:checked').value; }
const normalizeTask = value => String(value ?? '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
function clearPreview() { previewId = null; lastReport = null; focusTask = null; $('focusChip').hidden = true; $('summary').hidden = true; $('downloads').hidden = true; $('missingPanel').hidden = true; $('invalidPanel').hidden = true; $('mappingResult').hidden = true; $('results').innerHTML = '<tr><td colspan="5" class="empty">Nenhum resultado ainda.</td></tr>'; resultsPage = 0; $('resultsPager').hidden = true; updateApply(); }
function catalogAnswer(ref) {
  for (const question of liveCatalog?.questions ?? []) {
    const answer = question.answers.find(item => item.ref === ref);
    if (answer) return { question, answer };
  }
  return null;
}
function renderCatalogOverview() {
  const hasCatalog = Boolean(liveCatalog);
  if ($('catalogEmptyState')) $('catalogEmptyState').hidden = hasCatalog;
  if ($('catalogOverview')) $('catalogOverview').hidden = !hasCatalog;
  if (!liveCatalog) {
    updateSidebarBadges();
    return;
  }
  $('catalogOverviewStatus').textContent = `${liveCatalog.questionCount} perguntas e ${liveCatalog.answerCount} respostas ${catalogLive ? 'capturadas agora' : 'do catálogo anterior'} · conta ${liveCatalog.accountId}`;
  const query = normalizeTask($('catalogOverviewSearch').value);
  $('catalogOverviewList').replaceChildren();
  for (const question of liveCatalog.questions) {
    if (query && !normalizeTask(`${question.ref} ${question.label} ${question.answers.map(a => `${a.ref} ${a.display}`).join(' ')}`).includes(query)) continue;
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = `${question.ref} · ${question.label} (${question.answers.length} respostas)`;
    details.append(summary);
    for (const answer of question.answers) { const p = document.createElement('p'); p.textContent = `${answer.ref} · ${answer.display} · ${answer.valueKnown === false ? 'código lido na tela' : `código ${answer.value}`}`; details.append(p); }
    $('catalogOverviewList').append(details);
  }
  updateSidebarBadges();
}
function otherOfficeSuggestion(task) {
  const accountId = currentAccount();
  const seen = new Map();
  for (const m of savedMappings) {
    if (m.accountId === accountId || m.excluded || normalizeTask(m.task) !== normalizeTask(task.name) || !m.questionLabel || !m.answerLabel) continue;
    for (const { question, answer } of findByLabels(m.questionLabel, m.answerLabel)) seen.set(answer.ref, { question, answer, from: m.accountId });
  }
  return [...seen.values()];
}
function findByLabels(questionLabel, answerLabel) {
  const q = normalizeTask(questionLabel), a = normalizeTask(answerLabel);
  return (liveCatalog?.questions ?? []).flatMap(question => normalizeTask(question.label) !== q ? [] :
    question.answers.filter(answer => normalizeTask(answer.label) === a).map(answer => ({ question, answer })));
}
function mappingFor(task) {
  const accountId = currentAccount();
  const custom = savedMappings.find(m => m.accountId === accountId && m.task === task.name);
  if (custom?.excluded) return { state: 'excluded', label: 'Excluída: esta tarefa não gera resposta na Enquete' };
  if (custom) {
    const found = catalogAnswer(custom.answerRef);
    return found ? { state: catalogLive ? 'ready' : 'candidate', origin: 'Confirmada', ref: custom.answerRef, label: `Regra: marcar ${found.question.ref} → ${found.answer.display} (${found.question.label})${catalogLive ? '' : ' · conferir na conta'}` }
      : { state: liveCatalog ? 'attention' : 'known', label: liveCatalog ? 'A resposta salva não consta no catálogo atual' : `Associação salva ${custom.answerRef} · aguardando catálogo`, ref: custom.answerRef };
  }
  if (!liveCatalog) return { state: 'awaiting', label: 'Aguardando catálogo da Enquete desta conta' };
  const fromOffices = otherOfficeSuggestion(task);
  if (fromOffices.length === 1) return { state: 'suggested', ref: fromOffices[0].answer.ref,
    label: `Sugestão de outro escritório (conta ${fromOffices[0].from}): ${fromOffices[0].question.ref} → ${fromOffices[0].answer.display} · confirme` };
  const suggestions = liveCatalog.questions.flatMap(question => question.answers
    .filter(answer => normalizeTask(task.name) === normalizeTask(answer.label) || normalizeTask(task.name).startsWith(`${normalizeTask(answer.label)} - `))
    .map(answer => ({ question, answer })));
  if (suggestions.length === 1) return { state: 'suggested', ref: suggestions[0].answer.ref,
    label: `Sugestão pelo nome: ${suggestions[0].question.ref} → ${suggestions[0].answer.display}${catalogLive ? '' : ' · catálogo anterior'}` };
  return { state: 'attention', label: suggestions.length + fromOffices.length > 1 ? `${suggestions.length + fromOffices.length} respostas possíveis; escolha uma` : `Nenhuma associação segura pelo nome${catalogLive ? '' : ' no catálogo anterior'}` };
}
function renderQueue() {
  const all = taskCatalog.map(task => ({ task, mapping: mappingFor(task) }));
  const ready = all.filter(x => x.mapping.state === 'ready').length;
  const candidate = all.filter(x => x.mapping.state === 'candidate').length;
  const known = all.filter(x => x.mapping.state === 'known').length;
  const awaiting = all.filter(x => x.mapping.state === 'awaiting').length;
  const suggested = all.filter(x => x.mapping.state === 'suggested').length;
  const excluded = all.filter(x => x.mapping.state === 'excluded').length;
  const attention = all.length - ready - candidate - known - awaiting - excluded;
  for (const task of selectedTasks) if (!all.some(x => x.task.name === task && ['ready', 'candidate'].includes(x.mapping.state))) selectedTasks.delete(task);
  $('queueSummary').replaceChildren();
  if (all.length) {
    const facts = [[all.length, 'tarefas da planilha'], [ready, 'verificadas na conta'], [candidate, 'associadas no catálogo anterior'], [known, 'salvas aguardando catálogo'], [awaiting, 'aguardam catálogo'], [suggested, 'sugestões para revisar'], [attention - suggested, 'sem associação segura'], [excluded, 'excluídas'], [0, '']];
    for (const [count, label] of facts.filter(([count, label]) => count || label === 'tarefas da planilha' )) {
      const chip = document.createElement('span'); chip.textContent = `${count} ${label}`; $('queueSummary').append(chip, document.createTextNode(' '));
    }
  } else $('queueSummary').textContent = 'Carregue a planilha para listar as obrigações e tarefas.';
  const btnConfirm = $('btnConfirmAllSuggestions');
  if (btnConfirm) {
    btnConfirm.textContent = suggested ? `Confirmar ${suggested} sugestão(ões) seguras` : 'Confirmar sugestões seguras';
    btnConfirm.disabled = !suggested || !liveCatalog;
  }
  const query = normalizeTask($('queueSearch').value), filter = $('queueFilter').value;
  const visible = all.filter(({ task, mapping }) => normalizeTask(task.name).includes(query) &&
    (filter === 'all' || filter === 'attention' && ['suggested', 'attention', 'known', 'awaiting'].includes(mapping.state) || filter === 'ready' && ['ready', 'candidate'].includes(mapping.state) || filter === 'excluded' && mapping.state === 'excluded'));
  $('queueList').replaceChildren();
  for (const { task, mapping } of visible) {
    const row = document.createElement('div'); row.className = 'queue-item';
    const main = document.createElement('div'); main.className = 'queue-main';
    const title = document.createElement('strong'); title.textContent = task.name;
    const meta = document.createElement('p'); meta.textContent = `${task.clients ?? '?'} CNPJ(s) · ${task.count} linha(s)${task.invalidCnpjs ? ` · ${task.invalidCnpjs} CNPJ(s) inválido(s)` : ''}`;
    const detail = document.createElement('p'); detail.className = `queue-detail ${mapping.state}`; detail.textContent = mapping.label;
    main.append(title, meta, detail);
    const checked = lastReport?.accountId === currentAccount() ? lastReport?.mappings?.find(m => m.task === task.name) : null;
    if (['ready', 'candidate'].includes(mapping.state)) {
      const result = document.createElement('p'); result.className = 'queue-detail';
      if (checked) {
        const s = checked.summary, problems = s.divergente + s.bloqueado;
        result.textContent = `Situação na Enquete: ${s.vazio} sem marcação (a gravar) · ${s.ja_correto} já marcada(s)${problems ? ` · ${problems} divergente(s)/bloqueado(s)` : ''}${s.nao_encontrado ? ` · ${s.nao_encontrado} não localizado(s)` : ''}`;
        if (s.vazio) result.classList.add('pending');
      } else result.textContent = 'Situação na Enquete: ainda não conferida';
      main.append(result);
    }
    row.append(main);
    if (mapping.state !== 'excluded') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost'; button.textContent = ['ready', 'candidate'].includes(mapping.state) ? 'Revisar' : 'Mapear'; button.disabled = !liveCatalog;
      button.addEventListener('click', () => openMappingEditor(task.name, mapping.ref)); row.append(button);
    }
    $('queueList').append(row);
  }
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = all.length ? 'Nenhuma tarefa neste filtro.' : 'Nenhuma tarefa carregada.'; $('queueList').append(empty); }
  updateAuditTaskSelect();
  updateSidebarBadges();
}
function fillEditorQuestions(search = '', selectedRef = '') {
  const current = selectedRef || $('editorQuestion').value;
  const query = normalizeTask(search);
  $('editorQuestion').replaceChildren(new Option('Selecione uma pergunta', ''));
  for (const question of liveCatalog?.questions ?? []) if (normalizeTask(`${question.ref} ${question.label} ${question.category}`).includes(query))
    $('editorQuestion').append(new Option(`${question.ref} — ${question.label}`, question.ref));
  $('editorQuestion').value = [...$('editorQuestion').options].some(o => o.value === current) ? current : '';
  fillEditorAnswers();
}
function fillEditorAnswers(selectedRef = '') {
  const question = liveCatalog?.questions.find(q => q.ref === $('editorQuestion').value);
  $('editorAnswer').replaceChildren(new Option('Selecione uma resposta', ''));
  for (const answer of question?.answers ?? []) $('editorAnswer').append(new Option(`${answer.ref} — ${answer.display}`, answer.ref));
  $('editorAnswer').value = selectedRef || '';
}
function openMappingEditor(taskName, ref) {
  editingTask = taskName;
  $('editorTask').textContent = taskName;
  $('editorHint').textContent = catalogLive ? 'Escolha a resposta que esta obrigação exige. A prévia consultará cada CNPJ sem gravar.' : 'Escolha usando o catálogo anterior. A associação será conferida na conta atual antes da prévia.';
  $('editorSearch').value = '';
  const found = catalogAnswer(ref);
  fillEditorQuestions('', found?.question.ref ?? '');
  if (found) fillEditorAnswers(ref);
  $('mappingEditor').hidden = false;
  $('mappingEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function saveMapping(answerRef, excluded = false) {
  if (!editingTask) return;
  if (answerRef && !catalogAnswer(answerRef)) { $('editorHint').textContent = 'Selecione uma resposta válida.'; return; }
  try {
    const result = await api('mappings/save', { accountId: currentAccount(), task: editingTask, answerRef, excluded });
    savedMappings = result.savedMappings;
    if (answerRef) selectedTasks.add(editingTask); else selectedTasks.delete(editingTask);
    const task = editingTask;
    $('mappingEditor').hidden = true; editingTask = null; renderQueue();
    status(excluded ? 'Tarefa marcada como excluída para esta conta.' : answerRef ? (result.unchanged ? 'Mapeamento já estava salvo.' : 'Mapeamento salvo.') : 'Associação removida.', 'ok');
    if (answerRef) await showTaskOutput(task);
    if (isAutoAuditEnabled()) maybeAutoAudit();
  } catch (error) { $('editorHint').textContent = error.message; }
}
// Depois de mapear, a saída mostra na hora os CNPJs da tarefa e a resposta que será gravada; a conferência completa o estado.
async function showTaskOutput(task) {
  focusTask = task; resultsPage = 0;
  const audited = lastReport && ['account_audit', 'mapping_preview'].includes(lastReport.mode) && lastReport.accountId === currentAccount() && lastReport.mappings?.some(m => m.task === task);
  if (audited) { render(lastReport); return; }
  try {
    const plan = await api('mappings/plan', { ...(await payload('plan')), accountId: currentAccount(), task });
    const inspected = plan.rows.map(r => ({ cnpj: r.cnpj, empId: r.empId, empresa: r.empresa, mappingTask: task, mappingAnswer: plan.answerRef,
      uiStatus: r.status === 'pronto' ? 'a_conferir' : 'bloqueado', uiReason: r.status === 'pronto' ? (r.marcadoEm ? `Já registrado pelo robô em ${new Date(r.marcadoEm).toLocaleString('pt-BR')}` : 'Aguardando conferência na Enquete') : r.reason }));
    if (lastReport && ['account_audit', 'mapping_preview'].includes(lastReport.mode)) {
      const mergedInspected = [...(lastReport.inspected ?? []).filter(x => x.mappingTask !== task), ...inspected];
      const mergedSummary = { ...lastReport.summary, a_conferir: mergedInspected.filter(x => x.uiStatus === 'a_conferir').length };
      render({ ...lastReport, inspected: mergedInspected, summary: mergedSummary });
    } else {
      render({ mode: 'mapping_plan', accountId: currentAccount(), rules: { inputType: 'mixed', allowedTasks: [task] }, inspected, invalidSource: plan.invalid,
        summary: { total: inspected.length, a_conferir: inspected.filter(x => x.uiStatus === 'a_conferir').length, bloqueado: inspected.filter(x => x.uiStatus === 'bloqueado').length } });
    }
  } catch (error) { status(`Mapeamento salvo, mas não foi possível listar os CNPJs: ${error.message}`, 'error'); }
}
function answerText(ref) { const found = catalogAnswer(ref); return found ? `${found.question.ref} → ${found.answer.display}` : ref; }
function useCatalog(catalog, verified = false) {
  if (!catalog || String(catalog.accountId) !== $('accountId').value.trim()) throw new Error('O catálogo pertence a outra conta G-Click');
  liveCatalog = catalog; catalogLive = verified;
  renderCatalogOverview();
  if ($('queueFilter').value === 'attention' && !$('queueSearch').value && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state)))
    $('queueFilter').value = 'ready';
  renderQueue();
}
// A janela do Chrome pode ser fechada a qualquer momento; sem ela não há catálogo nem conferência válidos.
setInterval(async () => {
  if (!catalogLive || working) return;
  try {
    const current = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
    if (current.loginReady) return;
    liveCatalog = null; catalogLive = false; previewId = null; lastAuditKey = '';
    renderCatalogOverview(); renderQueue(); updateApply();
    $('auditStatus').textContent = 'Sessão encerrada: abra o login de novo para conferir.';
    status(current.sessionLostAt ? 'A janela do Chrome da automação foi fechada. Clique em Abrir janela de login e entre de novo; mantenha a janela aberta até o fim.' : 'A sessão do G-Click foi encerrada. Abra o login de novo.', 'error');
  } catch { /* servidor indisponível: a próxima ação mostrará o erro */ }
}, 8000);
function stopLoginPoll() { if (loginPoll) clearInterval(loginPoll); loginPoll = null; }
let currentEmpresaNome = null;
let currentSessionStatus = null;
let lastKnownAccountId = null;

function updateTopAccountDisplay(accountId, empresaNome = undefined, sessionStatus = undefined) {
  const previousId = lastKnownAccountId;
  if (accountId && accountId !== lastKnownAccountId) {
    lastKnownAccountId = accountId;
    if (empresaNome === undefined) currentEmpresaNome = null;
  }
  if (empresaNome !== undefined) currentEmpresaNome = empresaNome;
  if (sessionStatus !== undefined) currentSessionStatus = sessionStatus;

  if (accountId && /^\d+$/.test(accountId)) {
    if ($('accountId') && !$('accountId').value) {
      $('accountId').value = accountId;
    }
    try { localStorage.setItem(ACCOUNT_KEY, accountId); } catch {}
  }

  if ($('topAccountId')) $('topAccountId').textContent = accountId || '—';
  updateSidebarBadges(); // o selo e o nome da empresa no topo saem de connectionView()

  // Se a conta mudou e a seção atual for obrigações, recarrega o catálogo da conta ativa
  if (accountId && previousId && accountId !== previousId) {
    try {
      const activeSection = localStorage.getItem(SECTION_STORAGE_KEY);
      if (activeSection === 'obrigacoes') {
        loadObrigacoesSection();
      }
    } catch {}
  }
}

let gclickSessionState = {
  connected: false,
  accountMatches: false,
  isReadyForModules: false,
  activeAccountId: null,
  activeEmpresaNome: null,
  currentEmpresaId: null,
  currentEmpresaNome: null,
  availableEmpresas: []
};

function isConnectionResolved() {
  const acc = currentAccount();
  if (!/^\d+$/.test(acc)) return false;
  if (gclickSessionState.connected) {
    return Boolean(
      gclickSessionState.accountMatches &&
      String(gclickSessionState.activeAccountId) === String(acc)
    );
  }
  if (config.loginReady || config.catalogLive) {
    if (gclickSessionState.currentEmpresaId && String(gclickSessionState.currentEmpresaId) !== String(acc)) {
      return false;
    }
    return true;
  }
  return false;
}

function applySessionResult(result, targetAcc = null) {
  if (!result || !result.browserStatus) return;
  const selectedAcc = targetAcc || currentAccount();
  const effectiveAccount = selectedAcc || result.currentEmpresaId || result.activeAccountId;
  let empresaNome = result.activeEmpresaNome || result.currentEmpresaNome;
  if (result.availableEmpresas && Array.isArray(result.availableEmpresas)) {
    const match = result.availableEmpresas.find(e => String(e.id) === String(effectiveAccount));
    if (match?.nome) empresaNome = match.nome;
  }

  const isMatch = result.accountMatches !== undefined
    ? Boolean(result.accountMatches)
    : (result.gclickAuthStatus === 'login_detected' && (!result.currentEmpresaId || String(result.currentEmpresaId) === String(effectiveAccount)));

  const isReady = result.isReadyForModules !== undefined
    ? Boolean(result.isReadyForModules)
    : (result.gclickAuthStatus === 'login_detected' && isMatch);

  result.isReadyForModules = isReady;
  result.accountMatches = isMatch;

  gclickSessionState = {
    connected: Boolean(result.browserStatus === 'open' && (result.gclickAuthStatus === 'login_detected' || result.gclickAuthStatus === 'account_mismatch')),
    accountMatches: isMatch,
    isReadyForModules: isReady,
    activeAccountId: isMatch ? (result.activeAccountId || effectiveAccount) : (result.currentEmpresaId || effectiveAccount),
    activeEmpresaNome: empresaNome,
    currentEmpresaId: result.currentEmpresaId || effectiveAccount,
    currentEmpresaNome: result.currentEmpresaNome || empresaNome,
    availableEmpresas: result.availableEmpresas || []
  };

  updateTopAccountDisplay(effectiveAccount, empresaNome, result.gclickAuthStatus);
  updateSidebarBadges();
  renderAccountList();
  renderEmpresasGrid();
}

async function syncGClickSession(targetAcc = null) {
  const acc = targetAcc || currentAccount();
  const queryParam = acc ? `?accountId=${encodeURIComponent(acc)}` : '';
  try {
    const res = await fetch(`/api/gclick/session${queryParam}`);
    if (res.ok) {
      const result = await res.json().catch(() => null);
      if (result) {
        applySessionResult(result, acc);
        return result;
      }
    }
  } catch { /* inspeção passiva silenciosa */ }
  return null;
}

let autoSwitchTriedFor = null;
function startLoginPoll() {
  if (loginPoll) return;
  loginPoll = setInterval(async () => {
    if (working || loginPollBusy) return;
    loginPollBusy = true;
    try {
      const selectedAcc = currentAccount();
      const result = await syncGClickSession(selectedAcc);
      if (result && result.browserStatus) {
        const effectiveAccount = selectedAcc || result.currentEmpresaId || result.activeAccountId;
        let empresaNome = result.activeEmpresaNome || result.currentEmpresaNome;

        if (gclickSessionState.isReadyForModules || isConnectionResolved()) {
          status(`Login detectado no G-Click para a conta ${effectiveAccount}${empresaNome ? ` (${empresaNome})` : ''}. Módulos liberados!`, 'ok');
          stopLoginPoll();
          return;
        }

        if (selectedAcc && autoSwitchTriedFor !== selectedAcc && (result.gclickAuthStatus === 'account_mismatch' || result.gclickAuthStatus === 'select_company')) {
          autoSwitchTriedFor = selectedAcc;
          if (await switchToSelectedEmpresa(selectedAcc)) { stopLoginPoll(); return; }
        }

        if (result.gclickAuthStatus === 'account_mismatch') {
          status(result.message || `G-Click conectado em outra empresa (${result.currentEmpresaNome || result.currentEmpresaId}). Alterne para a conta ${selectedAcc}.`, 'warn');
          return;
        } else if (result.onEmpresas) {
          status(`Login realizado. Selecione a empresa no G-Click (conta ${effectiveAccount}) para continuar.`);
          return;
        } else if (result.message) {
          status(result.message);
          return;
        }
      }
    } catch { /* O login ou a escolha da conta ainda está em andamento. */ }
    finally { loginPollBusy = false; }
  }, 2000);
}
let lastSourceKey = '';
let currentStructure = null;
let currentProfile = null;

function sourceKey() {
  if (sourceType() === 'recent') { const f = downloadFiles.find(x => x.name === $('downloadFile').value); return `recent:${f?.name}:${f?.modifiedAt}:${f?.size}`; }
  if (sourceType() === 'file') { const f = $('file').files[0]; return `file:${f?.name}:${f?.lastModified}:${f?.size}`; }
  return `url:${$('sourceUrl').value.trim()}:${Date.now()}`;
}

async function inspectSource({ quiet = false } = {}) {
  try {
    if (!quiet) sourceStatus('Lendo as colunas da planilha…');
    const loadPayload = await payload('inspect');
    const result = await api('source/inspect', loadPayload);
    if (!result?.structure) throw new Error('o servidor não devolveu as colunas da planilha');
    currentStructure = result.structure;
    currentProfile = result.existingProfile ?? result.suggestedProfile;
    renderMappingEditor();
    $('mappingEditorSection').hidden = false;
    if (!quiet) sourceStatus(`${result.structure.columnCount} coluna(s) encontradas. Confira o DE/PARA abaixo e salve.`, 'ok');
  } catch (e) {
    if (quiet) return; // conferência automática após a leitura: a falha não apaga o resultado já mostrado
    sourceStatus(`Falha ao ler as colunas: ${e.message}`, 'error');
  }
}

function renderMappingEditor() {
  if (!currentStructure || !currentProfile) return;
  if ($('targetModelSelect')) $('targetModelSelect').value = currentProfile.targetModel || 'enquete_automacao';
  renderProfileBadge();

  const body = $('mappingColumnsBody');
  if (!body) return;
  body.replaceChildren();

  const targetFields = [
    { id: '', label: '(Não mapeado / Preservar)' },
    { id: 'cnpj', label: 'CNPJ' },
    { id: 'empresa', label: 'Empresa / Razão Social' },
    { id: 'empId', label: 'EmpID (G-Click)' },
    { id: 'cod', label: 'Código Interno (Cod.)' },
    { id: 'responsavel', label: 'Responsável (usuário G-Click)' },
    { id: 'tarefa', label: 'Obrigação / Tarefa' },
    { id: 'resposta', label: 'Resposta / Opção' },
    { id: 'data_base', label: 'Data-base' },
    { id: 'competencia', label: 'Competência' }
  ];

  const transforms = [
    { id: 'trim_texto', label: 'Texto simples (trim)' },
    { id: 'limpar_cnpj', label: 'Apenas números (CNPJ)' },
    { id: 'maiusculo', label: 'MAIÚSCULO' },
    { id: 'minusculo', label: 'minúsculo' },
    { id: 'preservar', label: 'Preservar original' }
  ];

  currentStructure.columns.forEach((col) => {
    const pCol = currentProfile.columns?.find(c => c.sourceIndex === col.index) || {
      sourceIndex: col.index,
      position: col.position,
      sourceName: col.rawHeader || col.name,
      targetField: col.suggestedField || '',
      action: col.suggestedField ? 'map' : 'preserve',
      transform: col.suggestedField === 'cnpj' ? 'limpar_cnpj' : 'trim_texto',
      userConfirmed: !col.needsConfirmation
    };

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #eef4f3';

    // 1. #
    const tdIdx = document.createElement('td');
    tdIdx.textContent = col.position;
    tdIdx.style.padding = '6px 10px';
    tdIdx.style.color = '#5e727b';

    // 2. Coluna de Origem
    const tdName = document.createElement('td');
    tdName.style.padding = '6px 10px';
    const strongName = document.createElement('strong');
    strongName.textContent = col.rawHeader || col.name;
    tdName.appendChild(strongName);
    if (col.isDuplicate) {
      const dup = document.createElement('span');
      dup.className = 'tag-pill';
      dup.style.marginLeft = '6px';
      dup.style.background = '#fef3c7';
      dup.style.color = '#92400e';
      dup.textContent = 'Repetida';
      tdName.appendChild(dup);
    }
    if (col.isUnnamed) {
      const un = document.createElement('span');
      un.className = 'tag-pill';
      un.style.marginLeft = '6px';
      un.style.background = '#f3f4f6';
      un.style.color = '#4b5563';
      un.textContent = 'Sem nome';
      tdName.appendChild(un);
    }

    // 3. Amostra
    const tdSample = document.createElement('td');
    tdSample.style.padding = '6px 10px';
    tdSample.style.color = '#5e727b';
    tdSample.textContent = col.samples.slice(0, 2).join(' | ') || '—';

    // 4. Ação
    const tdAction = document.createElement('td');
    tdAction.style.padding = '6px 10px';
    const selAction = document.createElement('select');
    selAction.style.padding = '3px 6px';
    selAction.style.fontSize = '12px';
    [
      { id: 'map', label: 'Mapear' },
      { id: 'preserve', label: 'Preservar sem mapear' },
      { id: 'ignore', label: 'Ignorar' }
    ].forEach(opt => {
      const o = new Option(opt.label, opt.id);
      if (opt.id === pCol.action) o.selected = true;
      selAction.appendChild(o);
    });
    tdAction.appendChild(selAction);

    // 5. Campo de Destino
    const tdTarget = document.createElement('td');
    tdTarget.style.padding = '6px 10px';
    const selTarget = document.createElement('select');
    selTarget.style.padding = '3px 6px';
    selTarget.style.fontSize = '12px';
    targetFields.forEach(opt => {
      const o = new Option(opt.label, opt.id);
      if (opt.id === (pCol.targetField || '')) o.selected = true;
      selTarget.appendChild(o);
    });
    tdTarget.appendChild(selTarget);

    // 6. Transformação
    const tdTrans = document.createElement('td');
    tdTrans.style.padding = '6px 10px';
    const selTrans = document.createElement('select');
    selTrans.style.padding = '3px 6px';
    selTrans.style.fontSize = '12px';
    transforms.forEach(opt => {
      const o = new Option(opt.label, opt.id);
      if (opt.id === pCol.transform) o.selected = true;
      selTrans.appendChild(o);
    });
    tdTrans.appendChild(selTrans);

    // 7. Confirmação
    const tdConfirm = document.createElement('td');
    tdConfirm.style.padding = '6px 10px';
    tdConfirm.style.textAlign = 'center';
    const chkConfirm = document.createElement('input');
    chkConfirm.type = 'checkbox';
    chkConfirm.checked = Boolean(pCol.userConfirmed);
    if (col.needsConfirmation && !pCol.userConfirmed) {
      tr.style.background = '#fffbeb';
    }
    chkConfirm.addEventListener('change', () => {
      if (chkConfirm.checked) tr.style.background = '';
      else if (col.needsConfirmation) tr.style.background = '#fffbeb';
    });
    tdConfirm.appendChild(chkConfirm);

    selAction.addEventListener('change', () => {
      selTarget.disabled = selAction.value !== 'map';
    });
    selAction.dispatchEvent(new Event('change'));

    tr.append(tdIdx, tdName, tdSample, tdAction, tdTarget, tdTrans, tdConfirm);
    body.appendChild(tr);
  });
}

function gatherProfileFromEditor() {
  if (!currentProfile || !currentStructure) return null;
  const rows = $('mappingColumnsBody')?.querySelectorAll('tr') || [];
  const columns = [];
  rows.forEach((tr, idx) => {
    const colStruct = currentStructure.columns[idx];
    const selects = tr.querySelectorAll('select');
    const chk = tr.querySelector('input[type="checkbox"]');
    columns.push({
      sourceIndex: colStruct.index,
      position: colStruct.position,
      sourceName: colStruct.rawHeader || colStruct.name,
      action: selects[0].value,
      targetField: selects[0].value === 'map' ? selects[1].value : null,
      transform: selects[2].value,
      userConfirmed: chk ? chk.checked : true
    });
  });
  return {
    ...currentProfile,
    targetModel: useTargetModel(),
    headerRow: parseInt($('headerRowInput')?.value || '1', 10),
    columns
  };
}

async function saveMappingProfile() {
  const profile = gatherProfileFromEditor();
  if (!profile) return;
  try {
    sourceStatus('Salvando DE/PARA…');
    const res = await api('mapping/profiles/save', { profile });
    currentProfile = res.profile;
    if (res.savedProfiles) savedProfiles = res.savedProfiles;
    renderProfileBadge();
    sourceStatus(`DE/PARA salvo (v${currentProfile.version}). Nas próximas leituras desta planilha ele é aplicado sozinho.`, 'ok');
  } catch (e) {
    sourceStatus(`Erro ao salvar o DE/PARA: ${e.message}`, 'error');
  }
}

async function applyMappingAndLoad() {
  const profile = gatherProfileFromEditor();
  if (!profile) return;
  currentProfile = profile;
  clearPreview();
  await readSource(profile);
}

// "Ler planilha" lê para o uso escolhido; nenhum uso apaga a planilha do outro.
function readSource(profile) {
  return sourceUse() === 'carteira' ? loadCarteiraSheet(profile) : loadTasks(profile);
}

const FIELD_NAMES = { responsavel: 'o Responsável', cnpj: 'o CNPJ', tarefa: 'a Obrigação / Tarefa' };
async function loadCarteiraSheet(profileParam) {
  if (!/^\d+$/.test(currentAccount())) {
    sourceStatus('Informe a conta do escritório em Conexão G-Click antes de ler a planilha da Carteira: os responsáveis são conferidos nos usuários dessa conta.', 'warn');
    return;
  }
  try {
    sourceStatus('Lendo a planilha da Carteira…');
    const p = await payload('tasks');
    if (profileParam) p.profile = profileParam; else delete p.profile;
    const result = await api('source/load', p);
    carteiraSheet = { table: result.table, profile: result.profile, source: result.source, readAt: new Date() };
    carteiraParsedData = null;
    currentProfile = result.profile;
    importedPage = 0; renderImportedTable(); renderProfileBadge();
    $('sourcePreviewInfo').textContent = `${result.rowCount} linha(s) · ${result.table.columns.length} coluna(s) · ${sourceLabel(result.source)} · ${profileLabel(result.profile)}`;
    carteiraSheet.info = $('sourcePreviewInfo').textContent;
    const saved = isSavedProfile(result.profile);
    if (result.missingFields?.length) {
      sourceStatus(`${result.rowCount} linha(s) lidas, mas o DE/PARA não indica ${result.missingFields.map(f => FIELD_NAMES[f] ?? f).join(' nem ')}. Ajuste o DE/PARA abaixo e clique em Aplicar e ler de novo.`, 'warn');
    } else {
      const rows = result.normalized.map(r => ({ linha: r._row, responsavel: r._norm.responsavel, empresa: r._norm.empresa, cnpj: r._norm.cnpj }));
      const parsed = await handleParseCarteiraSheet({ rows });
      sourceStatus(`${parsed.totalRows} empresa(s) de ${parsed.users.length} responsável(is) prontas para a Carteira.${saved ? '' : ' Confira o DE/PARA abaixo e salve para as próximas leituras.'}`, 'ok', { carteira: 'go' });
    }
    if (!saved || result.missingFields?.length) await inspectSource({ quiet: true });
    else $('mappingEditorSection').hidden = true;
  } catch (e) {
    sourceStatus(e.message, 'error');
  }
  renderCarteiraSheetSummary(); updateSidebarBadges();
}
function clearCarteiraSheet() {
  carteiraSheet = null; carteiraParsedData = null;
  if (sourceUse() === 'carteira') { $('sourcePreview').hidden = true; $('sourceTable').replaceChildren(); }
  renderCarteiraSheetSummary();
}

let enqueteSourceInfo = '';
async function loadTasks(profileParam) {
  try {
    $('taskStatus').textContent = 'Lendo e normalizando dados da fonte…';
    sourceStatus('Lendo e normalizando dados da fonte…');
    const p = await payload('tasks');
    if (profileParam || currentProfile) p.profile = profileParam || currentProfile;
    const result = await api('tasks', p);
    if (result.profile) {
      currentProfile = result.profile;
      renderProfileBadge();
    }
    taskCatalog = result.tasks ?? [];
    importedTable = result.table ?? null; importedPage = 0; renderImportedTable();
    if (importedTable) {
      const auditNote = result.audit ? ` · Auditados: ${result.audit.totalRows} registros (${result.audit.uniqueCnpjs ?? 0} CNPJs distintos)` : '';
      $('sourcePreviewInfo').textContent = `${result.rowCount} linha(s) · ${importedTable.columns.length} coluna(s) · ${sourceLabel(result.source)} · ${profileLabel(result.profile)}${auditNote}`;
      enqueteSourceInfo = $('sourcePreviewInfo').textContent;
    }
    const key = sourceKey();
    if (key !== lastSourceKey) { lastSourceKey = key; sourceVersion++; }
    const isTableOnly = result.kind === 'table';
    const message = isTableOnly
      ? `${result.rowCount} linha(s) lidas, mas esta aba não tem ${result.missingForAutomation.join(', ')}: ela não serve para conferir nem gravar na Enquete. Se for a planilha de responsáveis × empresas, use-a como planilha da Carteira; senão, ajuste o DE/PARA abaixo.`
      : `${taskCatalog.length} nomes de tarefa encontrados em ${result.rowCount} linhas (${sourceLabel(result.source)}).${isSavedProfile(result.profile) ? '' : ' Confira o DE/PARA abaixo e salve para as próximas leituras.'}`;
    $('taskStatus').textContent = message;
    sourceStatus(message, isTableOnly ? 'warn' : 'ok', { carteira: isTableOnly ? 'switch' : false });
    if (importedTable && !isSavedProfile(result.profile)) await inspectSource({ quiet: true });
    else if ($('mappingEditorSection')) $('mappingEditorSection').hidden = true;
    if ($('queueFilter').value === 'attention' && !$('queueSearch').value.trim() && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state))) $('queueFilter').value = 'ready';
    renderQueue();
    updateAuditTaskSelect();
    if (result.kind !== 'table') maybeAutoAudit();
  } catch (e) { taskCatalog = []; clearImportedTable(); renderQueue(); updateAuditTaskSelect(); $('taskStatus').textContent = e.message; sourceStatus(e.message, 'error'); }
}
$('sourcePrev').addEventListener('click', () => { if (importedPage) { importedPage--; renderImportedTable(); } });
$('sourceNext').addEventListener('click', () => { if (shownTable() && (importedPage + 1) * SOURCE_PAGE_SIZE < shownTable().rows.length) { importedPage++; renderImportedTable(); } });
function updateAuditTaskSelect() {
  const select = $('auditTaskSelect');
  if (!select) return;
  const current = select.value;
  select.replaceChildren();
  if (!taskCatalog.length) {
    select.append(new Option('Nenhuma tarefa carregada da planilha', ''));
    return;
  }
  select.append(new Option('Selecione uma obrigação…', ''));
  const sorted = [...taskCatalog].sort((a, b) => {
    const ma = mappingFor(a).state === 'ready' ? 0 : 1;
    const mb = mappingFor(b).state === 'ready' ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
  for (const t of sorted) {
    const m = mappingFor(t);
    const label = `${t.name} (${t.count} linhas${m.state === 'ready' ? ` · Mapeada: ${m.label}` : m.state === 'excluded' ? ' · Excluída' : ' · Sem associação'})`;
    select.append(new Option(label, t.name));
  }
  if ([...select.options].some(o => o.value === current)) select.value = current;
}
function dataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function payload(mode) {
  const out = { mode, sourceType: sourceType(), accountId: currentAccount(), targetModel: useTargetModel() };
  if ($('headerRowInput')) out.headerRow = parseInt($('headerRowInput').value || '1', 10);
  if (currentProfile) out.profile = currentProfile;
  if (out.sourceType === 'recent') { out.downloadFile = $('downloadFile').value; if (!out.downloadFile) throw new Error('Selecione o CSV baixado da aba da planilha'); }
  else if (out.sourceType === 'file') { const file = $('file').files[0]; if (!file) throw new Error('Selecione um arquivo CSV ou XLSX'); out.fileName = file.name; out.fileLastModified = file.lastModified; out.fileBase64 = await dataUrl(file); out.sheetName = $('sheetName').value.trim(); }
  else { out.sourceUrl = (sourceUse() === 'carteira' ? $('carteiraSourceUrl') : $('sourceUrl')).value.trim(); const key = $('serviceKey').files[0]; if (key) { if (key.size > 100 * 1024) throw new Error('JSON da conta de serviço maior que 100 KB'); out.serviceKeyBase64 = await dataUrl(key); } }
  return out;
}
async function api(endpoint, data) {
  let response;
  try {
    response = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? {})
    });
  } catch (networkError) {
    throw new Error(`Falha de comunicação com o servidor local: ${networkError.message}. Verifique se o servidor está ativo ou recarregue a página.`);
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && body.code === 'unauthenticated') {
    $('loginScreen').hidden = false;
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!response.ok) throw new Error(body.error || 'Falha na operação');
  return body;
}
function setBusy(value, title = 'Executando automação…', detail = 'Processando dados no G-Click') {
  working = value;
  for (const id of ['openLogin','closeLogin']) {
    if ($(id)) $(id).disabled = value;
  }
  updateApply();

  const banner = $('activeOperationBanner');
  if (banner) {
    banner.hidden = !value;
    if (value) {
      if ($('activeOpTitle')) $('activeOpTitle').textContent = title;
      if ($('activeOpDetail')) $('activeOpDetail').textContent = detail;
    }
  }
}
function metric(label, value, kind = '') { const d = document.createElement('div'); d.className = `metric ${kind}`; const strong = document.createElement('strong'); strong.textContent = value; const span = document.createElement('span'); span.textContent = label; d.append(strong, span); return d; }
function render(report) {
  lastReport = report;
  const items = report.inspected ?? report.plan ?? [];
  const missing = items.filter(x => x.uiStatus === 'nao_encontrado');
  $('modePill').textContent = report.filterTask ? `Conferência: ${report.filterTask}` : report.mode === 'account_audit' ? report.complete === false ? 'Conferência incompleta' : 'Conferência automática' : report.mode === 'preview' || report.mode === 'mapping_preview' ? 'Prévia' : ['apply', 'mapping_apply'].includes(report.mode) ? 'Gravação' : 'Planilha';
  if (report.filterTask) focusTask = report.filterTask;

  const taskFilterSelect = $('resultsTaskFilter');
  if (taskFilterSelect) {
    const uniqueTasks = [...new Set(items.map(x => x.mappingTask).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const currentVal = focusTask || '';
    taskFilterSelect.replaceChildren(
      new Option('Todas as obrigações', ''),
      ...uniqueTasks.map(t => new Option(t, t))
    );
    taskFilterSelect.value = uniqueTasks.includes(currentVal) ? currentVal : '';
  }

  $('mappingResult').hidden = !['mapping_preview', 'account_audit', 'mapping_apply'].includes(report.mode);
  if (report.mode === 'mapping_apply') {
    $('mappingResult').replaceChildren(...report.results.map(x => { const p = document.createElement('p'); p.textContent = `Pergunta ${x.questionRef} (${x.task}): ${x.cancelled ? 'cancelada por você no G-Click' : `${x.changed.length} marcada(s) e conferida(s)`}${x.skipped?.length ? ` · ${x.skipped.length} pulada(s)` : ''}${x.failed?.length ? ` · ${x.failed.length} falharam na conferência` : ''}`; return p; }));
    if (report.error) { const p = document.createElement('p'); p.className = 'queue-warning'; p.textContent = `Interrompido: ${report.error}`; $('mappingResult').append(p); }
  }
  if (['mapping_preview', 'account_audit'].includes(report.mode)) {
    const lines = report.mappings.map(x => `${x.task}: ${x.clients} CNPJ(s) · ${x.summary.vazio} sem marcação · ${x.summary.ja_correto} corretos · ${x.summary.nao_encontrado} não localizados · ${x.summary.divergente + x.summary.bloqueado} bloqueados`);
    $('mappingResult').replaceChildren();
    if (report.sourceWarning) { const p = document.createElement('p'); p.className = 'incomplete-banner'; p.textContent = report.sourceWarning; $('mappingResult').append(p); }
    if (report.complete === false) { const p = document.createElement('p'); p.className = 'incomplete-banner'; p.textContent = `Conferência incompleta. ${report.incompleteReason ?? 'Houve falha de leitura em alguma tarefa.'} Os pares afetados aparecem como “Não verificado”; reconecte a Enquete e confira de novo antes de gravar.`; $('mappingResult').append(p); }
    if (report.mode === 'account_audit') {
      const p = document.createElement('p');
      p.textContent = report.filterTask ? `Conferência filtrada para “${report.filterTask}” · ${report.mappings[0]?.clients ?? 0} CNPJ(s) na planilha.` : `${report.sourceCnpjCount} CNPJs distintos na planilha · ${report.sourceTaskCount} tarefas · ${report.mappings.length} tarefas verificadas na Enquete.`;
      $('mappingResult').append(p);
    }
    for (const line of lines) { const p = document.createElement('p'); p.textContent = line; $('mappingResult').append(p); }
    if (report.pendingTasks.length) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.className = 'queue-warning'; summary.textContent = `${report.pendingTasks.length} tarefa(s) sem associação com uma resposta da Enquete: estado não verificável`; details.append(summary); for (const task of report.pendingTasks) { const p = document.createElement('p'); p.textContent = task; details.append(p); } $('mappingResult').append(details); }
    if (report.failedTasks?.length) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.className = 'queue-warning'; summary.textContent = `${report.failedTasks.length} tarefa(s) com falha na leitura`; details.append(summary); for (const item of report.failedTasks) { const p = document.createElement('p'); p.textContent = `${item.task}: ${item.reason}`; details.append(p); } $('mappingResult').append(details); }
    if (report.excludedTasks?.length) { const p = document.createElement('p'); p.textContent = `${report.excludedTasks.length} tarefa(s) excluída(s) por regra.`; $('mappingResult').append(p); }
  }
  const summary = $('summary'); summary.hidden = false; summary.replaceChildren(metric(report.mode === 'account_audit' ? 'Pares CNPJ/tarefa na fonte' : 'CNPJs no escopo', items.length), metric(report.rules.inputType === 'checkbox' ? 'Não marcadas' : 'Sem resposta', report.summary?.vazio ?? 0), metric('Já corretos', report.summary?.ja_correto ?? 0), metric('Sem mapeamento', report.summary?.sem_mapeamento ?? 0, report.summary?.sem_mapeamento ? 'warn' : ''), metric('Não verificados', report.summary?.nao_verificado ?? 0, report.summary?.nao_verificado ? 'bad' : ''), metric('Não localizados', missing.length, missing.length ? 'bad' : ''), metric('Divergentes / bloqueados', (report.summary?.divergente ?? 0) + (report.summary?.bloqueado ?? 0), 'warn'), metric('CNPJ inválido na fonte', report.invalidSource?.length ?? 0, report.invalidSource?.length ? 'warn' : ''));
  $('missingPanel').hidden = !missing.length; $('missingList').replaceChildren(...missing.map(x => { const li = document.createElement('li'); li.textContent = `${x.cnpj} — ${x.empresa ?? ''} (EmpID ${x.empId ?? '?'})`; return li; }));
  $('invalidPanel').hidden = !(report.invalidSource?.length); $('invalidList').replaceChildren(...(report.invalidSource ?? []).map(x => { const li = document.createElement('li'); li.textContent = `Linha ${x.row}: ${x.cnpj || '(vazio)'} — ${x.empresa ?? ''}`; return li; }));
  $('downloads').hidden = false;
  renderResultRows(report);
  updateApply();
  updateSidebarBadges();
}
function renderResultRows(report) {
  const items = report.inspected ?? report.plan ?? [];
  const filter = $('filter').value;
  const rawQuery = ($('resultsSearch')?.value ?? '').trim().toLowerCase();
  const searchClean = rawQuery.replace(/[.\-/]/g, '');

  const visible = items.filter(x => {
    if (filter !== 'all' && (x.uiStatus ?? x.status) !== filter) return false;
    if (focusTask && x.mappingTask !== focusTask) return false;
    if (searchClean) {
      const cnpjClean = String(x.cnpj ?? '').replace(/\D/g, '');
      const empresa = String(x.empresa ?? '').toLowerCase();
      const task = String(x.mappingTask ?? '').toLowerCase();
      const empId = String(x.empId ?? '').toLowerCase();
      if (!cnpjClean.includes(searchClean) && !empresa.includes(rawQuery) && !task.includes(rawQuery) && !empId.includes(rawQuery)) {
        return false;
      }
    }
    return true;
  });

  $('focusChip').hidden = !focusTask; $('focusLabel').textContent = focusTask ? `Mostrando só: ${focusTask}` : '';
  const totalPages = Math.max(1, Math.ceil(visible.length / RESULTS_PAGE_SIZE));
  resultsPage = Math.min(resultsPage, totalPages - 1);
  const start = resultsPage * RESULTS_PAGE_SIZE;
  const tbody = $('results'); tbody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const x of visible.slice(start, start + RESULTS_PAGE_SIZE)) {
    const tr = document.createElement('tr'); const identity = document.createElement('td'); const bold = document.createElement('strong'); bold.textContent = x.cnpj; const company = document.createElement('div'); company.className = 'company'; company.textContent = x.empresa ?? ''; identity.append(bold, company);
    const emp = document.createElement('td'); emp.textContent = x.empId ?? '—'; const task = document.createElement('td'); task.textContent = x.mappingTask ?? (x.tasks?.filter(t => report.rules.allowedTasks.includes(t)).join(' | ') || '—');
    const state = document.createElement('td'); const tag = document.createElement('span'); const code = x.uiStatus ?? x.status; tag.className = `status-tag ${code}`; tag.textContent = code === 'vazio' && report.rules.inputType === 'checkbox' ? 'Não marcada' : labels[code] ?? code; state.append(tag);
    const detail = document.createElement('td'); const ref = x.mappingAnswer ?? savedMappings.find(m => m.accountId === currentAccount() && m.task === x.mappingTask)?.answerRef;
    detail.textContent = [ref ? `Resposta: ${answerText(ref)}` : '', x.uiReason ?? x.reason ?? ''].filter(Boolean).join(' · '); tr.append(identity, emp, task, state, detail); fragment.append(tr);
  }
  tbody.append(fragment);
  if (!visible.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 5; td.className = 'empty'; td.textContent = 'Nenhum CNPJ neste filtro.'; tr.append(td); tbody.append(tr); }
  $('resultsPager').hidden = visible.length <= RESULTS_PAGE_SIZE;
  $('resultsPageInfo').textContent = visible.length ? `Mostrando ${start + 1}–${Math.min(start + RESULTS_PAGE_SIZE, visible.length)} de ${visible.length} · página ${resultsPage + 1} de ${totalPages}` : 'Nenhum resultado neste filtro';
  $('resultsPrev').disabled = resultsPage === 0;
  $('resultsNext').disabled = resultsPage >= totalPages - 1;
}
function applyContext() {
  const mode = lastReport?.mode, items = lastReport?.inspected ?? [];
  if (['mapping_preview', 'account_audit'].includes(mode)) {
    const count = lastReport.toWrite ?? 0, skipped = items.filter(x => ['divergente','bloqueado','nao_encontrado'].includes(x.uiStatus)).length;
    const allowed = Boolean(previewId && !working && lastReport.complete !== false && !lastReport.sourceWarning && count);
    return { endpoint: 'mappings/apply', count, allowed, reason: lastReport.sourceWarning ? lastReport.sourceWarning : lastReport.complete === false ? 'Conferência incompleta: aguarde uma nova conferência com a janela do G-Click aberta.' : !count ? 'Nenhuma resposta a marcar nesta conferência.' : `${count} resposta(s) sem marcação serão marcadas, pergunta por pergunta; você confirma cada pergunta no G-Click.${skipped ? ` ${skipped} par(es) divergente(s), bloqueado(s) ou não localizado(s) ficam de fora.` : ''}${lastReport.sourceStale ? ' Atenção: o CSV tem mais de 24 h; confirme que a planilha está atual.' : ''}` };
  }
  return null;
}
function nextStep(ctx) {
  if (applyRunning) return applyMessage;
  if (auditRunning) return auditMessage;
  if (lastReport?.mode === 'mapping_plan') return catalogLive ? 'Mapeamento salvo. A conferência na Enquete começa em seguida e atualiza o estado de cada CNPJ.' : 'Mapeamento salvo. Abra o login do G-Click para o robô conferir estes CNPJs na Enquete.';
  if (!lastReport) return '';
  if (lastReport.mode === 'mapping_apply') return lastReport.status === 'verificado' ? 'Gravação concluída e conferida. Próximo passo: mapear as tarefas sem associação.' : `Gravação interrompida: ${lastReport.error ?? 'confira a Enquete'}`;
  if (!['mapping_preview', 'account_audit'].includes(lastReport.mode)) return '';
  const count = lastReport.toWrite ?? 0;
  if (lastReport.sourceWarning) return `Próximo passo: ${lastReport.sourceWarning}`;
  if (lastReport.complete === false) return 'A conferência ficou incompleta. Mantenha a janela do G-Click aberta; uma nova conferência é necessária antes de marcar.';
  if (!count) return 'Nada a marcar: todas as respostas mapeadas já estão no G-Click. Próximo passo: mapear as tarefas sem associação.';
  if (ctx?.allowed) return `Há ${count} resposta(s) a marcar. Próximo passo: clique em “Marcar ${count} resposta(s) no G-Click” e confirme cada pergunta no diálogo do G-Click.`;
  return '';
}
function updateApply() {
  const ctx = applyContext();
  const step = nextStep(ctx);
  $('nextStep').hidden = !step; $('nextStep').textContent = step;
  const isAuditComplete = ['mapping_preview', 'account_audit', 'mapping_apply'].includes(lastReport?.mode);
  $('applyCard').hidden = !isAuditComplete;
  if ($('applyAuditNeeded')) {
    $('applyAuditNeeded').hidden = isAuditComplete || lastReport?.mode !== 'mapping_plan';
  }
  $('apply').disabled = !ctx?.allowed;
  $('apply').textContent = ctx?.count ? `Marcar ${ctx.count} resposta(s) no G-Click` : 'Marcar respostas no G-Click';
  $('applyReason').textContent = ctx?.reason ?? 'A gravação só é liberada após uma prévia ou conferência completa e com opções a marcar.';
}
function auditKey() { return `${currentAccount()}:${liveCatalog?.capturedAt}:${sourceVersion}:${JSON.stringify(savedMappings)}`; }
function isAutoAuditEnabled() {
  const toggle = $('autoAuditToggle');
  return toggle ? toggle.checked : true;
}
function getSelectedAuditTask() {
  if ($('auditScopeSingle')?.checked) {
    return $('auditTaskSelect')?.value || null;
  }
  return null;
}
async function runAuditExecution({ filterTask = null, force = false } = {}) {
  if (!catalogLive) { $('auditStatus').textContent = 'Aguardando o login: a conferência começa quando o robô ler a Enquete da conta.'; return; }
  if (!taskCatalog.length) { $('auditStatus').textContent = 'Informe ou selecione a planilha para carregar os CNPJs.'; return; }
  if (working) return;
  const baseKey = auditKey();
  const key = `${baseKey}:${filterTask || 'ALL'}`;
  if (!force && key === lastAuditKey) return;
  lastAuditKey = key;
  try {
    setBusy(true); renderQueue(); previewId = null;
    $('auditStatus').textContent = filterTask ? `Conferindo a obrigação “${filterTask}” na Enquete…` : 'Conferindo automaticamente as tarefas mapeadas para todos os CNPJs da planilha…';
    $('auditProgress').hidden = false; $('auditProgress').value = 0;
    auditRunning = true; auditMessage = filterTask ? `Conferindo ${filterTask} na Enquete do G-Click…` : 'Conferindo na Enquete do G-Click…'; updateApply();
    auditPoll = setInterval(async () => {
      try {
        const progress = await api('audit/progress', {});
        if (progress.total) {
          $('auditProgress').value = Math.round(100 * progress.completed / progress.total);
          $('auditStatus').textContent = `${progress.completed}/${progress.total} tarefas avaliadas${progress.task ? ` · ${progress.task}` : ''}`;
          auditMessage = `Conferindo na Enquete: ${progress.task || 'preparando'} (${progress.completed}/${progress.total} tarefas). As tarefas já lidas são reaproveitadas.`;
          updateApply();
        }
      } catch { /* A requisição principal exibirá a falha. */ }
    }, 1500);
    const request = await payload('account_audit');
    request.accountId = currentAccount();
    request.autoAudit = true;
    request.headless = $('headlessAuditToggle') ? $('headlessAuditToggle').checked : true;
    if (currentProfile) request.profile = currentProfile;
    if (filterTask) request.filterTask = filterTask;
    const result = await api('mappings/preview', request);
    previewId = result.previewId;
    render(result.report);
    $('auditProgress').value = 100;
    $('auditStatus').textContent = filterTask
      ? `${result.report.complete === false ? 'Incompleto' : 'Concluído'}: obrigação “${filterTask}” verificada (${result.report.mappings[0]?.clients ?? 0} CNPJ(s)).`
      : `${result.report.complete === false ? 'Incompleto' : 'Concluído'}: ${result.report.mappings.length} tarefas verificadas; ${result.report.pendingTasks.length} sem associação; ${result.report.failedTasks.length} com falha de leitura.`;
    status(lastApplySummary ? `${lastApplySummary} Conferência atualizada com o estado atual da Enquete.` : (filterTask ? `Conferência de “${filterTask}” concluída. Nada foi gravado; veja o próximo passo abaixo.` : 'Conferência automática concluída. Nada foi gravado; veja o próximo passo abaixo.'), 'ok');
    lastApplySummary = '';
  } catch (error) {
    $('auditStatus').textContent = `Não foi possível conferir: ${error.message}`;
    status(error.message, 'error');
  } finally {
    auditRunning = false;
    if (auditPoll) clearInterval(auditPoll);
    auditPoll = null;
    $('auditProgress').hidden = true;
    setBusy(false);
    renderQueue();
    if (!filterTask && `${auditKey()}:ALL` !== key && isAutoAuditEnabled()) maybeAutoAudit();
  }
}
async function maybeAutoAudit() {
  if (!isAutoAuditEnabled()) {
    $('auditStatus').textContent = 'Conferência automática pausada. Use “Conferir na Enquete” para auditar sob demanda.';
    return;
  }
  const task = getSelectedAuditTask();
  if ($('auditScopeSingle')?.checked && !task) {
    $('auditStatus').textContent = 'Selecione uma obrigação da lista para conferir na Enquete.';
    return;
  }
  return runAuditExecution({ filterTask: task, force: false });
}
let applyRunning = false, applyMessage = '', lastApplySummary = '';
const STAGES = { iniciando: 'Preparando a gravação…', abrindo: 'Abrindo a pergunta {q} no G-Click…', marcando: 'Marcando as respostas na pergunta {q}…',
  aguardando_confirmacao: 'Pergunta {q}: confira o diálogo na janela do G-Click e clique em Confirmar ({n} cliente(s)). Para cancelar esta pergunta, feche o diálogo.', conferindo: 'Pergunta {q}: conferindo a gravação após recarregar…' };
async function apply() {
  const ctx = applyContext();
  if (!ctx?.allowed) return;
  const poll = setInterval(async () => {
    try {
      const p = await api('apply/progress', {});
      if (!p.running) return;
      applyMessage = `${STAGES[p.stage] ?? 'Gravando…'}`.replace('{q}', p.questionRef ?? '').replace('{n}', p.count ?? '') + ` (${p.done}/${p.questions} pergunta(s) concluída(s))`;
      $('nextStep').hidden = false; $('nextStep').textContent = applyMessage; status(applyMessage);
    } catch { /* a requisição principal mostra o erro */ }
  }, 1500);
  try {
    applyRunning = true; applyMessage = 'Preparando a gravação…'; setBusy(true); status(applyMessage);
    const result = await api(ctx.endpoint, { previewId });
    previewId = null; applyRunning = false; render(result.report);
    const changed = result.report.results.reduce((n, x) => n + x.changed.length, 0), cancelled = result.report.results.filter(x => x.cancelled).length;
    lastApplySummary = `Gravação concluída: ${changed} resposta(s) marcada(s) e conferida(s) após recarga${cancelled ? `; ${cancelled} pergunta(s) cancelada(s) por você` : ''}.${planilhaText(result.report.planilha)}`;
    refreshWriterStatus();
    status(lastApplySummary, 'ok');
  } catch (e) { applyRunning = false; status(`${e.message} Confira o relatório e a Enquete antes de repetir.`, 'error'); previewId = null; }
  finally { clearInterval(poll); applyRunning = false; setBusy(false); lastAuditKey = ''; }
}
let awaitingSheetDownload = false, sheetDownloadRequestedAt = 0;
function showDownloadSelection() {
  const selected = downloadFiles.find(x => x.name === $('downloadFile').value);
  $('downloadHint').textContent = selected ? `Selecionado: ${selected.name} · baixado em ${new Date(selected.modifiedAt).toLocaleString('pt-BR')}${selected.stale ? ' · antigo para gravação' : ''}`
    : awaitingSheetDownload ? 'Link alterado. Clique em “Baixar CSV da aba” e aguarde o novo arquivo, ou selecione manualmente o CSV correto.' : 'Nenhum CSV da aba selecionado.';
}
function invalidateRecentSource() {
  awaitingSheetDownload = true; sheetDownloadRequestedAt = 0;
  $('downloadFile').value = '';
  taskCatalog = []; selectedTasks.clear(); lastSourceKey = ''; lastAuditKey = '';
  clearPreview(); clearImportedTable(); renderQueue(); updateAuditTaskSelect(); showDownloadSelection();
  $('taskStatus').textContent = 'Link da aba alterado. Baixe o CSV desta aba para carregar as tarefas.';
  sourceStatus('Link alterado. Baixe o CSV desta aba ou selecione Arquivo para importar o CSV da sua pasta Downloads.');
}
function updateRecentSheetLinks() {
  const download = $('directExport'), open = $('openSheet'), hint = $('recentUrlHint');
  try {
    if (!$('recentSheetUrl').value.trim()) { download.removeAttribute('href'); open.removeAttribute('href'); hint.textContent = 'Cole o link da aba da planilha deste escritório; ele fica salvo para a conta.'; return; }
    const url = new URL($('recentSheetUrl').value.trim());
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) throw new Error('Informe um link válido de uma aba do Google Sheets.');
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const gid = hash.get('gid') ?? url.searchParams.get('gid') ?? '0';
    if (!/^\d+$/.test(gid)) throw new Error('O link precisa indicar uma aba válida (gid numérico).');
    const sheet = `https://docs.google.com/spreadsheets/d/${match[1]}`;
    download.href = `${sheet}/export?format=csv&gid=${gid}`;
    open.href = `${sheet}/edit?gid=${gid}#gid=${gid}`;
    hint.textContent = `Aba selecionada: gid ${gid}. O CSV será baixado pelo navegador integrado.`;
  } catch (error) {
    download.removeAttribute('href'); open.removeAttribute('href'); hint.textContent = error.message;
  }
}
async function refreshDownloads() {
  try {
    const selectedName = $('downloadFile').value;
    const selectedBefore = downloadFiles.find(x => x.name === selectedName);
    const previous = selectedBefore && `${selectedBefore.name}:${selectedBefore.modifiedAt}:${selectedBefore.size}`;
    const result = await api('downloads', {});
    downloadFiles = result.files;
    const select = $('downloadFile'); select.replaceChildren();
    if (!result.files.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Nenhum CSV recente com as colunas exigidas'; select.append(option);
      if (sourceType() === 'recent') sourceStatus('Nenhum CSV recente com as colunas exigidas foi encontrado em ~/Downloads. Baixe a aba ou use Arquivo para escolher o CSV em outra pasta.', 'error');
    } else for (const file of result.files) {
      const option = document.createElement('option'); option.value = file.name;
      option.textContent = `${file.name} — ${new Date(file.modifiedAt).toLocaleString('pt-BR')}${file.stale ? ' (antigo)' : ''}`;
      select.append(option);
    }
    if (awaitingSheetDownload) {
      const downloaded = sheetDownloadRequestedAt && downloadFiles.find(file => new Date(file.modifiedAt).getTime() >= sheetDownloadRequestedAt);
      if (downloaded) { select.value = downloaded.name; awaitingSheetDownload = false; sheetDownloadRequestedAt = 0; }
      else { select.add(new Option('Baixe o CSV da nova aba ou selecione o arquivo correto', ''), 0); select.value = ''; }
    }
    const selectedAfter = downloadFiles.find(x => x.name === select.value);
    const current = selectedAfter && `${selectedAfter.name}:${selectedAfter.modifiedAt}:${selectedAfter.size}`;
    if (previous && previous !== current) {
      selectedTasks.clear(); renderQueue();
      if (previewId) status('O CSV selecionado mudou. Gere uma nova prévia antes de gravar.', 'warn');
      clearPreview();
    }
    showDownloadSelection(); updateApply(); if (select.value) await readSource();
  } catch (e) { status(e.message, 'error'); }
}
async function login(endpoint) {
  const btnId = endpoint === 'login/open' ? 'openLogin' : 'closeLogin';
  const label = endpoint === 'login/open' ? 'Abrindo navegador…' : 'Verificando…';
  return withButtonLoading(btnId, label, async () => {
    try {
      setBusy(true); clearPreview(); stopLoginPoll();
      if (endpoint === 'login/open') autoSwitchTriedFor = null; // novo login: a troca automática vale de novo
      status(endpoint === 'login/open' ? 'Abrindo o Chrome na página de autenticação do G-Click…' : 'Verificando a conexão com o G-Click…');
      if (!/^\d+$/.test(currentAccount())) {
        toast.warning('Informe o código da conta G-Click (empId do escritório) antes de conectar.', 'Conta necessária');
        throw new Error('Informe o código da conta G-Click (empId do escritório) antes de conectar.');
      }
      const result = await api(endpoint, { accountId: currentAccount() });

      const selectedAcc = currentAccount();
      const effectiveAccount = selectedAcc || result.currentEmpresaId || result.activeAccountId;
      const empresaNome = result.activeEmpresaNome || result.currentEmpresaNome || result.empresaNome;

      gclickSessionState = {
        connected: Boolean(result.stage === 'login_detected' || result.stage === 'account_mismatch'),
        accountMatches: Boolean(result.accountMatches ?? (result.stage === 'login_detected')),
        isReadyForModules: Boolean(result.isReadyForModules ?? (result.stage === 'login_detected')),
        activeAccountId: result.activeAccountId || effectiveAccount,
        activeEmpresaNome: empresaNome,
        currentEmpresaId: result.currentEmpresaId || effectiveAccount,
        currentEmpresaNome: empresaNome
      };

      if (result.accountId || result.empresaNome || effectiveAccount) {
        updateTopAccountDisplay(effectiveAccount, empresaNome, result.stage === 'login_detected' ? 'login_detected' : result.stage === 'account_mismatch' ? 'account_mismatch' : 'logged_in');
      }

      updateSidebarBadges();

      if (result.stage === 'account_mismatch') {
        const mismatchMsg = result.message || `G-Click conectado em outra empresa (${result.currentEmpresaNome || result.currentEmpresaId}). Alterne para a conta ${selectedAcc}.`;
        status(mismatchMsg, 'warn');
        toast.warning(mismatchMsg, 'Empresa Incorreta');
        startLoginPoll();
        return;
      }

      if (result.catalog) useCatalog(result.catalog, true);
      else if (endpoint === 'login/open') {
        liveCatalog = null; catalogLive = false; renderCatalogOverview(); renderQueue();
        startLoginPoll();
      }

      const msg = endpoint === 'login/open'
        ? 'Entre no G-Click na janela que abriu. A conexão é detectada sozinha e os módulos são liberados quando a conta certa estiver ativa.'
        : (result.catalog ? `Catálogo atual conferido: ${result.catalog.questionCount} perguntas.` : (result.message || 'Login verificado no G-Click.'));
      status(msg, 'ok');
      toast.success(msg, endpoint === 'login/open' ? 'Navegador aberto' : 'Sessão G-Click');
    } catch (error) {
      status(error.message, 'error');
      toast.error(error.message, 'Falha no Login G-Click');
      if (endpoint === 'login/close') startLoginPoll();
    } finally {
      setBusy(false);
    }
  });
}
for (const input of document.querySelectorAll('input[name="sourceType"]')) input.addEventListener('change', () => { $('fileBox').hidden = sourceType() !== 'file'; $('urlBox').hidden = sourceType() !== 'url'; $('recentBox').hidden = sourceType() !== 'recent'; if (sourceUse() === 'carteira') { currentProfile = null; $('mappingEditorSection').hidden = true; sourceStatus(sourceType() === 'url' ? 'Cole o link da planilha de responsáveis × empresas e clique em Ler planilha.' : sourceType() === 'file' ? 'Escolha o CSV ou XLSX; a leitura começa ao selecionar o arquivo.' : 'Baixe o CSV da aba e selecione o arquivo recebido.'); if (sourceType() === 'recent') refreshDownloads(); return; } taskCatalog = []; selectedTasks.clear(); clearImportedTable(); renderQueue(); $('taskStatus').textContent = 'Leia as tarefas da fonte selecionada.'; currentProfile = null; $('mappingEditorSection').hidden = true; sourceStatus(sourceType() === 'url' ? 'Cole o link da planilha e clique em Ler planilha.' : sourceType() === 'file' ? 'Escolha o CSV ou XLSX; a leitura começa ao selecionar o arquivo.' : 'Baixe o CSV da aba e selecione o arquivo recebido.'); clearPreview(); if (sourceType() === 'recent') refreshDownloads(); });
for (const id of ['accountId','file','sheetName','sourceUrl','recentSheetUrl','serviceKey']) $(id).addEventListener('input', () => { previewId = null; updateApply(); if (id === 'accountId') updateSidebarBadges(); });
function setSheetUrl(value) {
  if ($('recentSheetUrl').value === value && $('sourceUrl').value === value) return;
  $('recentSheetUrl').value = value; $('sourceUrl').value = value; updateRecentSheetLinks();
}
async function saveSheetUrl(event) {
  const accountId = currentAccount(), sheetUrl = event.target.value.trim();
  if (!/^\d+$/.test(accountId)) { status('Informe a conta antes do link da planilha, para salvá-lo no escritório certo.', 'error'); return; }
  try {
    const result = await api('accounts/save', { accountId, sheetUrl });
    config.accounts = result.accounts; renderAccountList();
    setSheetUrl(sheetUrl);
    status(sheetUrl ? `Link da planilha salvo para a conta ${accountId}.` : `Link da planilha removido da conta ${accountId}.`, 'ok');
    refreshWriterStatus();
  } catch (error) { status(error.message, 'error'); }
}
function renderAccountList() {
  const accounts = config?.accounts ?? [];
  const options = [];
  const seenIds = new Set();

  for (const a of accounts) {
    seenIds.add(String(a.accountId));
    const label = `${a.accountId} · ${a.mappings} mapeamento(s)${a.capturedAt ? ` · catálogo de ${new Date(a.capturedAt).toLocaleDateString('pt-BR')}` : ''}${a.sheetUrl ? ' · planilha salva' : ''}`;
    options.push(new Option(label, a.accountId));
  }

  if (Array.isArray(gclickSessionState?.availableEmpresas)) {
    for (const emp of gclickSessionState.availableEmpresas) {
      if (!seenIds.has(String(emp.id))) {
        seenIds.add(String(emp.id));
        options.push(new Option(`${emp.id} · ${emp.nome}`, emp.id));
      }
    }
  }

  $('accountList')?.replaceChildren(...options);
}

function formatCnpjDisplay(cnpj) {
  if (!cnpj) return null;
  const digits = String(cnpj).replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return String(cnpj);
}

function getInitials(name) {
  if (!name) return 'GC';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderEmpresasGrid() {
  const container = $('empresaCardsGrid');
  if (!container) return;

  const empresas = gclickSessionState?.availableEmpresas || [];
  const activeId = String(gclickSessionState?.activeAccountId || gclickSessionState?.currentEmpresaId || currentAccount() || '');
  const searchFilter = ($('empresaGridSearch')?.value || '').trim().toLowerCase();

  if (!empresas.length) {
    container.innerHTML = `
      <div class="empresa-grid-empty" id="empresaGridEmpty">
        <div class="empty-icon">🏢</div>
        <p>Nenhuma empresa carregada. Abra a janela de login e autentique-se no G-Click para carregar as empresas disponíveis.</p>
      </div>`;
    return;
  }

  const filtered = empresas.filter(emp => {
    if (!searchFilter) return true;
    const nome = (emp.nome || '').toLowerCase();
    const apelido = (emp.apelido || '').toLowerCase();
    const id = String(emp.id || '').toLowerCase();
    const cnpj = String(emp.cnpj || '').replace(/\D/g, '');
    const cleanFilter = searchFilter.replace(/\D/g, '');
    return nome.includes(searchFilter) ||
           apelido.includes(searchFilter) ||
           id.includes(searchFilter) ||
           (cleanFilter && cnpj.includes(cleanFilter));
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empresa-grid-empty">
        <div class="empty-icon">🔍</div>
        <p>Nenhuma empresa encontrada para o filtro "<strong>${escapeHtml(searchFilter)}</strong>".</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  for (const emp of filtered) {
    const isCurrent = String(emp.id) === activeId;
    const isSuspended = emp.ativo === false;
    const card = document.createElement('div');
    card.className = `empresa-card-item${isCurrent ? ' is-active' : ''}${isSuspended ? ' is-disabled' : ''}`;
    card.dataset.id = emp.id;
    if (isSuspended) card.title = 'Empresa suspensa no G-Click';

    const initials = getInitials(emp.apelido || emp.nome);
    const photoUrl = emp.imagemUrl || `/api/empresa/foto?account=${encodeURIComponent(emp.id)}`;
    const avatarHtml = `<img class="empresa-card-avatar" src="${escapeHtml(photoUrl)}" alt="" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('div'),{className:'empresa-card-avatar',textContent:'${initials}'}))">`;

    const statusBadge = isSuspended
      ? `<span class="badge-empresa badge-empresa-status-suspended">Suspensa</span>`
      : `<span class="badge-empresa badge-empresa-status-active">Empresa Ativa</span>`;

    const connectedBadge = isCurrent
      ? `<span class="badge-empresa badge-empresa-connected">Conectada Agora</span>`
      : '';

    const cnpjFormatted = formatCnpjDisplay(emp.cnpj);

    card.innerHTML = `
      <div class="empresa-card-top">
        ${avatarHtml}
        <div class="empresa-card-badges">
          ${connectedBadge}
          ${statusBadge}
        </div>
      </div>
      <div class="empresa-card-body">
        <div class="empresa-card-name">${escapeHtml(emp.nome)}</div>
        ${emp.apelido && emp.apelido !== emp.nome ? `<div class="empresa-card-apelido">${escapeHtml(emp.apelido)}</div>` : ''}
      </div>
      <div class="empresa-card-meta">
        <span>ID: <strong>${escapeHtml(emp.id)}</strong></span>
        ${cnpjFormatted ? `<span>CNPJ: <strong>${escapeHtml(cnpjFormatted)}</strong></span>` : ''}
      </div>
    `;

    card.addEventListener('click', async () => {
      if (card.classList.contains('is-loading')) return;
      if (isSuspended) {
        toast.warning('Esta empresa está marcada como suspensa no G-Click.', 'Empresa Suspensa');
        return;
      }
      if (isCurrent && (gclickSessionState.isReadyForModules || isConnectionResolved())) {
        toast.info(`A conta ${emp.id} (${emp.nome}) já está conectada e ativa no G-Click.`, 'Empresa Conectada');
        return;
      }

      card.classList.add('is-loading');
      const input = $('accountId');
      if (input) {
        input.value = emp.id;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      try {
        const success = await switchToSelectedEmpresa(emp.id);
        if (success) {
          renderEmpresasGrid();
        }
      } finally {
        card.classList.remove('is-loading');
      }
    });

    container.appendChild(card);
  }
}

$('empresaGridSearch')?.addEventListener('input', () => renderEmpresasGrid());

$('recentSheetUrl').addEventListener('input', updateRecentSheetLinks);
$('recentSheetUrl').addEventListener('input', invalidateRecentSource);
$('recentSheetUrl').addEventListener('change', saveSheetUrl);
$('sourceUrl').addEventListener('change', saveSheetUrl);
$('directExport').addEventListener('click', () => {
  if (!$('directExport').href) return;
  const requestedAt = Date.now();
  invalidateRecentSource();
  awaitingSheetDownload = true; sheetDownloadRequestedAt = requestedAt;
  $('downloadFile').value = ''; showDownloadSelection();
  status('Download solicitado. Aguardando o arquivo chegar em ~/Downloads…');
  let attempts = 0;
  const check = async () => {
    attempts++;
    await refreshDownloads();
    if (!awaitingSheetDownload && $('downloadFile').value) { status('CSV novo encontrado em ~/Downloads e selecionado.', 'ok'); return; }
    if (attempts < 8) { setTimeout(check, 3000); return; }
    status('O CSV não chegou em ~/Downloads. Confira se o navegador salvou em outra pasta ou pediu para escolher o local, e se a planilha abriu logada. Alternativa: em Fonte da planilha, escolha Arquivo e envie o CSV baixado.', 'error');
  };
  setTimeout(check, 2500);
});
$('refreshDownloads').addEventListener('click', refreshDownloads); $('downloadFile').addEventListener('change', () => { awaitingSheetDownload = false; sheetDownloadRequestedAt = 0; taskCatalog = []; selectedTasks.clear(); clearImportedTable(); renderQueue(); clearPreview(); showDownloadSelection(); if ($('downloadFile').value) readSource(); });
$('loadSourceBtn').addEventListener('click', () => withButtonLoading('loadSourceBtn', 'Lendo…', () => { if (sourceUse() === 'enquete') clearPreview(); return readSource(); }));
$('btnSourceToCarteira').addEventListener('click', () => {
  if ($('btnSourceToCarteira').dataset.mode === 'go') { switchSection('carteira'); return; }
  // A aba lida na Enquete é de responsáveis × empresas: leva o link para o uso Carteira; a leitura fica com o operador.
  if (sourceType() === 'url') $('carteiraSourceUrl').value = $('sourceUrl').value;
  setSourceUse('carteira');
  if (sourceType() === 'url') saveCarteiraSheetUrl();
  sourceStatus('Uso trocado para Carteira por Usuário. Clique em Ler planilha.');
});
function setSourceUse(use) {
  const radio = document.querySelector(`input[name="sourceUse"][value="${use}"]`);
  if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
}
for (const input of document.querySelectorAll('input[name="sourceUse"]')) input.addEventListener('change', () => {
  const use = sourceUse();
  $('sourceUrl').hidden = use !== 'enquete';
  $('carteiraSourceUrl').hidden = use !== 'carteira';
  if (use === 'carteira' && !$('carteiraSourceUrl').value) $('carteiraSourceUrl').value = knownAccount()?.carteiraSheetUrl ?? '';
  currentProfile = use === 'carteira' ? carteiraSheet?.profile ?? null : null;
  currentStructure = null;
  $('mappingEditorSection').hidden = true;
  $('requiredFieldsHint').textContent = use === 'carteira' ? 'Responsável e CNPJ' : 'Obrigação / Tarefa e CNPJ ou código';
  importedPage = 0; renderImportedTable();
  $('sourcePreviewInfo').textContent = use === 'carteira' ? carteiraSheet?.info ?? '' : enqueteSourceInfo;
  const view = sourceViewByUse[use];
  if (view) sourceStatus(view.message, view.kind, { carteira: view.carteira });
  else sourceStatus(use === 'carteira' ? 'Cole o link da planilha de responsáveis × empresas e clique em Ler planilha.' : 'Cole o link da planilha e clique em Ler planilha.');
});
const knownAccount = () => (config.accounts ?? []).find(a => String(a.accountId) === String(currentAccount()));
async function saveCarteiraSheetUrl() {
  const accountId = currentAccount(), carteiraSheetUrl = $('carteiraSourceUrl').value.trim();
  if (!/^\d+$/.test(accountId)) return;
  try {
    const result = await api('accounts/save', { accountId, carteiraSheetUrl });
    config.accounts = result.accounts;
  } catch (error) { sourceStatus(error.message, 'error'); }
}
$('carteiraSourceUrl').addEventListener('change', saveCarteiraSheetUrl);
$('carteiraSourceUrl').addEventListener('input', () => { if (sourceType() === 'url') { clearCarteiraSheet(); currentProfile = null; $('mappingEditorSection').hidden = true; sourceStatus('Link alterado. Clique em Ler planilha.'); } });
$('inspectSourceBtn')?.addEventListener('click', inspectSource);
$('saveProfileBtn')?.addEventListener('click', saveMappingProfile);
$('applyAndLoadBtn')?.addEventListener('click', applyMappingAndLoad);
$('file').addEventListener('change', () => { if (sourceType() === 'file' && $('file').files.length && sourceUse() === 'carteira') { clearCarteiraSheet(); currentProfile = null; readSource(); return; } if (sourceType() === 'file' && $('file').files.length) { taskCatalog = []; selectedTasks.clear(); currentProfile = null; clearPreview(); clearImportedTable(); renderQueue(); loadTasks(); } });
$('sourceUrl').addEventListener('input', () => { if (sourceType() === 'url') { taskCatalog = []; selectedTasks.clear(); currentProfile = null; $('mappingEditorSection').hidden = true; clearPreview(); clearImportedTable(); renderQueue(); sourceStatus('Link alterado. Clique em Ler planilha.'); } });
$('queueSearch').addEventListener('input', renderQueue); $('queueFilter').addEventListener('change', renderQueue);
$('btnConfirmAllSuggestions')?.addEventListener('click', async () => {
  const accountId = currentAccount();
  if (!liveCatalog || !accountId) return;
  const all = taskCatalog.map(task => ({ task, mapping: mappingFor(task) }));
  const suggestions = all.filter(x => x.mapping.state === 'suggested' && x.mapping.ref).map(x => ({
    task: x.task.name,
    answerRef: x.mapping.ref
  }));
  if (!suggestions.length) return;
  try {
    setBusy(true);
    status(`Salvando ${suggestions.length} mapeamento(s)...`);
    const res = await api('mappings/save-batch', { accountId, mappings: suggestions });
    savedMappings = res.savedMappings;
    status(`${res.updatedCount} sugestões seguras foram confirmadas!`, 'ok');
    renderQueue();
  } catch (err) {
    status(`Falha ao confirmar sugestões: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
});
$('editorSearch').addEventListener('input', () => fillEditorQuestions($('editorSearch').value));
$('catalogOverviewSearch').addEventListener('input', renderCatalogOverview);
$('editorQuestion').addEventListener('change', () => fillEditorAnswers());
$('confirmMapping').addEventListener('click', () => saveMapping($('editorAnswer').value));
$('clearMapping').addEventListener('click', () => saveMapping(''));
$('excludeMapping').addEventListener('click', () => saveMapping('', true));
$('cancelMapping').addEventListener('click', () => { $('mappingEditor').hidden = true; editingTask = null; });
let loadedAccount = null;
async function loadAccountCatalog() {
  const accountId = currentAccount();
  // A planilha é de um escritório: ao trocar de conta, a fonte escolhida antes deixa de valer.
  if (loadedAccount && loadedAccount !== accountId) {
    taskCatalog = []; selectedTasks.clear(); clearPreview(); clearImportedTable(); clearCarteiraSheet();
    $('carteiraSourceUrl').value = knownAccount()?.carteiraSheetUrl ?? '';
    $('downloadFile').value = ''; showDownloadSelection();
    $('taskStatus').textContent = 'Conta alterada: selecione a planilha deste escritório.';
  }
  loadedAccount = accountId;
  try { if (/^\d+$/.test(accountId)) localStorage.setItem(ACCOUNT_KEY, accountId); } catch { /* preferência local opcional */ }
  if (liveCatalog && liveCatalog.accountId !== accountId) { liveCatalog = null; catalogLive = false; renderCatalogOverview(); }
  if (!/^\d+$/.test(accountId)) setSheetUrl('');
  else if (liveCatalog) { const known = (config.accounts ?? []).find(a => a.accountId === accountId); setSheetUrl(known?.sheetUrl ?? ''); }
  if (/^\d+$/.test(accountId) && !liveCatalog) {
    try {
      const result = await api('catalog/reference', { accountId });
      if (currentAccount() === accountId) setSheetUrl(result.sheetUrl ?? '');
      if (result.catalog && currentAccount() === accountId) useCatalog(result.catalog, true);
    } catch { /* sem catálogo salvo para esta conta */ }
  }
  selectedTasks.clear(); renderQueue();
  updateTopAccountDisplay(accountId);
  if (/^\d+$/.test(accountId)) {
    syncGClickSession(accountId).catch(() => {});
  }
}
$('accountId').addEventListener('change', () => {
  loadAccountCatalog();
  renderEmpresasGrid();
});
$('accountId').addEventListener('input', () => {
  const acc = $('accountId').value.trim();
  if (/^\d+$/.test(acc) && (config.loginReady || config.catalogLive) && !gclickSessionState.connected) {
    gclickSessionState = {
      ...gclickSessionState,
      connected: true,
      accountMatches: true,
      isReadyForModules: true,
      activeAccountId: acc,
      currentEmpresaId: acc
    };
  }
  updateTopAccountDisplay(acc);
  renderEmpresasGrid();
  if (/^\d+$/.test(acc)) {
    syncGClickSession(acc).catch(() => {});
  }
});
$('clearFocus').addEventListener('click', () => { focusTask = null; resultsPage = 0; if ($('resultsTaskFilter')) $('resultsTaskFilter').value = ''; if (lastReport) renderResultRows(lastReport); });
async function refreshWriterStatus() {
  const accountId = currentAccount();
  if (!/^\d+$/.test(accountId)) { $('writerStatus').textContent = 'Informe a conta para ver a configuração.'; $('resendMarks').hidden = true; return; }
  try {
    const w = await api('sheet-writer/status', { accountId });
    $('writerUrl').value = w.url;
    $('writerStatus').textContent = !w.hasSheetUrl ? 'Salve primeiro o link da aba da planilha desta conta.' : w.configured
      ? `Ativo na aba “${w.aba ?? '?'}” (testado em ${new Date(w.testedAt).toLocaleString('pt-BR')}). ${w.marks} marcação(ões) registrada(s)${w.pending ? `, ${w.pending} pendente(s) na planilha` : ''}.`
      : `Não configurado: as marcações ficam só no CSV “Baixar marcações registradas”.${w.marks ? ` ${w.marks} marcação(ões) aguardando a planilha.` : ''}`;
    $('writerSetup').open = w.hasSheetUrl && !w.configured;
    $('resendMarks').hidden = !(w.configured && w.pending);
  } catch (error) { $('writerStatus').textContent = error.message; }
}
$('copyScript').addEventListener('click', async () => {
  try {
    const { script } = await api('sheet-writer/script', { accountId: currentAccount() });
    try { await navigator.clipboard.writeText(script); $('copyStatus').textContent = 'Script copiado.'; $('scriptFallback').hidden = true; }
    catch { $('scriptFallback').value = script; $('scriptFallback').hidden = false; $('scriptFallback').select(); $('copyStatus').textContent = 'Copie o texto abaixo (Ctrl+C).'; }
  } catch (error) { $('copyStatus').textContent = error.message; }
});
$('saveWriter').addEventListener('click', async () => {
  await withButtonLoading('saveWriter', 'Testando script…', async () => {
    try {
      $('writerStatus').textContent = 'Testando o Apps Script…';
      const r = await api('sheet-writer/save', { accountId: currentAccount(), url: $('writerUrl').value.trim() });
      const msg = `Registro na planilha ativo (aba “${r.aba}”).${r.sync?.linhas ? ` ${r.sync.linhas} linha(s) atualizadas com marcações anteriores.` : ''}`;
      status(msg, 'ok');
      toast.success(msg, 'Planilha Conectada');
    } catch (error) {
      status(error.message, 'error');
      toast.error(error.message, 'Falha no Apps Script');
    }
    refreshWriterStatus();
  });
});
$('resendMarks').addEventListener('click', async () => {
  await withButtonLoading('resendMarks', 'Reenviando…', async () => {
    try {
      const r = await api('sheet-writer/resend', { accountId: currentAccount() });
      const msg = r.error ? `Planilha: ${r.error}` : `Planilha: ${r.linhas ?? 0} linha(s) atualizada(s)${r.pending ? `; ${r.pending} sem linha correspondente` : ''}.`;
      status(msg, r.error ? 'error' : 'ok');
      if (r.error) toast.error(r.error, 'Falha no reenvio');
      else toast.success(msg, 'Marcações Reenviadas');
    } catch (error) {
      status(error.message, 'error');
      toast.error(error.message, 'Falha no reenvio');
    }
    refreshWriterStatus();
  });
});
function planilhaText(p) {
  if (!p) return '';
  if (!p.configured) return ' Planilha: registro não configurado; use “Baixar marcações registradas”.';
  if (p.error) return ` Planilha: falhou (${p.error}); use “Reenviar marcações pendentes”.`;
  return ` Planilha: ${p.linhas ?? 0} linha(s) atualizada(s) na coluna “Enquete G-Click”${p.pending ? `; ${p.pending} sem linha correspondente` : ''}.`;
}
function updateLedgerLink() {
  const a = currentAccount();
  const valid = /^\d+$/.test(a);
  if ($('auditLogLink')) {
    $('auditLogLink').hidden = !valid;
    $('auditLogLink').href = `/api/audit/log.csv?account=${encodeURIComponent(a)}`;
    $('auditLogLink').setAttribute('download', `gclick-log-auditoria-${a}.csv`);
  }
  if ($('ledgerLink')) {
    $('ledgerLink').hidden = !valid;
    $('ledgerLink').href = `/api/marcacoes.csv?account=${encodeURIComponent(a)}&type=ledger_only`;
    $('ledgerLink').setAttribute('download', `marcacoes-gravadas-robo-${a}.csv`);
  }
}
$('accountId').addEventListener('change', () => { updateLedgerLink(); refreshWriterStatus(); updateSidebarBadges(); });
$('filter').addEventListener('change', () => { resultsPage = 0; if (lastReport) renderResultRows(lastReport); });
$('resultsSearch')?.addEventListener('input', () => { resultsPage = 0; if (lastReport) renderResultRows(lastReport); });
$('resultsTaskFilter')?.addEventListener('change', e => {
  focusTask = e.target.value || null;
  resultsPage = 0;
  if (lastReport) renderResultRows(lastReport);
});
$('resultsPrev').addEventListener('click', () => { if (lastReport && resultsPage > 0) { resultsPage--; renderResultRows(lastReport); } });
$('resultsNext').addEventListener('click', () => { if (lastReport) { resultsPage++; renderResultRows(lastReport); } });
$('apply').addEventListener('click', apply);
$('runAuditFromApply')?.addEventListener('click', () => {
  const isSingle = $('auditScopeSingle')?.checked;
  const filterTask = isSingle ? $('auditTaskSelect')?.value : null;
  runAuditExecution({ filterTask, force: true });
});
$('openLogin').addEventListener('click', () => login('login/open')); $('closeLogin').addEventListener('click', () => login('login/close'));
// Troca a empresa ativa no Chrome da automação para a conta do painel (card em appp /empresas).
async function switchToSelectedEmpresa(accountId) {
  try {
    status(`Alternando para a empresa ${accountId} no G-Click…`);
    const result = await api('gclick/switch-empresa', { accountId });
    // Contrato de ensureEmpresaActive: { active, accountId, empresaNome, reason, message }
    if (result.active) {
      const activeId = String(result.currentAccountId || result.accountId || accountId);
      const nome = result.empresaNome || result.currentEmpresaNome || '';
      gclickSessionState = {
        ...gclickSessionState,
        connected: true,
        accountMatches: true,
        isReadyForModules: true,
        activeAccountId: activeId,
        activeEmpresaNome: nome,
        currentEmpresaId: activeId,
        currentEmpresaNome: nome
      };
      if ($('accountId') && $('accountId').value !== activeId) {
        $('accountId').value = activeId;
      }
      updateSidebarBadges();
      updateTopAccountDisplay(activeId, nome, 'login_detected');
      renderEmpresasGrid();
      if (result.fotoSaved) loadAccountFoto(activeId, true);
      toast.success(`Conta alternada com sucesso para ${activeId}${nome ? ` (${nome})` : ''}`, 'Empresa Atualizada');
      status(`Empresa ativa atualizada para ${activeId}. Módulos liberados!`, 'ok');
      return true;
    }
    toast.error(result.message || 'Falha ao alternar empresa.', 'Troca de Empresa');
    status(result.message || 'Falha ao alternar empresa.', 'error');
  } catch (err) {
    toast.error(err.message, 'Erro ao alternar empresa');
    status(err.message, 'error');
  }
  return false;
}
$('btnSwitchEmpresa')?.addEventListener('click', async () => {
  const accountId = currentAccount();
  if (!accountId) {
    toast.warning('Informe o código da conta antes de alternar.', 'Conta necessária');
    return;
  }
  await withButtonLoading('btnSwitchEmpresa', 'Alternando conta…', () => switchToSelectedEmpresa(accountId));
});
const AUTO_AUDIT_KEY = 'enqueteSync_autoAudit';
const HEADLESS_AUDIT_KEY = 'enqueteSync_headlessAudit';
try {
  const savedAuto = localStorage.getItem(AUTO_AUDIT_KEY);
  if (savedAuto !== null && $('autoAuditToggle')) $('autoAuditToggle').checked = savedAuto === 'true';
} catch { /* sem preferência local */ }
try {
  const savedHeadless = localStorage.getItem(HEADLESS_AUDIT_KEY);
  if (savedHeadless !== null && $('headlessAuditToggle')) $('headlessAuditToggle').checked = savedHeadless === 'true';
} catch { /* sem preferência local */ }
$('headlessAuditToggle')?.addEventListener('change', () => {
  try { localStorage.setItem(HEADLESS_AUDIT_KEY, String($('headlessAuditToggle').checked)); } catch {}
});
$('autoAuditToggle')?.addEventListener('change', () => {
  try { localStorage.setItem(AUTO_AUDIT_KEY, String($('autoAuditToggle').checked)); } catch {}
  if ($('autoAuditToggle').checked) maybeAutoAudit();
  else $('auditStatus').textContent = 'Conferência automática pausada. Use “Conferir na Enquete” para auditar sob demanda.';
});
$('auditScopeAll')?.addEventListener('change', () => {
  $('auditTaskSelectBox').hidden = true;
  if (isAutoAuditEnabled()) maybeAutoAudit();
});
$('auditScopeSingle')?.addEventListener('change', () => {
  $('auditTaskSelectBox').hidden = false;
  if ($('auditTaskSelect')?.value && isAutoAuditEnabled()) maybeAutoAudit();
  else if (!$('auditTaskSelect')?.value) $('auditStatus').textContent = 'Selecione uma obrigação da lista para conferir na Enquete.';
});
$('auditTaskSelect')?.addEventListener('change', () => {
  if (isAutoAuditEnabled() && $('auditScopeSingle')?.checked && $('auditTaskSelect')?.value) {
    maybeAutoAudit();
  }
});
$('btnOpenLoginFromAudit')?.addEventListener('click', () => login('login/open'));
$('runAudit')?.addEventListener('click', () => {
  if (working) return;
  if (!catalogLive) {
    status('A sessão do G-Click não está ativa. Abrindo a janela de login para conectar…', 'warn');
    $('auditStatus').textContent = 'Abrindo o navegador para conectar a sessão do G-Click…';
    login('login/open');
    return;
  }
  const isSingle = $('auditScopeSingle')?.checked;
  const filterTask = isSingle ? $('auditTaskSelect')?.value : null;
  if (isSingle && !filterTask) {
    status('Selecione uma obrigação na lista para conferir.', 'warn');
    $('auditTaskSelect')?.focus();
    return;
  }
  focusTask = filterTask;
  runAuditExecution({ filterTask, force: true });
});
let currentUser = null;
let cachedRoles = [];
let cachedPermissions = [];

function renderUserSidebar(user) {
  if (!user) return;
  currentUser = user;
  if ($('sidebarUserName')) $('sidebarUserName').textContent = user.name;
  if ($('sidebarUserRole')) $('sidebarUserRole').textContent = user.is_superadmin ? 'Superadmin' : (user.roles?.map(r => r.name).join(', ') || 'Operador');
  if ($('sidebarUserEmail')) $('sidebarUserEmail').textContent = user.email;
  const canAdmin = user.is_superadmin || user.permissions?.some(p => p.slug === 'usuarios.administrar' && p.allowed);
  if ($('navModuleAdmin')) $('navModuleAdmin').hidden = !canAdmin;
}

async function loadUsersTable() {
  const tbody = $('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty">Carregando usuários…</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Não autorizado a listar usuários');
    const data = await res.json();
    cachedRoles = data.roles || [];
    cachedPermissions = data.permissions || [];
    tbody.replaceChildren();

    if (!data.users || !data.users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">Nenhum usuário cadastrado.</td></tr>';
      return;
    }

    for (const u of data.users) {
      const tr = document.createElement('tr');
      
      const tdName = document.createElement('td');
      tdName.innerHTML = `<strong>${escapeHtml(u.name)}</strong>${u.is_superadmin ? ' <span class="tag-pill" style="font-size:10px;background:#4c1d95;color:#e9d5ff">Superadmin</span>' : ''}`;
      
      const tdEmail = document.createElement('td');
      tdEmail.textContent = u.email;
      
      const tdRoles = document.createElement('td');
      tdRoles.innerHTML = u.roles?.length 
        ? u.roles.map(r => `<span class="tag-pill" style="font-size:10px;background:#164e63;color:#a5f3fc;margin-right:4px">${escapeHtml(r.name)}</span>`).join('') 
        : '<span style="color:var(--text-dimmed)">Sem cargo</span>';
      
      const tdAcc = document.createElement('td');
      tdAcc.textContent = u.is_superadmin ? 'Todas (*)' : (u.accounts?.join(', ') || 'Nenhuma');
      
      const tdStatus = document.createElement('td');
      tdStatus.innerHTML = u.is_active 
        ? '<span class="status-tag ja_correto">Ativo</span>' 
        : '<span class="status-tag divergente">Inativo</span>';
      
      const tdActions = document.createElement('td');
      tdActions.style.textAlign = 'right';
      tdActions.innerHTML = `
        <button type="button" class="btn-table-action btn-action-ghost btn-edit-user" data-id="${u.id}" style="margin-right:4px">✏️ Editar</button>
        <button type="button" class="btn-table-action btn-action-ghost btn-overrides-user" data-id="${u.id}" style="margin-right:4px">⚡ Exceções</button>
        ${!u.is_superadmin ? `<button type="button" class="btn-table-action btn-action-ghost btn-del-user" data-id="${u.id}" style="color:#ef4444" title="Excluir usuário">🗑️</button>` : ''}
      `;
      
      tdActions.querySelector('.btn-edit-user')?.addEventListener('click', () => openUserModal(u));
      tdActions.querySelector('.btn-overrides-user')?.addEventListener('click', () => openOverridesModal(u));
      tdActions.querySelector('.btn-del-user')?.addEventListener('click', () => deleteUser(u));

      tr.append(tdName, tdEmail, tdRoles, tdAcc, tdStatus, tdActions);
      tbody.append(tr);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="color:#ef4444">Erro ao carregar usuários: ${err.message}</td></tr>`;
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openUserModal(user = null) {
  $('formUserId').value = user ? user.id : '';
  $('modalUserTitle').textContent = user ? `Editar Usuário: ${user.name}` : 'Novo Usuário';
  $('formUserName').value = user ? user.name : '';
  $('formUserEmail').value = user ? user.email : '';
  $('formUserPassword').value = '';
  $('formUserPasswordHelp').textContent = user ? 'Deixe em branco para manter a senha atual.' : 'Mínimo de 6 caracteres.';
  $('formUserAccounts').value = user ? (user.accounts?.join(', ') || '*') : '*';
  $('formUserActive').checked = user ? Boolean(user.is_active) : true;
  $('formUserError').hidden = true;

  const rolesGroup = $('formUserRolesGroup');
  rolesGroup.innerHTML = '';
  const userRoleSlugs = new Set((user?.roles || []).map(r => r.slug));

  for (const r of cachedRoles) {
    const label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';
    label.style.cursor = 'pointer';
    label.style.fontSize = '13px';
    label.innerHTML = `
      <input type="checkbox" name="userRole" value="${r.slug}" ${userRoleSlugs.has(r.slug) || (!user && r.slug === 'operador') ? 'checked' : ''}>
      <span>${escapeHtml(r.name)}</span>
    `;
    rolesGroup.append(label);
  }

  $('modalUserForm').hidden = false;
}

async function openOverridesModal(user) {
  $('overridesUserSubtitle').textContent = `Usuário: ${user.name} (${user.email}) · Cargo(s): ${user.roles?.map(r => r.name).join(', ') || 'Nenhum'}`;
  const tbody = $('overridesTableBody');
  tbody.innerHTML = '';

  const renderRows = (u) => {
    tbody.innerHTML = '';
    for (const p of u.permissions || []) {
      const tr = document.createElement('tr');
      
      const tdPerm = document.createElement('td');
      tdPerm.innerHTML = `<strong>${escapeHtml(p.slug)}</strong><div style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.description)}</div>`;
      
      const tdMod = document.createElement('td');
      tdMod.textContent = p.module;
      
      const tdEff = document.createElement('td');
      let statusHtml = '';
      if (p.source === 'override_allowed') statusHtml = '<span class="status-tag ja_correto" style="background:#dcfce7;color:#15803d">🟢 Liberado (Override)</span>';
      else if (p.source === 'override_denied') statusHtml = '<span class="status-tag divergente" style="background:#fee2e2;color:#b91c1c">🔴 Bloqueado (Override)</span>';
      else if (p.source === 'role') statusHtml = '<span class="status-tag" style="background:#e0f2fe;color:#0369a1">🔵 Cargo: Liberado</span>';
      else if (p.source === 'superadmin') statusHtml = '<span class="status-tag" style="background:#f3e8ff;color:#7e22ce">👑 Superadmin</span>';
      else statusHtml = '<span class="status-tag" style="background:#f1f5f9;color:#64748b">⚪ Cargo: Bloqueado</span>';
      tdEff.innerHTML = statusHtml;

      const tdAction = document.createElement('td');
      tdAction.style.textAlign = 'right';

      if (u.is_superadmin) {
        tdAction.innerHTML = '<span style="font-size:11px;color:var(--text-dimmed)">Superadmin tem acesso total</span>';
      } else {
        const btnGroup = document.createElement('div');
        btnGroup.className = 'override-btn-group';
        
        const btnAllow = document.createElement('button');
        btnAllow.type = 'button';
        btnAllow.textContent = 'Liberar';
        btnAllow.title = 'Libera esta permissão para este usuário mesmo que o cargo não tenha';
        if (p.source === 'override_allowed') btnAllow.className = 'active-allow';

        const btnDeny = document.createElement('button');
        btnDeny.type = 'button';
        btnDeny.textContent = 'Bloquear';
        btnDeny.title = 'Bloqueia esta permissão para este usuário mesmo que o cargo tenha';
        if (p.source === 'override_denied') btnDeny.className = 'active-deny';

        const btnInherit = document.createElement('button');
        btnInherit.type = 'button';
        btnInherit.textContent = 'Herdar';
        btnInherit.title = 'Remove a exceção e volta a herdar a regra padrão do cargo';
        if (p.source === 'role' || p.source === 'denied') btnInherit.className = 'active-inherit';

        btnAllow.addEventListener('click', () => setOverride(u.id, p.slug, true));
        btnDeny.addEventListener('click', () => setOverride(u.id, p.slug, false));
        btnInherit.addEventListener('click', () => setOverride(u.id, p.slug, null));

        btnGroup.append(btnAllow, btnDeny, btnInherit);
        tdAction.append(btnGroup);
      }

      tr.append(tdPerm, tdMod, tdEff, tdAction);
      tbody.append(tr);
    }
  };

  const setOverride = async (userId, permissionSlug, allowed) => {
    try {
      const res = await fetch('/api/users/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, permissionSlug, allowed })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao definir exceção');
      renderRows(data.user);
    } catch (err) {
      alert(err.message);
    }
  };

  renderRows(user);
  $('modalOverrides').hidden = false;
}

async function deleteUser(user) {
  if (!confirm(`Tem certeza que deseja excluir o usuário "${user.name}" (${user.email})?`)) return;
  try {
    const res = await fetch('/api/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao excluir usuário');
    loadUsersTable();
  } catch (err) {
    alert(err.message);
  }
}

// Modal Listeners
$('btnNewUser')?.addEventListener('click', () => openUserModal(null));
$('btnCloseUserModal')?.addEventListener('click', () => { $('modalUserForm').hidden = true; });
$('btnCancelUser')?.addEventListener('click', () => { $('modalUserForm').hidden = true; });
$('btnCloseOverridesModal')?.addEventListener('click', () => { $('modalOverrides').hidden = true; loadUsersTable(); });
$('btnCloseOverrides')?.addEventListener('click', () => { $('modalOverrides').hidden = true; loadUsersTable(); });

$('formUser')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('formUserId').value;
  const name = $('formUserName').value.trim();
  const email = $('formUserEmail').value.trim();
  const password = $('formUserPassword').value;
  const isActive = $('formUserActive').checked;
  const accounts = $('formUserAccounts').value.split(',').map(s => s.trim()).filter(Boolean);
  const roles = [...document.querySelectorAll('input[name="userRole"]:checked')].map(i => i.value);

  const errorBox = $('formUserError');
  errorBox.hidden = true;

  try {
    const endpoint = id ? '/api/users/update' : '/api/users/create';
    const payload = { id, name, email, isActive, roleSlugs: roles, accountIds: accounts };
    if (password) payload.password = password;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar usuário');
    $('modalUserForm').hidden = true;
    loadUsersTable();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

$('btnLogout')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

$('formLogin')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const errorBox = $('loginError');
  errorBox.hidden = true;
  const submitBtn = $('btnLoginSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Autenticando…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenciais inválidas');
    $('loginScreen').hidden = true;
    renderUserSidebar(data.user);
    initApp();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar no Sistema';
  }
});

// Inicialização Principal com Verificação de Autenticação
async function checkAuthAndInit() {
  try {
    const meRes = await fetch('/api/auth/me');
    const text = await meRes.text().catch(() => '');
    let meData = null;
    try { meData = JSON.parse(text); } catch {}

    // Servidores mock de testes simples (que retornam CSS, HTML ou 404):
    if (!meData) {
      $('loginScreen').hidden = true;
      return initApp();
    }

    if (meData?.authenticated && meData?.user) {
      $('loginScreen').hidden = true;
      renderUserSidebar(meData.user);
      initApp();
    } else {
      $('loginScreen').hidden = false;
    }
  } catch (err) {
    // Falha de rede para servidor mock simples
    $('loginScreen').hidden = true;
    initApp().catch(() => {});
  }
}

async function initApp() {
  const res = await fetch('/api/config');
  if (res.status === 401) {
    $('loginScreen').hidden = false;
    return;
  }
  const loaded = await res.json();
  Object.assign(config, loaded);
  savedMappings = config.savedMappings ?? [];
  savedProfiles = config.savedProfiles ?? [];
  targetModels = config.targetModels ?? {};
  availableFields = config.availableFields ?? [];
  if (config.user) renderUserSidebar(config.user);

  renderAccountList();
  if (config.catalogLive && config.catalog?.accountId) {
    $('accountId').value = config.catalog.accountId;
  } else if ((config.catalogLive || config.loginReady) && Array.isArray(config.accounts) && config.accounts.length === 1) {
    const single = typeof config.accounts[0] === 'object' ? config.accounts[0].accountId : config.accounts[0];
    if (single) $('accountId').value = String(single);
  } else {
    try {
      const last = localStorage.getItem(ACCOUNT_KEY);
      if (last) $('accountId').value = last;
    } catch { /* sem preferência local */ }
  }
  updateTopAccountDisplay(currentAccount());
  if ((config.catalog && config.catalogLive) || (config.loginReady && currentAccount())) {
    const acc = currentAccount() || config.catalog?.accountId;
    if (config.catalog && config.catalogLive) {
      useCatalog(config.catalog, true);
    }
    gclickSessionState = {
      connected: true,
      accountMatches: true,
      isReadyForModules: true,
      activeAccountId: acc,
      activeEmpresaNome: config.empresaNome || null,
      currentEmpresaId: acc,
      currentEmpresaNome: config.empresaNome || null,
      availableEmpresas: []
    };
  } else if (currentAccount()) {
    await loadAccountCatalog();
  }

  const accForSession = currentAccount();
  const sessionResult = await syncGClickSession(accForSession);
  if (!accForSession && sessionResult?.currentEmpresaId && sessionResult.browserStatus === 'open') {
    $('accountId').value = sessionResult.currentEmpresaId;
    loadedAccount = sessionResult.currentEmpresaId;
    await syncGClickSession(sessionResult.currentEmpresaId);
  }
  loadedAccount = currentAccount() || null;
  if (currentAccount() && !$('recentSheetUrl').value) setSheetUrl((config.accounts ?? []).find(a => a.accountId === currentAccount())?.sheetUrl ?? '');
  renderEmpresasGrid();
  
  if (config.loginOpen) {
    status('Janela do navegador de automação aberta. Aguardando login no G-Click.');
    startLoginPoll();
  } else {
    status(config.sessionLostAt ? 'A janela do Chrome da automação foi fechada. Clique em Abrir janela de login e entre de novo.' : 'Informe a conta e clique em Abrir janela de login. As perguntas aparecem depois que o robô ler a Enquete do escritório.', config.sessionLostAt ? 'error' : '');
  }
  updateRecentSheetLinks();
  updateLedgerLink();
  refreshWriterStatus();
  renderQueue();
  if (sourceType() === 'recent') refreshDownloads();
  updateSidebarBadges();
}

checkAuthAndInit();

const SECTION_STORAGE_KEY = 'enqueteSync_activeSection';
const ENQUETE_TAB_STORAGE_KEY = 'enqueteSync_activeEnqueteTab';

const ENQUETE_SUBTABS = {
  'dados-mapeamento': { paneId: 'enqueteTabPaneDados', btnId: 'tabEnqueteDados' },
  'conferencia-gravacao': { paneId: 'enqueteTabPaneDados', btnId: 'tabEnqueteDados' },
  'cadastro-respostas': { paneId: 'enqueteTabPaneCadastro', btnId: 'tabEnqueteCadastro' },
  'sincronizacao-sheets': { paneId: 'enqueteTabPaneSheets', btnId: 'tabEnqueteSheets' }
};

function switchEnqueteTab(tabKey) {
  const targetTab = ENQUETE_SUBTABS[tabKey] ? tabKey : 'dados-mapeamento';

  const activePaneId = ENQUETE_SUBTABS[targetTab]?.paneId;
  const activeBtnId = ENQUETE_SUBTABS[targetTab]?.btnId;

  // Atualiza visibilidade dos painéis únicos
  const uniquePanes = new Set(Object.values(ENQUETE_SUBTABS).map(t => t.paneId));
  uniquePanes.forEach(paneId => {
    const pane = $(paneId);
    if (pane) pane.hidden = (paneId !== activePaneId);
  });

  // Atualiza estados dos botões de aba
  const uniqueBtns = new Set(Object.values(ENQUETE_SUBTABS).map(t => t.btnId));
  uniqueBtns.forEach(btnId => {
    const btn = $(btnId);
    if (btn) {
      const isBtnActive = (btnId === activeBtnId);
      btn.classList.toggle('active', isBtnActive);
      btn.setAttribute('aria-selected', String(isBtnActive));
    }
  });

  if (targetTab === 'conferencia-gravacao') {
    const applySec = $('section-apply') || $('section-audit');
    if (applySec) applySec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  if (targetTab === 'cadastro-respostas') {
    loadEnqueteCadastroSection();
  }

  try {
    localStorage.setItem(ENQUETE_TAB_STORAGE_KEY, targetTab);
  } catch { /* sem local storage */ }
}

function switchSection(sectionId) {
  let target = sectionId || 'all';

  if (target === 'all') {
    const navBtns = document.querySelectorAll('#sidebarNav .nav-btn');
    const sections = document.querySelectorAll('.app-section');
    navBtns.forEach(btn => btn.classList.remove('active'));
    sections.forEach(sec => {
      sec.hidden = false;
      sec.classList.remove('active');
    });
    $('sidebar')?.classList.remove('open');
    updateSidebarBadges();
    return;
  }

  let subTabToActivate = null;
  if (['source', 'catalog', 'mapping'].includes(target)) {
    subTabToActivate = 'dados-mapeamento';
    target = 'enquete';
  } else if (['audit', 'apply'].includes(target)) {
    subTabToActivate = 'conferencia-gravacao';
    target = 'enquete';
  } else if (target === 'enquete-cadastro') {
    subTabToActivate = 'cadastro-respostas';
    target = 'enquete';
  } else if (target === 'writer') {
    subTabToActivate = 'sincronizacao-sheets';
    target = 'enquete';
  }

  // Proteção de Pré-condição e Isolamento de Conta (AGENTS.md)
  // Bloqueia estritamente o acesso aos módulos operacionais/dependentes se não houver conta cliente conectada ou em caso de divergência.
  const operationalModules = ['enquete', 'catalog', 'mapping', 'audit', 'apply', 'obrigacoes', 'carteira', 'enquete-cadastro', 'valida-pdf', 'users'];
  if (operationalModules.includes(target)) {
    const acc = currentAccount();
    const isResolved = isConnectionResolved();
    if (!isResolved) {
      let reason = 'Conecte a conta do escritório no módulo Conexão G-Click para liberar o acesso aos recursos.';
      if (gclickSessionState.connected && !gclickSessionState.accountMatches) {
        reason = `O G-Click está conectado na empresa ${gclickSessionState.currentEmpresaNome || gclickSessionState.currentEmpresaId}, diferente da conta ${acc || 'selecionada'}. Alterne a empresa no módulo Conexão G-Click.`;
      } else if (!acc) {
        reason = 'Informe o código da conta do escritório e conecte a sessão no módulo Conexão G-Click para continuar.';
      }
      toast.warning(reason, 'Acesso Bloqueado');
      status(reason, 'warn');
      switchSection('connection');
      return;
    }
  }

  const navBtns = document.querySelectorAll('#sidebarNav .nav-btn');
  const sections = document.querySelectorAll('.app-section');

  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === target);
  });

  sections.forEach(sec => {
    const match = sec.id === `section-${target}`;
    sec.hidden = !match;
    sec.classList.toggle('active', match);
  });

  if (target === 'enquete') {
    if (subTabToActivate) {
      switchEnqueteTab(subTabToActivate);
    } else {
      let savedTab = 'dados-mapeamento';
      try {
        savedTab = localStorage.getItem(ENQUETE_TAB_STORAGE_KEY) || 'dados-mapeamento';
      } catch { /* sem localStorage */ }
      switchEnqueteTab(savedTab);
    }
  } else if (target === 'users') {
    loadUsersTable();
  } else if (target === 'obrigacoes') {
    loadObrigacoesSection();
  } else if (target === 'carteira') {
    loadCarteiraSection();
  } else if (target === 'valida-pdf') {
    loadValidaPdfSection();
  } else if (target === 'help') {
    initHelpSection();
  }

  $('sidebar')?.classList.remove('open');
  updateSidebarBadges();

  try {
    localStorage.setItem(SECTION_STORAGE_KEY, target);
  } catch { /* sem preferência local */ }
}

// Fonte única do estado da conexão: o card, a barra lateral, a faixa de indicadores e o fluxo de etapas leem daqui.
function connectionView() {
  const acc = currentAccount();
  const s = gclickSessionState;
  const empresa = s.currentEmpresaNome
    ? `${s.currentEmpresaNome}${s.currentEmpresaId ? ` (${s.currentEmpresaId})` : ''}`
    : (s.currentEmpresaId ? `conta ${s.currentEmpresaId}` : (acc ? `conta ${acc}` : 'outra empresa'));
  if (isConnectionResolved()) {
    return { state: 'ok', short: 'Conectado', title: `Conectado em ${empresa}`, detail: 'Módulos de automação liberados.' };
  }
  if (s.connected && !s.accountMatches) {
    return { state: 'mismatch', short: 'Conta divergente', title: `G-Click aberto em outra conta: ${empresa}`,
      detail: `Os módulos ficam bloqueados até a conta ${acc || 'selecionada'} ficar ativa.` };
  }
  if (config?.loginOpen) {
    return { state: 'entering', short: 'Aguardando login', title: 'Aguardando login',
      detail: 'Entre no G-Click na janela da automação. A conexão é detectada sozinha.' };
  }
  return { state: 'idle', short: 'Não conectado', title: 'Não conectado',
    detail: acc ? `Clique em Abrir janela de login para conectar a conta ${acc}.` : 'Informe a conta do escritório.' };
}

const ENQUETE_FLOW_SECTIONS = ['all', 'connection', 'source', 'catalog', 'mapping', 'audit', 'apply', 'writer'];

// Cabeçalho: foto da empresa (cópia local guardada pelo robô), nome e estado da conexão.
const EMPRESA_STOPWORDS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S/A', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
function empresaInitials(nome) {
  const words = String(nome ?? '').toUpperCase().split(/\s+/).filter(w => w && !EMPRESA_STOPWORDS.has(w));
  return words.slice(0, 2).map(w => w[0]).join('') || '—';
}
const accountFoto = { src: '', loaded: false, triedAt: 0 };
function loadAccountFoto(acc, force = false) {
  const img = $('topAccountFoto');
  if (!img) return;
  if (!acc) { img.hidden = true; img.removeAttribute('src'); accountFoto.src = ''; return; }
  const base = `/api/gclick/empresa-foto?accountId=${encodeURIComponent(acc)}`;
  if (!force && accountFoto.src.startsWith(base)) return;
  accountFoto.src = `${base}&t=${Date.now()}`;
  accountFoto.loaded = false; accountFoto.triedAt = Date.now();
  img.onload = () => { accountFoto.loaded = true; img.hidden = false; };
  img.onerror = () => { accountFoto.loaded = false; img.hidden = true; };
  img.src = accountFoto.src;
}
function renderAccountChip(acc, view, tone) {
  const chip = $('topAccountPill');
  if (!chip) return;
  const nome = view.state === 'ok' ? gclickSessionState.currentEmpresaNome : '';
  chip.dataset.state = view.state;
  chip.title = `${view.title}. Clique para abrir Conexão G-Click.`;
  $('topAccountNome').textContent = nome || (acc ? `Conta ${acc}` : 'Nenhuma conta selecionada');
  $('topAccountId').textContent = acc || '—';
  $('topAccountIdWrap').hidden = !nome;
  $('topAccountInitials').textContent = nome ? empresaInitials(nome) : (acc ? '#' : '—');
  const badge = $('topSessionBadge');
  badge.hidden = !acc;
  badge.textContent = view.short;
  badge.className = `nav-badge ${tone}`;
  // A foto é capturada pelo robô quando a conta fica ativa; sem ela, tenta de novo a cada 30 s.
  loadAccountFoto(acc);
  if (acc && view.state === 'ok' && !accountFoto.loaded && Date.now() - accountFoto.triedAt > 30000) loadAccountFoto(acc, true);
}

function updateSidebarBadges() {
  const acc = currentAccount();
  const isResolved = isConnectionResolved();
  const view = connectionView();
  const tone = { ok: 'badge-ok', mismatch: 'badge-warn', entering: 'badge-warn', idle: 'badge-neutral' }[view.state];

  renderAccountChip(acc, view, tone);
  if ($('stepMetaConnection')) $('stepMetaConnection').textContent = view.short;
  const badgeConn = $('navBadgeConnection');
  if (badgeConn) { badgeConn.textContent = view.short; badgeConn.className = `nav-badge ${tone}`; }

  const card = $('connectionCard');
  if (card) card.dataset.state = view.state;
  if ($('connStatusTitle')) $('connStatusTitle').textContent = view.title;
  if ($('connStatusDetail')) $('connStatusDetail').textContent = view.detail;
  const btnSwitch = $('btnSwitchEmpresa');
  if (btnSwitch) {
    btnSwitch.hidden = view.state !== 'mismatch';
    if (!btnSwitch.disabled) btnSwitch.textContent = acc ? `Alternar para a conta ${acc}` : 'Alternar conta';
  }

  // Atualiza classes de bloqueio visual em itens do menu lateral
  const dependentModules = ['enquete', 'source', 'catalog', 'mapping', 'audit', 'apply', 'obrigacoes', 'carteira', 'users', 'valida-pdf'];
  document.querySelectorAll('#sidebarNav .nav-btn').forEach(btn => {
    if (dependentModules.includes(btn.dataset.section)) {
      btn.classList.toggle('nav-blocked', !isResolved);
    }
  });

  const badgeSource = $('navBadgeSource');
  const rowCount = importedTable?.rows?.length || 0;
  if ($('stepMetaSource')) $('stepMetaSource').textContent = rowCount ? `${rowCount} linhas` : 'Selecionar dados';

  if (badgeSource) {
    if (taskCatalog.length) { badgeSource.textContent = `${taskCatalog.length} tarefas`; badgeSource.className = 'nav-badge badge-ok'; }
    else if (importedTable) { badgeSource.textContent = `${importedTable.rows.length} linhas`; badgeSource.className = 'nav-badge badge-ok'; }
    else if (carteiraParsedData) { badgeSource.textContent = 'Carteira lida'; badgeSource.className = 'nav-badge badge-ok'; }
    else { badgeSource.textContent = 'Pendente'; badgeSource.className = 'nav-badge badge-neutral'; }
  }

  const badgeMapping = $('navBadgeMapping');
  if (badgeMapping) {
    if (!taskCatalog.length) { badgeMapping.textContent = '0'; badgeMapping.className = 'nav-badge badge-neutral'; }
    else {
      const attention = taskCatalog.filter(t => ['attention', 'suggested', 'awaiting'].includes(mappingFor(t).state)).length;
      if (attention > 0) { badgeMapping.textContent = `${attention} pendente(s)`; badgeMapping.className = 'nav-badge badge-warn'; }
      else { badgeMapping.textContent = '100% OK'; badgeMapping.className = 'nav-badge badge-ok'; }
    }
  }

  const mappedCount = taskCatalog.length || (importedTable?.tasks?.length || 0);
  if ($('stepMetaMapping')) {
    $('stepMetaMapping').textContent = mappedCount ? `${mappedCount} tarefas mapeadas` : 'Definir regras';
  }

  const badgeAudit = $('navBadgeAudit');
  const pendingMarks = lastReport?.toWrite ?? 0;
  if ($('stepMetaAudit')) {
    $('stepMetaAudit').textContent = lastReport ? `${pendingMarks} divergência(s)` : 'Auditar divergências';
  }
  if (badgeAudit) {
    if (lastReport) {
      if (pendingMarks > 0) { badgeAudit.textContent = `${pendingMarks} a marcar`; badgeAudit.className = 'nav-badge badge-warn'; }
      else { badgeAudit.textContent = 'Conferido'; badgeAudit.className = 'nav-badge badge-ok'; }
    } else {
      badgeAudit.textContent = '0'; badgeAudit.className = 'nav-badge badge-neutral';
    }
  }

  const badgeApply = $('navBadgeApply');
  if ($('stepMetaApply')) {
    $('stepMetaApply').textContent = lastReport?.mode === 'mapping_apply' ? 'Gravado no G-Click' : pendingMarks > 0 ? `${pendingMarks} prontas` : 'Executar robô';
  }
  if (badgeApply) {
    const toWrite = lastReport?.toWrite ?? 0;
    if (toWrite > 0) { badgeApply.textContent = `${toWrite} pronta(s)`; badgeApply.className = 'nav-badge badge-warn'; }
    else if (lastReport?.mode === 'mapping_apply') { badgeApply.textContent = 'Concluído'; badgeApply.className = 'nav-badge badge-ok'; }
    else { badgeApply.textContent = 'Aguardando'; badgeApply.className = 'nav-badge badge-neutral'; }
  }

  const badgeCarteira = $('navBadgeCarteira');
  if (badgeCarteira) {
    if (carteiraAuditItems && carteiraAuditItems.length > 0) {
      const disp = carteiraAuditItems.filter(i => i.status === 'disponivel_para_vincular').length;
      if (disp > 0) {
        badgeCarteira.textContent = `${disp} a vincular`;
        badgeCarteira.className = 'nav-badge badge-warn';
      } else {
        badgeCarteira.textContent = 'Auditado';
        badgeCarteira.className = 'nav-badge badge-ok';
      }
    } else if (carteiraUsers && carteiraUsers.length > 0) {
      badgeCarteira.textContent = `${carteiraUsers.length} usuários`;
      badgeCarteira.className = 'nav-badge badge-info';
    } else {
      badgeCarteira.textContent = 'Carteira';
      badgeCarteira.className = 'nav-badge badge-neutral';
    }
  }

  const badgeWriter = $('navBadgeWriter');
  const isWriterConfigured = Boolean($('writerUrl')?.value?.trim());
  if (badgeWriter) {
    badgeWriter.textContent = isWriterConfigured ? 'Ativo' : 'Pendente';
    badgeWriter.className = `nav-badge ${isWriterConfigured ? 'badge-ok' : 'badge-neutral'}`;
  }

  const badgeCatalog = $('navBadgeCatalog');
  if (badgeCatalog) {
    if (liveCatalog?.questionCount) {
      badgeCatalog.textContent = `${liveCatalog.questionCount} perguntas`;
      badgeCatalog.className = 'nav-badge badge-ok';
    } else {
      badgeCatalog.textContent = '0 perguntas';
      badgeCatalog.className = 'nav-badge badge-neutral';
    }
  }

  const badgeObrigacoes = $('navBadgeObrigacoes');
  if (badgeObrigacoes) {
    if (obrigacoesList?.length) {
      const pend = obrigacoesAudit?.pendenteWhatsapp || 0;
      badgeObrigacoes.textContent = pend > 0 ? `${pend} pendente(s)` : `${obrigacoesList.length} itens`;
      badgeObrigacoes.className = `nav-badge ${pend > 0 ? 'badge-warn' : 'badge-ok'}`;
    } else {
      badgeObrigacoes.textContent = 'Obrigações';
      badgeObrigacoes.className = 'nav-badge badge-neutral';
    }
  }

  const badgeEnquete = $('navBadgeEnquete');
  if (badgeEnquete) {
    if (pendingMarks > 0) {
      badgeEnquete.textContent = `${pendingMarks} a marcar`;
      badgeEnquete.className = 'nav-badge badge-warn';
    } else if (lastReport?.mode === 'mapping_apply') {
      badgeEnquete.textContent = 'Gravado';
      badgeEnquete.className = 'nav-badge badge-ok';
    } else if (taskCatalog?.length) {
      badgeEnquete.textContent = `${taskCatalog.length} tarefas`;
      badgeEnquete.className = 'nav-badge badge-ok';
    } else if (importedTable?.rows?.length) {
      badgeEnquete.textContent = `${importedTable.rows.length} linhas`;
      badgeEnquete.className = 'nav-badge badge-ok';
    } else {
      badgeEnquete.textContent = '';
      badgeEnquete.className = 'nav-badge';
    }
  }

  if ($('auditLoginNotice')) {
    $('auditLoginNotice').style.display = catalogLive ? 'none' : 'flex';
  }
}

$('refreshCatalogManual')?.addEventListener('click', async () => {
  const accountId = currentAccount();
  if (!/^\d+$/.test(accountId)) {
    status('Informe o código da conta G-Click (empId) em Conexão G-Click antes de buscar o catálogo.', 'error');
    return;
  }
  const btn = $('refreshCatalogManual');
  try {
    setBusy(true);
    if (btn) btn.disabled = true;
    status(`Buscando perguntas e respostas da Enquete da conta ${accountId} sob demanda…`);
    const result = await api('catalog', { accountId, refresh: true });
    if (result.catalog) {
      useCatalog(result.catalog, true);
      status(`Catálogo da Enquete atualizado sob demanda com sucesso: ${result.catalog.questionCount} perguntas e ${result.catalog.answerCount} respostas.`, 'ok');
    }
  } catch (error) {
    status(`Busca sob demanda: ${error.message}. Se a janela do G-Click não estiver aberta, clique em "Abrir janela de login" no menu Conexão G-Click.`, 'error');
  } finally {
    setBusy(false);
    if (btn) btn.disabled = false;
    updateSidebarBadges();
  }
});

/* ==========================================================================
   MÓDULO DE OBRIGAÇÕES (GESTÃO DE CATÁLOGO & PARIDADE DE CANAIS)
   ========================================================================== */
let obrigacoesList = [];
let obrigacoesAudit = null;
let obrigacoesPage = 0;
const OBRIG_PAGE_SIZE = 15;
let currentFocusedTextarea = null;
const selectedObrigacoesIds = new Set();

function updateBatchBarState(filteredItems = []) {
  const depto = $('obrigDeptoFilter')?.value || '';
  const countText = $('obrigBatchCountText');
  const deptoWarning = $('obrigBatchDeptoWarning');
  const btnBatchModal = $('btnOpenBatchEmailModal');
  const btnClear = $('btnClearBatchSelection');
  const selectAllCb = $('obrigSelectAll');

  const count = selectedObrigacoesIds.size;
  if (countText) countText.textContent = `${count} obrigação(ões) selecionada(s)`;

  if (!depto) {
    if (deptoWarning) deptoWarning.style.display = 'inline-flex';
    if (btnBatchModal) {
      btnBatchModal.disabled = true;
      btnBatchModal.title = 'Selecione um departamento no filtro para habilitar a ação em massa.';
    }
    const btnBatchWhats = $('btnOpenBatchWhatsappModal');
    if (btnBatchWhats) {
      btnBatchWhats.disabled = true;
      btnBatchWhats.title = 'Selecione um departamento no filtro para habilitar a ação em massa.';
    }
  } else {
    if (deptoWarning) deptoWarning.style.display = 'none';
    if (btnBatchModal) {
      btnBatchModal.disabled = count === 0;
      btnBatchModal.title = count === 0 ? 'Selecione pelo menos uma obrigação.' : `Configurar E-mail para ${count} obrigação(ões) do departamento ${depto}.`;
    }
    const btnBatchWhats = $('btnOpenBatchWhatsappModal');
    if (btnBatchWhats) {
      btnBatchWhats.disabled = count === 0;
      btnBatchWhats.title = count === 0 ? 'Selecione pelo menos uma obrigação.' : `Criar WhatsApp para ${count} obrigação(ões) do departamento ${depto}.`;
    }
  }

  if (btnClear) btnClear.disabled = count === 0;

  if (selectAllCb) {
    const selectable = filteredItems.map(it => it.id);
    if (selectable.length > 0 && selectable.every(id => selectedObrigacoesIds.has(id))) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else if (selectable.some(id => selectedObrigacoesIds.has(id))) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
  }
}

async function loadObrigacoesSection() {
  const accountId = currentAccount() || (config.accounts && config.accounts[0] ? (typeof config.accounts[0] === 'string' ? config.accounts[0] : config.accounts[0].accountId) : '') || '6581';
  try {
    if ($('obrigMetricSource')) $('obrigMetricSource').textContent = 'Carregando catálogo da conta ' + accountId + '…';
    const tbody = $('obrigacoesTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr class="skeleton-table-row"><td><div class="skeleton-box" style="width:18px"></div></td><td><div class="skeleton-box" style="width:160px"></div></td><td><div class="skeleton-box" style="width:90px"></div></td><td><div class="skeleton-box" style="width:70px"></div></td><td><div class="skeleton-box" style="width:60px"></div></td><td><div class="skeleton-box" style="width:110px"></div></td><td><div class="skeleton-box" style="width:100px"></div></td><td><div class="skeleton-box" style="width:80px"></div></td></tr>
        <tr class="skeleton-table-row"><td><div class="skeleton-box" style="width:18px"></div></td><td><div class="skeleton-box" style="width:200px"></div></td><td><div class="skeleton-box" style="width:100px"></div></td><td><div class="skeleton-box" style="width:75px"></div></td><td><div class="skeleton-box" style="width:65px"></div></td><td><div class="skeleton-box" style="width:120px"></div></td><td><div class="skeleton-box" style="width:95px"></div></td><td><div class="skeleton-box" style="width:80px"></div></td></tr>
        <tr class="skeleton-table-row"><td><div class="skeleton-box" style="width:18px"></div></td><td><div class="skeleton-box" style="width:140px"></div></td><td><div class="skeleton-box" style="width:85px"></div></td><td><div class="skeleton-box" style="width:70px"></div></td><td><div class="skeleton-box" style="width:55px"></div></td><td><div class="skeleton-box" style="width:105px"></div></td><td><div class="skeleton-box" style="width:110px"></div></td><td><div class="skeleton-box" style="width:80px"></div></td></tr>
      `;
    }
    const res = await api('obrigacoes/catalog', { accountId });
    obrigacoesList = res.items || [];

    if ($('obrigMetricTotal')) $('obrigMetricTotal').textContent = obrigacoesList.length;
    if ($('obrigMetricSource')) {
      $('obrigMetricSource').textContent = res.source === 'file'
        ? `Arquivo da conta ${accountId}`
        : (res.live ? 'Ao vivo no G-Click' : 'Sem catálogo salvo');
    }

    const deptos = Array.from(new Set(obrigacoesList.map(o => o.departamento).filter(Boolean))).sort();
    if ($('obrigMetricDeptos')) $('obrigMetricDeptos').textContent = deptos.length;

    const deptoSelect = $('obrigDeptoFilter');
    if (deptoSelect) {
      const currentVal = deptoSelect.value;
      deptoSelect.innerHTML = '<option value="">Todos os Departamentos</option>';
      for (const d of deptos) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        if (d === currentVal) opt.selected = true;
        deptoSelect.appendChild(opt);
      }
    }

    const freqs = Array.from(new Set(obrigacoesList.map(o => o.frequencia).filter(Boolean))).sort();
    const freqSelect = $('obrigFreqFilter');
    if (freqSelect) {
      const currentFreq = freqSelect.value;
      freqSelect.innerHTML = '<option value="">Todas as Frequências</option>';
      for (const f of freqs) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        if (f === currentFreq) opt.selected = true;
        freqSelect.appendChild(opt);
      }
    }

    await runObrigacoesAudit(accountId);
    obrigacoesPage = 0;
    renderObrigacoesTable();
    updateSidebarBadges();
  } catch (err) {
    console.error('Erro ao carregar módulo de obrigações:', err);
    if ($('obrigMetricSource')) $('obrigMetricSource').textContent = 'Falha ao carregar: ' + err.message;
  }
}

async function runObrigacoesAudit(accountIdParam = null) {
  const accountId = accountIdParam || currentAccount() || (config.accounts && config.accounts[0] ? (typeof config.accounts[0] === 'string' ? config.accounts[0] : config.accounts[0].accountId) : '') || '6581';
  try {
    const auditRes = await api('obrigacoes/audit', { accountId, items: obrigacoesList });
    obrigacoesAudit = auditRes;
    if ($('obrigMetricConforme')) $('obrigMetricConforme').textContent = auditRes.conforme || 0;
    if ($('obrigMetricPendente')) $('obrigMetricPendente').textContent = auditRes.pendenteWhatsapp || 0;

    if (auditRes.items) {
      const map = new Map(auditRes.items.map(it => [it.id, it.paridade]));
      for (const o of obrigacoesList) {
        o.paridade = map.get(o.id) || { status: 'sem_disparo' };
      }
    }
  } catch (err) {
    console.error('Erro ao auditar paridade de obrigações:', err);
  }
}

function renderObrigacoesTable() {
  const tbody = $('obrigacoesTableBody');
  if (!tbody) return;

  const search = ($('obrigSearchInput')?.value || '').trim().toLowerCase();
  const depto = $('obrigDeptoFilter')?.value || '';
  const freq = $('obrigFreqFilter')?.value || '';
  const paridade = $('obrigParidadeFilter')?.value || '';

  const filtered = obrigacoesList.filter(item => {
    if (depto && item.departamento !== depto) return false;
    if (freq && item.frequencia !== freq) return false;
    if (paridade && item.paridade?.status !== paridade) return false;
    if (search) {
      const matchName = (item.nome || '').toLowerCase().includes(search);
      const matchId = String(item.id || '').includes(search);
      const matchDepto = (item.departamento || '').toLowerCase().includes(search);
      const matchFreq = (item.frequencia || '').toLowerCase().includes(search);
      const matchOrgao = (item.orgao || '').toLowerCase().includes(search);
      if (!matchName && !matchId && !matchDepto && !matchFreq && !matchOrgao) return false;
    }
    return true;
  });

  updateBatchBarState(filtered);

  const total = filtered.length;
  const start = obrigacoesPage * OBRIG_PAGE_SIZE;
  const end = Math.min(start + OBRIG_PAGE_SIZE, total);
  const pageItems = filtered.slice(start, end);

  const maxPage = Math.max(0, Math.ceil(total / OBRIG_PAGE_SIZE) - 1);
  if (obrigacoesPage > maxPage) obrigacoesPage = maxPage;

  if ($('obrigPaginationInfo')) {
    $('obrigPaginationInfo').textContent = total > 0
      ? `Exibindo ${start + 1}–${end} de ${total} obrigação(ões)`
      : 'Nenhuma obrigação encontrada com os filtros selecionados';
  }
  if ($('obrigPrevPage')) $('obrigPrevPage').disabled = obrigacoesPage === 0;
  if ($('obrigNextPage')) $('obrigNextPage').disabled = end >= total;

  if (pageItems.length === 0) {
    const acc = currentAccount() || 'ativa';
    if (obrigacoesList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center;padding:40px 20px;">
            <div style="max-width:520px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:12px;">
              <span style="font-size:36px;display:block;">📁</span>
              <h4 style="margin:0;color:#184f59;font-size:16px;">Nenhuma obrigação carregada para a conta ${escapeHtml(acc)}</h4>
              <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.5;">
                O catálogo local desta conta ainda não foi lido ou está vazio. Você pode sincronizar as obrigações cadastradas diretamente do G-Click da conta logada.
              </p>
              <button type="button" class="primary" style="margin-top:8px;padding:9px 18px;font-size:13px;display:inline-flex;align-items:center;gap:6px;" onclick="document.getElementById('btnSyncObrigacoes').click();">
                <span>🔄</span> Ler Obrigações da Conta ${escapeHtml(acc)} no G-Click
              </button>
            </div>
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-muted);">Nenhuma obrigação localizada com os filtros selecionados.</td></tr>`;
    }
    return;
  }

  tbody.innerHTML = pageItems.map(item => {
    let paridadeBadge = `<span style="font-size:11px;color:var(--text-muted);background:#f0f4f3;padding:2px 6px;border-radius:4px;">Sem disparo</span>`;
    const precisaOrdem = Boolean(item.paridade?.precisaReordenacao);
    if (item.paridade?.status === 'conforme') {
      if (item.paridade?.canalExclusivoEmail) {
        paridadeBadge = `<span class="badge-ok" style="font-size:11px;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;" title="Obrigação com canal exclusivo de e-mail (não requer WhatsApp)"><span>✓</span> ✉️ Canal E-mail</span>`;
      } else if (precisaOrdem) {
        paridadeBadge = `<span class="badge-warn" style="font-size:11px;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;" title="Cada passo de WhatsApp deve ficar imediatamente antes do respectivo passo de e-mail"><span>↕️</span> Ordem a ajustar</span>`;
      } else {
        paridadeBadge = `<span class="badge-ok" style="font-size:11px;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;"><span>✓</span> ✉️ + 💬 Alinhados</span>`;
      }
    } else if (item.paridade?.status === 'pendente_whatsapp') {
      const faltam = item.paridade?.faltamWhatsapp || 1;
      const totalEmail = item.paridade?.emailCount || faltam;
      paridadeBadge = `<span class="badge-warn" style="font-size:11px;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;" title="${totalEmail} passo(s) de e-mail e ${item.paridade?.whatsappCount || 0} de WhatsApp (regra 1:1)"><span>⚠️</span> Faltam ${faltam} WhatsApp</span>`;
    } else if (item.paridade?.status === 'pendente_email') {
      paridadeBadge = `<span style="font-size:11px;background:#e0e7ff;color:#3730a3;padding:2px 6px;border-radius:4px;">💬 Sem E-mail</span>`;
    }

    const deptoBadge = `<span style="font-size:11px;background:#eaf2f1;color:#184f59;padding:2px 6px;border-radius:4px;font-weight:600;">${escapeHtml(item.departamento || 'Geral')}</span>`;
    const orgaoBadge = `<span style="font-size:11px;color:#4a6560;">${escapeHtml(item.orgao || 'Empresa')}</span>`;
    const vencText = item.diaVencimento ? `Dia ${item.diaVencimento}` : '—';
    const isChecked = selectedObrigacoesIds.has(item.id);

    return `
      <tr class="${isChecked ? 'is-selected' : ''}">
        <td style="text-align:center;">
          <input type="checkbox" class="obrig-row-check" data-id="${item.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
        </td>
        <td style="color:#184f59;font-weight:700;">#${item.id}</td>
        <td>
          <strong style="color:#184f59;">${escapeHtml(item.nome)}</strong>
        </td>
        <td>${deptoBadge}</td>
        <td style="color:#4a6560;">${escapeHtml(item.frequencia || '—')}</td>
        <td style="color:#4a6560;">${escapeHtml(vencText)}</td>
        <td style="color:#4a6560;">${escapeHtml(item.fatoGerador || '—')}</td>
        <td>${orgaoBadge}</td>
        <td style="text-align:center;">${paridadeBadge}</td>
        <td style="text-align:center;">
          ${(() => {
            const kanbanRaw = (item.quadroKanban || (item.status && item.status !== 'Ativo' ? item.status : '') || '').replace(/\n+/g, ' · ').trim();
            return kanbanRaw
              ? `<span style="font-size:11px;background:#eef6f5;color:#184f59;padding:2px 6px;border-radius:4px;font-weight:500;display:inline-block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(kanbanRaw)}">${escapeHtml(kanbanRaw)}</span>`
              : `<span style="font-size:11.5px;color:#94a3b8;">—</span>`;
          })()}
        </td>
        <td style="text-align:right;white-space:nowrap;">
          <div style="display:inline-flex;gap:4px;align-items:center;">
            <button type="button" class="btn-table-action btn-action-ghost" onclick="openFixEmailModal(${item.id})" title="Ajustar passos e modelos de E-mail">
              <span>✉️</span> Ajustar E-mail
            </button>
            ${item.paridade?.hasWhatsapp ? `
              <button type="button" class="btn-table-action btn-action-ghost" title="Confere e atualiza a configuração nos passos de WhatsApp (tipo de cancelamento, automação de envio e anexos)" onclick="openCreateWhatsappModal(${item.id})">
                <span>💬</span> Ajustar WhatsApp
              </button>
            ` : (!item.paridade?.canalExclusivoEmail ? `
              <button type="button" class="btn-table-action btn-action-primary" title="Criar passos de disparo WhatsApp" onclick="openCreateWhatsappModal(${item.id})">
                <span>💬</span> Criar WhatsApp
              </button>
            ` : '')}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Adiciona listeners para os checkboxes da tabela
  tbody.querySelectorAll('.obrig-row-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.checked) {
        selectedObrigacoesIds.add(id);
      } else {
        selectedObrigacoesIds.delete(id);
      }
      renderObrigacoesTable();
    });
  });
}

async function openObrigTemplatesModal() {
  const accountId = currentAccount() || (config.accounts && config.accounts[0] ? (typeof config.accounts[0] === 'string' ? config.accounts[0] : config.accounts[0].accountId) : '') || '6581';
  try {
    const res = await api('obrigacoes/templates', { accountId });
    const tmpl = res.templates || {};

    if ($('tmplWhatsappHabilitado')) $('tmplWhatsappHabilitado').checked = tmpl.whatsapp?.habilitado !== false;
    if ($('tmplWhatsappTexto')) $('tmplWhatsappTexto').value = tmpl.whatsapp?.texto || '';
    if ($('tmplWhatsappParticularidade')) $('tmplWhatsappParticularidade').value = tmpl.whatsapp?.particularidadeId || '539';

    if ($('tmplEmailAssunto')) $('tmplEmailAssunto').value = tmpl.email?.assunto || '';
    if ($('tmplEmailTexto')) $('tmplEmailTexto').value = tmpl.email?.texto || '';

    updateObrigPreview();
    if ($('modalObrigTemplates')) $('modalObrigTemplates').style.display = 'flex';
  } catch (err) {
    status('Erro ao carregar modelos: ' + err.message, 'error');
  }
}

function updateObrigPreview() {
  const text = $('tmplWhatsappTexto')?.value || '';
  const dummyData = {
    '[cliente.apelido]': 'Indústria e Comércio Silva Ltda',
    '[cliente.nome]': 'Silva Indústria e Comércio de Alimentos Ltda',
    '[obrigacao.nome]': 'DAS SIMPLES',
    '[tarefa.competencia]': '10/2026',
    '[tarefa.vencimento]': '20/11/2026',
    '[contato.nome]': 'Carlos Eduardo',
    '[empresa.apelido]': 'Nosso Escritório Contábil'
  };

  let preview = text;
  for (const [tag, val] of Object.entries(dummyData)) {
    preview = preview.replaceAll(tag, val);
  }
  if ($('obrigPreviewWhatsapp')) {
    $('obrigPreviewWhatsapp').textContent = preview || '(Nenhum texto informado)';
  }
}

async function saveObrigTemplates() {
  const accountId = currentAccount() || (config.accounts && config.accounts[0] ? (typeof config.accounts[0] === 'string' ? config.accounts[0] : config.accounts[0].accountId) : '') || '6581';
  const templates = {
    whatsapp: {
      habilitado: $('tmplWhatsappHabilitado')?.checked ?? true,
      texto: $('tmplWhatsappTexto')?.value || '',
      particularidadeId: $('tmplWhatsappParticularidade')?.value?.trim() || '539'
    },
    email: {
      assunto: $('tmplEmailAssunto')?.value || '',
      texto: $('tmplEmailTexto')?.value || ''
    }
  };

  try {
    setBusy(true);
    await api('obrigacoes/templates/save', { accountId, templates });
    status('Modelos flexíveis de mensagem salvos com sucesso!', 'ok');
    if ($('modalObrigTemplates')) $('modalObrigTemplates').style.display = 'none';
  } catch (err) {
    status('Erro ao salvar modelos: ' + err.message, 'error');
  } finally {
    setBusy(false);
  }
}

$('obrigSearchInput')?.addEventListener('input', () => { obrigacoesPage = 0; renderObrigacoesTable(); });
$('obrigDeptoFilter')?.addEventListener('change', () => { obrigacoesPage = 0; renderObrigacoesTable(); });
$('obrigFreqFilter')?.addEventListener('change', () => { obrigacoesPage = 0; renderObrigacoesTable(); });
$('obrigParidadeFilter')?.addEventListener('change', () => { obrigacoesPage = 0; renderObrigacoesTable(); });
$('obrigPrevPage')?.addEventListener('click', () => { if (obrigacoesPage > 0) { obrigacoesPage--; renderObrigacoesTable(); } });
$('obrigNextPage')?.addEventListener('click', () => { obrigacoesPage++; renderObrigacoesTable(); });

$('btnOpenObrigTemplates')?.addEventListener('click', openObrigTemplatesModal);
$('btnCloseObrigTemplates')?.addEventListener('click', () => { if ($('modalObrigTemplates')) $('modalObrigTemplates').style.display = 'none'; });
$('btnCancelObrigTemplates')?.addEventListener('click', () => { if ($('modalObrigTemplates')) $('modalObrigTemplates').style.display = 'none'; });
$('btnSaveObrigTemplates')?.addEventListener('click', saveObrigTemplates);

$('tmplWhatsappTexto')?.addEventListener('input', updateObrigPreview);
$('tmplWhatsappTexto')?.addEventListener('focus', () => { currentFocusedTextarea = $('tmplWhatsappTexto'); });
$('tmplEmailTexto')?.addEventListener('focus', () => { currentFocusedTextarea = $('tmplEmailTexto'); });
$('tmplEmailAssunto')?.addEventListener('focus', () => { currentFocusedTextarea = $('tmplEmailAssunto'); });

document.querySelectorAll('#obrigTemplateChips .tag-chip').forEach(chip => {
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    const tag = chip.dataset.tag;
    const targetInput = currentFocusedTextarea || $('tmplWhatsappTexto');
    if (!targetInput) return;
    const start = targetInput.selectionStart ?? targetInput.value.length;
    const end = targetInput.selectionEnd ?? targetInput.value.length;
    const val = targetInput.value;
    targetInput.value = val.substring(0, start) + tag + val.substring(end);
    targetInput.selectionStart = targetInput.selectionEnd = start + tag.length;
    targetInput.focus();
    updateObrigPreview();
  });
});

// ==========================================
// MÓDULO DE AJUSTE / CORREÇÃO DE E-MAIL
// ==========================================
let currentEditingObrig = null;

window.insertTagIntoFixEmail = function(tag) {
  const el = $('fixEmailCorpo');
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const val = el.value;
  el.value = val.substring(0, start) + tag + val.substring(end);
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.focus();
};

window.openFixEmailModal = async function(obrigId) {
  const item = obrigacoesList.find(o => o.id === obrigId);
  if (!item) {
    status('Obrigação não encontrada na lista local.', 'warn');
    return;
  }
  currentEditingObrig = item;

  const modal = $('modalFixEmail');
  if (!modal) return;
  modal.style.display = 'flex';

  $('fixEmailLoading').style.display = 'block';
  $('fixEmailFormContent').style.display = 'none';
  $('fixEmailObrigBadge').innerText = `#${item.id}`;
  $('fixEmailObrigNome').innerText = item.nome;
  $('fixEmailDepto').innerText = item.departamento || 'Geral';
  $('fixEmailSubhint').innerText = `Lendo configurações da obrigação #${item.id} no G-Click...`;

  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    return;
  }
  try {
    const res = await api('obrigacoes/email-inspect', {
      accountId,
      id: item.id,
      coid: item.coid
    });

    $('fixEmailSubhint').innerText = `Configure categorias, assunto, corpo e gatilho de envio para #${item.id}.`;
    $('fixEmailLoading').style.display = 'none';
    $('fixEmailFormContent').style.display = 'block';

    // 1. Renderizar Categorias
    const catContainer = $('fixEmailCategoriasContainer');
    catContainer.innerHTML = '';
    const disponiveis = res.categoriasDisponiveis || [];
    const selecionadas = res.categoriasSelecionadas || [];

    // Se nenhuma categoria estiver selecionada, tenta sugerir a do departamento da obrigação
    let autoSuggest = selecionadas.slice();
    if (autoSuggest.length === 0 && item.departamento) {
      const norm = str => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const depNorm = norm(item.departamento);
      const root = depNorm.length >= 6 ? depNorm.slice(0, 6) : depNorm;
      const matchDepto = disponiveis.find(c => {
        const catNorm = norm(c.label);
        return catNorm.includes(depNorm) || depNorm.includes(catNorm) || catNorm.startsWith(root) || depNorm.startsWith(catNorm.slice(0, 6));
      });
      if (matchDepto) autoSuggest.push(matchDepto.value);
    }

    if (disponiveis.length === 0) {
      catContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Nenhuma categoria cadastrada na conta.</span>`;
    } else {
      disponiveis.forEach(c => {
        const isChecked = autoSuggest.includes(c.value);
        const labelEl = document.createElement('label');
        labelEl.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;background:#eef6f5;padding:4px 8px;border-radius:4px;cursor:pointer;color:#184f59;font-weight:500;';
        labelEl.innerHTML = `
          <input type="checkbox" name="fixEmailCat" value="${escapeHtml(c.value)}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
          <span>${escapeHtml(c.label)}</span>
        `;
        catContainer.appendChild(labelEl);
      });
    }

    // 2. Assunto
    $('fixEmailAssunto').value = res.assunto || `[obrigacao.nome] - [tarefa.competencia]`;

    // 3. Corpo
    $('fixEmailCorpo').value = res.corpoTexto || `Olá [cliente.apelido],\n\nSegue [obrigacao.nome] referente a [tarefa.competencia], com o vencimento: [tarefa.vencimento].\n\nQualquer dúvida, ficamos à disposição!\n\nAtenciosamente,`;

    // 4. Formas de Envio
    $('fixEmailAutomacao').value = res.automacao === '1' ? '1' : (res.automacao || '1');
    $('fixEmailAnexarTodos').checked = true;

    // 5. Lista de Anexos
    const docsUl = $('fixEmailDocsUl');
    docsUl.innerHTML = '';
    const anexos = res.anexos || [];
    if (anexos.length === 0) {
      docsUl.innerHTML = `<li>Nenhuma atividade de documento detectada antes deste passo.</li>`;
    } else {
      anexos.forEach(a => {
        const li = document.createElement('li');
        li.style.marginBottom = '4px';
        const statusText = a.anexado ? '<span style="color:#047857;font-weight:600;">[Já anexado]</span>' : '<span style="color:#d97706;font-weight:600;">[Será anexado]</span>';
        li.innerHTML = `Ordem ${escapeHtml(a.ordem)}: <strong>${escapeHtml(a.nome)}</strong> — ${statusText}`;
        docsUl.appendChild(li);
      });
    }

    // 6. Tipo de Cancelamento
    const cancelSelect = $('fixEmailCancelamento');
    if (cancelSelect) {
      cancelSelect.innerHTML = '';
      const cancelOptions = res.tiposCancelamentoDisponiveis || [
        { value: '0', label: 'Sem justificativa' },
        { value: '1', label: 'Com justificativa' },
        { value: '2', label: 'Sem cancelamento' }
      ];
      cancelOptions.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.innerText = opt.label;
        if (opt.value === (res.tipoCancelamento || '1')) optionEl.selected = true;
        cancelSelect.appendChild(optionEl);
      });
      // Padrão solicitado: 1 ("Com justificativa") se nada estiver explicitamente definido
      if (!cancelSelect.value) cancelSelect.value = '1';
    }

    // 7. Particularidades / Clientes
    const partSelect = $('fixEmailParticularidade');
    if (partSelect) {
      partSelect.innerHTML = '';
      const partOptions = res.particularidadesDisponiveis || [];
      if (partOptions.length === 0) {
        partSelect.innerHTML = `<option value="">Nenhuma particularidade encontrada na conta</option>`;
      } else {
        let matchedEmail = false;
        partOptions.forEach(opt => {
          const optionEl = document.createElement('option');
          optionEl.value = opt.value;
          optionEl.innerText = opt.label;
          // Se for a atualmente selecionada, ou se contiver "E-mail" / "Email"
          const optLower = opt.label.toLowerCase();
          const isEmail = optLower.includes('e-mail') || optLower.includes('email');
          if (opt.value === res.particularidadeAtual || (!matchedEmail && isEmail)) {
            optionEl.selected = true;
            matchedEmail = true;
          }
          partSelect.appendChild(optionEl);
        });
      }
    }

  } catch (err) {
    $('fixEmailLoading').style.display = 'none';
    $('modalFixEmail').style.display = 'none';
    status('Erro ao inspecionar e-mail da obrigação: ' + err.message, 'error');
  }
};

async function submitFixEmail() {
  if (!currentEditingObrig) return;
  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    return;
  }

  const catCheckboxes = document.querySelectorAll('input[name="fixEmailCat"]:checked');
  const categorias = Array.from(catCheckboxes).map(c => c.value);
  if (categorias.length === 0) {
    if (!confirm('Nenhuma categoria de e-mail foi selecionada. Deseja continuar mesmo assim?')) {
      return;
    }
  }

  const assunto = $('fixEmailAssunto').value.trim();
  const corpoTexto = $('fixEmailCorpo').value.trim();
  const automacao = $('fixEmailAutomacao').value;
  const anexarTodos = $('fixEmailAnexarTodos').checked;
  const tipoCancelamento = $('fixEmailCancelamento')?.value || '1';
  const particularidadeCliente = $('fixEmailParticularidade')?.value || null;

  if (!corpoTexto) {
    alert('Por favor, informe o texto do corpo do e-mail.');
    $('fixEmailCorpo').focus();
    return;
  }

  setBusy(true);
  const fixEmailMsg = `Gravando configurações de e-mail da obrigação #${currentEditingObrig.id} no G-Click...`;
  status(fixEmailMsg, 'busy');
  setObrigStatus(fixEmailMsg, 'info', { percent: 20, current: 1, total: 1 });
  startObrigProgressPoll({ type: 'single_email' });
  $('btnSubmitFixEmail').disabled = true;

  try {
    const res = await api('obrigacoes/fix-email', {
      accountId,
      id: currentEditingObrig.id,
      coid: currentEditingObrig.coid,
      categorias,
      assunto,
      corpoTexto,
      automacao,
      anexarTodos,
      tipoCancelamento,
      particularidadeCliente
    });

    const okMsg = `Obrigação #${currentEditingObrig.id} configurada com sucesso no G-Click!`;
    status(okMsg, 'ok');
    setObrigStatus(okMsg, 'ok');
    $('modalFixEmail').style.display = 'none';
    currentEditingObrig = null;

    // Atualiza status na lista local
    await loadObrigacoesSection();
  } catch (err) {
    status('Erro ao gravar configuração de e-mail: ' + err.message, 'error');
    setObrigStatus('Erro ao gravar configuração de e-mail: ' + err.message, 'error');
  } finally {
    stopObrigProgressPoll();
    setBusy(false);
    $('btnSubmitFixEmail').disabled = false;
  }
}

$('btnCloseFixEmail')?.addEventListener('click', () => { if ($('modalFixEmail')) $('modalFixEmail').style.display = 'none'; });
$('btnCancelFixEmail')?.addEventListener('click', () => { if ($('modalFixEmail')) $('modalFixEmail').style.display = 'none'; });
$('btnSubmitFixEmail')?.addEventListener('click', submitFixEmail);

// ==========================================
// MÓDULO DE AÇÃO EM MASSA (LOTE) DE E-MAIL
// ==========================================
window.insertTagIntoBatchEmail = function(tag) {
  const el = $('batchEmailCorpo');
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const val = el.value;
  el.value = val.substring(0, start) + tag + val.substring(end);
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.focus();
};

$('obrigSelectAll')?.addEventListener('change', (e) => {
  const depto = $('obrigDeptoFilter')?.value || '';
  const freq = $('obrigFreqFilter')?.value || '';
  const search = ($('obrigSearchInput')?.value || '').trim().toLowerCase();
  const paridade = $('obrigParidadeFilter')?.value || '';

  const filtered = obrigacoesList.filter(item => {
    if (depto && item.departamento !== depto) return false;
    if (freq && item.frequencia !== freq) return false;
    if (paridade && item.paridade?.status !== paridade) return false;
    if (search) {
      const matchName = (item.nome || '').toLowerCase().includes(search);
      const matchId = String(item.id || '').includes(search);
      const matchDepto = (item.departamento || '').toLowerCase().includes(search);
      const matchFreq = (item.frequencia || '').toLowerCase().includes(search);
      const matchOrgao = (item.orgao || '').toLowerCase().includes(search);
      if (!matchName && !matchId && !matchDepto && !matchFreq && !matchOrgao) return false;
    }
    return true;
  });

  if (e.target.checked) {
    filtered.forEach(item => selectedObrigacoesIds.add(item.id));
  } else {
    filtered.forEach(item => selectedObrigacoesIds.delete(item.id));
  }
  renderObrigacoesTable();
});

$('btnClearBatchSelection')?.addEventListener('click', () => {
  selectedObrigacoesIds.clear();
  renderObrigacoesTable();
});

$('obrigDeptoFilter')?.addEventListener('change', () => {
  // Limpa seleções de outros departamentos para manter consistência
  selectedObrigacoesIds.clear();
  obrigacoesPage = 0;
  renderObrigacoesTable();
});

$('obrigFreqFilter')?.addEventListener('change', () => {
  selectedObrigacoesIds.clear();
  obrigacoesPage = 0;
  renderObrigacoesTable();
});

$('obrigParidadeFilter')?.addEventListener('change', () => {
  obrigacoesPage = 0;
  renderObrigacoesTable();
});

$('obrigSearchInput')?.addEventListener('input', () => {
  obrigacoesPage = 0;
  renderObrigacoesTable();
});

async function openBatchEmailModal() {
  const depto = $('obrigDeptoFilter')?.value || '';
  if (!depto) {
    alert('Para executar a ação em massa, o departamento deve estar obrigatoriamente selecionado no filtro.');
    $('obrigDeptoFilter')?.focus();
    return;
  }

  const selectedItems = obrigacoesList.filter(o => selectedObrigacoesIds.has(o.id));
  if (selectedItems.length === 0) {
    alert('Nenhuma obrigação selecionada. Marque as obrigações que deseja configurar.');
    return;
  }

  const modal = $('modalBatchEmail');
  if (!modal) return;
  modal.style.display = 'flex';

  $('batchEmailDeptoBadge').textContent = depto;
  $('batchEmailTotalCount').textContent = `${selectedItems.length} obrigação(ões) selecionada(s)`;
  $('batchEmailListPreview').textContent = selectedItems.map(o => o.nome).join(', ');
  $('batchEmailProgressBox').style.display = 'none';

  // Carrega opções reais de categorias e particularidades da conta logada
  const catContainer = $('batchEmailCategoriasContainer');
  const partSelect = $('batchEmailParticularidade');
  catContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Consultando conta no G-Click...</span>`;
  partSelect.innerHTML = `<option value="">Carregando particularidades da conta…</option>`;

  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    return;
  }
  try {
    // Usa uma obrigação de referência para inspecionar categorias e particularidades
    const refItem = selectedItems[0];
    const res = await api('obrigacoes/email-inspect', {
      accountId,
      id: refItem.id,
      coid: refItem.coid
    });

    // 1. Renderizar Categorias da Conta
    catContainer.innerHTML = '';
    const disponiveis = res.categoriasDisponiveis || [];
    let autoSuggest = [];

    // Tenta casar categoria com o departamento filtrado
    if (depto) {
      const norm = str => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const depNorm = norm(depto);
      const root = depNorm.length >= 6 ? depNorm.slice(0, 6) : depNorm;
      const matchDepto = disponiveis.find(c => {
        const catNorm = norm(c.label);
        return catNorm.includes(depNorm) || depNorm.includes(catNorm) || catNorm.startsWith(root) || depNorm.startsWith(catNorm.slice(0, 6));
      });
      if (matchDepto) autoSuggest.push(matchDepto.value);
    }

    if (disponiveis.length === 0) {
      catContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Nenhuma categoria cadastrada na conta.</span>`;
    } else {
      disponiveis.forEach(c => {
        const isChecked = autoSuggest.includes(c.value);
        const labelEl = document.createElement('label');
        labelEl.style.cssText = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;background:#eef6f5;padding:4px 8px;border-radius:4px;cursor:pointer;color:#184f59;font-weight:500;';
        labelEl.innerHTML = `
          <input type="checkbox" name="batchEmailCat" value="${escapeHtml(c.value)}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
          <span>${escapeHtml(c.label)}</span>
        `;
        catContainer.appendChild(labelEl);
      });
    }

    // 2. Renderizar Particularidades / Clientes
    partSelect.innerHTML = '';
    const partOptions = res.particularidadesDisponiveis || [];
    if (partOptions.length === 0) {
      partSelect.innerHTML = `<option value="">Nenhuma particularidade encontrada na conta</option>`;
    } else {
      let matchedEmail = false;
      partOptions.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.innerText = opt.label;
        const optLower = opt.label.toLowerCase();
        const isEmail = optLower.includes('e-mail') || optLower.includes('email');
        if (!matchedEmail && isEmail) {
          optionEl.selected = true;
          matchedEmail = true;
        }
        partSelect.appendChild(optionEl);
      });
    }

    // 3. Padrão do Tipo de Cancelamento
    if ($('batchEmailCancelamento')) $('batchEmailCancelamento').value = '1';

  } catch (err) {
    catContainer.innerHTML = `<span style="font-size:12px;color:#d97706;">Aviso: Não foi possível obter categorias ao vivo (${escapeHtml(err.message)}). A gravação usará os parâmetros informados.</span>`;
  }
}

async function submitBatchEmail() {
  const depto = $('obrigDeptoFilter')?.value || '';
  if (!depto) {
    alert('Departamento obrigatório no filtro.');
    return;
  }

  const selectedItems = obrigacoesList.filter(o => selectedObrigacoesIds.has(o.id));
  if (selectedItems.length === 0) {
    alert('Selecione pelo menos uma obrigação.');
    return;
  }

  const catCheckboxes = document.querySelectorAll('input[name="batchEmailCat"]:checked');
  const categorias = Array.from(catCheckboxes).map(c => c.value);
  if (categorias.length === 0) {
    if (!confirm('Nenhuma categoria de e-mail foi marcada. Deseja aplicar o lote mesmo assim?')) {
      return;
    }
  }

  const assunto = $('batchEmailAssunto').value.trim();
  const corpoTexto = $('batchEmailCorpo').value.trim();
  const automacao = $('batchEmailAutomacao').value;
  const anexarTodos = $('batchEmailAnexarTodos').checked;
  const tipoCancelamento = $('batchEmailCancelamento')?.value || '1';
  const particularidadeCliente = $('batchEmailParticularidade')?.value || null;

  if (!corpoTexto) {
    alert('Por favor, informe o corpo de e-mail padrão.');
    $('batchEmailCorpo').focus();
    return;
  }

  if (!confirm(`Confirma a configuração em lote para ${selectedItems.length} obrigação(ões) do departamento "${depto}"?`)) {
    return;
  }

  setBusy(true);
  $('btnSubmitBatchEmail').disabled = true;
  $('batchEmailProgressBox').style.display = 'block';
  $('batchEmailProgressPerc').textContent = '5%';
  $('batchEmailProgressBar').value = 5;
  const batchEmailMsg = `Iniciando configuração de e-mail em massa para ${selectedItems.length} obrigações...`;
  status(batchEmailMsg, 'busy');
  setObrigStatus(batchEmailMsg, 'info', { percent: 5, current: 0, total: selectedItems.length });
  startObrigProgressPoll({ type: 'batch_email' });

  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    stopObrigProgressPoll();
    setBusy(false);
    $('btnSubmitBatchEmail').disabled = false;
    return;
  }
  try {
    const res = await api('obrigacoes/fix-email-batch', {
      accountId,
      departamento: depto,
      items: selectedItems.map(it => ({ id: it.id, coid: it.coid, nome: it.nome, departamento: it.departamento })),
      categorias,
      assunto,
      corpoTexto,
      automacao,
      anexarTodos,
      tipoCancelamento,
      particularidadeCliente
    });

    $('batchEmailProgressBar').value = 100;
    $('batchEmailProgressPerc').textContent = '100%';
    const okMsg = `Ação em massa concluída: ${res.successCount} de ${res.total} obrigações configuradas com sucesso!`;
    status(okMsg, 'ok');
    setObrigStatus(okMsg, 'ok');

    selectedObrigacoesIds.clear();
    $('modalBatchEmail').style.display = 'none';

    // Recarrega catálogo e renderiza lista
    await loadObrigacoesSection();
  } catch (err) {
    status('Erro na configuração em massa: ' + err.message, 'error');
    setObrigStatus('Falha na ação em massa: ' + err.message, 'error');
  } finally {
    stopObrigProgressPoll();
    setBusy(false);
    $('btnSubmitBatchEmail').disabled = false;
  }
}

$('btnOpenBatchEmailModal')?.addEventListener('click', openBatchEmailModal);
$('btnCloseBatchEmail')?.addEventListener('click', () => { if ($('modalBatchEmail')) $('modalBatchEmail').style.display = 'none'; });
$('btnCancelBatchEmail')?.addEventListener('click', () => { if ($('modalBatchEmail')) $('modalBatchEmail').style.display = 'none'; });
$('btnSubmitBatchEmail')?.addEventListener('click', submitBatchEmail);

// ==========================================
// MÓDULO DE CRIAÇÃO DO PASSO DE WHATSAPP
// ==========================================
let currentWhatsappObrig = null;

window.insertTagIntoCreateWhatsapp = function(tag) {
  const el = $('createWhatsappMensagem');
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.substring(0, start) + tag + el.value.substring(end);
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.focus();
};

window.openCreateWhatsappModal = async function(id) {
  const item = obrigacoesList.find(o => o.id === id);
  if (!item) {
    status('Obrigação não encontrada no catálogo local.', 'error');
    return;
  }

  if (item.paridade?.canalExclusivoEmail) {
    alert('Esta obrigação possui canal exclusivo de e-mail e não deve ter passo de WhatsApp.');
    return;
  }

  const isAjuste = Boolean(item.paridade?.hasWhatsapp);
  currentWhatsappObrig = item;
  $('createWhatsappObrigBadge').textContent = `#${item.id}`;
  $('createWhatsappObrigNome').textContent = item.nome;
  $('createWhatsappDepto').textContent = item.departamento || 'Geral';
  const modalTitle = $('createWhatsappModalTitle') || $('modalCreateWhatsapp')?.querySelector('h3');
  if (modalTitle) modalTitle.textContent = isAjuste ? 'Ajustar Configuração de WhatsApp' : 'Criar e Configurar Passo de WhatsApp';
  const submitBtn = $('btnSubmitCreateWhatsapp');
  if (submitBtn) submitBtn.innerHTML = isAjuste ? '<span>💾</span> Gravar Configuração no G-Click' : '<span>💬</span> Criar e Configurar no G-Click';
  $('modalCreateWhatsapp').style.display = 'flex';

  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    return;
  }
  try {
    const res = await api('obrigacoes/whatsapp-inspect', {
      accountId,
      id: item.id,
      coid: item.coid
    });

    // Categorias de Destinatário
    const catContainer = $('createWhatsappCategoriasContainer');
    if (catContainer) {
      catContainer.innerHTML = '';
      const catOptions = res.categoriasDisponiveis || [];
      if (catOptions.length === 0) {
        catContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Nenhuma categoria de destinatário listada na conta.</span>`;
      } else {
        const itemDeptoLower = (item.departamento || '').toLowerCase();
        catOptions.forEach(cat => {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:12px;background:#fff;padding:3px 8px;border:1px solid #c8d9d6;border-radius:4px;cursor:pointer;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.name = 'createWhatsappCat';
          cb.value = cat.value;
          const catLower = cat.label.toLowerCase();
          if ((itemDeptoLower && (catLower.includes(itemDeptoLower) || itemDeptoLower.includes(catLower))) || catLower.includes('geral')) {
            cb.checked = true;
          }
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(cat.label));
          catContainer.appendChild(lbl);
        });
      }
    }

    // Canais de Envio
    const canalSelect = $('createWhatsappCanal');
    if (canalSelect) {
      canalSelect.innerHTML = '';
      const canais = res.canaisDisponiveis || [{ value: 'WHATSAPP - Atendimento', label: 'WHATSAPP - Atendimento' }];
      canais.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.innerText = c.label;
        if (c.value.toLowerCase().includes('whatsapp') || c.value.toLowerCase().includes('atendimento')) {
          opt.selected = true;
        }
        canalSelect.appendChild(opt);
      });
    }

    // Particularidades
    const partSelect = $('createWhatsappParticularidade');
    if (partSelect) {
      partSelect.innerHTML = '';
      const partOptions = res.particularidadesDisponiveis || [];
      if (partOptions.length === 0) {
        partSelect.innerHTML = `<option value="542" selected>542 - Whats (Padrão)</option>`;
      } else {
        let matchedWhats = false;
        partOptions.forEach(opt => {
          const optionEl = document.createElement('option');
          optionEl.value = opt.value;
          optionEl.innerText = opt.label;
          const optLower = opt.label.toLowerCase();
          const isWhats = optLower.includes('whats') || optLower.includes('542');
          if (!matchedWhats && isWhats) {
            optionEl.selected = true;
            matchedWhats = true;
          }
          partSelect.appendChild(optionEl);
        });
      }
    }

    // Tipos de cancelamento
    const cancelSelect = $('createWhatsappCancelamento');
    if (cancelSelect) {
      cancelSelect.innerHTML = '';
      const cancelOptions = res.tiposCancelamentoDisponiveis || [
        { value: '0', label: 'Sem justificativa' },
        { value: '1', label: 'Com justificativa' },
        { value: '2', label: 'Sem cancelamento' }
      ];
      cancelOptions.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.innerText = opt.label;
        if (opt.value === '1') optionEl.selected = true;
        cancelSelect.appendChild(optionEl);
      });
      if (!cancelSelect.value) cancelSelect.value = '1';
    }
  } catch (err) {
    console.warn('Não foi possível inspecionar opções ao vivo:', err);
  }
};

async function submitCreateWhatsapp() {
  if (!currentWhatsappObrig) return;
  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    return;
  }

  const textoDesejado = $('createWhatsappTexto')?.value.trim() || 'Enviar Cliente';
  const catCheckboxes = document.querySelectorAll('input[name="createWhatsappCat"]:checked');
  const categorias = Array.from(catCheckboxes).map(c => c.value);
  const canal = $('createWhatsappCanal')?.value || 'WHATSAPP - Atendimento';
  const mensagemTexto = $('createWhatsappMensagem')?.value.trim() || '';
  const automacao = $('createWhatsappAutomacao')?.value || '1';
  const anexarTodos = $('createWhatsappAnexarTodos')?.checked !== false;
  const tipoCancelamento = $('createWhatsappCancelamento')?.value || '1';
  const particularidadeCliente = $('createWhatsappParticularidade')?.value || '542';

  if (!mensagemTexto) {
    alert('Por favor, informe o texto da mensagem do WhatsApp.');
    $('createWhatsappMensagem')?.focus();
    return;
  }

  const isAjuste = Boolean(currentWhatsappObrig.paridade?.hasWhatsapp);
  setBusy(true);
  const loadingMsg = isAjuste
    ? `Atualizando configurações de WhatsApp da obrigação #${currentWhatsappObrig.id} no G-Click...`
    : `Criando passo de WhatsApp para obrigação #${currentWhatsappObrig.id} no G-Click...`;
  status(loadingMsg, 'busy');
  setObrigStatus(loadingMsg, 'info', { percent: 15, current: 1, total: 1 });
  startObrigProgressPoll({ type: 'single_whatsapp' });
  $('btnSubmitCreateWhatsapp').disabled = true;

  try {
    const res = await api('obrigacoes/create-whatsapp', {
      accountId,
      id: currentWhatsappObrig.id,
      coid: currentWhatsappObrig.coid,
      tipoDesejado: 'Atendimento: DIGISAC',
      textoDesejado,
      categorias,
      canal,
      mensagemTexto,
      automacao,
      anexarTodos,
      tipoCancelamento,
      particularidadeCliente
    });

    if (res.skipped) {
      status(`Ação não executada: ${res.reason}`, 'warn');
      setObrigStatus(`Ação não executada: ${res.reason}`, 'warn');
      alert(res.reason);
    } else {
      const okMsg = isAjuste
        ? `Configuração de WhatsApp atualizada com sucesso na obrigação #${currentWhatsappObrig.id}!`
        : `Passo de WhatsApp criado com sucesso na obrigação #${currentWhatsappObrig.id}!`;
      status(okMsg, 'ok');
      setObrigStatus(okMsg, 'ok');
      $('modalCreateWhatsapp').style.display = 'none';
      currentWhatsappObrig = null;
      await loadObrigacoesSection();
    }
  } catch (err) {
    status('Erro ao criar passo de WhatsApp: ' + err.message, 'error');
    setObrigStatus('Erro ao criar passo de WhatsApp: ' + err.message, 'error');
  } finally {
    stopObrigProgressPoll();
    setBusy(false);
    $('btnSubmitCreateWhatsapp').disabled = false;
  }
}

$('btnCloseCreateWhatsapp')?.addEventListener('click', () => { if ($('modalCreateWhatsapp')) $('modalCreateWhatsapp').style.display = 'none'; });
$('btnCancelCreateWhatsapp')?.addEventListener('click', () => { if ($('modalCreateWhatsapp')) $('modalCreateWhatsapp').style.display = 'none'; });
$('btnSubmitCreateWhatsapp')?.addEventListener('click', submitCreateWhatsapp);

// ==========================================
// MÓDULO DE CRIAÇÃO DE WHATSAPP EM MASSA
// ==========================================
window.insertTagIntoBatchWhatsapp = function(tag) {
  const el = $('batchWhatsappMensagem');
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.substring(0, start) + tag + el.value.substring(end);
  el.selectionStart = el.selectionEnd = start + tag.length;
  el.focus();
};

async function openBatchWhatsappModal() {
  const depto = $('obrigDeptoFilter')?.value || '';
  if (!depto) {
    alert('Para a ação em massa, o departamento deve estar obrigatoriamente selecionado no filtro.');
    return;
  }

  const selectedItems = obrigacoesList.filter(o => selectedObrigacoesIds.has(o.id));
  if (selectedItems.length === 0) {
    alert('Selecione pelo menos uma obrigação para configurar em massa.');
    return;
  }

  $('batchWhatsappDeptoBadge').textContent = depto;
  $('batchWhatsappTotalCount').textContent = `${selectedItems.length} obrigação(ões) selecionada(s)`;
  $('batchWhatsappListPreview').textContent = selectedItems.map(o => `#${o.id} ${o.nome}`).join(', ');

  $('batchWhatsappProgressBox').style.display = 'none';
  $('batchWhatsappFormContent').style.display = 'block';
  $('modalBatchWhatsapp').style.display = 'flex';

  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    return;
  }
  const refItem = selectedItems[0];
  try {
    const res = await api('obrigacoes/whatsapp-inspect', {
      accountId,
      id: refItem.id,
      coid: refItem.coid
    });

    // Categorias de Destinatário no Lote
    const catContainer = $('batchWhatsappCategoriasContainer');
    if (catContainer) {
      catContainer.innerHTML = '';
      const catOptions = res.categoriasDisponiveis || [];
      if (catOptions.length === 0) {
        catContainer.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Nenhuma categoria encontrada na conta.</span>`;
      } else {
        const deptoLower = depto.toLowerCase();
        catOptions.forEach(cat => {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:12px;background:#fff;padding:3px 8px;border:1px solid #c8d9d6;border-radius:4px;cursor:pointer;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.name = 'batchWhatsappCat';
          cb.value = cat.value;
          const catLower = cat.label.toLowerCase();
          if (catLower.includes(deptoLower) || deptoLower.includes(catLower) || catLower.includes('geral')) {
            cb.checked = true;
          }
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(cat.label));
          catContainer.appendChild(lbl);
        });
      }
    }

    // Canais de Envio no Lote
    const canalSelect = $('batchWhatsappCanal');
    if (canalSelect) {
      canalSelect.innerHTML = '';
      const canais = res.canaisDisponiveis || [{ value: 'WHATSAPP - Atendimento', label: 'WHATSAPP - Atendimento' }];
      canais.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.innerText = c.label;
        if (c.value.toLowerCase().includes('whatsapp') || c.value.toLowerCase().includes('atendimento')) {
          opt.selected = true;
        }
        canalSelect.appendChild(opt);
      });
    }

    const partSelect = $('batchWhatsappParticularidade');
    if (partSelect && res.particularidadesDisponiveis?.length > 0) {
      partSelect.innerHTML = '';
      let matchedWhats = false;
      res.particularidadesDisponiveis.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.innerText = opt.label;
        const optLower = opt.label.toLowerCase();
        const isWhats = optLower.includes('whats') || optLower.includes('542');
        if (!matchedWhats && isWhats) {
          optionEl.selected = true;
          matchedWhats = true;
        }
        partSelect.appendChild(optionEl);
      });
    }

    // Tipos de Cancelamento no Lote
    const cancelSelect = $('batchWhatsappCancelamento');
    if (cancelSelect) {
      cancelSelect.innerHTML = '';
      const cancelOptions = res.tiposCancelamentoDisponiveis || [
        { value: '0', label: 'Sem justificativa' },
        { value: '1', label: 'Com justificativa' },
        { value: '2', label: 'Sem cancelamento' }
      ];
      cancelOptions.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.innerText = opt.label;
        if (opt.value === '1') optionEl.selected = true;
        cancelSelect.appendChild(optionEl);
      });
      if (!cancelSelect.value) cancelSelect.value = '1';
    }
  } catch (err) {
    console.warn('Não foi possível obter dados ao vivo para lote de WhatsApp:', err);
  }
}

async function submitBatchWhatsapp() {
  const depto = $('obrigDeptoFilter')?.value || '';
  if (!depto) {
    alert('Departamento obrigatório no filtro.');
    return;
  }

  const selectedItems = obrigacoesList.filter(o => selectedObrigacoesIds.has(o.id));
  if (selectedItems.length === 0) {
    alert('Selecione pelo menos uma obrigação.');
    return;
  }

  const textoDesejado = $('batchWhatsappTexto')?.value.trim() || 'Enviar Cliente';
  const catCheckboxes = document.querySelectorAll('input[name="batchWhatsappCat"]:checked');
  const categorias = Array.from(catCheckboxes).map(c => c.value);
  const canal = $('batchWhatsappCanal')?.value || 'WHATSAPP - Atendimento';
  const mensagemTexto = $('batchWhatsappMensagem')?.value.trim() || '';
  const automacao = $('batchWhatsappAutomacao')?.value || '1';
  const anexarTodos = $('batchWhatsappAnexarTodos')?.checked !== false;
  const tipoCancelamento = $('batchWhatsappCancelamento')?.value || '1';
  const particularidadeCliente = $('batchWhatsappParticularidade')?.value || '542';

  if (!mensagemTexto) {
    alert('Por favor, informe a mensagem do WhatsApp padrão.');
    $('batchWhatsappMensagem')?.focus();
    return;
  }

  if (!confirm(`Confirma a criação do passo de WhatsApp em lote para ${selectedItems.length} obrigação(ões) do departamento "${depto}"?`)) {
    return;
  }

  $('batchWhatsappFormContent').style.display = 'none';
  $('batchWhatsappProgressBox').style.display = 'block';
  if ($('batchWhatsappProgressBar')) $('batchWhatsappProgressBar').value = 5;
  if ($('batchWhatsappProgressPerc')) $('batchWhatsappProgressPerc').textContent = '5%';
  $('btnSubmitBatchWhatsapp').disabled = true;
  setBusy(true);

  const accountId = currentAccount();
  if (!accountId) {
    status('Selecione ou informe uma conta G-Click ativa.', 'warn');
    setBusy(false);
    $('btnSubmitBatchWhatsapp').disabled = false;
    return;
  }

  const batchMsg = `Iniciando criação de WhatsApp em massa para ${selectedItems.length} obrigações...`;
  status(batchMsg, 'busy');
  setObrigStatus(batchMsg, 'info', { percent: 5, current: 0, total: selectedItems.length });
  startObrigProgressPoll({ type: 'batch_whatsapp' });

  try {
    const res = await api('obrigacoes/create-whatsapp-batch', {
      accountId,
      departamento: depto,
      items: selectedItems.map(o => ({ id: o.id, coid: o.coid, nome: o.nome })),
      tipoDesejado: 'Atendimento: DIGISAC',
      textoDesejado,
      categorias,
      canal,
      mensagemTexto,
      automacao,
      anexarTodos,
      tipoCancelamento,
      particularidadeCliente
    });

    const okMsg = `Lote de WhatsApp concluído: ${res.successCount} criadas com sucesso, ${res.failureCount} falhas.`;
    status(okMsg, 'ok');
    setObrigStatus(okMsg, 'ok');
    toast.success(okMsg, 'Automação em Lote Concluída');

    selectedObrigacoesIds.clear();
    $('modalBatchWhatsapp').style.display = 'none';
    await loadObrigacoesSection();
  } catch (err) {
    status('Erro na criação de WhatsApp em massa: ' + err.message, 'error');
    setObrigStatus('Falha na ação em massa: ' + err.message, 'error');
    toast.error('Erro na criação de WhatsApp em massa: ' + err.message, 'Falha no Lote WhatsApp');
  } finally {
    stopObrigProgressPoll();
    setBusy(false);
    $('btnSubmitBatchWhatsapp').disabled = false;
  }
}

$('btnOpenBatchWhatsappModal')?.addEventListener('click', openBatchWhatsappModal);
$('btnCloseBatchWhatsapp')?.addEventListener('click', () => { if ($('modalBatchWhatsapp')) $('modalBatchWhatsapp').style.display = 'none'; });
$('btnCancelBatchWhatsapp')?.addEventListener('click', () => { if ($('modalBatchWhatsapp')) $('modalBatchWhatsapp').style.display = 'none'; });
$('btnSubmitBatchWhatsapp')?.addEventListener('click', submitBatchWhatsapp);


let obrigProgressInterval = null;

function setObrigStatus(message, type = 'info', progress = null) {
  const alert = $('obrigStatusAlert');
  const text = $('obrigStatusText');
  const icon = $('obrigStatusIcon');
  const barContainer = $('obrigProgressBarContainer');
  const bar = $('obrigProgressBar');
  const badge = $('obrigProgressBadge');

  if (!alert || !text) return;
  if (!message) {
    alert.style.display = 'none';
    if (barContainer) barContainer.style.display = 'none';
    if (badge) badge.style.display = 'none';
    return;
  }
  alert.style.display = 'flex';
  text.textContent = message;

  if (progress && typeof progress.percent === 'number') {
    const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
    if (barContainer && bar) {
      barContainer.style.display = 'block';
      bar.style.width = `${pct}%`;
      bar.style.background = type === 'ok' ? '#10b981' : (type === 'warn' || type === 'error') ? '#f59e0b' : '#0284c7';
    }
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = progress.total > 0 ? `${progress.current}/${progress.total} (${pct}%)` : `${pct}%`;
      badge.style.color = type === 'ok' ? '#047857' : (type === 'warn' || type === 'error') ? '#92400e' : '#0369a1';
    }
  } else {
    if (barContainer) barContainer.style.display = 'none';
    if (badge) badge.style.display = 'none';
  }

  if (type === 'ok') {
    alert.style.background = '#eaf7f2';
    alert.style.color = '#047857';
    alert.style.border = '1px solid #a7f3d0';
    if (icon) icon.textContent = '✓';
  } else if (type === 'warn' || type === 'error') {
    alert.style.background = '#fef3c7';
    alert.style.color = '#92400e';
    alert.style.border = '1px solid #fde68a';
    if (icon) icon.textContent = '⚠️';
  } else {
    alert.style.background = '#e0f2fe';
    alert.style.color = '#0369a1';
    alert.style.border = '1px solid #bae6fd';
    if (icon) icon.textContent = '⏳';
  }
}

function startObrigProgressPoll(options = {}) {
  stopObrigProgressPoll();
  obrigProgressInterval = setInterval(async () => {
    try {
      const p = await api('obrigacoes/progress', {});
      if (!p || !p.running) return;

      const percent = Math.min(100, Math.max(0, p.percent || 0));
      const current = p.current || 0;
      const total = p.total || 0;
      const label = p.stage || (p.nome ? `Processando ${current}/${total}: ${p.nome}` : 'Processando no G-Click...');

      setObrigStatus(label, 'info', { percent, current, total });

      if ($('batchWhatsappProgressBox') && $('modalBatchWhatsapp')?.style.display !== 'none') {
        $('batchWhatsappProgressBox').style.display = 'block';
        if ($('batchWhatsappProgressText')) $('batchWhatsappProgressText').textContent = label;
        if ($('batchWhatsappProgressPerc')) $('batchWhatsappProgressPerc').textContent = `${percent}%`;
        if ($('batchWhatsappProgressBar')) $('batchWhatsappProgressBar').value = percent;
      }

      if ($('batchEmailProgressBox') && $('modalBatchEmail')?.style.display !== 'none') {
        $('batchEmailProgressBox').style.display = 'block';
        if ($('batchEmailProgressText')) $('batchEmailProgressText').textContent = label;
        if ($('batchEmailProgressPerc')) $('batchEmailProgressPerc').textContent = `${percent}%`;
        if ($('batchEmailProgressBar')) $('batchEmailProgressBar').value = percent;
      }
    } catch {
      // Ignora falha de polling
    }
  }, 600);
}

function stopObrigProgressPoll() {
  if (obrigProgressInterval) {
    clearInterval(obrigProgressInterval);
    obrigProgressInterval = null;
  }
  if ($('batchWhatsappProgressBox')) $('batchWhatsappProgressBox').style.display = 'none';
  if ($('batchEmailProgressBox')) $('batchEmailProgressBox').style.display = 'none';
}

$('btnSyncObrigacoes')?.addEventListener('click', async () => {
  if (working) return;
  const accountId = currentAccount() || (config.catalog?.accountId) || '';
  if (!accountId) {
    const msg = 'Informe o código da conta G-Click ou conecte sua sessão antes de sincronizar.';
    setObrigStatus(msg, 'warn');
    status(msg, 'warn');
    return;
  }
  let isLive = Boolean(
    currentSessionStatus === 'login_detected' ||
    config.loginOpen ||
    config.loginReady ||
    catalogLive
  );
  if (!isLive) {
    try {
      const sessRes = await fetch(`/api/gclick/session?accountId=${encodeURIComponent(accountId)}`);
      if (sessRes.ok) {
        const sessData = await sessRes.json();
        if (sessData?.gclickAuthStatus === 'login_detected' || sessData?.browserStatus === 'open') {
          isLive = true;
          const selectedAcc = currentAccount() || accountId;
          const detectedAccount = selectedAcc || sessData.currentEmpresaId || sessData.activeAccountId;
          let resolvedNome = sessData.activeEmpresaNome;
          if (sessData.availableEmpresas && Array.isArray(sessData.availableEmpresas)) {
            const match = sessData.availableEmpresas.find(e => String(e.id) === String(detectedAccount));
            if (match?.nome) resolvedNome = match.nome;
          }
          updateTopAccountDisplay(detectedAccount, resolvedNome, sessData.gclickAuthStatus);
        }
      }
    } catch {}
  }
  if (!isLive) {
    const msg = 'A sessão do G-Click não está ativa. Abra o menu "Conexão G-Click" e clique em "Abrir janela de login" para conectar antes de sincronizar.';
    setObrigStatus(msg, 'warn');
    status(msg, 'warn');
    return;
  }

  const btn = $('btnSyncObrigacoes');
  try {
    setBusy(true);
    if (btn) btn.disabled = true;
    const msg = `Sincronizando todas as obrigações da conta ${accountId} no G-Click…`;
    setObrigStatus(msg, 'info', { percent: 0, current: 0, total: 0 });
    status(msg);
    startObrigProgressPoll({ type: 'sync' });
    const res = await api('obrigacoes/sync-catalog', { accountId });
    if (res.items) {
      obrigacoesList = res.items;
      const scannedMsg = res.totalScanned ? ` (total escaneado: ${res.totalScanned})` : '';
      const okMsg = `Catálogo atualizado: ${res.total} obrigação(ões) carregadas${scannedMsg}.`;
      setObrigStatus(okMsg, 'ok');
      status(okMsg, 'ok');
      await loadObrigacoesSection();
    }
  } catch (err) {
    const errMsg = 'Erro ao sincronizar obrigações: ' + err.message;
    setObrigStatus(errMsg, 'error');
    status(errMsg, 'error');
  } finally {
    stopObrigProgressPoll();
    setBusy(false);
    if (btn) btn.disabled = false;
  }
});

for (const btn of document.querySelectorAll('#sidebarNav .nav-btn')) {
  btn.addEventListener('click', () => {
    if (btn.dataset.action === 'obrig-batch') {
      switchSection('obrigacoes');
      const batchBar = $('obrigBatchBar');
      if (batchBar) {
        batchBar.scrollIntoView({ behavior: 'smooth', block: 'center' });
        batchBar.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.4)';
        setTimeout(() => { batchBar.style.boxShadow = ''; }, 1600);
      }
      return;
    }
    if (btn.dataset.action === 'obrig-templates') {
      switchSection('obrigacoes');
      $('btnOpenObrigTemplates')?.click();
      return;
    }
    if (btn.dataset.action === 'valida-pdf-models') {
      switchSection('valida-pdf');
      switchValidaPdfTab('models');
      return;
    }
    if (btn.dataset.section) {
      switchSection(btn.dataset.section);
    }
  });
}

// Configuração de sub-módulos interativos (acordeões retráteis)
function setupSubmoduleToggles() {
  const submodules = [
    { headerId: 'headerSubmoduleEnquete', containerId: 'submoduleEnquete', storageKey: 'submodule_enquete_collapsed' },
    { headerId: 'headerSubmoduleObrigacoes', containerId: 'submoduleObrigacoes', storageKey: 'submodule_obrigacoes_collapsed' },
    { headerId: 'headerSubmoduleValidaPdf', containerId: 'submoduleValidaPdf', storageKey: 'submodule_valida_pdf_collapsed' }
  ];

  submodules.forEach(({ headerId, containerId, storageKey }) => {
    const header = $(headerId);
    const container = $(containerId);
    if (!header || !container) return;

    try {
      const isCollapsed = localStorage.getItem(`enqueteSync_${storageKey}`) === 'true';
      if (isCollapsed) container.classList.add('collapsed');
    } catch { /* sem localStorage */ }

    header.addEventListener('click', () => {
      container.classList.toggle('collapsed');
      try {
        localStorage.setItem(`enqueteSync_${storageKey}`, String(container.classList.contains('collapsed')));
      } catch { /* sem localStorage */ }
    });
  });
}
setupSubmoduleToggles();

// Toggle e persistência de minimização do menu lateral (modo ícones)
function setupSidebarCollapse() {
  const sidebar = $('sidebar');
  const btnCollapse = $('btnCollapseSidebar');
  const icon = $('collapseIcon');
  if (!sidebar || !btnCollapse) return;

  const setCollapsedState = (collapsed) => {
    if (collapsed) {
      sidebar.classList.add('collapsed');
      if (icon) icon.textContent = '▶';
      btnCollapse.title = 'Expandir menu lateral';
      btnCollapse.setAttribute('aria-label', 'Expandir menu lateral');
    } else {
      sidebar.classList.remove('collapsed');
      if (icon) icon.textContent = '◀';
      btnCollapse.title = 'Minimizar menu lateral (somente ícones)';
      btnCollapse.setAttribute('aria-label', 'Minimizar menu lateral');
    }
  };

  try {
    const isCollapsed = localStorage.getItem('enqueteSync_sidebarCollapsed') === 'true';
    if (isCollapsed) setCollapsedState(true);
  } catch { /* sem localStorage */ }

  btnCollapse.addEventListener('click', (e) => {
    e.stopPropagation();
    const willCollapse = !sidebar.classList.contains('collapsed');
    setCollapsedState(willCollapse);
    try {
      localStorage.setItem('enqueteSync_sidebarCollapsed', String(willCollapse));
    } catch { /* sem localStorage */ }
  });
}
setupSidebarCollapse();

// Listener das abas internas do Workspace Enquete
document.querySelectorAll('#enqueteTabs .module-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabKey = btn.dataset.enqueteTab;
    if (tabKey) switchEnqueteTab(tabKey);
  });
});
$('sidebarToggle')?.addEventListener('click', () => {
  $('sidebar')?.classList.toggle('open');
});

// ==========================================================================
// CANCELAMENTO DE OPERAÇÕES & INTERRUPÇÃO SEGURA (Esc / Botão)
// ==========================================================================
async function requestCancelOperation() {
  if (!working) {
    toast.show({ title: 'Nenhuma operação ativa', message: 'Não há automação em execução para cancelar.', type: 'info' });
    return;
  }
  const confirmModal = $('modalConfirmCancel');
  if (confirmModal) confirmModal.hidden = false;
}

async function executeCancelOperation() {
  $('modalConfirmCancel')?.setAttribute('hidden', 'true');
  status('Solicitando cancelamento da operação ao servidor…', 'error');
  try {
    const res = await api('cancel', {});
    toast.show({
      title: 'Operação Interrompida',
      message: res.message || 'A operação foi cancelada com sucesso.',
      type: 'warning'
    });
    status('Operação cancelada com sucesso.', 'ok');
  } catch (err) {
    toast.show({ title: 'Erro ao Cancelar', message: err.message, type: 'error' });
  } finally {
    setBusy(false);
  }
}

$('btnCancelActiveOperation')?.addEventListener('click', requestCancelOperation);
$('btnCloseConfirmCancel')?.addEventListener('click', () => { $('modalConfirmCancel')?.setAttribute('hidden', 'true'); });
$('btnDismissCancel')?.addEventListener('click', () => { $('modalConfirmCancel')?.setAttribute('hidden', 'true'); });
$('btnConfirmAbort')?.addEventListener('click', executeCancelOperation);

// ==========================================================================
// COMMAND PALETTE ENTERPRISE (⌘K / Ctrl+K)
// ==========================================================================
const COMMANDS_REGISTRY = [
  { id: 'nav-conn', title: 'Conexão G-Click', desc: 'Gerenciar sessão e código empId do escritório', icon: '🔑', badge: 'Configuração', action: () => switchSection('connection') },
  { id: 'nav-enquete', title: 'Enquete G-Click', desc: 'Workspace integrado de importação, regras, conferência e gravação', icon: '📝', badge: 'Módulo', action: () => switchSection('enquete') },
  { id: 'nav-source', title: 'Enquete: Planilha & Mapeamento', desc: 'Importar dados e configurar DE/PARA de colunas e regras', icon: '📊', badge: 'Enquete', action: () => { switchSection('enquete'); switchEnqueteTab('dados-mapeamento'); } },
  { id: 'nav-audit', title: 'Enquete: Conferência & Gravação', desc: 'Auditar divergências e gravar marcações no G-Click', icon: '🔍', badge: 'Enquete', action: () => { switchSection('enquete'); switchEnqueteTab('conferencia-gravacao'); } },
  { id: 'nav-enquete-cad', title: 'Enquete: Cadastro de Respostas', desc: 'Criar particularidades faltantes pelo catálogo modelo', icon: '✍️', badge: 'Enquete', action: () => { switchSection('enquete'); switchEnqueteTab('cadastro-respostas'); } },
  { id: 'nav-writer', title: 'Enquete: Sincronização Sheets', desc: 'Configurar script Apps Script e sincronizar status', icon: '🔄', badge: 'Enquete', action: () => { switchSection('enquete'); switchEnqueteTab('sincronizacao-sheets'); } },
  { id: 'nav-obrig', title: 'Obrigações & Canais', desc: 'Gerenciar catálogo de obrigações, WhatsApp e E-mail', icon: '📁', badge: 'Módulo', action: () => switchSection('obrigacoes') },
  { id: 'nav-carteira', title: 'Carteira de Clientes', desc: 'Conferir e vincular clientes a usuários no G-Click', icon: '🗂️', badge: 'Módulo', action: () => switchSection('carteira') },
  { id: 'nav-valida-pdf', title: 'Validador de PDF', desc: 'Conferência, validação de layouts e oráculo de upload', icon: '📄', badge: 'Módulo', action: () => switchSection('valida-pdf') },
  { id: 'nav-help', title: 'Central de Ajuda & Tutoriais', desc: 'Guias práticos, regras negociais e FAQ dos módulos', icon: '📚', badge: 'Suporte', action: () => switchSection('help') },
  { id: 'nav-users', title: 'Usuários & Permissões', desc: 'Administrar acessos e exceções de usuários', icon: '👥', badge: 'Governança', action: () => switchSection('users') },
  { id: 'act-refresh-catalog', title: 'Buscar Catálogo Sob Demanda', desc: 'Ler perguntas e respostas ativas da Enquete no G-Click', icon: '🔄', badge: 'Ação', action: () => $('refreshCatalogManual')?.click() }
];

let selectedCommandIndex = 0;

function openCommandPalette() {
  const modal = $('modalCommandPalette');
  if (!modal) return;
  modal.hidden = false;
  const input = $('commandPaletteInput');
  if (input) {
    input.value = '';
    input.focus();
  }
  selectedCommandIndex = 0;
  renderCommandResults('');
}

function closeCommandPalette() {
  const modal = $('modalCommandPalette');
  if (modal) modal.hidden = true;
}

function renderCommandResults(query) {
  const container = $('commandPaletteResults');
  if (!container) return;
  const q = String(query || '').toLowerCase().trim();
  const filtered = COMMANDS_REGISTRY.filter(cmd => {
    return cmd.title.toLowerCase().includes(q) || cmd.desc.toLowerCase().includes(q) || cmd.badge.toLowerCase().includes(q);
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="cmd-empty-msg">Nenhum comando ou seção encontrada para "<strong>${escapeHtml(query)}</strong>"</div>`;
    return;
  }

  container.innerHTML = filtered.map((cmd, idx) => `
    <div class="cmd-item ${idx === selectedCommandIndex ? 'selected' : ''}" data-cmd-id="${cmd.id}" data-index="${idx}">
      <div class="cmd-item-left">
        <span class="cmd-item-icon">${cmd.icon}</span>
        <div>
          <span class="cmd-item-text">${escapeHtml(cmd.title)}</span>
          <span class="cmd-item-desc">${escapeHtml(cmd.desc)}</span>
        </div>
      </div>
      <span class="cmd-item-badge">${escapeHtml(cmd.badge)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.cmd-item').forEach(el => {
    el.addEventListener('click', () => {
      const cmdId = el.dataset.cmdId;
      const cmd = COMMANDS_REGISTRY.find(c => c.id === cmdId);
      if (cmd) {
        closeCommandPalette();
        cmd.action();
      }
    });
  });
}

function executeSelectedCommand() {
  const input = $('commandPaletteInput');
  const q = String(input?.value || '').toLowerCase().trim();
  const filtered = COMMANDS_REGISTRY.filter(cmd => {
    return cmd.title.toLowerCase().includes(q) || cmd.desc.toLowerCase().includes(q) || cmd.badge.toLowerCase().includes(q);
  });
  const cmd = filtered[selectedCommandIndex];
  if (cmd) {
    closeCommandPalette();
    cmd.action();
  }
}

$('btnOpenCommandPalette')?.addEventListener('click', openCommandPalette);
$('modalCommandPalette')?.addEventListener('click', (e) => {
  if (e.target === $('modalCommandPalette')) closeCommandPalette();
});

$('commandPaletteInput')?.addEventListener('input', (e) => {
  selectedCommandIndex = 0;
  renderCommandResults(e.target.value);
});

$('commandPaletteInput')?.addEventListener('keydown', (e) => {
  const container = $('commandPaletteResults');
  const items = container?.querySelectorAll('.cmd-item') || [];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (items.length > 0) {
      selectedCommandIndex = (selectedCommandIndex + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedCommandIndex));
      items[selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (items.length > 0) {
      selectedCommandIndex = (selectedCommandIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedCommandIndex));
      items[selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeSelectedCommand();
  }
});

// Listener global de atalhos de teclado (⌘K e Esc)
window.addEventListener('keydown', (e) => {
  // Atalho ⌘K ou Ctrl+K para Command Palette
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    const modal = $('modalCommandPalette');
    if (modal && !modal.hidden) closeCommandPalette();
    else openCommandPalette();
    return;
  }

  // Atalho Esc para fechar modal ou interromper automação ativa
  if (e.key === 'Escape') {
    const cmdModal = $('modalCommandPalette');
    if (cmdModal && !cmdModal.hidden) {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    const cancelModal = $('modalConfirmCancel');
    if (cancelModal && !cancelModal.hidden) {
      e.preventDefault();
      cancelModal.hidden = true;
      return;
    }

    // Fechamento universal de qualquer modal aberto
    const openModals = Array.from(document.querySelectorAll('.modal-overlay:not([hidden]), #modalObrigTemplates, #modalFixEmail')).filter(el => {
      const style = window.getComputedStyle(el);
      return !el.hidden && style.display !== 'none';
    });

    if (openModals.length > 0) {
      e.preventDefault();
      const topModal = openModals[openModals.length - 1];
      topModal.hidden = true;
      topModal.style.display = 'none';
      return;
    }

    if (working) {
      e.preventDefault();
      requestCancelOperation();
    }
  }
});

// ==========================================================================
// MÓDULO: CARTEIRA DE CLIENTES POR USUÁRIO (Cadastros > Usuários > Carteira)
// ==========================================================================

async function loadCarteiraSection() {
  const acc = currentAccount();
  if (!acc) return;

  renderCarteiraSheetSummary();

  try {
    const res = await fetch(`/api/carteira/users?accountId=${encodeURIComponent(acc)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: acc })
    });
    if (res.ok) {
      const data = await res.json();
      carteiraUsers = data.users || [];
      carteiraMinha = data.minhaCarteira || null;
      updateCarteiraUsersBadge();
      renderCarteiraMinha();
    }
    loadCarteiraOperacoes();
  } catch (e) {
    console.warn('Erro ao carregar usuários da carteira:', e);
  }
}

function updateCarteiraUsersBadge() {
  const badge = $('carteiraUsersCountBadge');
  const preview = $('carteiraUsersPreview');
  const previewText = $('carteiraUsersPreviewText');
  if (!badge) return;

  if (carteiraUsers.length > 0) {
    badge.textContent = `${carteiraUsers.length} usuários em cache`;
    badge.className = 'nav-badge badge-ok';
    if (preview && previewText) {
      preview.style.display = 'block';
      const sample = carteiraUsers.slice(0, 5).map(u => `${u.apelido || u.nome} (${u.nome})`).join(' • ');
      previewText.innerHTML = `<strong>Mapeamentos em cache:</strong> ${sample}${carteiraUsers.length > 5 ? ` e mais ${carteiraUsers.length - 5} usuário(s)...` : ''}`;
    }
  } else {
    badge.textContent = '0 usuários em cache';
    badge.className = 'nav-badge badge-neutral';
    if (preview) preview.style.display = 'none';
  }
}

// Alternância das sub-abas do módulo Carteira (Vinculação vs Carteiras Existentes)
document.querySelectorAll('input[name="carteiraSubTab"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isVinculacao = radio.value === 'vinculacao';
    const viewVinc = $('carteiraViewVinculacao');
    const viewExist = $('carteiraViewExistentes');
    if (viewVinc) viewVinc.style.display = isVinculacao ? 'flex' : 'none';
    if (viewExist) viewExist.style.display = isVinculacao ? 'none' : 'flex';
  });
});

// Sincroniza o seletor único com o filtro da tabela de auditoria
$('carteiraSelectResponsavel')?.addEventListener('change', () => {
  const val = $('carteiraSelectResponsavel')?.value || '';
  const auditFilter = $('carteiraAuditUserFilter');
  if (auditFilter) {
    auditFilter.value = val === '__ALL__' ? '' : val;
    if (carteiraAuditItems && carteiraAuditItems.length > 0) {
      renderCarteiraAuditTable();
    }
  }
});

$('btnSyncCarteiraUsers')?.addEventListener('click', async () => {
  const acc = currentAccount();
  if (!acc) {
    toast.warning('Selecione ou informe uma conta G-Click no topo da página.');
    return;
  }

  await withButtonLoading('btnSyncCarteiraUsers', 'Lendo usuários e carteiras...', async () => {
    try {
      const res = await fetch('/api/carteira/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: acc })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao sincronizar usuários do G-Click.');
      }
      carteiraUsers = data.users || [];
      carteiraMinha = data.minhaCarteira || null;
      updateCarteiraUsersBadge();
      renderCarteiraMinha();
      const falhas = (carteiraMinha?.usuarios || []).filter(u => u.erro).length;
      toast.success(`${carteiraUsers.length} usuário(s) sincronizados; ${carteiraMinha?.totalEmpresas ?? 0} empresa(s) em Minha Carteira.${falhas ? ` ${falhas} usuário(s) não puderam ser lidos.` : ''}`, 'Usuários e carteiras atualizados');
      if (carteiraParsedData) {
        renderCarteiraUsersSelect();
      }
    } catch (err) {
      toast.error(err.message, 'Erro ao Sincronizar');
    }
  });
});

function renderCarteiraMinha() {
  const wrap = $('carteiraMinhaWrap');
  if (!wrap) return;
  const usuarios = carteiraMinha?.usuarios || [];
  wrap.hidden = !usuarios.length;
  if (!usuarios.length) return;
  const abertos = new Set(Array.from(wrap.querySelectorAll('.carteira-minha-user[open]')).map(el => el.dataset.valor));
  const quando = new Date(carteiraMinha.syncedAt);
  $('carteiraMinhaSyncedAt').textContent = `${carteiraMinha.totalEmpresas} empresa(s) em ${usuarios.length} usuário(s) · sincronizado em ${quando.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  $('carteiraMinhaList').innerHTML = usuarios.map(u => `
    <details class="carteira-minha-user" data-valor="${escapeHtml(u.valor)}"${abertos.has(String(u.valor)) ? ' open' : ''}>
      <summary><div>${escapeHtml(u.nome)}</div><span class="nav-badge ${u.erro ? 'badge-danger' : u.total ? 'badge-ok' : 'badge-neutral'}">${u.erro ? 'Não lido' : `${u.total} empresa(s)`}</span></summary>
      ${u.erro ? `<p class="sub-hint">${escapeHtml(u.erro)}</p>` : u.total
        ? `<ul>${u.empresas.map(e => `<li><label><input type="checkbox" class="carteira-retirar-cb" value="${escapeHtml(e.cnpj)}"${e.cnpj ? '' : ' disabled title="Sem CNPJ na tela do G-Click"'}> <code>${escapeHtml(e.cnpjFormatado || '—')}</code> ${escapeHtml(e.empresa)}</label></li>`).join('')}</ul>
          <div class="carteira-minha-actions"><button type="button" class="btn btn-danger btn-md carteira-retirar-btn" disabled>Retirar selecionadas</button></div>`
        : '<p class="sub-hint">Carteira vazia.</p>'}
    </details>`).join('');
}

// Seleção e retirada por usuário, a partir da Minha Carteira sincronizada.
$('carteiraMinhaList')?.addEventListener('change', event => {
  if (!event.target.classList.contains('carteira-retirar-cb')) return;
  const user = event.target.closest('.carteira-minha-user');
  const count = user.querySelectorAll('.carteira-retirar-cb:checked').length;
  const btn = user.querySelector('.carteira-retirar-btn');
  btn.disabled = count === 0;
  btn.textContent = count ? `Retirar ${count} empresa(s)` : 'Retirar selecionadas';
});
$('carteiraMinhaList')?.addEventListener('click', async event => {
  const btn = event.target.closest('.carteira-retirar-btn');
  if (!btn) return;
  const acc = currentAccount();
  const userEl = btn.closest('.carteira-minha-user');
  const usuario = carteiraMinha?.usuarios?.find(u => String(u.valor) === userEl.dataset.valor);
  const cnpjs = Array.from(userEl.querySelectorAll('.carteira-retirar-cb:checked')).map(cb => cb.value);
  if (!acc || !usuario || !cnpjs.length) return;
  if (!confirm(`Retirar ${cnpjs.length} empresa(s) da Minha Carteira de ${usuario.nome} no G-Click? O robô marcará as empresas e clicará em "Retirar".`)) return;

  btn.disabled = true;
  btn.textContent = 'Retirando no G-Click...';
  try {
    const res = await fetch('/api/carteira/retirar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: acc, usuario: usuario.nome, valor: usuario.valor, cnpjs })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Falha ao retirar clientes.');
    if (data.usuarioSincronizado) Object.assign(usuario, data.usuarioSincronizado);
    carteiraMinha.totalEmpresas = carteiraMinha.usuarios.reduce((sum, u) => sum + u.total, 0);
    if (data.registro?.status === 'ok') toast.success(`${data.removidos.length} empresa(s) retiradas da carteira de ${usuario.nome}.`, 'Retirada concluída');
    else toast.warning(`${data.removidos.length} de ${cnpjs.length} empresa(s) retiradas. O motivo ficou no histórico.`, 'Retirada incompleta');
  } catch (err) {
    toast.error(`${err.message} O erro ficou registrado no histórico.`, 'Erro ao retirar');
  } finally {
    renderCarteiraMinha();
    loadCarteiraOperacoes();
  }
});

const CARTEIRA_OP_STATUS = { ok: ['Concluído', 'badge-ok'], parcial: ['Parcial', 'badge-warn'], erro: ['Erro', 'badge-danger'] };
async function loadCarteiraOperacoes() {
  const acc = currentAccount();
  const card = $('cardCarteiraOperacoes');
  if (!acc || !card) return;
  try {
    const res = await fetch(`/api/carteira/operacoes?accountId=${encodeURIComponent(acc)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: acc })
    });
    if (!res.ok) return;
    const { operacoes = [] } = await res.json();
    card.hidden = !operacoes.length;
    const erros = operacoes.filter(op => op.status !== 'ok').length;
    $('carteiraOperacoesResumo').textContent = `${operacoes.length} registro(s) recentes${erros ? ` · ${erros} com erro ou incompletos` : ''}`;
    $('carteiraOperacoesBody').innerHTML = operacoes.map(op => {
      const [label, cls] = CARTEIRA_OP_STATUS[op.status] || [op.status, 'badge-neutral'];
      const acao = op.acao === 'retirar' ? 'Retirar' : `Vincular${op.origem ? ` (${op.origem === 'mesmo_cargo' ? 'mesmo Cargo' : 'Restantes'})` : ''}`;
      return `<tr data-status="${escapeHtml(op.status)}">
        <td>${escapeHtml(new Date(op.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td>
        <td>${escapeHtml(acao)}</td>
        <td>${escapeHtml(op.usuario)}</td>
        <td>${op.concluidos.length}/${op.solicitados.length}</td>
        <td><span class="nav-badge ${cls}">${label}</span>${op.erro ? `<div class="carteira-op-erro">${escapeHtml(op.erro)}</div>` : ''}</td>
        <td>${escapeHtml(op.operador || '—')}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.warn('Erro ao carregar o histórico da Carteira:', e);
  }
}

async function handleParseCarteiraSheet(payload) {
  const res = await fetch('/api/carteira/sheet/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: currentAccount(), ...payload })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`A Carteira não aceitou a planilha: ${data.error || 'falha ao processar'}`);

  carteiraParsedData = data;
  $('carteiraMetricUsers').textContent = data.users.length;
  $('carteiraMetricUsersHint').textContent = `${data.validCnpjs} CNPJs válidos`;
  $('carteiraMetricTotalEmpresas').textContent = data.totalRows;
  renderCarteiraUsersSelect();
  $('carteiraUserSelectWrap').style.display = 'block';
  return data;
}

function findCarteiraUser(identifier) {
  if (!identifier || !carteiraUsers?.length) return null;
  const raw = String(identifier).trim().toLowerCase();
  const clean = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const cleanRaw = clean(raw);

  // 1. Apelido ou nome exato
  let match = carteiraUsers.find(u => String(u.apelido || '').toLowerCase() === raw || String(u.nome || '').toLowerCase() === raw);
  if (match) return match;

  // 2. Normalizado sem acento
  match = carteiraUsers.find(u => clean(u.apelido) === cleanRaw || clean(u.nome) === cleanRaw);
  if (match) return match;

  // 3. Tokens (ex.: "andreane" em "andreane.exito" casando com "Andreane Rocha")
  const tokens = cleanRaw.split(' ').filter(t => t.length > 1);
  if (tokens.length) {
    const firstTok = tokens[0];
    const candidates = carteiraUsers.filter(u => {
      const uFirst = clean(u.nome).split(' ')[0] || '';
      const uApFirst = clean(u.apelido).split(' ')[0] || '';
      return uFirst === firstTok || uApFirst === firstTok;
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1 && tokens.length > 1) {
      const meaningfulTokens = tokens.filter(t => !/^(exito|consultoria|empresa|contabilidade|adm|oper|aux)$/i.test(t));
      const exactCandidate = candidates.find(c => meaningfulTokens.every(tok => clean(c.nome).includes(tok))) || candidates[0];
      if (exactCandidate) return exactCandidate;
    }
  }

  // 4. Substring
  return carteiraUsers.find(u => clean(u.nome).includes(cleanRaw)) || null;
}

function renderCarteiraUsersSelect() {
  const select = $('carteiraSelectResponsavel');
  if (!select || !carteiraParsedData?.users) return;

  select.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '__ALL__';
  optAll.textContent = `⚡ Todos os usuários da planilha (${carteiraParsedData.users.length} responsáveis / ${carteiraParsedData.totalRows} empresas)`;
  select.appendChild(optAll);

  carteiraParsedData.users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.responsavel;
    const gUser = u.usuarioGclick || findCarteiraUser(u.responsavel);
    const nomeMapeado = gUser?.nome 
      ? ` — ${gUser.nome}` 
      : ' (⚠️ Não cadastrado no G-Click)';
    opt.textContent = `${u.responsavel}${nomeMapeado} (${u.totalEmpresas} empresas)`;
    select.appendChild(opt);
  });
}

// A planilha da Carteira é lida em Planilhas (uso "Carteira por Usuário"); aqui só o resumo e o atalho até lá.
function renderCarteiraSheetSummary() {
  if (!$('carteiraSheetSummary')) return;
  const ready = Boolean(carteiraParsedData && carteiraSheet);
  $('carteiraSheetTitle').textContent = ready ? `${carteiraParsedData.totalRows} empresa(s) · ${carteiraParsedData.users.length} responsável(is)` : 'Planilha da Carteira não carregada';
  $('carteiraSheetDetail').textContent = ready
    ? `${sourceLabel(carteiraSheet.source)} · lida às ${carteiraSheet.readAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${profileLabel(carteiraSheet.profile)}`
    : 'Leia a planilha em Planilhas, escolhendo o uso "Carteira por Usuário".';
  $('btnCarteiraChangeSheet').textContent = ready ? 'Trocar planilha' : 'Abrir Planilhas';
  $('carteiraSheetSummary').classList.toggle('ready', ready);
  if (!ready) {
    $('carteiraUserSelectWrap').style.display = 'none';
    for (const id of ['carteiraMetricUsers', 'carteiraMetricTotalEmpresas']) $(id).textContent = '--';
    $('carteiraMetricUsersHint').textContent = 'Aguardando planilha';
  }
}
$('btnCarteiraChangeSheet')?.addEventListener('click', () => { switchSection('source'); setSourceUse('carteira'); });

$('btnAuditCarteira')?.addEventListener('click', async () => {
  const acc = currentAccount();
  if (!acc) {
    toast.warning('Selecione ou informe uma conta G-Click no topo da página.');
    return;
  }
  const select = $('carteiraSelectResponsavel');
  const selectedResp = select?.value;
  if (!selectedResp) {
    toast.warning('Selecione um responsável para conferir.');
    return;
  }

  await withButtonLoading('btnAuditCarteira', 'Auditando na Carteira...', async () => {
    try {
      let targets = [];
      if (selectedResp === '__ALL__') {
        targets = carteiraParsedData.users;
      } else {
        const found = carteiraParsedData.users.find(u => u.responsavel === selectedResp);
        if (found) targets = [found];
      }

      if (!targets.length) {
        throw new Error('Nenhum dado encontrado para o responsável selecionado.');
      }

      carteiraAuditItems = [];
      let totalJaVinculados = 0;
      let totalDisponiveis = 0;
      let totalNaoLocalizados = 0;
      const totalPorOrigem = { mesmo_cargo: 0, restantes: 0 };

      for (const t of targets) {
        try {
          const res = await fetch('/api/carteira/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accountId: acc,
              responsavel: t.responsavel,
              empresas: t.empresas
            })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || `Falha ao auditar usuário ${t.responsavel}`);
          }
          if (data.audit?.items) {
            carteiraAuditItems.push(...data.audit.items);
            totalJaVinculados += data.audit.jaVinculados || 0;
            totalDisponiveis += data.audit.disponiveis || 0;
            totalPorOrigem.mesmo_cargo += data.audit.disponiveisMesmoCargo || 0;
            totalPorOrigem.restantes += data.audit.disponiveisRestantes || 0;
            totalNaoLocalizados += data.audit.naoLocalizados || 0;
          }
        } catch (errUser) {
          console.warn(`[Carteira] Erro ao auditar responsável ${t.responsavel}:`, errUser);
          (t.empresas || []).forEach(emp => {
            carteiraAuditItems.push({
              linha: emp.linha,
              responsavel: t.responsavel,
              empresa: emp.empresa,
              cnpj: emp.cnpj,
              cnpjFormatado: emp.cnpjFormatado,
              status: 'usuario_nao_localizado',
              situacao: 'Usuário não cadastrado no G-Click',
              colunaGclick: null,
              origens: [],
              detalhe: errUser.message || 'Usuário ausente no G-Click'
            });
            totalNaoLocalizados++;
          });
        }
      }

      $('carteiraMetricJaVinculados').textContent = totalJaVinculados;
      $('carteiraMetricDisponiveis').textContent = totalDisponiveis;
      $('carteiraMetricDisponiveisHint').textContent = `${totalPorOrigem.mesmo_cargo} mesmo Cargo · ${totalPorOrigem.restantes} Restantes`;
      $('carteiraMetricNaoLocalizados').textContent = totalNaoLocalizados;
      updateCarteiraVincularState();

      $('cardCarteiraAudit').style.display = 'block';
      if ($('btnExportCarteiraCsv')) $('btnExportCarteiraCsv').style.display = 'inline-flex';
      populateCarteiraAuditUserFilter();
      renderCarteiraAuditTable();

      toast.success(`Auditoria concluída: ${totalJaVinculados} já vinculados, ${totalDisponiveis} disponíveis, ${totalNaoLocalizados} não localizados/pendentes.`, 'Conferência Realizada');
    } catch (err) {
      toast.error(err.message, 'Erro na Auditoria');
    }
  });
});

function populateCarteiraAuditUserFilter() {
  const select = $('carteiraAuditUserFilter');
  if (!select) return;
  const currentVal = select.value;

  select.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'Todos os Usuários / Responsáveis';
  select.appendChild(optAll);

  const userMap = new Map();
  for (const item of carteiraAuditItems) {
    if (!item.responsavel) continue;
    if (!userMap.has(item.responsavel)) {
      const gUser = findCarteiraUser(item.responsavel);
      userMap.set(item.responsavel, {
        responsavel: item.responsavel,
        usuarioNome: item.usuarioNome || gUser?.nome || null,
        count: 0
      });
    }
    userMap.get(item.responsavel).count++;
  }

  for (const [resp, info] of userMap.entries()) {
    const opt = document.createElement('option');
    opt.value = resp;
    const nomeTxt = info.usuarioNome ? ` — ${info.usuarioNome}` : '';
    opt.textContent = `${resp}${nomeTxt} (${info.count} empresas)`;
    select.appendChild(opt);
  }

  if (currentVal && userMap.has(currentVal)) {
    select.value = currentVal;
  }
}

const CARTEIRA_ORIGEM_LABEL = { mesmo_cargo: 'Clientes Disponíveis com o mesmo Cargo', restantes: 'Clientes Restantes Disponíveis' };
const carteiraPendentes = origem => carteiraAuditItems.filter(i => i.status === 'disponivel_para_vincular' && (i.origens || []).includes(origem));

// O vínculo sai de uma coluna só, escolhida pelo operador; o botão conta o que está disponível nela.
function updateCarteiraVincularState() {
  const select = $('carteiraVincularOrigem');
  if (!select) return;
  for (const option of select.options) {
    option.textContent = `${CARTEIRA_ORIGEM_LABEL[option.value]} (${carteiraPendentes(option.value).length})`;
  }
  const count = carteiraPendentes(select.value).length;
  $('btnVincularCarteira').disabled = count === 0;
  $('carteiraAuditVincularHint').textContent = count > 0
    ? `${count} cliente(s) prontos para vincular a partir de ${CARTEIRA_ORIGEM_LABEL[select.value]}.`
    : `Nenhum cliente disponível em ${CARTEIRA_ORIGEM_LABEL[select.value]}.`;
}
$('carteiraVincularOrigem')?.addEventListener('change', updateCarteiraVincularState);

function renderCarteiraAuditTable() {
  const tbody = $('carteiraAuditTableBody');
  if (!tbody) return;

  const filterUser = $('carteiraAuditUserFilter')?.value || '';
  const filterStatus = $('carteiraAuditStatusFilter')?.value || '';
  const search = ($('carteiraAuditSearch')?.value || '').trim().toLowerCase();

  const filtered = carteiraAuditItems.filter(item => {
    if (filterUser && item.responsavel !== filterUser) return false;
    if (filterStatus.startsWith('origem:')) {
      if (!(item.origens || []).includes(filterStatus.slice(7))) return false;
    } else if (filterStatus && item.status !== filterStatus) return false;
    if (search) {
      const matchText = `${item.responsavel} ${item.usuarioNome || ''} ${item.empresa} ${item.cnpj} ${item.cnpjFormatado} ${item.situacao} ${item.colunaGclick || ''}`.toLowerCase();
      if (!matchText.includes(search)) return false;
    }
    return true;
  });

  tbody.innerHTML = '';

  if (!filtered.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" style="padding:24px;text-align:center;color:#64748b;">Nenhum registro corresponde aos filtros selecionados.</td>`;
    tbody.appendChild(tr);
    $('carteiraAuditSummaryText').textContent = 'Exibindo 0 registros';
    return;
  }

  $('carteiraAuditSummaryText').textContent = `Exibindo ${filtered.length} de ${carteiraAuditItems.length} registros`;

  filtered.forEach(item => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-neutral';
    if (item.status === 'ja_vinculado') {
      badgeClass = 'badge-ok';
    } else if (item.status === 'disponivel_para_vincular') {
      badgeClass = 'badge-warn';
    } else if (item.status === 'usuario_nao_localizado') {
      badgeClass = 'badge-warn';
    } else if (item.status === 'nao_localizado') {
      badgeClass = 'badge-danger';
    }

    const nomeMapeado = item.usuarioNome || findCarteiraUser(item.responsavel)?.nome || '';

    tr.innerHTML = `
      <td style="color:#94a3b8;">${item.linha || '--'}</td>
      <td>
        <div style="font-weight:600;color:#1e293b;">${escapeHtml(item.responsavel)}</div>
        ${nomeMapeado ? `<div style="font-size:11.5px;color:#0f766e;font-weight:500;">${escapeHtml(nomeMapeado)}</div>` : ''}
      </td>
      <td style="color:#334155;">${escapeHtml(item.empresa)}</td>
      <td style="font-family:var(--font-mono);font-size:12px;color:#0f766e;">${escapeHtml(item.cnpjFormatado || item.cnpj)}</td>
      <td>
        <span class="nav-badge ${badgeClass}" style="padding:2px 8px;border-radius:12px;display:inline-block;font-size:11px;">
          ${escapeHtml(item.situacao)}
        </span>
      </td>
      <td style="color:#64748b;">${escapeHtml(item.colunaGclick || '—')}</td>
      <td style="font-size:12px;color:#64748b;">${escapeHtml(item.detalhe || '')}</td>
    `;
    tbody.appendChild(tr);
  });
}

$('carteiraAuditUserFilter')?.addEventListener('change', renderCarteiraAuditTable);
$('carteiraAuditSearch')?.addEventListener('input', renderCarteiraAuditTable);
$('carteiraAuditStatusFilter')?.addEventListener('change', renderCarteiraAuditTable);

$('btnVincularCarteira')?.addEventListener('click', async () => {
  const acc = currentAccount();
  if (!acc) return;

  const origem = $('carteiraVincularOrigem')?.value || 'mesmo_cargo';
  const pendentes = carteiraPendentes(origem);
  if (!pendentes.length) {
    toast.info(`Não há clientes disponíveis em ${CARTEIRA_ORIGEM_LABEL[origem]}.`);
    return;
  }

  const porResp = {};
  pendentes.forEach(p => {
    if (!porResp[p.responsavel]) porResp[p.responsavel] = [];
    porResp[p.responsavel].push(p.cnpj);
  });

  const confirmMsg = `Confirma a vinculação de ${pendentes.length} cliente(s) para ${Object.keys(porResp).length} usuário(s) no G-Click, a partir de "${CARTEIRA_ORIGEM_LABEL[origem]}"? O robô marcará os checkboxes nessa coluna e clicará no "<- Vincular" dela.`;
  if (!confirm(confirmMsg)) return;

  await withButtonLoading('btnVincularCarteira', 'Vinculando no G-Click...', async () => {
    try {
      let totalVinculados = 0;
      for (const [resp, cnpjs] of Object.entries(porResp)) {
        const res = await fetch('/api/carteira/vincular', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: acc,
            responsavel: resp,
            cnpjs,
            origem
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Falha ao vincular clientes para ${resp}`);
        }
        totalVinculados += data.verifiedCount || data.markedCount || 0;
      }

      toast.success(`${totalVinculados} cliente(s) vinculados com sucesso no G-Click!`, 'Vinculação Concluída');
      loadCarteiraOperacoes();
      $('btnAuditCarteira')?.click();
    } catch (err) {
      toast.error(err.message, 'Erro ao Vincular');
      loadCarteiraOperacoes();
    }
  });
});

$('btnExportCarteiraCsv')?.addEventListener('click', async () => {
  const acc = currentAccount();
  if (!carteiraAuditItems.length) {
    toast.warning('Execute a conferência antes de exportar.');
    return;
  }

  try {
    const res = await fetch('/api/carteira/audit/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: acc,
        items: carteiraAuditItems
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao exportar.');

    const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = data.filename || 'auditoria-carteira.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
    toast.success('Relatório CSV baixado com sucesso!');
  } catch (err) {
    toast.error(err.message, 'Erro ao Exportar');
  }
});



// ==============================================================================
// MÓDULO: CADASTRO DE RESPOSTAS DA ENQUETE (CONFERÊNCIA E GRAVAÇÃO EM LOTE)
// ==============================================================================

let currentEnqueteComparison = null;
let currentEnqueteCategories = [];
let enqueteProgressInterval = null;

async function loadEnqueteCadastroSection() {
  if (currentEnqueteComparison) {
    renderEnqueteCadastroTable(currentEnqueteComparison);
    return;
  }
  await triggerEnqueteConferencia();
}

async function triggerEnqueteConferencia() {
  const acc = currentAccount() || '3032';
  const sheetInput = $('enqueteModelSheetUrl');
  const sheetUrl = sheetInput ? sheetInput.value.trim() : '';

  const btnConferir = $('btnEnqueteConferir');
  if (btnConferir) {
    btnConferir.disabled = true;
    btnConferir.innerHTML = '<span>⏳</span> Conferindo...';
  }

  const tbody = $('tbodyEnqueteCadastro');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">
      <div style="display:inline-block;animation:spin 1s linear infinite;margin-bottom:8px;">⏳</div>
      <div>Comparando planilha modelo com a Enquete da conta <strong>${acc}</strong>...</div>
    </td></tr>`;
  }

  try {
    const query = new URLSearchParams({ accountId: acc });
    if (sheetUrl) query.set('sheetUrl', sheetUrl);

    const res = await fetch(`/api/enquete/conferencia?${query.toString()}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Falha ao carregar conferência da Enquete.');

    currentEnqueteComparison = data.comparison;
    currentEnqueteCategories = data.categories || ['Fiscal - Ramo', 'Fiscal', 'Dpto. Pessoal', 'Financeiro', 'Contábil', 'Sem Categoria'];

    // Atualiza métricas
    if ($('metricTotalPerguntas')) $('metricTotalPerguntas').textContent = data.comparison.totalPerguntas || 0;
    if ($('metricTotalRespostas')) $('metricTotalRespostas').textContent = data.comparison.totalRespostas || 0;
    if ($('metricRespostasExistentes')) $('metricRespostasExistentes').textContent = data.comparison.respostasJaExistem || 0;
    if ($('metricRespostasFaltantes')) $('metricRespostasFaltantes').textContent = data.comparison.respostasFaltantes || 0;

    renderEnqueteCadastroTable(currentEnqueteComparison);
    toast.success(`Conferência concluída: ${data.comparison.respostasFaltantes} resposta(s) faltante(s) identificada(s).`, 'Enquete Sincronizada');
  } catch (err) {
    toast.error(err.message, 'Erro na Conferência');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#dc2626;">
        ⚠️ ${err.message}
      </td></tr>`;
    }
  } finally {
    if (btnConferir) {
      btnConferir.disabled = false;
      btnConferir.innerHTML = '<span>🔍</span> Carregar e Conferir';
    }
  }
}

function renderEnqueteCadastroTable(comparison) {
  const tbody = $('tbodyEnqueteCadastro');
  if (!tbody || !comparison || !comparison.items) return;

  const filterStatus = document.querySelector('input[name="enqueteFilterStatus"]:checked')?.value || 'all';
  const searchTerm = ($('enqueteSearchInput')?.value || '').toLowerCase().trim();

  const filtered = comparison.items.filter(item => {
    if (filterStatus === 'faltante' && item.status !== 'faltante') return false;
    if (filterStatus === 'ja_existe' && item.status !== 'ja_existe') return false;
    if (searchTerm) {
      const matchP = item.pergunta.toLowerCase().includes(searchTerm);
      const matchR = item.resposta.toLowerCase().includes(searchTerm);
      const matchG = item.grupo.toLowerCase().includes(searchTerm);
      if (!matchP && !matchR && !matchG) return false;
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted);">
      Nenhum registro encontrado para os filtros selecionados.
    </td></tr>`;
    updateSelectedCadastroCount();
    return;
  }

  let html = '';
  filtered.forEach((item, fIdx) => {
    const isFaltante = item.status === 'faltante';
    const isMatched = item.perguntaMatched;
    const badgeStatus = isFaltante
      ? `<span class="badge-cad badge-cad-faltante">⚠️ Faltante</span>`
      : `<span class="badge-cad badge-cad-existente">✓ Já Existe</span>`;

    const simScore = item.perguntaScore ? Math.round(item.perguntaScore * 100) : 0;
    const badgeSim = item.perguntaMatchNome && item.perguntaMatchNome !== item.pergunta
      ? `<br><small class="badge-cad badge-cad-sim" title="Similaridade com o modelo: ${simScore}%">~ ${simScore}% similar: "${item.perguntaMatchNome}"</small>`
      : '';

    const catOptions = currentEnqueteCategories.map(cat => {
      const sel = cat === item.categoriaSugerida ? 'selected' : '';
      return `<option value="${cat}" ${sel}>${cat}</option>`;
    }).join('');

    const chkDisabled = !isFaltante || !isMatched ? 'disabled' : '';
    const btnDisabled = !isFaltante || !isMatched ? 'disabled' : '';

    html += `
      <tr data-fidx="${fIdx}" data-pergunta-id="${item.perguntaId || ''}">
        <td style="text-align:center;">
          <input type="checkbox" class="chk-cad-item" ${chkDisabled} data-fidx="${fIdx}" ${isFaltante && isMatched ? 'checked' : ''}>
        </td>
        <td style="font-size:12px;color:var(--text-muted);font-weight:600;">${item.grupo}</td>
        <td style="font-size:12.5px;font-weight:600;color:var(--text-main);">${item.pergunta}</td>
        <td style="font-size:12px;">
          ${isMatched ? `<strong>${item.perguntaMatchNome}</strong> (ID: ${item.perguntaId})` : '<em style="color:#dc2626;">Não encontrada no G-Click</em>'}
          ${badgeSim}
        </td>
        <td style="font-size:12.5px;font-weight:700;color:#1e293b;">${item.resposta}</td>
        <td>${badgeStatus}</td>
        <td>
          <select class="cat-select-cell select-item-categoria" ${chkDisabled} data-fidx="${fIdx}">
            ${catOptions}
          </select>
        </td>
        <td style="text-align:right;">
          <button type="button" class="btn btn-secondary btn-sm btn-cadastrar-single" ${btnDisabled} data-fidx="${fIdx}">
            Cadastrar
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  attachEnqueteCadastroRowEvents(filtered);
  updateSelectedCadastroCount();
}

function attachEnqueteCadastroRowEvents(filteredItems) {
  const tbody = $('tbodyEnqueteCadastro');
  if (!tbody) return;

  tbody.querySelectorAll('.chk-cad-item').forEach(chk => {
    chk.addEventListener('change', () => {
      updateSelectedCadastroCount();
    });
  });

  tbody.querySelectorAll('.btn-cadastrar-single').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fIdx = parseInt(btn.dataset.fidx, 10);
      const item = filteredItems[fIdx];
      if (!item) return;

      const row = btn.closest('tr');
      const catSelect = row ? row.querySelector('.select-item-categoria') : null;
      const categoria = catSelect ? catSelect.value : item.categoriaSugerida;

      const payloadItem = {
        questionRef: item.perguntaId,
        questionNome: item.perguntaMatchNome || item.pergunta,
        perguntaId: item.perguntaId,
        perguntaNome: item.perguntaMatchNome || item.pergunta,
        answerName: item.resposta,
        resposta: item.resposta,
        categoriaName: categoria,
        categoria: categoria
      };

      await executeCadastrarRespostas([payloadItem]);
    });
  });
}

function updateSelectedCadastroCount() {
  const checkboxes = document.querySelectorAll('.chk-cad-item:checked:not(:disabled)');
  const count = checkboxes.length;
  if ($('countSelectedCad')) $('countSelectedCad').textContent = count;
  if ($('btnCadastrarRespostasSelecionadas')) {
    $('btnCadastrarRespostasSelecionadas').disabled = count === 0;
  }
}

async function executeCadastrarRespostas(itemsToRegister) {
  const acc = currentAccount() || '3032';
  if (!itemsToRegister || !itemsToRegister.length) {
    toast.warning('Nenhuma resposta selecionada para cadastro.');
    return;
  }

  // Prepara painel de progresso
  const panel = $('enqueteProgressPanel');
  const bar = $('enqueteProgressBar');
  const percentText = $('enqueteProgressPercent');
  const titleText = $('enqueteProgressTitle');
  const logsEl = $('enqueteProgressLogs');

  if (panel) panel.hidden = false;
  if (bar) bar.style.width = '0%';
  if (percentText) percentText.textContent = '0%';
  if (titleText) titleText.textContent = `Cadastrando ${itemsToRegister.length} resposta(s) no G-Click...`;
  if (logsEl) logsEl.innerHTML = `<div style="color:#0284c7;">[${new Date().toLocaleTimeString('pt-BR')}] Iniciando lote de ${itemsToRegister.length} resposta(s)...</div>`;

  const btnBatch = $('btnCadastrarRespostasSelecionadas');
  if (btnBatch) btnBatch.disabled = true;

  // Inicia polling de progresso
  if (enqueteProgressInterval) clearInterval(enqueteProgressInterval);
  enqueteProgressInterval = setInterval(async () => {
    try {
      const pRes = await fetch('/api/enquete/progresso');
      if (pRes.ok) {
        const pData = await pRes.json();
        const p = pData.progress;
        if (p && p.total > 0) {
          const pct = Math.round((p.current / p.total) * 100);
          if (bar) bar.style.width = `${pct}%`;
          if (percentText) percentText.textContent = `${pct}% (${p.current}/${p.total})`;
          if (titleText) titleText.textContent = p.message || 'Processando...';
          if (logsEl && p.logs && p.logs.length) {
            logsEl.innerHTML = p.logs.map(l => `<div>${l}</div>`).join('');
            logsEl.scrollTop = logsEl.scrollHeight;
          }
        }
      }
    } catch { /* ignora erro transitório no polling */ }
  }, 1000);

  try {
    const res = await fetch('/api/enquete/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: acc,
        items: itemsToRegister
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao executar cadastro de respostas.');

    clearInterval(enqueteProgressInterval);
    if (bar) bar.style.width = '100%';
    if (percentText) percentText.textContent = '100%';
    if (titleText) titleText.textContent = `Concluído: ${data.results.length} resposta(s) processada(s)!`;

    const criadas = data.results.filter(r => r.created).length;
    const vinculadas = data.results.filter(r => r.attached).length;
    toast.success(`${vinculadas} resposta(s) vinculadas (${criadas} novas criadas) na conta ${acc}!`, 'Cadastro Concluído');

    // Recarrega a conferência para atualizar a tela
    await triggerEnqueteConferencia();
  } catch (err) {
    clearInterval(enqueteProgressInterval);
    toast.error(err.message, 'Erro no Cadastro');
    if (titleText) titleText.textContent = `Erro: ${err.message}`;
    if (logsEl) {
      logsEl.innerHTML += `<div style="color:#dc2626;">[${new Date().toLocaleTimeString('pt-BR')}] ERRO: ${err.message}</div>`;
    }
  } finally {
    if (btnBatch) btnBatch.disabled = false;
  }
}

// Event Listeners da Seção Enquete Cadastro
$('btnEnqueteConferir')?.addEventListener('click', triggerEnqueteConferencia);

$('selectAllEnqueteFaltantes')?.addEventListener('change', (e) => {
  const isChecked = e.target.checked;
  document.querySelectorAll('.chk-cad-item:not(:disabled)').forEach(chk => {
    chk.checked = isChecked;
  });
  updateSelectedCadastroCount();
});

document.querySelectorAll('input[name="enqueteFilterStatus"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (currentEnqueteComparison) renderEnqueteCadastroTable(currentEnqueteComparison);
  });
});

$('enqueteSearchInput')?.addEventListener('input', () => {
  if (currentEnqueteComparison) renderEnqueteCadastroTable(currentEnqueteComparison);
});

$('btnCadastrarRespostasSelecionadas')?.addEventListener('click', async () => {
  if (!currentEnqueteComparison) return;
  const tbody = $('tbodyEnqueteCadastro');
  if (!tbody) return;

  const checkedBoxes = Array.from(tbody.querySelectorAll('.chk-cad-item:checked:not(:disabled)'));
  if (!checkedBoxes.length) {
    toast.warning('Selecione ao menos uma resposta para cadastrar.');
    return;
  }

  const items = checkedBoxes.map(chk => {
    const fIdx = parseInt(chk.dataset.fidx, 10);
    const row = chk.closest('tr');
    const catSelect = row ? row.querySelector('.select-item-categoria') : null;
    const filterStatus = document.querySelector('input[name="enqueteFilterStatus"]:checked')?.value || 'all';
    const searchTerm = ($('enqueteSearchInput')?.value || '').toLowerCase().trim();

    const filtered = currentEnqueteComparison.items.filter(item => {
      if (filterStatus === 'faltante' && item.status !== 'faltante') return false;
      if (filterStatus === 'ja_existe' && item.status !== 'ja_existe') return false;
      if (searchTerm) {
        const matchP = item.pergunta.toLowerCase().includes(searchTerm);
        const matchR = item.resposta.toLowerCase().includes(searchTerm);
        const matchG = item.grupo.toLowerCase().includes(searchTerm);
        if (!matchP && !matchR && !matchG) return false;
      }
      return true;
    });

    const item = filtered[fIdx] || currentEnqueteComparison.items[fIdx];
    return {
      questionRef: item.perguntaId,
      questionNome: item.perguntaMatchNome || item.pergunta,
      perguntaId: item.perguntaId,
      perguntaNome: item.perguntaMatchNome || item.pergunta,
      answerName: item.resposta,
      resposta: item.resposta,
      categoriaName: catSelect ? catSelect.value : item.categoriaSugerida,
      categoria: catSelect ? catSelect.value : item.categoriaSugerida
    };
  });

  await executeCadastrarRespostas(items);
});

$('topAccountPill')?.addEventListener('click', () => switchSection('connection'));
$('btnTopHelp')?.addEventListener('click', () => switchSection('help'));
if ($('sidebarLocal')) {
  $('sidebarLocal').textContent = location.port
    ? `Servidor local · porta ${location.port}`
    : `JB Consultoria · ${location.hostname}`;
}

// ============================================================================
// MÓDULO: VALIDA PDF (G-CLICK PDF LAYOUT)
// ============================================================================
let validaPdfModels = [];
let validaPdfResults = [];
let validaPdfDuplicates = null;
let currentValidaChip = 'all';
let currentInspectedResult = null;
let validaPdfInitialized = false;
let currentMapPdfBase64 = null;
let currentMapPdfPath = null;
let currentMapPdfLines = [];
let selectedValidaPdfPaths = new Set();
let isBatchUploadJobRunning = false;
let shouldCancelBatchUploadJob = false;

function switchValidaChip(chip, syncSelect = true) {
  currentValidaChip = chip || 'all';

  const chips = [
    { id: 'chipValidaAll', key: 'all' },
    { id: 'chipValidaReady', key: 'ready' },
    { id: 'chipValidaNeedsMap', key: 'needs_map' },
    { id: 'chipValidaNoClient', key: 'no_client' },
    { id: 'chipValidaValid', key: 'valid' },
    { id: 'chipValidaPending', key: 'pending' },
    { id: 'chipValidaDupes', key: 'dupes' },
    { id: 'chipValidaModels', key: 'models' }
  ];

  chips.forEach(c => {
    const el = $(c.id);
    if (!el) return;
    if (c.key === currentValidaChip) {
      el.classList.add('btn-chip-active');
      el.classList.remove('btn-ghost');
    } else {
      el.classList.remove('btn-chip-active');
      el.classList.add('btn-ghost');
    }
  });

  if (syncSelect && $('validaFilterGclick')) {
    const validSelectKeys = ['all', 'ready', 'needs_map', 'no_client', 'dupes'];
    if (validSelectKeys.includes(currentValidaChip)) {
      $('validaFilterGclick').value = currentValidaChip;
    } else {
      $('validaFilterGclick').value = 'all';
    }
  }

  const wrapResults = $('wrapValidaResultsTable');
  const wrapDupes = $('wrapValidaDuplicatesView');
  const wrapModels = $('wrapValidaModelsTable');

  if (currentValidaChip === 'dupes') {
    if (wrapResults) wrapResults.hidden = true;
    if (wrapDupes) wrapDupes.hidden = false;
    if (wrapModels) wrapModels.hidden = true;
    renderValidaPdfDuplicatesView();
  } else if (currentValidaChip === 'models') {
    if (wrapResults) wrapResults.hidden = true;
    if (wrapDupes) wrapDupes.hidden = true;
    if (wrapModels) wrapModels.hidden = false;
    renderValidaPdfModelsTable();
  } else {
    if (wrapResults) wrapResults.hidden = false;
    if (wrapDupes) wrapDupes.hidden = true;
    if (wrapModels) wrapModels.hidden = true;
    renderValidaPdfResultsTable();
  }
}

async function loadValidaPdfSection() {
  if (!validaPdfInitialized) {
    setupValidaPdfListeners();
    validaPdfInitialized = true;
  }

  const accountId = currentAccount() || '6019';
  if (!validaPdfModels.length) {
    try {
      const res = await api('valida-pdf/models', { accountId });
      validaPdfModels = res.models || [];
    } catch (err) {
      console.warn('Não foi possível carregar modelos locais do Valida PDF:', err);
    }
  }

  const count = validaPdfModels.length || 184;
  if ($('validaPdfMetricModels')) $('validaPdfMetricModels').textContent = count;
  if ($('validaModelsTabBadge')) $('validaModelsTabBadge').textContent = count;
  if ($('navBadgeValidaPdfModels')) $('navBadgeValidaPdfModels').textContent = count;

  renderValidaPdfModelsTable();
  renderValidaPdfResultsTable();
}

function getModelStatusBadge(statusCode, statusText) {
  if (statusCode === 'configurado' || (statusText && /já está configurado|sendo usado/i.test(statusText))) {
    return `<span class="tag-pill" style="font-size:11px;font-weight:600;background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;" title="${escapeHtml(statusText || 'Configurado')}">🟢 Ativo / Pronto</span>`;
  }
  if (statusCode === 'pendente_campos' || (statusText && /configure os campos/i.test(statusText))) {
    return `<span class="tag-pill" style="font-size:11px;font-weight:600;background:#fef9c3;color:#854d0e;border:1px solid #fef08a;" title="${escapeHtml(statusText || 'Pendente de campos')}">🟡 Falta Configurar</span>`;
  }
  if (statusCode === 'sem_arquivo' || (statusText && /anexe um arquivo/i.test(statusText))) {
    return `<span class="tag-pill" style="font-size:11px;font-weight:600;background:#fee2e2;color:#991b1b;border:1px solid #fecaca;" title="${escapeHtml(statusText || 'Sem arquivo')}">🔴 Sem Arquivo</span>`;
  }
  return `<span class="tag-pill" style="font-size:11px;background:#f1f5f9;color:#64748b;">${escapeHtml(statusText || 'Pendente')}</span>`;
}

function getDeptoBadge(depto) {
  const d = (depto || '').toLowerCase();
  let bg = '#f1f5f9', color = '#334155', border = '#e2e8f0';
  if (d.includes('pessoal') || d.includes('dp')) { bg = '#eff6ff'; color = '#1d4ed8'; border = '#bfdbfe'; }
  else if (d.includes('fiscal')) { bg = '#f5f3ff'; color = '#6d28d9'; border = '#ddd6fe'; }
  else if (d.includes('contab')) { bg = '#f0fdf4'; color = '#15803d'; border = '#bbf7d0'; }
  else if (d.includes('financ')) { bg = '#fffbeb'; color = '#b45309'; border = '#fde68a'; }
  else if (d.includes('admin')) { bg = '#f8fafc'; color = '#475569'; border = '#cbd5e1'; }
  return `<span class="tag-pill" style="font-size:11px;font-weight:600;background:${bg};color:${color};border:1px solid ${border};">${escapeHtml(depto || 'Geral')}</span>`;
}

function renderValidaPdfModelsTable() {
  const tbody = $('validaModelsBody');
  if (!tbody) return;

  const searchTerm = ($('validaModelSearch')?.value || '').toLowerCase().trim();
  const deptoFilter = $('validaModelDeptoFilter')?.value || '';
  const statusFilter = $('validaModelStatusFilter')?.value || '';

  // Atualiza contadores KPI da aba Modelos
  const total = validaPdfModels.length;
  const configurados = validaPdfModels.filter(m => m.statusCode === 'configurado' || /já está configurado|sendo usado/i.test(m.status || '')).length;
  const pendentes = validaPdfModels.filter(m => m.statusCode === 'pendente_campos' || /configure os campos/i.test(m.status || '')).length;
  const semArquivo = validaPdfModels.filter(m => m.statusCode === 'sem_arquivo' || /anexe um arquivo/i.test(m.status || '')).length;
  const comObrig = validaPdfModels.filter(m => Boolean(m.obrigacao)).length;

  if ($('statModelsTotal')) $('statModelsTotal').textContent = total;
  if ($('statModelsConfigurados')) $('statModelsConfigurados').textContent = configurados;
  if ($('statModelsPendentes')) $('statModelsPendentes').textContent = pendentes;
  if ($('statModelsSemArquivo')) $('statModelsSemArquivo').textContent = semArquivo;
  if ($('statModelsComObrigacao')) $('statModelsComObrigacao').textContent = comObrig;

  const filtered = validaPdfModels.filter(m => {
    const sCode = m.statusCode || (
      /já está configurado|sendo usado/i.test(m.status || '') ? 'configurado' :
      /configure os campos/i.test(m.status || '') ? 'pendente_campos' :
      /anexe um arquivo/i.test(m.status || '') ? 'sem_arquivo' : 'outro'
    );
    if (statusFilter && sCode !== statusFilter) return false;
    if (deptoFilter && m.departamento !== deptoFilter) return false;
    if (searchTerm) {
      const matchId = String(m.id || m.modelId || '').toLowerCase().includes(searchTerm);
      const matchNome = (m.nome || m.modelo || '').toLowerCase().includes(searchTerm);
      const matchKw = (m.palavraChave || '').toLowerCase().includes(searchTerm);
      const matchObrig = (m.obrigacao || m.atividade || '').toLowerCase().includes(searchTerm);
      const matchDepto = (m.departamento || '').toLowerCase().includes(searchTerm);
      const matchStatus = (m.status || '').toLowerCase().includes(searchTerm);
      if (!matchId && !matchNome && !matchKw && !matchObrig && !matchDepto && !matchStatus) return false;
    }
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:28px;color:#64748b;">
          Nenhum modelo encontrado para os filtros aplicados.
        </td>
      </tr>
    `;
    if ($('validaModelsCount')) $('validaModelsCount').textContent = 'Exibindo 0 modelos';
    return;
  }

  const accountId = currentAccount() || '6019';

  tbody.innerHTML = filtered.map(m => {
    const idVal = m.id || m.modelId || m.num || '-';
    const nomeVal = m.nome || m.modelo || '-';
    const linkVal = m.link || (idVal !== '-' ? `https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=${encodeURIComponent(idVal)}&empId=${encodeURIComponent(accountId)}` : '#');
    const isReady = m.statusCode === 'configurado' || /já está configurado|sendo usado/i.test(m.status || '');

    // Palavra-chave (Pilar 1)
    let pilar1Html = '<span style="color:#94a3b8;font-size:11.5px;">Aguardando config</span>';
    if (m.palavraChave) {
      pilar1Html = `<strong style="font-family:var(--font-mono);font-size:11.5px;color:#0f766e;">${escapeHtml(m.palavraChave)}</strong>`;
    } else if (isReady) {
      pilar1Html = `<span style="font-family:var(--font-mono);font-size:11.5px;color:#0f766e;">${escapeHtml(nomeVal)}</span>`;
    }

    // Inscrição (Pilar 2)
    let pilar2Html = '<span style="color:#94a3b8;font-size:11px;">-</span>';
    if (m.tipoInscricao) {
      pilar2Html = `<span class="nav-badge badge-neutral" style="font-size:10.5px;">${escapeHtml(m.tipoInscricao)}</span>`;
    } else if (isReady) {
      pilar2Html = `<span class="nav-badge badge-neutral" style="font-size:10.5px;">CNPJ / CPF</span>`;
    }

    // Competência (Pilar 3)
    let pilar3Html = '<span style="color:#94a3b8;font-size:11px;">-</span>';
    if (m.competencia) {
      pilar3Html = `<span class="tag-pill" style="font-size:10.5px;">${escapeHtml(m.competencia)}</span>`;
    } else if (isReady) {
      pilar3Html = `<span class="tag-pill" style="font-size:10.5px;">MM/AAAA</span>`;
    }

    // Obrigação vinculada
    let obrigHtml = '<span style="color:#94a3b8;font-size:11.5px;font-style:italic;">Não vinculada</span>';
    if (m.obrigacao) {
      obrigHtml = `
        <div style="font-size:12px;color:#1e293b;font-weight:500;">${escapeHtml(m.obrigacao)}</div>
        ${m.atividade ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(m.atividade)}</div>` : ''}
      `;
    }

    return `
      <tr>
        <td style="font-family:var(--font-mono);font-size:12px;color:#0f766e;font-weight:600;">#${escapeHtml(idVal)}</td>
        <td>
          <strong style="color:#0f172a;font-size:13px;">${escapeHtml(nomeVal)}</strong>
          ${m.multilinhas ? '<span title="Configurado com busca em multilinhas variáveis" style="margin-left:4px;font-size:10px;background:#e2e8f0;color:#475569;padding:1px 4px;border-radius:3px;">linhas+</span>' : ''}
        </td>
        <td>${getDeptoBadge(m.departamento)}</td>
        <td>${getModelStatusBadge(m.statusCode, m.status)}</td>
        <td>${pilar1Html}</td>
        <td>${pilar2Html}</td>
        <td>${pilar3Html}</td>
        <td>${obrigHtml}</td>
        <td style="text-align:center;">
          <div style="display:inline-flex;gap:4px;align-items:center;">
            <a href="${escapeHtml(linkVal)}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-secondary" style="padding:4px 8px;font-size:11px;text-decoration:none;display:inline-flex;align-items:center;gap:3px;" title="Abrir configuração do layout no G-Click">
              <span>↗</span> Abrir
            </a>
            <button type="button" class="btn btn-xs btn-ghost btn-view-model-detail" data-model-id="${escapeHtml(idVal)}" style="padding:4px 6px;font-size:11px;cursor:pointer;" title="Ver detalhes e regras dos 3 pilares">
              <span>ℹ️</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Atribui evento aos botões de detalhes
  tbody.querySelectorAll('.btn-view-model-detail').forEach(btn => {
    btn.addEventListener('click', () => {
      const mId = btn.getAttribute('data-model-id');
      if (mId) openValidaModelDetailModal(mId);
    });
  });

  if ($('validaModelsCount')) {
    $('validaModelsCount').textContent = `Exibindo ${filtered.length} de ${validaPdfModels.length} modelos cadastrados no G-Click`;
  }
}

async function openValidaModelDetailModal(modelId) {
  const modal = $('modalValidaModelDetail');
  if (!modal) return;

  const accountId = currentAccount() || '6019';
  const model = validaPdfModels.find(m => String(m.id || m.modelId || m.num) === String(modelId));
  const modelName = model?.nome || model?.modelo || `Modelo #${modelId}`;

  if ($('modalModelDetailTitle')) $('modalModelDetailTitle').textContent = modelName;
  if ($('modalModelDetailId')) $('modalModelDetailId').textContent = `#${modelId}`;
  if ($('modalModelDetailDepto')) $('modalModelDetailDepto').textContent = model?.departamento || 'Geral';
  if ($('modalModelDetailObrigacao')) $('modalModelDetailObrigacao').textContent = model?.obrigacao || 'Não vinculada';
  if ($('modalModelDetailMultilinhas')) $('modalModelDetailMultilinhas').textContent = model?.multilinhas ? 'Sim (Ativado)' : 'Não';

  const link = model?.link || `https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=${encodeURIComponent(modelId)}&empId=${encodeURIComponent(accountId)}`;
  if ($('btnModalOpenInGclick')) $('btnModalOpenInGclick').href = link;

  // Banner de status
  const banner = $('modalModelDetailStatusBanner');
  if (banner) {
    const isConfig = model?.statusCode === 'configurado' || /já está configurado|sendo usado/i.test(model?.status || '');
    if (isConfig) {
      banner.style.background = '#dcfce7';
      banner.style.border = '1px solid #bbf7d0';
      banner.style.color = '#15803d';
      banner.innerHTML = `<strong>🟢 Modelo Configurado & Pronto:</strong> ${escapeHtml(model?.status || 'Este modelo já está configurado e sendo usado para validação no G-Click.')}`;
    } else {
      banner.style.background = '#fef9c3';
      banner.style.border = '1px solid #fef08a';
      banner.style.color = '#854d0e';
      banner.innerHTML = `<strong>⚠️ Status:</strong> ${escapeHtml(model?.status || 'Pendente de configuração dos campos ou anexo de arquivo no G-Click.')}`;
    }
  }

  // Preenche pilares (valores padrão ou inspecionados)
  if ($('modalModelDetailPilar1Val')) $('modalModelDetailPilar1Val').textContent = model?.palavraChave || modelName;
  if ($('modalModelDetailPilar1Line')) $('modalModelDetailPilar1Line').textContent = model?.pilar1?.linha ? `Linha ${model.pilar1.linha}` : 'Linha variável';

  if ($('modalModelDetailPilar2Val')) $('modalModelDetailPilar2Val').textContent = model?.tipoInscricao || 'CNPJ / CPF';
  if ($('modalModelDetailPilar2Line')) $('modalModelDetailPilar2Line').textContent = model?.pilar2?.linha ? `Linha ${model.pilar2.linha}` : 'Linha variável';

  if ($('modalModelDetailPilar3Val')) $('modalModelDetailPilar3Val').textContent = model?.competencia || 'Mês/Ano (MM/AAAA)';
  if ($('modalModelDetailPilar3Line')) $('modalModelDetailPilar3Line').textContent = model?.pilar3?.linha ? `Linha ${model.pilar3.linha}` : 'Linha variável';

  modal.hidden = false;
}

function renderValidaPdfResultsTable() {
  const tbody = $('validaResultsBody');
  if (!tbody) return;

  const searchTerm = ($('validaFilterSearch')?.value || '').toLowerCase().trim();
  const gclickFilter = $('validaFilterGclick')?.value || currentValidaChip || 'all';
  const validacaoFilter = $('validaFilterValidacao')?.value || '';

  const getIsReady = (r) => {
    const sit = r.conciliacao?.situacaoGclick;
    const mod = r.conciliacao?.modelo;
    return sit === 'ja_no_gclick' || Boolean(r.valido && mod?.encontrado && mod?.isConfigurado && !r.conciliacao?.precisaMapear);
  };

  const getNeedsMap = (r) => {
    if (getIsReady(r)) return false;
    const sit = r.conciliacao?.situacaoGclick;
    const mod = r.conciliacao?.modelo;

    // Arquivos digitalizados/imagem sem OCR ou não passíveis de mapeamento são inválidos e NÃO devem aparecer em "Enviar & Mapear"
    if (sit === 'sem_ocr' || r.status === 'erro_extracao' || !r.regras?.extracaoTexto?.ok) {
      return false;
    }

    return sit === 'sem_modelo' || sit === 'modelo_pendente' || Boolean(r.conciliacao?.precisaMapear) || !mod?.encontrado || !mod?.isConfigurado;
  };

  const getNoClient = (r) => {
    const sit = r.conciliacao?.situacaoGclick;
    const cli = r.conciliacao?.cliente;
    return sit === 'cliente_nao_cadastrado' || Boolean(cli && !cli.encontrado && (r.regras?.identificacaoCliente?.cnpjs?.length || r.regras?.identificacaoCliente?.cpfs?.length));
  };

  const filtered = validaPdfResults.filter(r => {
    const mod = r.conciliacao?.modelo;
    const cli = r.conciliacao?.cliente;

    const isReady = getIsReady(r);
    const needsMap = getNeedsMap(r);
    const noClient = getNoClient(r);

    // 1. Filtro de Situação no G-Click (Chips do Topo ou Dropdown de Situação)
    if (gclickFilter === 'ready' && !isReady) return false;
    if (gclickFilter === 'needs_map' && !needsMap) return false;
    if (gclickFilter === 'no_client' && !noClient) return false;
    if (gclickFilter === 'dupes' && !r.duplicidade?.temDuplicidade) return false;

    // 2. Filtro Técnico de Validação do Documento / OCR
    if (validacaoFilter === 'valido' && !r.valido) return false;
    if (validacaoFilter === 'invalido' && r.valido) return false;
    if (validacaoFilter === 'erro_extracao' && r.status !== 'erro_extracao') return false;

    // 3. Filtro de Busca Textual
    if (searchTerm) {
      const matchFile = (r.fileName || '').toLowerCase().includes(searchTerm);
      const matchSub = (r.subpasta || r.relPath || '').toLowerCase().includes(searchTerm);
      const matchDoc = (r.regras?.nomeDocumento?.identificado || '').toLowerCase().includes(searchTerm) ||
                        (mod?.nome || '').toLowerCase().includes(searchTerm);
      const matchClient = (r.regras?.identificacaoCliente?.cnpjs || []).join(' ').toLowerCase().includes(searchTerm) ||
                          (r.regras?.identificacaoCliente?.cpfs || []).join(' ').toLowerCase().includes(searchTerm) ||
                          (cli?.nome || r.regras?.identificacaoCliente?.razaoSocial || '').toLowerCase().includes(searchTerm);
      const matchComp = (r.regras?.competencia?.competenciaDetectada || '').toLowerCase().includes(searchTerm);
      const matchGuia = (r.numDoc || '').toLowerCase().includes(searchTerm) ||
                        (r.valor || '').toLowerCase().includes(searchTerm);
      if (!matchFile && !matchSub && !matchDoc && !matchClient && !matchComp && !matchGuia) return false;
    }
    return true;
  });

  // Atualiza métricas e contadores de chips com rigor e exclusão mútua
  const total = validaPdfResults.length;
  const readyCount = validaPdfResults.filter(r => getIsReady(r)).length;
  const needsMapCount = validaPdfResults.filter(r => getNeedsMap(r)).length;
  const noClientCount = validaPdfResults.filter(r => getNoClient(r)).length;
  const validos = validaPdfResults.filter(r => r.valido).length;
  const invalidos = total - validos;
  const dupesCount = validaPdfDuplicates?.totalConflitos || 0;
  const modelsCount = validaPdfModels?.length || 184;

  if ($('validaPdfMetricTotal')) $('validaPdfMetricTotal').textContent = total;
  if ($('validaPdfMetricValid')) $('validaPdfMetricValid').textContent = validos;
  if ($('validaPdfMetricInvalid')) $('validaPdfMetricInvalid').textContent = invalidos;
  if ($('validaPdfMetricDupes')) $('validaPdfMetricDupes').textContent = dupesCount;
  if ($('validaPdfMetricModels')) $('validaPdfMetricModels').textContent = modelsCount;

  if ($('countChipAll')) $('countChipAll').textContent = total;
  if ($('countChipReady')) $('countChipReady').textContent = readyCount;
  if ($('countChipNeedsMap')) $('countChipNeedsMap').textContent = needsMapCount;
  if ($('countChipNoClient')) $('countChipNoClient').textContent = noClientCount;
  if ($('countChipValid')) $('countChipValid').textContent = validos;
  if ($('countChipPending')) $('countChipPending').textContent = invalidos;
  if ($('countChipDupes')) $('countChipDupes').textContent = dupesCount;
  if ($('countChipModels')) $('countChipModels').textContent = modelsCount;

  if ($('btnClearValidaResults')) $('btnClearValidaResults').style.display = total > 0 ? 'inline-block' : 'none';
  if ($('btnGenerateDiagnosticReport')) $('btnGenerateDiagnosticReport').style.display = total > 0 ? 'inline-flex' : 'none';
  if ($('btnBatchTestUploadGclick')) $('btnBatchTestUploadGclick').style.display = total > 0 ? 'inline-flex' : 'none';

  updateMappingValidatedFilesDropdown();
  updateValidaSelectionUI(filtered);

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:36px;color:#64748b;">
          ${total === 0
            ? 'Nenhum arquivo validado ainda. Informe uma pasta acima e clique em <strong>Analisar, Conciliar & Validar Pasta</strong> para começar.'
            : 'Nenhum arquivo corresponde aos filtros aplicados.'}
        </td>
      </tr>
    `;
    if ($('validaResultsCount')) $('validaResultsCount').textContent = `Exibindo 0 de ${total} registros`;
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => {
    const sit = r.conciliacao?.situacaoGclick;
    const mod = r.conciliacao?.modelo;
    const cli = r.conciliacao?.cliente;

    const isRowReady = getIsReady(r);
    const isRowNeedsMap = getNeedsMap(r);

    // Situação no G-Click Badge
    let sitBadge = '';
    if (isRowReady) {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#dcfce7;color:#15803d;font-weight:700;font-size:11.5px;border:1px solid #86efac;">
          <span>🟢</span> Já no G-Click
        </div>
        <div style="font-size:10.5px;color:#166534;font-weight:600;margin-top:2px;">
          🚀 Pronto p/ Envio
        </div>
      `;
    } else if (sit === 'sem_modelo' || !mod?.encontrado) {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#ffedd5;color:#c2410c;font-weight:700;font-size:11.5px;border:1px solid #fed7aa;">
          <span>🛠️</span> Falta Mapear
        </div>
        <div style="font-size:10.5px;color:#9a3412;margin-top:2px;font-weight:600;">
          Não está no G-Click
        </div>
      `;
    } else if (sit === 'modelo_pendente' || (mod?.encontrado && !mod?.isConfigurado)) {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#fef9c3;color:#854d0e;font-weight:700;font-size:11.5px;border:1px solid #fef08a;">
          <span>⚙️</span> Modelo Pendente
        </div>
        <div style="font-size:10.5px;color:#a16207;margin-top:2px;font-weight:600;">
          Falta mapear linhas
        </div>
      `;
    } else if (sit === 'cliente_nao_cadastrado') {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:11.5px;border:1px solid #fecaca;">
          <span>👤</span> Cliente não existe
        </div>
        <div style="font-size:10.5px;color:#b91c1c;margin-top:2px;">
          Cadastrar no G-Click
        </div>
      `;
    } else if (sit === 'sem_ocr' || r.status === 'erro_extracao') {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#f1f5f9;color:#475569;font-weight:600;font-size:11.5px;border:1px solid #cbd5e1;">
          <span>📷</span> Sem OCR
        </div>
        <div style="font-size:10.5px;color:#64748b;margin-top:2px;">
          Sem texto selecionável
        </div>
      `;
    } else if (sit === 'duplicata_identica') {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:11.5px;border:1px solid #fecaca;">
          <span>⚠️</span> Duplicata 100%
        </div>
      `;
    } else if (sit === 'conflito_retificacao') {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#fffbeb;color:#b45309;font-weight:700;font-size:11.5px;border:1px solid #fde68a;">
          <span>⚠️</span> Retificação
        </div>
      `;
    } else {
      sitBadge = `
        <div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:12px;background:#f8fafc;color:#475569;font-weight:600;font-size:11.5px;border:1px solid #e2e8f0;">
          <span>⚠️</span> ${escapeHtml(r.status || 'Pendente')}
        </div>
      `;
    }

    // Documento & Modelo G-Click
    const docIdentificado = r.regras?.nomeDocumento?.identificado || '<span style="color:#94a3b8;">Não identificado</span>';
    let modelDetailsHtml = '';
    if (mod?.encontrado) {
      const isOk = mod.isConfigurado;
      modelDetailsHtml = `
        <div style="font-size:11px;margin-top:3px;color:${isOk ? '#15803d' : '#854d0e'};display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <span>${isOk ? '✔' : '⚠️'} Modelo:</span>
          <strong>${escapeHtml(mod.nome || '')}</strong>
          ${mod.id ? `<span style="color:#64748b;">(#${mod.id})</span>` : ''}
        </div>
      `;
    } else {
      modelDetailsHtml = `
        <div style="font-size:11px;margin-top:3px;color:#c2410c;display:flex;align-items:center;gap:4px;">
          <span>❌</span> <em>Nenhum modelo cadastrado no G-Click</em>
        </div>
      `;
    }

    // Cliente (CNPJ / CPF)
    let clienteHtml = '';
    const cnpjs = r.regras?.identificacaoCliente?.cnpjs || [];
    const cnpjsBase = r.regras?.identificacaoCliente?.cnpjsBase || [];
    const cpfs = r.regras?.identificacaoCliente?.cpfs || [];
    const razao = cli?.nome || r.regras?.identificacaoCliente?.razaoSocial;

    if (cnpjs.length) {
      clienteHtml = `<span class="tag-pill" style="font-size:11px;background:#e0f2fe;color:#0369a1;">CNPJ ${escapeHtml(cnpjs[0])}</span>`;
    } else if (cnpjsBase.length) {
      clienteHtml = `<span class="tag-pill" style="font-size:11px;background:#f0fdf4;color:#15803d;">CNPJ Base ${escapeHtml(cnpjsBase[0])}</span>`;
    } else if (cpfs.length) {
      clienteHtml = `<span class="tag-pill" style="font-size:11px;background:#fef3c7;color:#b45309;">CPF ${escapeHtml(cpfs[0])}</span>`;
    } else {
      clienteHtml = '<span style="color:#94a3b8;">Não localizado</span>';
    }

    if (razao) {
      clienteHtml += `<div style="font-size:11px;color:#475569;margin-top:2px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(razao)}">${escapeHtml(razao)}</div>`;
    }

    const comp = r.regras?.competencia?.competenciaDetectada || '<span style="color:#94a3b8;">--</span>';

    // Guia / Valor / Vencimento
    let guiaHtml = '';
    if (r.valor) {
      guiaHtml += `<div style="font-weight:700;color:#0f766e;font-size:12px;">R$ ${escapeHtml(r.valor)}</div>`;
    }
    if (r.vencimento) {
      guiaHtml += `<div style="font-size:11px;color:#64748b;">Venc: ${escapeHtml(r.vencimento)}</div>`;
    }
    if (r.numDoc) {
      guiaHtml += `<div style="font-size:10.5px;color:#94a3b8;max-width:140px;overflow:hidden;text-overflow:ellipsis;" title="Doc/Guia: ${escapeHtml(r.numDoc)}">Nº: ${escapeHtml(r.numDoc)}</div>`;
    }
    if (!guiaHtml) {
      guiaHtml = '<span style="color:#94a3b8;font-size:11.5px;">--</span>';
    }

    const subpastaTag = r.subpasta
      ? `<div style="margin-top:3px;"><span class="tag-pill" style="font-size:10.5px;background:#f0fdfa;color:#0f766e;border:1px solid #ccfbf1;">📁 ${escapeHtml(r.subpasta)}</span></div>`
      : (r.relPath && r.relPath !== r.fileName ? `<div style="font-size:11px;color:#64748b;">${escapeHtml(r.relPath)}</div>` : '');

    // Ações
    let actionBtnHtml = '';
    if (sit === 'sem_ocr' || r.status === 'erro_extracao') {
      actionBtnHtml = `<button type="button" class="btn btn-secondary btn-sm" disabled title="Documentos escaneados sem OCR não possuem texto selecionável" style="font-size:11.5px;padding:4px 8px;margin-right:4px;opacity:0.6;cursor:not-allowed;">📷 Sem OCR</button>`;
    } else if (isRowReady) {
      actionBtnHtml = `
        <span class="tag-pill" style="font-size:11px;background:#dcfce7;color:#15803d;padding:4px 8px;font-weight:700;margin-right:4px;border:1px solid #bbf7d0;" title="Modelo ativo e configurado no G-Click">✔ Configurado</span>
        ${mod?.link ? `<a href="${escapeHtml(mod.link)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 6px;margin-right:4px;" title="Ver modelo no G-Click">G-Click ↗</a>` : ''}
      `;
    } else if (sit === 'sem_modelo' || !mod?.encontrado) {
      actionBtnHtml = `<button type="button" class="btn btn-warning btn-sm btn-map-pdf" data-idx="${idx}" title="Enviar este PDF e mapear os 3 pilares no G-Click" style="font-size:11.5px;padding:5px 10px;margin-right:4px;font-weight:700;background:#ea580c;color:#fff;border-color:#ea580c;box-shadow:0 1px 2px rgba(234,88,12,0.3);">🛠️ Enviar & Mapear</button>`;
    } else if (sit === 'modelo_pendente' || (mod?.encontrado && !mod?.isConfigurado)) {
      actionBtnHtml = `
        <button type="button" class="btn btn-warning btn-sm btn-map-pdf" data-idx="${idx}" title="Mapear linhas deste modelo no G-Click" style="font-size:11.5px;padding:5px 10px;margin-right:4px;font-weight:600;background:#d97706;color:#fff;border-color:#d97706;">⚙️ Mapear Linhas</button>
        ${mod?.link ? `<a href="${escapeHtml(mod.link)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px;padding:4px 6px;margin-right:4px;" title="Abrir no G-Click">G-Click ↗</a>` : ''}
      `;
    } else if (sit === 'cliente_nao_cadastrado') {
      actionBtnHtml = `<button type="button" class="btn btn-secondary btn-sm" style="font-size:11.5px;padding:4px 8px;margin-right:4px;color:#b91c1c;border-color:#fca5a5;" title="Cadastre este CNPJ no G-Click antes de enviar">👤 Falta Cliente</button>`;
    } else {
      actionBtnHtml = `<button type="button" class="btn btn-primary btn-sm btn-map-pdf" data-idx="${idx}" title="Mapear arquivo" style="font-size:11.5px;padding:4px 8px;margin-right:4px;">🛠️ Mapear</button>`;
    }

    return `
      <tr>
        <td style="text-align:center;vertical-align:middle;">
          <input type="checkbox" class="chk-valida-pdf-row" data-path="${escapeHtml(r.filePath || '')}" ${selectedValidaPdfPaths.has(r.filePath) ? 'checked' : ''} style="cursor:pointer;width:15px;height:15px;" ${r.status === 'erro_extracao' ? 'disabled' : ''}>
        </td>
        <td>${sitBadge}</td>
        <td>
          <div style="font-weight:600;font-size:13px;color:#1e293b;">${escapeHtml(r.fileName || 'arquivo.pdf')}</div>
          ${subpastaTag}
        </td>
        <td>
          <div style="font-size:12.5px;font-weight:500;">${docIdentificado}</div>
          ${modelDetailsHtml}
        </td>
        <td>${clienteHtml}</td>
        <td><strong style="font-size:12.5px;color:#1e293b;">${comp}</strong></td>
        <td>${guiaHtml}</td>
        <td style="text-align:right;white-space:nowrap;">
          ${actionBtnHtml}
          <button type="button" class="btn btn-secondary btn-sm btn-inspect-pdf" data-idx="${idx}" style="font-size:11.5px;padding:4px 8px;">
            🔍 Inspecionar
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Bind nos checkboxes individuais de cada linha
  tbody.querySelectorAll('.chk-valida-pdf-row').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const p = e.target.getAttribute('data-path');
      if (p) {
        if (e.target.checked) selectedValidaPdfPaths.add(p);
        else selectedValidaPdfPaths.delete(p);
      }
      updateValidaSelectionUI(filtered);
    });
  });

  if ($('validaResultsCount')) {
    $('validaResultsCount').textContent = `Exibindo ${filtered.length} de ${total} registros`;
  }
}

function updateValidaSelectionUI(filtered = null) {
  const badge = $('validaSelectedCountBadge');
  const btnBatch = $('btnBatchTestUploadGclick');
  const chkAll = $('chkValidaPdfSelectAll');

  const count = selectedValidaPdfPaths.size;
  if (badge) {
    if (count > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = `${count} selecionado${count > 1 ? 's' : ''}`;
    } else {
      badge.style.display = 'none';
    }
  }

  if (btnBatch && !isBatchUploadJobRunning) {
    if (count > 0) {
      btnBatch.innerHTML = `<span>⚡</span> Validar Selecionados (${count}) no Oráculo`;
      btnBatch.title = `Valida apenas os ${count} arquivos selecionados na tela /upload do G-Click`;
    } else {
      btnBatch.innerHTML = `<span>⚡</span> Validar no Oráculo G-Click`;
      btnBatch.title = `Valida os arquivos legíveis na tela oficial /upload do G-Click, 1 por vez com F5 a cada envio`;
    }
  }

  if (chkAll) {
    const list = filtered || validaPdfResults;
    const validCount = list.filter(r => r.filePath && r.status !== 'erro_extracao').length;
    const selectedVisible = list.filter(r => selectedValidaPdfPaths.has(r.filePath)).length;
    chkAll.checked = validCount > 0 && selectedVisible === validCount;
    chkAll.indeterminate = selectedVisible > 0 && selectedVisible < validCount;
  }
}

function updateMappingValidatedFilesDropdown() {
  const select = $('mapValidatedFilesSelect');
  if (!select) return;

  if (!validaPdfResults.length) {
    select.innerHTML = '<option value="">-- Nenhum arquivo validado disponível ainda --</option>';
    return;
  }

  const validFiles = validaPdfResults.map((r, idx) => ({ ...r, originalIdx: idx })).filter(r => r.valido);
  const invalidFiles = validaPdfResults.map((r, idx) => ({ ...r, originalIdx: idx })).filter(r => !r.valido);

  const options = ['<option value="">-- Selecione um arquivo validado para mapear --</option>'];

  if (validFiles.length) {
    options.push(`<optgroup label="✅ Arquivos Válidos para Mapeamento (${validFiles.length})">`);
    validFiles.forEach(r => {
      const doc = r.regras?.nomeDocumento?.identificado ? `[${r.regras.nomeDocumento.identificado}] ` : '';
      const sub = r.subpasta ? `📁 ${r.subpasta} / ` : '';
      const cnpj = r.regras?.identificacaoCliente?.cnpjs?.[0] ? ` · CNPJ ${r.regras.identificacaoCliente.cnpjs[0]}` : '';
      options.push(`<option value="${r.originalIdx}">✔ ${doc}${sub}${escapeHtml(r.fileName || 'arquivo.pdf')}${cnpj}</option>`);
    });
    options.push('</optgroup>');
  }

  if (invalidFiles.length) {
    options.push(`<optgroup label="⚠️ Inconsistentes / Imagem Sem OCR (${invalidFiles.length})">`);
    invalidFiles.forEach(r => {
      const tag = r.status === 'erro_extracao' ? '📷 Sem OCR' : '⚠️ Inconsistente';
      const sub = r.subpasta ? `📁 ${r.subpasta} / ` : '';
      options.push(`<option value="${r.originalIdx}">${tag} · ${sub}${escapeHtml(r.fileName || 'arquivo.pdf')}</option>`);
    });
    options.push('</optgroup>');
  }

  select.innerHTML = options.join('');
}

async function loadValidatedFileIntoMapping(item, itemIdx = null) {
  if (!item) return;

  currentMapPdfPath = item.filePath || null;
  currentMapPdfBase64 = item.fileBase64 || null;
  currentMapPdfLines = [];

  const fileName = item.fileName || 'arquivo.pdf';
  const subpastaInfo = item.subpasta ? ` (${item.subpasta})` : '';
  if ($('mapPdfFileName')) {
    $('mapPdfFileName').textContent = `📁 ${fileName}${subpastaInfo}`;
  }

  // Sugestão de Nome do Modelo
  const docIdentificado = item.regras?.nomeDocumento?.identificado;
  if ($('mapModelName')) {
    if (docIdentificado && !docIdentificado.includes('Não identificado')) {
      $('mapModelName').value = docIdentificado;
    } else {
      $('mapModelName').value = fileName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    }
  }

  // Sugestão de Departamento
  const searchStr = `${fileName} ${item.subpasta || ''} ${docIdentificado || ''}`.toLowerCase();
  if ($('mapModelDepto')) {
    if (searchStr.includes('folha') || searchStr.includes('recibo') || searchStr.includes('salario') || searchStr.includes('domestica') || searchStr.includes('pro abore') || searchStr.includes('ponto') || searchStr.includes('ferias') || searchStr.includes('rescisao')) {
      $('mapModelDepto').value = 'Departamento Pessoal';
    } else if (searchStr.includes('darf') || searchStr.includes('dctf') || searchStr.includes('fiscal') || searchStr.includes('sped') || searchStr.includes('fgts')) {
      $('mapModelDepto').value = 'Fiscal';
    } else if (searchStr.includes('contabil') || searchStr.includes('balanco')) {
      $('mapModelDepto').value = 'Contabilidade';
    }
  }

  // Sugestão de Obrigação a vincular
  if ($('mapObrigacaoNome')) {
    if (item.regras?.nomeDocumento?.modelosCompativeis?.[0]?.nome) {
      $('mapObrigacaoNome').value = item.regras.nomeDocumento.modelosCompativeis[0].nome;
    } else if (searchStr.includes('adiantamento')) {
      $('mapObrigacaoNome').value = 'Adiantamento Salarial - Mensal';
    } else if (searchStr.includes('recibo') || searchStr.includes('folha')) {
      $('mapObrigacaoNome').value = 'Folha de Pagamento';
    }
  }

  // Sincroniza o select de arquivos validados
  if (itemIdx !== null && $('mapValidatedFilesSelect')) {
    $('mapValidatedFilesSelect').value = String(itemIdx);
  }

  // Abre o modal direto de mapeamento
  if ($('modalValidaMapping')) {
    $('modalValidaMapping').hidden = false;
  }

  // Se o arquivo for imagem sem OCR, alerta de imediato
  if (item.status === 'erro_extracao') {
    resetMappingPillars();
    renderMapLinesViewer([], fileName);
    toast.warning(`O arquivo "${fileName}" é uma imagem escaneada sem OCR (0 linhas). O G-Click não aceita imagens para layout. Selecione um arquivo válido (como Recibo de Pagamento).`, 'Sem OCR / Imagem');
    return;
  }

  // Dispara autodetecção imediata
  toast.info(`Arquivo "${fileName}" carregado para mapeamento. Analisando linhas e campos…`, 'Mapeamento');
  await runAutoDetectMapping();
}

async function runAutoDetectMapping() {
  if (!currentMapPdfPath && !currentMapPdfBase64) {
    toast.warning('Selecione um arquivo PDF primeiro.', 'Mapeamento');
    return;
  }

  const btn = $('btnAutoDetectMapping');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Detectando…';
  }

  const viewer = $('mapLinesViewer');
  if (viewer) {
    viewer.innerHTML = '<div style="padding:28px;text-align:center;color:#0369a1;background:#f0f9ff;border-radius:8px;">⏳ Extraindo linhas no formato nativo do G-Click e detectando os 3 pilares…</div>';
  }

  try {
    const res = await fetch('/api/valida-pdf/auto-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: currentMapPdfPath,
        fileBase64: currentMapPdfBase64
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      toast.error(data.error || 'Falha ao autodetectar campos.', 'Erro');
      renderMapLinesViewer([], data.fileName || 'arquivo.pdf');
      return;
    }

    currentMapPdfLines = data.lines || [];
    renderMapLinesViewer(currentMapPdfLines, data.fileName || 'arquivo.pdf');

    if (!currentMapPdfLines.length) {
      resetMappingPillars();
      toast.warning(`O arquivo "${data.fileName || 'PDF'}" não possui texto legível (0 linhas). O G-Click requer texto selecionável. Selecione um arquivo válido da lista.`, 'Sem OCR');
      return;
    }

    // Preenche os 3 Pilares com sugestões
    let detectadosCount = 0;
    if (data.pilares?.pilar1_obrigacao) {
      const p1 = data.pilares.pilar1_obrigacao;
      if ($('mapPilar1Linha')) $('mapPilar1Linha').value = p1.linha || '';
      if ($('mapPilar1Texto')) $('mapPilar1Texto').value = p1.termoMapeado || '';
      if ($('mapPilar1Linha2')) $('mapPilar1Linha2').value = p1.linha2 || '';
      if ($('mapPilar1Texto2')) $('mapPilar1Texto2').value = p1.texto2 || '';

      if (p1.nomeSugerido && $('mapModelName')) {
        $('mapModelName').value = p1.nomeSugerido;
      }

      if ($('mapPilar1Badge')) {
        const desc = p1.linha2 ? `Linhas ${p1.linha} & ${p1.linha2} (2 Textos OK)` : `Linha ${p1.linha} (OK)`;
        $('mapPilar1Badge').textContent = desc;
        $('mapPilar1Badge').style.background = '#dcfce7';
        $('mapPilar1Badge').style.color = '#15803d';
      }
      detectadosCount++;
    } else {
      if ($('mapPilar1Linha')) $('mapPilar1Linha').value = '';
      if ($('mapPilar1Texto')) $('mapPilar1Texto').value = '';
      if ($('mapPilar1Linha2')) $('mapPilar1Linha2').value = '';
      if ($('mapPilar1Texto2')) $('mapPilar1Texto2').value = '';
      if ($('mapPilar1Badge')) {
        $('mapPilar1Badge').textContent = 'Pendente';
        $('mapPilar1Badge').style.background = '#f1f5f9';
        $('mapPilar1Badge').style.color = '#64748b';
      }
    }

    if (data.pilares?.pilar2_cliente) {
      if ($('mapPilar2Linha')) $('mapPilar2Linha').value = data.pilares.pilar2_cliente.linha;
      if ($('mapPilar2Valor')) $('mapPilar2Valor').value = data.pilares.pilar2_cliente.valor;
      if ($('mapPilar2Tipo')) {
        const t = data.pilares.pilar2_cliente.tipo;
        $('mapPilar2Tipo').value = t === 'CPF' ? 'CPF' : (t === 'CNPJ Base' ? 'CNPJ_BASE' : 'CNPJ');
      }
      if ($('mapPilar2Badge')) {
        $('mapPilar2Badge').textContent = `Linha ${data.pilares.pilar2_cliente.linha} (${data.pilares.pilar2_cliente.tipo})`;
        $('mapPilar2Badge').style.background = '#dcfce7';
        $('mapPilar2Badge').style.color = '#15803d';
      }
      detectadosCount++;
    } else {
      if ($('mapPilar2Linha')) $('mapPilar2Linha').value = '';
      if ($('mapPilar2Valor')) $('mapPilar2Valor').value = '';
      if ($('mapPilar2Badge')) {
        $('mapPilar2Badge').textContent = 'Pendente';
        $('mapPilar2Badge').style.background = '#f1f5f9';
        $('mapPilar2Badge').style.color = '#64748b';
      }
    }

    if (data.pilares?.pilar3_competencia) {
      if ($('mapPilar3Linha')) $('mapPilar3Linha').value = data.pilares.pilar3_competencia.linha;
      const exato = data.pilares.pilar3_competencia.trechoExato || data.pilares.pilar3_competencia.competenciaDetectada || data.pilares.pilar3_competencia.textoCompleto;
      if ($('mapPilar3Texto')) $('mapPilar3Texto').value = exato;
      if ($('mapPilar3Formato')) $('mapPilar3Formato').value = data.pilares.pilar3_competencia.formato || 'mes_ano';
      if ($('mapPilar3Badge')) {
        $('mapPilar3Badge').textContent = `Linha ${data.pilares.pilar3_competencia.linha} (OK)`;
        $('mapPilar3Badge').style.background = '#dcfce7';
        $('mapPilar3Badge').style.color = '#15803d';
      }
      detectadosCount++;
    } else {
      if ($('mapPilar3Linha')) $('mapPilar3Linha').value = '';
      if ($('mapPilar3Texto')) $('mapPilar3Texto').value = '';
      if ($('mapPilar3Badge')) {
        $('mapPilar3Badge').textContent = 'Pendente';
        $('mapPilar3Badge').style.background = '#f1f5f9';
        $('mapPilar3Badge').style.color = '#64748b';
      }
    }

    if (typeof data.multiLinhas === 'boolean' && $('mapMultiLinhas')) {
      $('mapMultiLinhas').checked = data.multiLinhas;
    }

    if (detectadosCount === 3) {
      toast.success('Todos os 3 pilares (Obrigação, CNPJ e Competência) autodetectados com sucesso!', 'Mapeamento');
    } else if (detectadosCount > 0) {
      toast.info(`${detectadosCount} de 3 pilares autodetectados. Clique nas linhas à esquerda para preencher os pendentes.`, 'Mapeamento');
    } else {
      toast.warning('Linhas carregadas. Clique nas linhas à esquerda para selecionar os pilares.', 'Mapeamento Manual');
    }
  } catch (err) {
    toast.error(`Erro na autodetecção: ${err.message}`, 'Falha');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

function renderMapLinesViewer(lines, fileName = 'documento.pdf') {
  const viewer = $('mapLinesViewer');
  if (!viewer) return;
  if ($('mapLinesCount')) $('mapLinesCount').textContent = `${lines.length} linhas`;

  if (!lines.length) {
    const validFiles = validaPdfResults.filter(r => r.valido);
    const firstValid = validFiles[0];
    const validPrompt = firstValid
      ? `<div style="margin-top:14px;">
           <button type="button" class="btn btn-primary btn-sm" id="btnQuickLoadValidRecibo" style="padding:6px 14px;">
             👉 Carregar Documento Válido (${escapeHtml(firstValid.fileName)})
           </button>
         </div>`
      : '';

    viewer.innerHTML = `
      <div style="padding:28px 16px;text-align:center;background:#fff1f2;border:1px dashed #fca5a5;border-radius:8px;margin:12px;">
        <div style="font-size:28px;margin-bottom:6px;">📷</div>
        <strong style="color:#991b1b;font-size:14px;display:block;margin-bottom:6px;">
          Nenhuma linha de texto encontrada no arquivo "${escapeHtml(fileName)}"
        </strong>
        <p style="color:#7f1d1d;font-size:12.5px;margin:0 auto;max-width:500px;line-height:1.45;">
          Este arquivo é uma <strong>imagem digitalizada sem OCR (0 linhas)</strong>. O sistema ValidaPDF do G-Click requer arquivos com texto selecionável para criar regras de validação.
        </p>
        ${validPrompt}
      </div>
    `;

    $('btnQuickLoadValidRecibo')?.addEventListener('click', () => {
      const validIdx = validaPdfResults.findIndex(r => r.valido);
      if (validIdx >= 0) {
        loadValidatedFileIntoMapping(validaPdfResults[validIdx], validIdx);
      }
    });
    return;
  }

    viewer.innerHTML = lines.map(l => `
    <div class="map-line-row" data-line="${l.lineNumber}" style="display:flex;padding:3px 8px;border-bottom:1px solid #f1f5f9;cursor:text;align-items:center;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
      <span style="width:36px;font-weight:600;color:#94a3b8;user-select:none;cursor:pointer;" title="Clique no número para selecionar a linha toda">${String(l.lineNumber).padStart(2, '0')}</span>
      <span class="map-line-text" style="flex:1;white-space:pre-wrap;word-break:break-word;color:#1e293b;user-select:text;">${escapeHtml(l.text)}</span>
    </div>
  `).join('');

  let activeSelectedText = '';
  let activeSelectedLine = '';

  const selectionBar = $('mapSelectionBar');
  const selTextEl = $('mapSelectionText');
  const selLineEl = $('mapSelectionLine');

  // Captura seleção com o mouse (clicar e arrastar) dentro do visualizador
  viewer.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    const str = sel ? sel.toString().trim() : '';

    if (str && str.length > 0) {
      // Descobre qual linha foi selecionada
      let anchorNode = sel.anchorNode;
      if (anchorNode && anchorNode.nodeType === 3) anchorNode = anchorNode.parentElement;
      const row = anchorNode ? anchorNode.closest('.map-line-row') : null;
      const lineNum = row ? row.getAttribute('data-line') : '';

      activeSelectedText = str;
      activeSelectedLine = lineNum;

      if (selectionBar && selTextEl && selLineEl) {
        selTextEl.textContent = str;
        selLineEl.textContent = lineNum || '?';
        selectionBar.style.display = 'flex';
      }
    }
  });

  // Ações da barra flutuante de seleção
  $('btnAssignToPilar1')?.addEventListener('click', () => {
    if (!activeSelectedText) return;
    if ($('mapPilar1Texto')) $('mapPilar1Texto').value = activeSelectedText;
    if (activeSelectedLine && $('mapPilar1Linha')) $('mapPilar1Linha').value = activeSelectedLine;
    if ($('mapPilar1Badge')) {
      $('mapPilar1Badge').textContent = `Linha ${activeSelectedLine || '1'} (Manual)`;
      $('mapPilar1Badge').style.background = '#dcfce7';
      $('mapPilar1Badge').style.color = '#15803d';
    }
    toast.success(`"${activeSelectedText}" atribuído à Obrigação (Pilar 1).`);
    if (selectionBar) selectionBar.style.display = 'none';
  });

  $('btnAssignToPilar2')?.addEventListener('click', () => {
    if (!activeSelectedText) return;
    if ($('mapPilar2Valor')) $('mapPilar2Valor').value = activeSelectedText;
    if (activeSelectedLine && $('mapPilar2Linha')) $('mapPilar2Linha').value = activeSelectedLine;
    const clean = activeSelectedText.replace(/\D/g, '');
    const isCpf = clean.length === 11;
    if ($('mapPilar2Tipo')) $('mapPilar2Tipo').value = isCpf ? 'CPF' : (clean.length === 8 ? 'CNPJ_BASE' : 'CNPJ');
    if ($('mapPilar2Badge')) {
      $('mapPilar2Badge').textContent = `Linha ${activeSelectedLine || '1'} (${isCpf ? 'CPF' : 'CNPJ'})`;
      $('mapPilar2Badge').style.background = '#dcfce7';
      $('mapPilar2Badge').style.color = '#15803d';
    }
    toast.success(`"${activeSelectedText}" atribuído à Inscrição (Pilar 2).`);
    if (selectionBar) selectionBar.style.display = 'none';
  });

  $('btnAssignToPilar3')?.addEventListener('click', () => {
    if (!activeSelectedText) return;
    if ($('mapPilar3Texto')) $('mapPilar3Texto').value = activeSelectedText;
    if (activeSelectedLine && $('mapPilar3Linha')) $('mapPilar3Linha').value = activeSelectedLine;
    if ($('mapPilar3Badge')) {
      $('mapPilar3Badge').textContent = `Linha ${activeSelectedLine || '1'} (Manual)`;
      $('mapPilar3Badge').style.background = '#dcfce7';
      $('mapPilar3Badge').style.color = '#15803d';
    }
    toast.success(`"${activeSelectedText}" atribuído à Competência (Pilar 3).`);
    if (selectionBar) selectionBar.style.display = 'none';
  });

  // Clique no número da linha seleciona a linha inteira de forma prática
  viewer.querySelectorAll('.map-line-row span:first-child').forEach(numSpan => {
    numSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = numSpan.closest('.map-line-row');
      const lineNum = row.getAttribute('data-line');
      const textSpan = row.querySelector('.map-line-text');
      const lineText = textSpan ? textSpan.textContent.trim() : '';

      if (!$('mapPilar1Linha').value) {
        $('mapPilar1Linha').value = lineNum;
        $('mapPilar1Texto').value = lineText;
        $('mapPilar1Badge').textContent = `Linha ${lineNum}`;
        $('mapPilar1Badge').style.background = '#dcfce7';
        $('mapPilar1Badge').style.color = '#15803d';
        toast.info(`Linha ${lineNum} definida para Obrigação (Pilar 1).`);
      } else if (!$('mapPilar2Linha').value) {
        $('mapPilar2Linha').value = lineNum;
        $('mapPilar2Valor').value = lineText;
        const clean = lineText.replace(/\D/g, '');
        const isCpf = clean.length === 11;
        if ($('mapPilar2Tipo')) $('mapPilar2Tipo').value = isCpf ? 'CPF' : (clean.length === 8 ? 'CNPJ_BASE' : 'CNPJ');
        $('mapPilar2Badge').textContent = `Linha ${lineNum} (${isCpf ? 'CPF' : 'CNPJ'})`;
        $('mapPilar2Badge').style.background = '#dcfce7';
        $('mapPilar2Badge').style.color = '#15803d';
        toast.info(`Linha ${lineNum} definida para Inscrição (Pilar 2).`);
      } else {
        $('mapPilar3Linha').value = lineNum;
        $('mapPilar3Texto').value = lineText;
        $('mapPilar3Badge').textContent = `Linha ${lineNum}`;
        $('mapPilar3Badge').style.background = '#dcfce7';
        $('mapPilar3Badge').style.color = '#15803d';
        toast.info(`Linha ${lineNum} definida para Competência (Pilar 3).`);
      }
    });
  });
}

function resetMappingPillars() {
  if ($('mapPilar1Linha')) $('mapPilar1Linha').value = '';
  if ($('mapPilar1Texto')) $('mapPilar1Texto').value = '';
  if ($('mapPilar1Badge')) {
    $('mapPilar1Badge').textContent = 'Pendente';
    $('mapPilar1Badge').style.background = '#f1f5f9';
    $('mapPilar1Badge').style.color = '#64748b';
  }
  if ($('mapPilar2Linha')) $('mapPilar2Linha').value = '';
  if ($('mapPilar2Valor')) $('mapPilar2Valor').value = '';
  if ($('mapPilar2Badge')) {
    $('mapPilar2Badge').textContent = 'Pendente';
    $('mapPilar2Badge').style.background = '#f1f5f9';
    $('mapPilar2Badge').style.color = '#64748b';
  }
  if ($('mapPilar3Linha')) $('mapPilar3Linha').value = '';
  if ($('mapPilar3Texto')) $('mapPilar3Texto').value = '';
  if ($('mapPilar3Badge')) {
    $('mapPilar3Badge').textContent = 'Pendente';
    $('mapPilar3Badge').style.background = '#f1f5f9';
    $('mapPilar3Badge').style.color = '#64748b';
  }
}

function openValidaPdfInspectModal(result) {
  if (!result) return;
  currentInspectedResult = result;

  const modal = $('modalValidaPdfInspect');
  if (!modal) return;

  $('modalValidaPdfTitle').textContent = `Inspeção: ${result.fileName || 'Documento PDF'}`;
  if ($('modalValidaPdfSubtitle')) {
    const loc = result.filePath || result.relPath || 'Arquivo enviado para conferência';
    const sub = result.subpasta ? ` · Subpasta: ${result.subpasta}` : '';
    $('modalValidaPdfSubtitle').innerHTML = `📍 Localização: <code>${escapeHtml(loc)}</code>${sub ? ` <span class="tag-pill" style="font-size:10.5px;background:#f0fdfa;color:#0f766e;border:1px solid #ccfbf1;">📁 ${escapeHtml(sub)}</span>` : ''}`;
  }

  const banner = $('modalValidaPdfStatusBanner');
  if (banner) {
    if (result.valido) {
      banner.style.background = '#dcfce7';
      banner.style.color = '#15803d';
      banner.style.border = '1px solid #86efac';
      banner.innerHTML = '<strong>✔ Arquivo Conforme:</strong> Atende a todas as 4 regras do Valida PDF e aos modelos do G-Click.';
    } else {
      banner.style.background = '#fee2e2';
      banner.style.color = '#991b1b';
      banner.style.border = '1px solid #fca5a5';
      banner.innerHTML = `<strong>⚠️ Inconsistência Detectada:</strong> ${escapeHtml(result.mensagem || 'Não atendeu a todos os critérios de envio.')}`;
    }
  }

  // Regra 1: Extração
  const ext = result.regras?.extracaoTexto;
  $('ruleIconExtracao').textContent = ext?.ok ? '✅' : '❌';
  if ($('ruleLineExtracao')) {
    $('ruleLineExtracao').textContent = ext?.linhas ? `${ext.linhas} linhas` : '';
  }
  $('ruleDetailExtracao').innerHTML = ext?.ok
    ? `Texto extraído com sucesso via <code>pdftotext -layout</code>.<br><strong>${ext.linhas || result.totalLines || 0}</strong> linhas · <strong>${ext.caracteres || 0}</strong> caracteres legíveis.`
    : '<span style="color:#dc2626;">PDF sem camada de texto selecionável ou imagem escaneada. Requer OCR antes do envio.</span>';

  // Regra 2: Cliente
  const cli = result.regras?.identificacaoCliente;
  $('ruleIconCliente').textContent = cli?.ok ? '✅' : '❌';
  if ($('ruleLineCliente')) {
    $('ruleLineCliente').textContent = cli?.linhaCliente ? `Linha ${cli.linhaCliente}` : '';
  }
  let cliText = '';
  if (cli?.cnpjs?.length) cliText += `<div><strong>CNPJ:</strong> ${cli.cnpjs.join(', ')}</div>`;
  if (cli?.cnpjsBase?.length) cliText += `<div><strong>CNPJ Base:</strong> ${cli.cnpjsBase.join(', ')}</div>`;
  if (cli?.cpfs?.length) cliText += `<div><strong>CPF:</strong> ${cli.cpfs.join(', ')}</div>`;
  if (cli?.razaoSocial) cliText += `<div><strong>Razão Social:</strong> ${escapeHtml(cli.razaoSocial)}</div>`;
  if (!cliText) cliText = '<span style="color:#dc2626;">Nenhum CNPJ, CNPJ Base ou CPF localizado no documento.</span>';
  $('ruleDetailCliente').innerHTML = cliText;

  // Regra 3: Competência
  const comp = result.regras?.competencia;
  $('ruleIconComp').textContent = comp?.ok ? '✅' : '❌';
  if ($('ruleLineComp')) {
    $('ruleLineComp').textContent = comp?.linhaCompetencia ? `Linha ${comp.linhaCompetencia}` : '';
  }
  let compText = '';
  if (comp?.competenciaDetectada) {
    compText = `<div><strong>Competência Principal:</strong> <span class="tag-pill" style="font-size:12px;font-weight:600;">${comp.competenciaDetectada}</span></div>`;
    if (comp.candidatos?.length > 1) {
      compText += `<div style="margin-top:4px;font-size:11.5px;color:#64748b;">Outros candidatos encontrados: ${comp.candidatos.map(c => c.normalizado).join(', ')}</div>`;
    }
  } else {
    compText = '<span style="color:#dc2626;">Nenhuma competência no formato MM/AAAA ou mês por extenso encontrada no cabeçalho ou linhas.</span>';
  }
  $('ruleDetailComp').innerHTML = compText;

  // Regra 4: Nome do Documento
  const doc = result.regras?.nomeDocumento;
  $('ruleIconDoc').textContent = doc?.ok ? '✅' : '❌';
  if ($('ruleLineDoc')) {
    $('ruleLineDoc').textContent = doc?.linhaIdentificada ? `Linha ${doc.linhaIdentificada}` : '';
  }
  let docText = '';
  if (doc?.identificado) {
    docText = `<div><strong>Documento:</strong> ${escapeHtml(doc.identificado)}</div>`;
    if (doc.modelosCompativeis?.length) {
      docText += `<div style="margin-top:4px;font-size:11.5px;color:#0f766e;"><strong>Modelo G-Click Vinculado:</strong> ${escapeHtml(doc.modelosCompativeis[0].nome)} (ID ${doc.modelosCompativeis[0].id})</div>`;
    }
  } else {
    docText = '<span style="color:#dc2626;">Palavra-chave não coincidiu com os 184 modelos do G-Click nem com os padrões de folha/impostos.</span>';
  }
  $('ruleDetailDoc').innerHTML = docText;

  // Diagnóstico & Checklist de Destravamento (#vocepode G-Click)
  const diagWrap = $('modalValidaPdfDiagnosticoWrap');
  const diag = result.diagnosticoGclick;
  if (diagWrap && diag) {
    diagWrap.hidden = false;
    if ($('diagTitulo')) $('diagTitulo').textContent = diag.titulo || 'Diagnóstico G-Click';
    
    const badgeEl = $('diagBadge');
    if (badgeEl) {
      badgeEl.className = 'nav-badge';
      if (diag.tipo === 'ok') {
        badgeEl.classList.add('badge-ready');
        badgeEl.textContent = '100% Conforme';
      } else if (diag.tipo === 'erro_1_modelo') {
        badgeEl.classList.add('badge-warn');
        badgeEl.textContent = 'Erro 1 (Modelo)';
      } else if (diag.tipo === 'erro_2_cliente') {
        badgeEl.classList.add('badge-error');
        badgeEl.textContent = 'Erro 2 (Cliente)';
      } else if (diag.tipo === 'erro_3_tarefa') {
        badgeEl.classList.add('badge-warn');
        badgeEl.textContent = 'Erro 3 (Tarefa)';
      } else {
        badgeEl.classList.add('badge-neutral');
        badgeEl.textContent = diag.codigo || 'Inconsistência';
      }
    }

    if ($('diagAcaoRecomendada')) {
      $('diagAcaoRecomendada').innerHTML = escapeHtml(diag.acaoRecomendada || '');
    }

    const itemsContainer = $('diagChecklistItems');
    if (itemsContainer) {
      itemsContainer.innerHTML = '';
      if (Array.isArray(diag.checklist3Perguntas)) {
        diag.checklist3Perguntas.forEach(item => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'flex-start';
          row.style.gap = '8px';
          row.style.lineHeight = '1.4';
          row.innerHTML = `
            <span style="font-size:14px;line-height:1;">${item.ok ? '✅' : '⚠️'}</span>
            <div><strong>${escapeHtml(item.pergunta)}:</strong> <span style="color:#334155;">${escapeHtml(item.resposta)}</span></div>
          `;
          itemsContainer.appendChild(row);
        });
      }

      if (diag.sugestaoAnexoPorNome) {
        const anexoRow = document.createElement('div');
        anexoRow.style.marginTop = '8px';
        anexoRow.style.padding = '8px 10px';
        anexoRow.style.background = '#eef7f5';
        anexoRow.style.border = '1px solid #c8d9d6';
        anexoRow.style.borderRadius = '6px';
        anexoRow.style.fontSize = '11.5px';
        anexoRow.innerHTML = `
          <strong>💡 Dica de Anexo por Nome:</strong> ${escapeHtml(diag.sugestaoAnexoPorNome.motivo)}<br>
          <span style="font-family:var(--font-mono);font-size:11px;color:#0f766e;">Padrão: ${escapeHtml(diag.sugestaoAnexoPorNome.exemploNome)}</span>
        `;
        itemsContainer.appendChild(anexoRow);
      }
    }
  } else if (diagWrap) {
    diagWrap.hidden = true;
  }

  // Texto Completo Formatado com Numeração de Linhas e Destaques
  const rawPre = $('modalValidaPdfRawText');
  if (rawPre) {
    if (result.rawText) {
      const lines = result.rawText.split(/\r?\n/);
      const lCli = cli?.linhaCliente;
      const lDoc = doc?.linhaIdentificada;
      const lComp = comp?.linhaCompetencia;

      const formatted = lines.map((line, idx) => {
        const lineNum = idx + 1;
        const numStr = String(lineNum).padStart(3, '0');
        let tag = '';
        if (lineNum === lCli) tag += ' [CLIENTE]';
        if (lineNum === lDoc) tag += ' [DOC]';
        if (lineNum === lComp) tag += ' [COMP]';
        return `${numStr} | ${line}${tag ? '  <<' + tag : ''}`;
      }).join('\n');

      rawPre.textContent = formatted;
    } else {
      rawPre.textContent = '(Texto não disponível ou arquivo sem OCR)';
    }
  }

  // Reset e população dos controles do G-Click
  const modelSelect = $('modalGclickModelSelect');
  const openModelLink = $('btnOpenGclickModelLink');
  const accountId = $('accountId')?.value?.trim() || '6019';
  const defaultModelId = doc?.modelosCompativeis?.[0]?.id || '';

  if (modelSelect) {
    modelSelect.innerHTML = '<option value="">Detectar automaticamente ou testar na lista geral</option>';
    if (Array.isArray(validaPdfModels) && validaPdfModels.length > 0) {
      validaPdfModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.modelId || m.id;
        opt.textContent = `${m.modelo || m.nome} (${m.departamento || 'G-Click'}) - ID ${m.modelId || m.id}`;
        if (defaultModelId && String(opt.value) === String(defaultModelId)) {
          opt.selected = true;
        }
        modelSelect.appendChild(opt);
      });
    }
  }

  const updateOpenLink = () => {
    const selectedId = modelSelect?.value || defaultModelId;
    if (openModelLink) {
      if (selectedId) {
        openModelLink.href = `https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=${encodeURIComponent(selectedId)}&empId=${encodeURIComponent(accountId)}`;
        openModelLink.title = `Abrir modelo ID ${selectedId} no G-Click`;
      } else {
        openModelLink.href = `https://app.gclick.com.br/configuracaoListar.do?obj=pdflayoutopen&tipo=0&empId=${encodeURIComponent(accountId)}`;
        openModelLink.title = 'Abrir lista de modelos de PDF no G-Click';
      }
    }
  };
  updateOpenLink();
  modelSelect?.addEventListener('change', updateOpenLink);

  // Reset do Container G-Click
  const gclickWrap = $('modalValidaPdfGclickWrap');
  if (gclickWrap) {
    gclickWrap.hidden = true;
    if ($('gclickValidaMessage')) $('gclickValidaMessage').innerHTML = '';
    if ($('gclickValidaItems')) $('gclickValidaItems').innerHTML = '';
    if ($('gclickValidaDica')) $('gclickValidaDica').hidden = true;
  }

  modal.hidden = false;
}

function setupValidaPdfListeners() {
  $('tabBtnValidaFiles')?.addEventListener('click', () => switchValidaPdfTab('files'));
  $('tabBtnValidaModels')?.addEventListener('click', () => switchValidaPdfTab('models'));

  $('validaModelSearch')?.addEventListener('input', () => renderValidaPdfModelsTable());
  $('validaModelDeptoFilter')?.addEventListener('change', () => renderValidaPdfModelsTable());
  $('validaModelStatusFilter')?.addEventListener('change', () => renderValidaPdfModelsTable());

  $('validaFilterSearch')?.addEventListener('input', () => renderValidaPdfResultsTable());
  $('validaFilterGclick')?.addEventListener('change', (e) => {
    const val = e.target.value || 'all';
    switchValidaChip(val, false);
    renderValidaPdfResultsTable();
  });
  $('validaFilterValidacao')?.addEventListener('change', () => renderValidaPdfResultsTable());

  $('btnClearValidaResults')?.addEventListener('click', () => {
    validaPdfResults = [];
    selectedValidaPdfPaths.clear();
    renderValidaPdfResultsTable();
    toast.info('Lista de resultados limpa.', 'Valida PDF');
  });

  $('chkValidaPdfSelectAll')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    validaPdfResults.forEach(r => {
      if (r.filePath && r.status !== 'erro_extracao') {
        if (isChecked) selectedValidaPdfPaths.add(r.filePath);
        else selectedValidaPdfPaths.delete(r.filePath);
      }
    });
    renderValidaPdfResultsTable();
  });

  // Teste Oficial do Oráculo na tela /upload do G-Click
  $('btnTestUploadOnGclick')?.addEventListener('click', async () => {
    if (!currentInspectedResult) return;
    const btn = $('btnTestUploadOnGclick');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Testando no /upload...';

    try {
      const accountId = $('accountId')?.value?.trim() || '6019';

      const res = await fetch('/api/valida-pdf/test-upload-gclick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          filePath: currentInspectedResult.filePath,
          fileBase64: currentInspectedResult.fileBase64,
          fileName: currentInspectedResult.fileName
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'Falha ao testar no /upload do G-Click.', 'Oráculo /upload');
        return;
      }

      const wrap = $('modalValidaPdfGclickWrap');
      const msg = $('gclickValidaMessage');
      const badge = $('gclickValidaBadge');
      const itemsEl = $('gclickValidaItems');
      const dicaEl = $('gclickValidaDica');

      if (wrap) {
        wrap.hidden = false;

        let badgeClass = 'badge-warn';
        let badgeText = 'G-Click: Identificado';
        if (data.situacao === 'sucesso_vinculado') {
          badgeClass = 'badge-ready';
          badgeText = 'G-Click: 100% OK (Vinculado)';
        } else if (data.situacao === 'modelo_desvinculado_ou_incompleto') {
          badgeClass = 'badge-warn';
          badgeText = 'G-Click: Modelo Existe (Pendente de Vínculo)';
        } else if (data.situacao === 'sem_modelo') {
          badgeClass = 'badge-error';
          badgeText = 'G-Click: Modelo Não Encontrado';
        } else if (data.situacao === 'em_processamento') {
          badgeClass = 'badge-warn';
          badgeText = 'G-Click: Processando Tarefas...';
        }

        if (badge) {
          badge.className = 'nav-badge ' + badgeClass;
          badge.textContent = badgeText;
        }

        if (itemsEl) {
          itemsEl.innerHTML = '';

          let validadorHtml = '';
          if (data.situacao === 'modelo_desvinculado_ou_incompleto') {
            validadorHtml = `
              <div style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;padding:10px 12px;border-radius:6px;margin-bottom:8px;">
                <div style="font-size:12.5px;color:#92400e;font-weight:600;margin-bottom:6px;">
                  ⚠️ Modelo não vinculado à uma obrigação! O modelo existe mais não teve sua configuração finalizada, verifique se o cadastro foi feito corretamente ou consulte o administrador da empresa.
                </div>
                <div style="font-size:13.5px;font-weight:700;color:#0f766e;">
                  🎯 ${escapeHtml(data.validador || (data.modeloId ? `Validador: ${data.modeloId}-${data.modeloNome || ''}` : 'Validador existente'))}
                </div>
              </div>
            `;
          } else if (data.situacao === 'sem_modelo') {
            validadorHtml = `
              <div style="font-size:12.5px;color:#991b1b;padding:8px 12px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;margin-bottom:8px;">
                ❌ <strong>Modelo não encontrado!</strong> Configure um novo ou consulte o administrador da empresa.
              </div>
            `;
          } else if (data.situacao === 'sucesso_vinculado') {
            validadorHtml = `
              <div style="font-size:13.5px;font-weight:700;color:#15803d;padding:8px 12px;background:#dcfce7;border:1px solid #86efac;border-radius:6px;margin-bottom:8px;">
                ✅ Arquivo 100% vinculado e tarefa gerada no G-Click! (${escapeHtml(data.validador || '')})
              </div>
            `;
          } else if (data.validador) {
            validadorHtml = `<div style="font-size:13.5px;font-weight:700;color:#0f766e;padding:6px 10px;background:#ccfbf1;border-radius:6px;margin-bottom:8px;">🎯 ${escapeHtml(data.validador)}</div>`;
          } else {
            validadorHtml = `<div style="font-size:12.5px;color:#991b1b;padding:6px 10px;background:#fee2e2;border-radius:6px;margin-bottom:8px;">❌ Nenhum Validador/Modelo do G-Click reconheceu este arquivo.</div>`;
          }

          let alertCards = '';
          if (data.alertas && data.alertas.length > 0) {
            alertCards = data.alertas.map(a => `<div style="padding:6px 10px;background:#fffbeb;border-left:3px solid #f59e0b;font-size:12px;color:#92400e;margin-bottom:4px;">${escapeHtml(a)}</div>`).join('');
          }

          let conflitoBanner = '';
          const docEsperado = (currentInspectedResult.regras?.nomeDocumento?.identificado || currentInspectedResult.fileName || '').toLowerCase();
          const modeloEncontrado = (data.modeloNome || '').toLowerCase();
          if (data.modeloId && modeloEncontrado && !docEsperado.includes(modeloEncontrado) && !modeloEncontrado.includes(docEsperado)) {
            conflitoBanner = `
              <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:#991b1b;">
                <strong>⚠️ Conflito / Duplicidade de Regra no G-Click:</strong><br>
                Este arquivo é um <em>"${escapeHtml(currentInspectedResult.regras?.nomeDocumento?.identificado || currentInspectedResult.fileName)}"</em>, porém o motor do G-Click capturou o <strong>Validador #${data.modeloId} (${escapeHtml(data.modeloNome)})</strong>.<br>
                Isso indica que o modelo #${data.modeloId} foi configurado com palavras-chave que colidem com este documento e devem ser corrigidas ou excluídas no G-Click.
              </div>
            `;
          }

          itemsEl.innerHTML = `
            ${validadorHtml}
            ${conflitoBanner}
            ${alertCards}
          `;
        }

        if (dicaEl) {
          dicaEl.hidden = false;
          if (data.situacao === 'modelo_desvinculado_ou_incompleto') {
            dicaEl.innerHTML = `💡 <strong>Não crie um modelo novo!</strong> O modelo <strong>#${data.modeloId || ''} (${escapeHtml(data.modeloNome || '')})</strong> já existe no G-Click. Basta ir em Configurações > ValidaPDF, abrir esse modelo e vincular uma atividade de obrigação a ele.`;
          } else if (data.situacao === 'sem_modelo') {
            dicaEl.innerHTML = `💡 Como o G-Click não possui nenhum validador compatível, use o botão <strong>"🛠️ Mapear no G-Click"</strong> para criar o layout dos 3 pilares.`;
          } else if (data.situacao === 'sucesso_vinculado') {
            dicaEl.innerHTML = `💡 O arquivo é 100% compatível e já possui modelo ativo vinculado no G-Click. Pronto para envio!`;
          } else {
            dicaEl.innerHTML = `💡 Validação realizada na tela oficial <code>https://appp.gclick.com.br/upload</code>.`;
          }
        }

        if (msg) {
          msg.textContent = JSON.stringify(data.detalhes || data, null, 2);
        }
      }

      // Atualiza o status em nosso sistema para "Configurado" quando houver modelo correspondente
      if (data.situacao === 'modelo_desvinculado_ou_incompleto' || data.situacao === 'sucesso_vinculado') {
        currentInspectedResult.conciliacao = currentInspectedResult.conciliacao || {};
        currentInspectedResult.conciliacao.situacaoGclick = 'ja_no_gclick';
        currentInspectedResult.conciliacao.modelo = currentInspectedResult.conciliacao.modelo || {};
        currentInspectedResult.conciliacao.modelo.id = data.modeloId;
        currentInspectedResult.conciliacao.modelo.nome = data.modeloNome;
        currentInspectedResult.conciliacao.modelo.isConfigurado = true;
        currentInspectedResult.conciliacao.modelo.encontrado = true;
        currentInspectedResult.conciliacao.precisaMapear = false;
        currentInspectedResult.valido = true;
        currentInspectedResult.statusGclickOracle = 'configurado';
        currentInspectedResult.validadorGclick = data.validador;
        renderValidaPdfResultsTable();
      } else if (data.situacao === 'sem_modelo') {
        currentInspectedResult.conciliacao = currentInspectedResult.conciliacao || {};
        currentInspectedResult.conciliacao.situacaoGclick = 'sem_modelo';
        currentInspectedResult.conciliacao.precisaMapear = true;
        currentInspectedResult.statusGclickOracle = 'sem_modelo';
        renderValidaPdfResultsTable();
      }

      toast.success(`Teste no /upload concluído: ${data.validador || 'Processado'}`, 'Oráculo G-Click');
    } catch (err) {
      toast.error(`Erro ao testar no /upload: ${err.message}`, 'Falha');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });

  // ==========================================
  // JOB DE VALIDAÇÃO EM MASSA (1 POR VEZ COM F5)
  // ==========================================
  async function runBatchUploadOracleJob() {
    if (isBatchUploadJobRunning) return;

    let targetFiles = [];
    if (selectedValidaPdfPaths.size > 0) {
      targetFiles = validaPdfResults.filter(r => selectedValidaPdfPaths.has(r.filePath) && r.status !== 'erro_extracao');
    } else {
      targetFiles = validaPdfResults.filter(r => r.filePath && r.status !== 'erro_extracao');
    }

    if (!targetFiles.length) {
      toast.warning('Nenhum arquivo legível selecionado para validação.', 'Validação em Lote');
      return;
    }

    const accountId = $('accountId')?.value?.trim() || '6019';
    const progressWrap = $('validaBatchJobProgressWrap');
    const progressBar = $('validaBatchJobProgressBar');
    const statusEl = $('validaBatchJobStatus');
    const countEl = $('validaBatchJobCount');
    const currentFileEl = $('validaBatchJobCurrentFile');
    const btnBatch = $('btnBatchTestUploadGclick');

    isBatchUploadJobRunning = true;
    shouldCancelBatchUploadJob = false;

    if (progressWrap) progressWrap.hidden = false;
    if (btnBatch) {
      btnBatch.disabled = true;
      btnBatch.innerHTML = '<span>⏳</span> Processando…';
    }

    let processedCount = 0;
    let configuradosCount = 0;
    let semModeloCount = 0;
    const total = targetFiles.length;

    toast.info(`Iniciando validação de ${total} arquivo(s) selecionado(s) no G-Click. Envio sequencial (1 por vez) com F5 após cada validação…`, 'Job Iniciada');

    try {
      for (let i = 0; i < total; i++) {
        if (shouldCancelBatchUploadJob) {
          toast.warning('Operação em lote interrompida pelo operador.', 'Job Cancelada');
          break;
        }

        const item = targetFiles[i];
        const pct = Math.round(((i + 1) / total) * 100);

        if (progressBar) progressBar.style.width = `${pct}%`;
        if (countEl) countEl.textContent = `${i + 1} / ${total}`;
        if (currentFileEl) currentFileEl.textContent = `Arquivo: ${item.fileName || 'arquivo.pdf'}`;
        if (statusEl) statusEl.textContent = `[${i + 1}/${total}] Enviando "${item.fileName}" para o /upload do G-Click…`;

        try {
          const res = await fetch('/api/valida-pdf/test-upload-gclick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filePath: item.filePath,
              accountId,
              reloadAfter: true, // F5 no G-Click após cada envio!
              keepPageOpen: true // Reutiliza a aba para o próximo arquivo
            })
          });

          const data = await res.json();
          if (res.ok && data.ok) {
            if (data.situacao === 'modelo_desvinculado_ou_incompleto' || data.situacao === 'sucesso_vinculado') {
              item.conciliacao = item.conciliacao || {};
              item.conciliacao.situacaoGclick = 'ja_no_gclick';
              item.conciliacao.modelo = item.conciliacao.modelo || {};
              item.conciliacao.modelo.id = data.modeloId;
              item.conciliacao.modelo.nome = data.modeloNome;
              item.conciliacao.modelo.isConfigurado = true;
              item.conciliacao.modelo.encontrado = true;
              item.conciliacao.precisaMapear = false;
              item.valido = true;
              item.statusGclickOracle = 'configurado';
              item.validadorGclick = data.validador;
              configuradosCount++;
            } else if (data.situacao === 'sem_modelo') {
              item.conciliacao = item.conciliacao || {};
              item.conciliacao.situacaoGclick = 'sem_modelo';
              item.conciliacao.precisaMapear = true;
              item.statusGclickOracle = 'sem_modelo';
              semModeloCount++;
            }
          }
        } catch (err) {
          console.error(`Erro ao validar arquivo "${item.fileName}":`, err);
        }

        processedCount++;
        // Remove da lista de selecionados após validação e atualiza a tela
        selectedValidaPdfPaths.delete(item.filePath);
        updateValidaSelectionUI();
        renderValidaPdfResultsTable();
      }

      if (!shouldCancelBatchUploadJob) {
        toast.success(`Validação concluída! ${configuradosCount} alterados para "Configurado", ${semModeloCount} sem modelo.`, 'Job Concluída');
      }
    } finally {
      isBatchUploadJobRunning = false;
      shouldCancelBatchUploadJob = false;
      if (btnBatch) {
        btnBatch.disabled = false;
      }
      updateValidaSelectionUI();
      if (statusEl) {
        statusEl.textContent = `Concluído: ${processedCount} processados (${configuradosCount} configurados).`;
      }
      setTimeout(() => {
        if (!isBatchUploadJobRunning && progressWrap) {
          progressWrap.hidden = true;
        }
      }, 5000);
    }
  }

  $('btnBatchTestUploadGclick')?.addEventListener('click', () => {
    runBatchUploadOracleJob();
  });

  $('btnCancelBatchUploadJob')?.addEventListener('click', () => {
    if (isBatchUploadJobRunning) {
      shouldCancelBatchUploadJob = true;
      toast.info('Cancelando fila de validação… Aguarde o arquivo atual finalizar.', 'Cancelamento');
    }
  });

  // Validação ao vivo no motor do G-Click
  $('btnValidateOnGclick')?.addEventListener('click', async () => {
    if (!currentInspectedResult) return;
    const btn = $('btnValidateOnGclick');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> Validando no G-Click...';

    try {
      const accountId = $('accountId')?.value?.trim() || '6019';
      const modelId = $('modalGclickModelSelect')?.value || currentInspectedResult.regras?.nomeDocumento?.modelosCompativeis?.[0]?.id || null;

      const res = await fetch('/api/valida-pdf/validate-on-gclick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          filePath: currentInspectedResult.filePath,
          fileBase64: currentInspectedResult.fileBase64,
          modelId
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error(data.error || 'Falha ao validar no G-Click.', 'Validação G-Click');
        return;
      }

      const wrap = $('modalValidaPdfGclickWrap');
      const msg = $('gclickValidaMessage');
      const badge = $('gclickValidaBadge');
      const itemsEl = $('gclickValidaItems');
      const dicaEl = $('gclickValidaDica');

      if (wrap) {
        wrap.hidden = false;
        if (badge) {
          badge.className = 'nav-badge ' + (data.validoGclick ? 'badge-ready' : 'badge-error');
          badge.textContent = data.validoGclick ? 'G-Click: 100% Conforme' : 'G-Click: Divergência';
        }

        if (itemsEl) {
          itemsEl.innerHTML = '';
          const items = data.parsedGclick?.items || [];
          if (items.length > 0) {
            items.forEach(it => {
              const row = document.createElement('div');
              row.style.display = 'flex';
              row.style.alignItems = 'center';
              row.style.gap = '8px';
              const isOk = it.status === 'ok';
              row.innerHTML = `
                <span style="font-size:14px;">${isOk ? '✅' : '❌'}</span>
                <div><strong>${escapeHtml(it.label)}:</strong> <span style="color:#334155;">${escapeHtml(it.valor || (isOk ? 'OK' : 'Inconsistente'))}</span></div>
              `;
              itemsEl.appendChild(row);
            });
          } else {
            itemsEl.innerHTML = `<div>${escapeHtml(data.retornoTexto || 'Teste concluído.')}</div>`;
          }
        }

        if (dicaEl) {
          if (data.parsedGclick?.diagnostico && !data.validoGclick) {
            dicaEl.hidden = false;
            dicaEl.style.background = '#ecfeff';
            dicaEl.style.borderColor = '#06b6d4';
            dicaEl.style.color = '#0e7490';
            dicaEl.innerHTML = `<strong>💡 Diagnóstico Omie/G-Click:</strong> ${escapeHtml(data.parsedGclick.diagnostico)}`;
          } else if (data.validoGclick) {
            dicaEl.hidden = false;
            dicaEl.style.background = '#f0fdf4';
            dicaEl.style.borderColor = '#22c55e';
            dicaEl.style.color = '#15803d';
            dicaEl.innerHTML = '<strong>✔ Sucesso:</strong> O motor do G-Click validou o documento perfeitamente contra as regras deste modelo.';
          } else {
            dicaEl.hidden = true;
          }
        }

        if (msg) {
          msg.textContent = data.retornoTexto || data.retornoHtml || '';
        }
      }
      toast.success(data.validoGclick ? 'Documento 100% validado pelo G-Click.' : 'Validação executada no G-Click com divergências.', 'G-Click ValidaPDF');
    } catch (err) {
      toast.error(err.message, 'Erro de Conexão G-Click');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });

  // Modal Fechamento
  $('btnCloseValidaPdfInspect')?.addEventListener('click', () => {
    $('modalValidaPdfInspect').hidden = true;
  });
  $('btnCloseValidaPdfModalBtn')?.addEventListener('click', () => {
    $('modalValidaPdfInspect').hidden = true;
  });

  // Modal Detalhes do Modelo G-Click
  $('btnCloseValidaModelDetail')?.addEventListener('click', () => {
    if ($('modalValidaModelDetail')) $('modalValidaModelDetail').hidden = true;
  });
  $('btnCloseValidaModelDetailBtn')?.addEventListener('click', () => {
    if ($('modalValidaModelDetail')) $('modalValidaModelDetail').hidden = true;
  });

  // Clique em Mapear ou Inspecionar na tabela
  $('validaResultsBody')?.addEventListener('click', async (e) => {
    const mapBtn = e.target.closest('.btn-map-pdf');
    if (mapBtn) {
      const idx = parseInt(mapBtn.dataset.idx, 10);
      const item = validaPdfResults[idx];
      if (item) {
        await loadValidatedFileIntoMapping(item, idx);
      }
      return;
    }

    const btn = e.target.closest('.btn-inspect-pdf');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    const item = validaPdfResults[idx];
    if (!item) return;

    if (!item.rawText && item.filePath) {
      try {
        const textRes = await api('valida-pdf/extract-text', { filePath: item.filePath });
        item.rawText = textRes.rawText;
      } catch {}
    }
    openValidaPdfInspectModal(item);
  });

  // Botão Sincronizar Modelos
  $('btnSyncValidaModels')?.addEventListener('click', async () => {
    const btn = $('btnSyncValidaModels');
    if (btn) btn.disabled = true;
    try {
      toast.info('Sincronizando modelos com o G-Click…', 'Valida PDF');
      const accountId = currentAccount() || '6019';
      const res = await api('valida-pdf/sync-models', { accountId });
      validaPdfModels = res.models || [];
      renderValidaPdfModelsTable();
      toast.success(res.message || 'Modelos sincronizados!', 'G-Click');
    } catch (err) {
      toast.error(err.message || 'Erro ao sincronizar modelos', 'Falha');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Função de varredura recursiva de pasta no servidor/computador
  async function executeDirectoryScan(dirPath) {
    const btn = $('btnScanDirectory');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> Varrando pasta…';
    }

    try {
      const target = (dirPath || $('validaScanDirPath')?.value || '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum').trim();
      const accountId = $('accountId')?.value?.trim() || '6019';
      const expectedCnpj = ($('validaExpectedDocId')?.value || '').trim();
      const expectedCompetencia = ($('validaExpectedComp')?.value || '').trim();

      toast.info(`Iniciando varredura recursiva em "${target}"…`, 'Valida PDF');

      const res = await api('valida-pdf/validate-batch', {
        dirPath: target,
        accountId,
        expectedCnpj,
        expectedCompetencia
      });

      validaPdfResults = res.arquivos || res.validations || [];
      validaPdfDuplicates = res.duplicidades || null;
      renderValidaPdfResultsTable();

      // Atualiza cards de estatísticas
      const statsWrap = $('validaBatchStatsWrap');
      const r = res.resumo || {};
      if (statsWrap) {
        statsWrap.hidden = false;
        if ($('statTotalPdfs')) $('statTotalPdfs').textContent = r.total || 0;
        if ($('statValidosPdfs')) $('statValidosPdfs').textContent = r.validos || 0;
        if ($('statInconsistentesPdfs')) $('statInconsistentesPdfs').textContent = r.inconsistentes || 0;
        if ($('statSemOcrPdfs')) $('statSemOcrPdfs').textContent = r.semTextoOcr || 0;
        if ($('statSubpastasCount')) $('statSubpastasCount').textContent = r.totalSubpastas || res.subpastas?.length || 0;
      }

      const dupesCount = res.duplicidades?.totalConflitos || 0;
      toast.success(
        `Análise concluída: ${r.validos || 0} válidos, ${r.inconsistentes || 0} pendências e ${dupesCount} conflitos/duplicidades de ${r.total || 0} PDFs.`,
        'Varredura Concluída'
      );
    } catch (err) {
      toast.error(err.message || 'Erro ao varrer pasta de arquivos', 'Falha na Varredura');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  }

  // Botão de Varrer Pasta
  $('btnScanDirectory')?.addEventListener('click', () => {
    const dir = $('validaScanDirPath')?.value?.trim();
    executeDirectoryScan(dir);
  });

  // Atalhos rápidos de diretórios
  document.querySelectorAll('.btn-dir-shortcut').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const p = e.currentTarget.dataset.path;
      if (p) {
        if ($('validaScanDirPath')) $('validaScanDirPath').value = p;
        executeDirectoryScan(p);
      }
    });
  });

  // Seletor de Pasta Local do Computador (webkitdirectory)
  $('validaFolderPicker')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      toast.info('Nenhum arquivo PDF encontrado na pasta selecionada.', 'Valida PDF');
      return;
    }

    toast.info(`Processando ${files.length} PDFs da pasta selecionada pelo navegador…`, 'Valida PDF');

    const readAsBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const results = [];
    const subpastasSet = new Set();
    const accountId = $('accountId')?.value?.trim() || '6019';
    const expectedCnpj = ($('validaExpectedDocId')?.value || '').trim();
    const expectedCompetencia = ($('validaExpectedComp')?.value || '').trim();

    // Processa os arquivos em chunks de 5 para não sobrecarregar o browser
    const chunkSize = 5;
    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (f) => {
        try {
          const base64 = await readAsBase64(f);
          const rel = f.webkitRelativePath || f.name;
          const sub = rel.includes('/') ? rel.substring(0, rel.lastIndexOf('/')) : '';
          if (sub) subpastasSet.add(sub);

          const res = await api('valida-pdf/validate-file', {
            fileName: f.name,
            fileBase64: base64,
            accountId,
            expectedCnpj,
            expectedCompetencia
          });

          results.push({
            ...res,
            fileName: f.name,
            relPath: rel,
            subpasta: sub
          });
        } catch (err) {
          console.error(`Erro ao validar arquivo ${f.name}:`, err);
        }
      }));
    }

    validaPdfResults = results;
    renderValidaPdfResultsTable();

    const statsWrap = $('validaBatchStatsWrap');
    const validos = results.filter(r => r.valido).length;
    const inconsistentes = results.length - validos;
    const semOcr = results.filter(r => r.status === 'erro_extracao').length;

    if (statsWrap) {
      statsWrap.hidden = false;
      if ($('statTotalPdfs')) $('statTotalPdfs').textContent = results.length;
      if ($('statValidosPdfs')) $('statValidosPdfs').textContent = validos;
      if ($('statInconsistentesPdfs')) $('statInconsistentesPdfs').textContent = inconsistentes;
      if ($('statSemOcrPdfs')) $('statSemOcrPdfs').textContent = semOcr;
      if ($('statSubpastasCount')) $('statSubpastasCount').textContent = subpastasSet.size;
    }

    toast.success(
      `Pasta local processada: ${validos} válidos de ${results.length} PDFs.`,
      'Varredura Concluída'
    );
  });

  // Botão Validar Pasta de Amostras (retrocompatibilidade)
  $('btnValidaSampleBatch')?.addEventListener('click', () => {
    executeDirectoryScan('/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum');
  });

  // Drag and Drop
  const dropZone = $('validaPdfDropZone');
  const fileInput = $('validaPdfFileInput');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = 'var(--gclick-primary)';
        dropZone.style.backgroundColor = '#ecfdf5';
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = '#cbd5e1';
        dropZone.style.backgroundColor = '#f8fafc';
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt?.files;
      if (files?.length) {
        processUploadedPdfFiles(files);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) {
        processUploadedPdfFiles(fileInput.files);
        fileInput.value = '';
      }
    });
  }

  // Relatório de Diagnóstico de Validação (Melhoria #2)
  $('btnGenerateDiagnosticReport')?.addEventListener('click', async () => {
    if (!validaPdfResults.length) {
      toast.warning('Nenhum resultado disponível para gerar relatório.', 'Valida PDF');
      return;
    }

    const btn = $('btnGenerateDiagnosticReport');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> Gerando Relatório…';
    }

    try {
      const dirPath = $('validaScanDirPath')?.value?.trim() || 'Arquivos Selecionados';
      const accountId = $('accountId')?.value?.trim() || '6019';

      const res = await fetch('/api/valida-pdf/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: validaPdfResults,
          dirPath,
          accountId,
          accountName: 'CONTABILIDADE MAGNUM LTDA',
          format: 'html'
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao gerar relatório de diagnóstico');
      }

      const htmlReport = await res.text();
      const iframe = $('diagnosticReportIframe');
      if (iframe) {
        iframe.srcdoc = htmlReport;
      }

      const modal = $('modalDiagnosticReport');
      if (modal) modal.hidden = false;

      toast.success('Relatório analítico de diagnóstico gerado com sucesso.', 'Diagnóstico Concluído');
    } catch (err) {
      toast.error(err.message, 'Erro ao Gerar Relatório');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  });

  // Fechamento do Modal de Relatório
  $('btnCloseDiagnosticReport')?.addEventListener('click', () => {
    $('modalDiagnosticReport').hidden = true;
  });
  $('btnCloseDiagnosticReportBtn')?.addEventListener('click', () => {
    $('modalDiagnosticReport').hidden = true;
  });

  // Imprimir Relatório
  $('btnPrintDiagnosticReport')?.addEventListener('click', () => {
    const iframe = $('diagnosticReportIframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.print();
    }
  });

  // Aba Mapeamento & Importação: Listener de Troca de Aba
  $('tabBtnValidaMapping')?.addEventListener('click', () => switchValidaPdfTab('mapping'));

  // Integração: Pegar dos Arquivos Validados
  $('mapValidatedFilesSelect')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!isNaN(idx) && validaPdfResults[idx]) {
      loadValidatedFileIntoMapping(validaPdfResults[idx], idx);
    }
  });

  $('btnLoadSelectedValidatedFile')?.addEventListener('click', () => {
    const select = $('mapValidatedFilesSelect');
    const idx = parseInt(select?.value, 10);
    if (!isNaN(idx) && validaPdfResults[idx]) {
      loadValidatedFileIntoMapping(validaPdfResults[idx], idx);
    } else {
      toast.warning('Selecione um arquivo validado no menu acima.', 'Mapeamento');
    }
  });

  $('btnCloseValidaMappingModal')?.addEventListener('click', () => {
    if ($('modalValidaMapping')) $('modalValidaMapping').hidden = true;
  });
  $('btnCloseValidaMappingBtn')?.addEventListener('click', () => {
    if ($('modalValidaMapping')) $('modalValidaMapping').hidden = true;
  });
  $('btnReturnToFilesTab')?.addEventListener('click', () => {
    if ($('modalValidaMapping')) $('modalValidaMapping').hidden = true;
  });

  $('btnGoToMappingFromFiles')?.addEventListener('click', () => {
    if (!validaPdfResults.length) {
      toast.warning('Nenhum arquivo validado disponível.', 'Mapeamento');
      return;
    }
    const firstValidIdx = validaPdfResults.findIndex(r => r.valido);
    const chosenIdx = firstValidIdx >= 0 ? firstValidIdx : 0;
    loadValidatedFileIntoMapping(validaPdfResults[chosenIdx], chosenIdx);
  });

  // Escolher PDF local para mapeamento
  $('btnPickMapPdfFile')?.addEventListener('click', () => {
    $('mapPdfFileInput')?.click();
  });

  $('mapPdfFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.warning('Selecione um arquivo PDF.', 'Formato Inválido');
      return;
    }

    $('mapPdfFileName').textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    if (!$('mapModelName').value) {
      const baseName = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
      $('mapModelName').value = baseName;
    }

    currentMapPdfBase64 = await readFileAsBase64(file);
    currentMapPdfPath = null;
    toast.info('PDF carregado. Clique em Autodetectar Campos.', 'Mapeamento');
    runAutoDetectMapping();
  });

  // Usar Amostra Magnum (Recibo de Pagamento)
  $('btnPickSampleMapPdf')?.addEventListener('click', async () => {
    const samplePath = '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum/Folha sem variavel/Recibo de Pagamento.pdf';
    $('mapPdfFileName').textContent = '📁 Recibo de Pagamento.pdf (Amostra Magnum)';
    $('mapModelName').value = 'Recibo de Pagamento 2';
    $('mapObrigacaoNome').value = 'Adiantamento Salarial - Mensal';
    currentMapPdfPath = samplePath;
    currentMapPdfBase64 = null;
    toast.info('Carregando amostra e autodetectando campos…', 'Mapeamento');
    runAutoDetectMapping();
  });

  $('btnAutoDetectMapping')?.addEventListener('click', runAutoDetectMapping);

  // Disparo para Criar e Mapear diretamente no G-Click
  $('btnSubmitMappingToGclick')?.addEventListener('click', async () => {
    const nomeModelo = $('mapModelName').value.trim();
    const departamentoNome = $('mapModelDepto').value;
    const obrigacaoNome = $('mapObrigacaoNome').value.trim();
    const multiLinhas = $('mapMultiLinhas').checked;

    if (!nomeModelo) {
      toast.warning('Informe o Nome do Modelo.', 'Validação');
      $('mapModelName').focus();
      return;
    }

    if (!currentMapPdfPath && !currentMapPdfBase64) {
      toast.warning('Selecione um arquivo PDF de modelo.', 'Validação');
      return;
    }

    const pilar1Linha = parseInt($('mapPilar1Linha').value);
    const pilar1Texto = $('mapPilar1Texto').value.trim();
    const pilar1Linha2 = parseInt($('mapPilar1Linha2')?.value) || null;
    const pilar1Texto2 = ($('mapPilar1Texto2')?.value || '').trim() || null;
    if (!pilar1Linha || !pilar1Texto) {
      toast.warning('Mapeie a linha e o texto da Obrigação (Pilar 1).', 'Validação');
      return;
    }

    const pilar2Linha = parseInt($('mapPilar2Linha').value);
    const pilar2Valor = $('mapPilar2Valor').value.trim();
    const pilar2Tipo = $('mapPilar2Tipo')?.value || (pilar2Valor.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ');
    if (!pilar2Linha) {
      toast.warning('Mapeie a linha da Inscrição/CNPJ do Cliente (Pilar 2).', 'Validação');
      return;
    }

    const pilar3Linha = parseInt($('mapPilar3Linha').value);
    const pilar3Formato = $('mapPilar3Formato').value;
    const pilar3Texto = $('mapPilar3Texto')?.value?.trim() || '';
    if (!pilar3Linha) {
      toast.warning('Mapeie a linha da Competência (Pilar 3).', 'Validação');
      return;
    }

    const btn = $('btnSubmitMappingToGclick');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>🚀</span> Criando no G-Click...';

    // Inicializa o depurador visual
    const dbgBox = $('mapDebuggerBox');
    const dbgLogs = $('mapDebuggerLogs');
    const dbgBadge = $('mapDebuggerStatusBadge');
    if (dbgBox) dbgBox.style.display = 'block';
    if (dbgBadge) {
      dbgBadge.textContent = 'Executando…';
      dbgBadge.style.background = '#eab308';
    }
    if (dbgLogs) {
      dbgLogs.innerHTML = `
        <div style="color:#38bdf8;">[${new Date().toLocaleTimeString()}] 🚀 Iniciando processo de criação e mapeamento do modelo "${nomeModelo}" no G-Click...</div>
        <div style="color:#94a3b8;">[${new Date().toLocaleTimeString()}] Enviando requisição para a automação Playwright...</div>
      `;
    }

    const appendDebugLog = (msg, color = '#e2e8f0') => {
      if (!dbgLogs) return;
      const el = document.createElement('div');
      el.style.color = color;
      el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      dbgLogs.appendChild(el);
      dbgLogs.scrollTop = dbgLogs.scrollHeight;
    };

    $('btnClearMapDebugger')?.addEventListener('click', () => {
      if (dbgLogs) dbgLogs.innerHTML = '<div style="color:#64748b;">Terminal de depuração limpo.</div>';
    });

    try {
      const accountId = $('accountId')?.value?.trim() || '6019';
      appendDebugLog(`Conta ativa: ${accountId} | Departamento: ${departamentoNome}`);
      appendDebugLog(`Regra 1 (Obrigação): Linha ${pilar1Linha} -> "${pilar1Texto}"`);
      appendDebugLog(`Regra 2 (Inscrição - ${pilar2Tipo}): Linha ${pilar2Linha} -> "${pilar2Valor}"`);
      appendDebugLog(`Regra 3 (Competência): Linha ${pilar3Linha} -> "${pilar3Texto}" (${pilar3Formato})`);
      appendDebugLog(`Multi-linhas ativado: ${multiLinhas ? 'Sim' : 'Não'}`);

      const res = await fetch('/api/valida-pdf/create-model-gclick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          nomeModelo,
          departamentoNome,
          obrigacaoNome,
          multiLinhas,
          filePath: currentMapPdfPath,
          fileBase64: currentMapPdfBase64,
          pilar1: {
            linha: pilar1Linha,
            texto: pilar1Texto,
            valor: pilar1Texto,
            linha2: pilar1Linha2,
            texto2: pilar1Texto2,
            valor2: pilar1Texto2
          },
          pilar2: { linha: pilar2Linha, tipo: pilar2Tipo, texto: pilar2Valor, valor: pilar2Valor },
          pilar3: { linha: pilar3Linha, formato: pilar3Formato, texto: pilar3Texto, valor: pilar3Texto }
        })
      });

      const data = await res.json();

      // Renderiza passos retornados pelo backend se disponíveis
      if (data.steps && Array.isArray(data.steps)) {
        for (const s of data.steps) {
          appendDebugLog(`Passo ${s.step}: ${s.msg}`, '#a7f3d0');
        }
      }

      if (!res.ok || data.error) {
        if (dbgBadge) {
          dbgBadge.textContent = 'Erro';
          dbgBadge.style.background = '#ef4444';
        }
        appendDebugLog(`❌ Falha na automação: ${data.error || 'Erro desconhecido'}`, '#f87171');
        toast.error(data.error || 'Falha ao criar modelo no G-Click.', 'Erro G-Click');
        return;
      }

      if (dbgBadge) {
        dbgBadge.textContent = 'Concluído 100%';
        dbgBadge.style.background = '#10b981';
      }
      appendDebugLog(`✅ Sucesso! Modelo cadastrado e mapeado com sucesso no G-Click.`, '#4ade80');
      if (data.urlFinal) {
        appendDebugLog(`🔗 URL no G-Click: ${data.urlFinal}`, '#38bdf8');
      }

      toast.success(`Modelo "${nomeModelo}" criado e mapeado com sucesso no G-Click!`, 'Sucesso');
      // Recarrega catálogo de modelos na UI
      if (typeof loadValidaPdfSection === 'function') {
        loadValidaPdfSection().catch(() => {});
      }
    } catch (err) {
      if (dbgBadge) {
        dbgBadge.textContent = 'Erro';
        dbgBadge.style.background = '#ef4444';
      }
      appendDebugLog(`❌ Erro de comunicação: ${err.message}`, '#f87171');
      toast.error(`Erro ao criar no G-Click: ${err.message}`, 'Falha');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  });

  // LISTENERS DE CHIPS DO WORKSPACE UNIFICADO
  ['chipValidaAll', 'chipValidaReady', 'chipValidaNeedsMap', 'chipValidaNoClient', 'chipValidaValid', 'chipValidaPending', 'chipValidaDupes', 'chipValidaModels'].forEach(id => {
    $(id)?.addEventListener('click', (e) => {
      const chip = e.currentTarget.dataset.chip || 'all';
      switchValidaChip(chip);
    });
  });

  // Fechamento do Modal de Comparação de Duplicidades
  $('btnCloseValidaDuplicateCompare')?.addEventListener('click', () => {
    if ($('modalValidaDuplicateCompare')) $('modalValidaDuplicateCompare').hidden = true;
  });
  $('btnCloseValidaDuplicateCompareFooter')?.addEventListener('click', () => {
    if ($('modalValidaDuplicateCompare')) $('modalValidaDuplicateCompare').hidden = true;
  });

  // Clique em Comparar Duplicatas
  $('validaDuplicatesContainer')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-compare-dupe');
    if (btn) {
      const grupoId = btn.dataset.grupoid;
      openValidaDuplicateCompareModal(grupoId);
    }
  });
}

function renderValidaPdfDuplicatesView() {
  const container = $('validaDuplicatesContainer');
  if (!container) return;

  const dupData = validaPdfDuplicates;
  const groups = dupData?.gruposConflito || [];

  if (!groups.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:36px;color:#64748b;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1;">
        <span style="font-size:32px;display:block;margin-bottom:8px;">✅</span>
        <strong style="color:#1e293b;font-size:14px;display:block;margin-bottom:4px;">Nenhuma duplicidade ou conflito encontrado</strong>
        <span style="font-size:12.5px;color:#64748b;">Todos os documentos processados possuem conteúdo, numerações ou competências distintas.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = groups.map((g, idx) => {
    let typeBadge = '';
    let borderStyle = 'border-left: 4px solid #b45309;';
    if (g.tipoConflito === 'duplicata_identica') {
      typeBadge = '<span class="dupe-badge-identical">🚨 Duplicata 100% Idêntica</span>';
      borderStyle = 'border-left: 4px solid #dc2626;';
    } else if (g.tipoConflito === 'duplicata_guia') {
      typeBadge = '<span class="dupe-badge-guide">⚠️ Mesma Guia / Reemissão</span>';
      borderStyle = 'border-left: 4px solid #d97706;';
    } else {
      typeBadge = '<span class="dupe-badge-conflict">⚡ Possível Retificação / Valores Diferentes</span>';
      borderStyle = 'border-left: 4px solid #ea580c;';
    }

    const filesTableRows = (g.arquivos || []).map(f => `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px 10px;font-weight:600;font-size:12.5px;color:#1e293b;">
          ${escapeHtml(f.fileName)}
          ${f.subpasta ? `<div style="font-size:11px;color:#0f766e;font-weight:normal;">📁 ${escapeHtml(f.subpasta)}</div>` : ''}
        </td>
        <td style="padding:8px 10px;font-size:12px;color:#475569;">
          ${f.numDoc ? `<code style="font-size:11px;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${escapeHtml(f.numDoc)}</code>` : '<span style="color:#94a3b8;">--</span>'}
        </td>
        <td style="padding:8px 10px;font-weight:700;font-size:12px;color:#0f766e;">
          ${f.valor ? `R$ ${escapeHtml(f.valor)}` : '<span style="color:#94a3b8;">--</span>'}
        </td>
        <td style="padding:8px 10px;font-size:12px;color:#475569;">
          ${f.vencimento ? escapeHtml(f.vencimento) : '<span style="color:#94a3b8;">--</span>'}
        </td>
        <td style="padding:8px 10px;font-size:11px;font-family:monospace;color:#64748b;">
          ${f.contentHash ? escapeHtml(f.contentHash.substring(0, 10)) + '…' : '--'}
        </td>
      </tr>
    `).join('');

    return `
      <div class="dupe-card" style="${borderStyle}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              ${typeBadge}
              <strong style="font-size:13.5px;color:#0f172a;">${escapeHtml(g.chave)}</strong>
            </div>
            <p style="margin:0;font-size:12px;color:#64748b;">${escapeHtml(g.detalhes || '')}</p>
          </div>
          <div>
            <button type="button" class="btn btn-secondary btn-sm btn-compare-dupe" data-grupoid="${g.grupoId || idx}" style="font-size:12px;display:flex;align-items:center;gap:6px;">
              <span>🔍</span> Comparar Detalhes
            </button>
          </div>
        </div>

        <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
          <table style="width:100%;border-collapse:collapse;text-align:left;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:11px;color:#64748b;text-transform:uppercase;">
                <th style="padding:6px 10px;">Arquivo</th>
                <th style="padding:6px 10px;">Nº Guia / DCTF</th>
                <th style="padding:6px 10px;">Valor</th>
                <th style="padding:6px 10px;">Vencimento</th>
                <th style="padding:6px 10px;">Hash Resumo</th>
              </tr>
            </thead>
            <tbody>
              ${filesTableRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

function openValidaDuplicateCompareModal(grupoId) {
  const dupData = validaPdfDuplicates;
  const groups = dupData?.gruposConflito || [];
  const g = groups.find((item, idx) => String(item.grupoId || idx) === String(grupoId));

  if (!g) {
    toast.error('Grupo de duplicidades não encontrado.', 'Erro');
    return;
  }

  const modal = $('modalValidaDuplicateCompare');
  const body = $('modalDupCompareBody');
  const title = $('modalDupCompareTitle');
  const sub = $('modalDupCompareSubtitle');

  if (title) title.textContent = `Comparação: ${g.chave}`;
  if (sub) sub.textContent = g.detalhes || 'Análise de campos extraídos dos documentos em conflito.';

  if (body) {
    const arquivos = g.arquivos || [];
    body.innerHTML = `
      <div style="margin-bottom:16px;background:#f8fafc;padding:12px 16px;border-radius:8px;border:1px solid #e2e8f0;">
        <strong style="font-size:13px;color:#1e293b;display:block;margin-bottom:4px;">Tipo de Diagnóstico:</strong>
        <span style="font-size:12.5px;color:#475569;">${escapeHtml(g.detalhes || '')}</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;">
        ${arquivos.map((f, i) => `
          <div style="background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">
              <span style="font-size:16px;">📄</span>
              <strong style="font-size:12.5px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(f.fileName)}">
                #${i + 1} · ${escapeHtml(f.fileName)}
              </strong>
            </div>

            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
              <div><strong>Subpasta:</strong> <span style="color:#0f766e;">${escapeHtml(f.subpasta || 'Raiz')}</span></div>
              <div><strong>Cliente:</strong> <span>${escapeHtml(f.clienteCnpj || f.clienteCpf || '--')}</span></div>
              <div><strong>Competência:</strong> <span>${escapeHtml(f.competencia || '--')}</span></div>
              <div><strong>Nº Documento / Guia:</strong> <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">${escapeHtml(f.numDoc || 'Não detectado')}</code></div>
              <div><strong>Valor Declarado:</strong> <strong style="color:#0f766e;">${f.valor ? 'R$ ' + escapeHtml(f.valor) : 'Não detectado'}</strong></div>
              <div><strong>Vencimento:</strong> <span>${escapeHtml(f.vencimento || 'Não detectado')}</span></div>
              <div style="font-size:11px;color:#64748b;margin-top:6px;border-top:1px dashed #e2e8f0;padding-top:6px;">
                <strong>SHA-256 Hash:</strong>
                <div style="word-break:break-all;font-family:monospace;font-size:10px;color:#334155;background:#f8fafc;padding:4px;border-radius:4px;margin-top:2px;">
                  ${escapeHtml(f.contentHash || '--')}
                </div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (modal) modal.hidden = false;
}

async function processUploadedPdfFiles(fileList) {
  const pdfs = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) {
    toast.warning('Selecione apenas arquivos no formato PDF (.pdf).', 'Arquivo Inválido');
    return;
  }

  toast.info(`Processando ${pdfs.length} arquivo(s) PDF…`, 'Valida PDF');
  const expectedCnpj = ($('validaExpectedDocId')?.value || '').trim();
  const expectedCompetencia = ($('validaExpectedComp')?.value || '').trim();

  for (const file of pdfs) {
    try {
      const base64 = await readFileAsBase64(file);
      const res = await api('valida-pdf/validate-file', {
        fileName: file.name,
        fileBase64: base64,
        expectedCnpj,
        expectedCompetencia
      });
      validaPdfResults.unshift(res);
      renderValidaPdfResultsTable();
    } catch (err) {
      toast.error(`Erro ao validar ${file.name}: ${err.message}`, 'Falha');
    }
  }

  toast.success('Validação concluída.', 'Valida PDF');
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function switchValidaPdfTab(tabKey) {
  if (tabKey === 'models') {
    switchValidaChip('needs_map');
    const scanner = $('cardValidaScanner') || $('tabValidaFilesContent');
    if (scanner) scanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (tabKey === 'mapping') {
    if ($('modalValidaMapping')) $('modalValidaMapping').hidden = false;
  }
}

// ============================================================================
// CENTRAL DE AJUDA & TUTORIAIS INTERNOS
// ============================================================================
let helpSectionInitialized = false;

function initHelpSection() {
  if (helpSectionInitialized) return;
  helpSectionInitialized = true;

  // Abas de navegação da Central de Ajuda
  const helpTabs = document.querySelectorAll('.btn-help-tab');
  helpTabs.forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const targetTab = tabBtn.dataset.helpTab;
      if (targetTab) switchHelpTab(targetTab);
    });
  });

  // Busca em tempo real nos cards e tutoriais
  const searchInput = $('helpSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterHelpCards(e.target.value);
    });
  }
}

function switchHelpTab(tabKey) {
  const tabs = document.querySelectorAll('.btn-help-tab');
  const contents = document.querySelectorAll('.help-tab-content');

  tabs.forEach(tab => {
    const isCurrent = tab.dataset.helpTab === tabKey;
    tab.classList.toggle('btn-chip-active', isCurrent);
    tab.classList.toggle('btn-ghost', !isCurrent);
  });

  contents.forEach(content => {
    const isTarget = content.id === `helpTabContent-${tabKey}`;
    content.hidden = !isTarget;
    content.style.display = isTarget ? 'block' : 'none';
  });

  const searchInput = $('helpSearchInput');
  if (searchInput && searchInput.value) {
    filterHelpCards(searchInput.value);
  }
}

function filterHelpCards(query) {
  const q = (query || '').toLowerCase().trim();
  const activeContent = document.querySelector('.help-tab-content:not([hidden])');
  if (!activeContent) return;

  const cards = activeContent.querySelectorAll('.card');
  cards.forEach(card => {
    if (!q) {
      card.style.display = '';
    } else {
      const text = (card.textContent || '').toLowerCase();
      card.style.display = text.includes(q) ? '' : 'none';
    }
  });
}

// Inicialização da seção salva após o carregamento de todos os módulos
initHelpSection();
let savedSection = 'all';
try {
  savedSection = localStorage.getItem(SECTION_STORAGE_KEY) || 'all';
} catch { /* sem localStorage */ }
switchSection(savedSection);
updateSidebarBadges();
