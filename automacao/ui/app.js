const $ = id => document.getElementById(id);
let authToken = '', previewId = null, lastReport = null, working = false, downloadFiles = [], liveCatalog = null, catalogLive = false, taskCatalog = [], tasksAutoFilled = false, loginPoll = null, loginPollBusy = false, savedMappings = [], editingTask = null, selectedTasks = new Set();
let sourceVersion = 0, lastAuditKey = '', auditPoll = null, resultsPage = 0;
const RESULTS_PAGE_SIZE = 50;
const labels = { vazio: 'Sem resposta', ja_correto: 'Já correto', divergente: 'Divergente', nao_encontrado: 'Não localizado', bloqueado: 'Bloqueado', sem_mapeamento: 'Sem mapeamento', nao_verificado: 'Não verificado', pronto: 'Elegível' };
const ACCOUNT_KEY = 'gclick.lastAccount';
const currentAccount = () => $('accountId').value.trim();
function status(message, kind = '') { $('status').textContent = message; $('status').className = `status ${kind}`; }
function sourceType() { return document.querySelector('input[name="sourceType"]:checked').value; }
const normalizeTask = value => String(value ?? '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
function clearPreview() { previewId = null; lastReport = null; $('summary').hidden = true; $('downloads').hidden = true; $('missingPanel').hidden = true; $('invalidPanel').hidden = true; $('mappingResult').hidden = true; $('results').innerHTML = '<tr><td colspan="5" class="empty">Nenhum resultado ainda.</td></tr>'; resultsPage = 0; $('resultsPager').hidden = true; updateApply(); }
function catalogAnswer(ref) {
  for (const question of liveCatalog?.questions ?? []) {
    const answer = question.answers.find(item => item.ref === ref);
    if (answer) return { question, answer };
  }
  return null;
}
function renderCatalogOverview() {
  $('catalogOverview').hidden = !liveCatalog;
  if (!liveCatalog) return;
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
    $('mappingEditor').hidden = true; editingTask = null; clearPreview(); renderQueue();
    status(excluded ? 'Tarefa marcada como excluída para esta conta.' : answerRef ? catalogLive ? 'Mapeamento salvo após conferência no catálogo atual.' : 'Mapeamento provisório salvo. Conecte a Enquete para conferir antes da prévia.' : 'Associação removida.', 'ok');
    maybeAutoAudit();
  } catch (error) { $('editorHint').textContent = error.message; }
}
function useCatalog(catalog, verified = false) {
  if (!catalog || String(catalog.accountId) !== $('accountId').value.trim()) throw new Error('O catálogo pertence a outra conta G-Click');
  liveCatalog = catalog; catalogLive = verified;
  renderCatalogOverview();
  if ($('queueFilter').value === 'attention' && !$('queueSearch').value && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state)))
    $('queueFilter').value = 'ready';
  renderQueue();
  maybeAutoAudit();
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
function startLoginPoll() {
  if (loginPoll) return;
  loginPoll = setInterval(async () => {
    if (working || loginPollBusy || catalogLive) return;
    loginPollBusy = true;
    try {
      const result = await api('login/close', { accountId: currentAccount(), auto: true });
      if (result.catalog) {
        useCatalog(result.catalog, true);
        stopLoginPoll();
        status(`Enquete da conta ${result.catalog.accountId} aberta automaticamente. Catálogo com ${result.catalog.questionCount} perguntas carregado.`, 'ok');
      } else if (result.message) status(result.message, result.stage === 'no_access' ? 'error' : '');
    } catch { /* O login ou a escolha da conta ainda está em andamento. */ }
    finally { loginPollBusy = false; }
  }, 5000);
}
let lastSourceKey = '';
function sourceKey() {
  if (sourceType() === 'recent') { const f = downloadFiles.find(x => x.name === $('downloadFile').value); return `recent:${f?.name}:${f?.modifiedAt}:${f?.size}`; }
  if (sourceType() === 'file') { const f = $('file').files[0]; return `file:${f?.name}:${f?.lastModified}:${f?.size}`; }
  return `url:${$('sourceUrl').value.trim()}:${Date.now()}`;
}
async function loadTasks() {
  try {
    $('taskStatus').textContent = 'Lendo as tarefas da fonte selecionada…';
    const result = await api('tasks', await payload('tasks'));
    taskCatalog = result.tasks;
    // Só uma planilha diferente (outro arquivo, outra versão) dispara nova conferência; reler a mesma não.
    const key = sourceKey();
    if (key !== lastSourceKey) { lastSourceKey = key; sourceVersion++; }
    $('taskStatus').textContent = `${taskCatalog.length} nomes de tarefa encontrados em ${result.rowCount} linhas (${result.source}).`;
    if ($('queueFilter').value === 'attention' && !$('queueSearch').value.trim() && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state))) $('queueFilter').value = 'ready';
    renderQueue();
    maybeAutoAudit();
  } catch (e) { taskCatalog = []; renderQueue(); $('taskStatus').textContent = e.message; }
}
function dataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function payload(mode) {
  const out = { mode, sourceType: sourceType() };
  if (out.sourceType === 'recent') { out.downloadFile = $('downloadFile').value; if (!out.downloadFile) throw new Error('Selecione o CSV baixado da aba da planilha'); }
  else if (out.sourceType === 'file') { const file = $('file').files[0]; if (!file) throw new Error('Selecione um arquivo CSV ou XLSX'); out.fileName = file.name; out.fileLastModified = file.lastModified; out.fileBase64 = await dataUrl(file); out.sheetName = $('sheetName').value.trim(); }
  else { out.sourceUrl = $('sourceUrl').value.trim(); const key = $('serviceKey').files[0]; if (key) { if (key.size > 100 * 1024) throw new Error('JSON da conta de serviço maior que 100 KB'); out.serviceKeyBase64 = await dataUrl(key); } }
  return out;
}
async function api(endpoint, data) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GClick-Token': authToken }, body: JSON.stringify(data ?? {}) });
    const body = await response.json();
    if (response.status === 403 && body.code === 'invalid_session' && attempt === 0) {
      const config = await fetch('/api/config', { cache: 'no-store' }).then(r => r.json());
      authToken = config.token;
      continue;
    }
    if (!response.ok) throw new Error(body.error || 'Falha na operação');
    return body;
  }
}
function setBusy(value) { working = value; for (const id of ['openLogin','closeLogin']) $(id).disabled = value; updateApply(); }
function metric(label, value, kind = '') { const d = document.createElement('div'); d.className = `metric ${kind}`; const strong = document.createElement('strong'); strong.textContent = value; const span = document.createElement('span'); span.textContent = label; d.append(strong, span); return d; }
function render(report) {
  lastReport = report;
  const items = report.inspected ?? report.plan ?? [];
  const missing = items.filter(x => x.uiStatus === 'nao_encontrado');
  $('modePill').textContent = report.mode === 'account_audit' ? report.complete === false ? 'Conferência incompleta' : 'Conferência automática' : report.mode === 'preview' || report.mode === 'mapping_preview' ? 'Prévia' : ['apply', 'mapping_apply'].includes(report.mode) ? 'Gravação' : 'Planilha';
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
    if (report.mode === 'account_audit') { const p = document.createElement('p'); p.textContent = `${report.sourceCnpjCount} CNPJs distintos na planilha · ${report.sourceTaskCount} tarefas · ${report.mappings.length} tarefas verificadas na Enquete.`; $('mappingResult').append(p); }
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
}
function renderResultRows(report) {
  const items = report.inspected ?? report.plan ?? [];
  const filter = $('filter').value;
  const visible = items.filter(x => filter === 'all' || (x.uiStatus ?? x.status) === filter);
  const totalPages = Math.max(1, Math.ceil(visible.length / RESULTS_PAGE_SIZE));
  resultsPage = Math.min(resultsPage, totalPages - 1);
  const start = resultsPage * RESULTS_PAGE_SIZE;
  const tbody = $('results'); tbody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const x of visible.slice(start, start + RESULTS_PAGE_SIZE)) {
    const tr = document.createElement('tr'); const identity = document.createElement('td'); const bold = document.createElement('strong'); bold.textContent = x.cnpj; const company = document.createElement('div'); company.className = 'company'; company.textContent = x.empresa ?? ''; identity.append(bold, company);
    const emp = document.createElement('td'); emp.textContent = x.empId ?? '—'; const task = document.createElement('td'); task.textContent = x.mappingTask ?? (x.tasks?.filter(t => report.rules.allowedTasks.includes(t)).join(' | ') || '—');
    const state = document.createElement('td'); const tag = document.createElement('span'); const code = x.uiStatus ?? x.status; tag.className = `status-tag ${code}`; tag.textContent = code === 'vazio' && report.rules.inputType === 'checkbox' ? 'Não marcada' : labels[code] ?? code; state.append(tag);
    const detail = document.createElement('td'); detail.textContent = x.uiReason ?? x.reason ?? ''; tr.append(identity, emp, task, state, detail); fragment.append(tr);
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
  $('applyCard').hidden = !['mapping_preview', 'account_audit', 'mapping_apply'].includes(lastReport?.mode);
  $('apply').disabled = !ctx?.allowed;
  $('apply').textContent = ctx?.count ? `Marcar ${ctx.count} resposta(s) no G-Click` : 'Marcar respostas no G-Click';
  $('applyReason').textContent = ctx?.reason ?? 'A gravação só é liberada após uma prévia ou conferência completa e com opções a marcar.';
}
function auditKey() { return `${currentAccount()}:${liveCatalog?.capturedAt}:${sourceVersion}:${JSON.stringify(savedMappings)}`; }
async function maybeAutoAudit() {
  if (!catalogLive) { $('auditStatus').textContent = 'Aguardando a Enquete atual da conta. O catálogo anterior serve apenas para preparar associações.'; return; }
  if (!taskCatalog.length) { $('auditStatus').textContent = 'Informe ou selecione a planilha para carregar os CNPJs.'; return; }
  if (working) return;
  const key = auditKey();
  if (key === lastAuditKey) return;
  lastAuditKey = key;
  try {
    setBusy(true); renderQueue(); clearPreview();
    $('auditStatus').textContent = 'Conferindo automaticamente as tarefas mapeadas para todos os CNPJs da planilha…';
    $('auditProgress').hidden = false; $('auditProgress').value = 0;
    auditPoll = setInterval(async () => { try { const progress = await api('audit/progress', {}); if (progress.total) { $('auditProgress').value = Math.round(100 * progress.completed / progress.total); $('auditStatus').textContent = `${progress.completed}/${progress.total} tarefas avaliadas${progress.task ? ` · ${progress.task}` : ''}`; } } catch { /* A requisição principal exibirá a falha. */ } }, 1500);
    const request = await payload('account_audit'); request.accountId = currentAccount(); request.autoAudit = true;
    const result = await api('mappings/preview', request);
    previewId = result.previewId;
    render(result.report);
    $('auditProgress').value = 100;
    $('auditStatus').textContent = `${result.report.complete === false ? 'Incompleto' : 'Concluído'}: ${result.report.mappings.length} tarefas verificadas; ${result.report.pendingTasks.length} sem associação; ${result.report.failedTasks.length} com falha de leitura.`;
    status(lastApplySummary ? `${lastApplySummary} Conferência atualizada com o estado atual da Enquete.` : 'Conferência automática concluída. Nada foi gravado; veja o próximo passo abaixo.', 'ok');
    lastApplySummary = '';
  } catch (error) { $('auditStatus').textContent = `Não foi possível conferir automaticamente: ${error.message}`; status(error.message, 'error'); }
  finally { if (auditPoll) clearInterval(auditPoll); auditPoll = null; $('auditProgress').hidden = true; setBusy(false); renderQueue(); if (auditKey() !== key) maybeAutoAudit(); }
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
    lastApplySummary = `Gravação concluída: ${changed} resposta(s) marcada(s) e conferida(s) após recarga${cancelled ? `; ${cancelled} pergunta(s) cancelada(s) por você` : ''}.`;
    status(lastApplySummary, 'ok');
  } catch (e) { applyRunning = false; status(`${e.message} Confira o relatório e a Enquete antes de repetir.`, 'error'); previewId = null; }
  finally { clearInterval(poll); applyRunning = false; setBusy(false); lastAuditKey = ''; setTimeout(maybeAutoAudit, 500); }
}
function showDownloadSelection() { const selected = downloadFiles.find(x => x.name === $('downloadFile').value); $('downloadHint').textContent = selected ? `Selecionado: ${selected.name} · baixado em ${new Date(selected.modifiedAt).toLocaleString('pt-BR')}${selected.stale ? ' · antigo para gravação' : ''}` : 'Nenhum CSV da aba selecionado.'; }
function updateRecentSheetLinks() {
  const download = $('directExport'), open = $('openSheet'), hint = $('recentUrlHint');
  try {
    if (!$('recentSheetUrl').value.trim()) { download.removeAttribute('href'); open.removeAttribute('href'); hint.textContent = 'Cole o link da aba da planilha deste escritório; ele fica salvo para a conta.'; return; }
    const url = new URL($('recentSheetUrl').value.trim());
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) throw new Error('Informe um link válido de uma aba do Google Sheets.');
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const gid = url.searchParams.get('gid') ?? hash.get('gid') ?? '0';
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
    const selectedBefore = downloadFiles.find(x => x.name === $('downloadFile').value);
    const previous = selectedBefore && `${selectedBefore.name}:${selectedBefore.modifiedAt}:${selectedBefore.size}`;
    const result = await api('downloads', {});
    downloadFiles = result.files;
    const select = $('downloadFile'); select.replaceChildren();
    if (!result.files.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Nenhum CSV recente com as colunas exigidas'; select.append(option);
    } else for (const file of result.files) {
      const option = document.createElement('option'); option.value = file.name;
      option.textContent = `${file.name} — ${new Date(file.modifiedAt).toLocaleString('pt-BR')}${file.stale ? ' (antigo)' : ''}`;
      select.append(option);
    }
    const selectedAfter = downloadFiles.find(x => x.name === select.value);
    const current = selectedAfter && `${selectedAfter.name}:${selectedAfter.modifiedAt}:${selectedAfter.size}`;
    if (previous && previous !== current) {
      selectedTasks.clear(); renderQueue();
      if (previewId) status('O CSV selecionado mudou. Gere uma nova prévia antes de gravar.', 'warn');
      clearPreview();
    }
    showDownloadSelection(); updateApply(); if (select.value) await loadTasks();
  } catch (e) { status(e.message, 'error'); }
}
async function login(endpoint) {
  try {
    setBusy(true); clearPreview(); stopLoginPoll();
    status(endpoint === 'login/open' ? 'Abrindo o Chrome na página de autenticação do G-Click…' : 'Capturando perguntas e respostas da Enquete…');
    if (!/^\d+$/.test(currentAccount())) throw new Error('Informe o código da conta G-Click (empId do escritório) antes de conectar.');
    const result = await api(endpoint, { accountId: currentAccount() });
    if (result.catalog) useCatalog(result.catalog, true);
    else if (endpoint === 'login/open') {
      liveCatalog = null; catalogLive = false; renderCatalogOverview(); renderQueue();
      startLoginPoll();
    }
    status(endpoint === 'login/open' ? 'Entre no G-Click na janela que abriu e mantenha-a aberta. Depois do login, o robô abre sozinho a Enquete desta conta e lê as perguntas.' : `Catálogo atual conferido: ${result.catalog.questionCount} perguntas.`, 'ok');
  } catch (error) { status(error.message, 'error'); if (endpoint === 'login/close') startLoginPoll(); }
  finally { setBusy(false); maybeAutoAudit(); }
}
for (const input of document.querySelectorAll('input[name="sourceType"]')) input.addEventListener('change', () => { $('fileBox').hidden = sourceType() !== 'file'; $('urlBox').hidden = sourceType() !== 'url'; $('recentBox').hidden = sourceType() !== 'recent'; taskCatalog = []; selectedTasks.clear(); renderQueue(); $('taskStatus').textContent = 'Leia as tarefas da fonte selecionada.'; clearPreview(); if (sourceType() === 'recent') refreshDownloads(); });
for (const id of ['accountId','file','sheetName','sourceUrl','recentSheetUrl','serviceKey']) $(id).addEventListener('input', () => { previewId = null; updateApply(); });
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
  } catch (error) { status(error.message, 'error'); }
}
function renderAccountList() {
  $('accountList').replaceChildren(...(config.accounts ?? []).map(a => new Option(`${a.mappings} mapeamento(s)${a.capturedAt ? ` · catálogo de ${new Date(a.capturedAt).toLocaleDateString('pt-BR')}` : ''}${a.sheetUrl ? ' · planilha salva' : ''}`, a.accountId)));
}
$('recentSheetUrl').addEventListener('input', updateRecentSheetLinks);
$('recentSheetUrl').addEventListener('change', saveSheetUrl);
$('sourceUrl').addEventListener('change', saveSheetUrl);
$('directExport').addEventListener('click', () => {
  const requestedAt = Date.now();
  status('Download solicitado. Aguardando o arquivo chegar em ~/Downloads…');
  let attempts = 0;
  const check = async () => {
    attempts++;
    await refreshDownloads();
    if (downloadFiles.some(file => new Date(file.modifiedAt).getTime() >= requestedAt - 5000)) { status('CSV novo encontrado em ~/Downloads e selecionado.', 'ok'); return; }
    if (attempts < 8) { setTimeout(check, 3000); return; }
    status('O CSV não chegou em ~/Downloads. Confira se o navegador salvou em outra pasta ou pediu para escolher o local, e se a planilha abriu logada. Alternativa: em Fonte da planilha, escolha Arquivo e envie o CSV baixado.', 'error');
  };
  setTimeout(check, 2500);
});
$('refreshDownloads').addEventListener('click', refreshDownloads); $('downloadFile').addEventListener('change', () => { taskCatalog = []; selectedTasks.clear(); renderQueue(); clearPreview(); showDownloadSelection(); loadTasks(); });
$('file').addEventListener('change', () => { if (sourceType() === 'file' && $('file').files.length) loadTasks(); });
$('queueSearch').addEventListener('input', renderQueue); $('queueFilter').addEventListener('change', renderQueue);
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
    taskCatalog = []; selectedTasks.clear(); clearPreview();
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
  selectedTasks.clear(); renderQueue(); maybeAutoAudit();
}
$('accountId').addEventListener('change', loadAccountCatalog);
$('filter').addEventListener('change', () => { resultsPage = 0; if (lastReport) renderResultRows(lastReport); });
$('resultsPrev').addEventListener('click', () => { if (lastReport && resultsPage > 0) { resultsPage--; renderResultRows(lastReport); } });
$('resultsNext').addEventListener('click', () => { if (lastReport) { resultsPage++; renderResultRows(lastReport); } });
$('apply').addEventListener('click', apply);
$('openLogin').addEventListener('click', () => login('login/open')); $('closeLogin').addEventListener('click', () => login('login/close'));
const config = await fetch('/api/config').then(r => r.json()); authToken = config.token; savedMappings = config.savedMappings ?? [];
renderAccountList();
if (config.catalogLive && config.catalog?.accountId) $('accountId').value = config.catalog.accountId;
else { try { const last = localStorage.getItem(ACCOUNT_KEY); if (last) $('accountId').value = last; } catch { /* sem preferência local */ } }
if (config.catalog && config.catalogLive) useCatalog(config.catalog, true);
else if (currentAccount()) await loadAccountCatalog();
loadedAccount = currentAccount() || null;
if (currentAccount() && !$('recentSheetUrl').value) setSheetUrl((config.accounts ?? []).find(a => a.accountId === currentAccount())?.sheetUrl ?? '');
if (config.loginReady) status('Sessão da Enquete pronta. Mantenha a janela do Chrome aberta durante o uso.', 'ok');
else if (config.loginOpen) { status('Janela de login aberta. A captura ocorrerá quando a Enquete da conta estiver disponível.'); startLoginPoll(); }
else status(config.sessionLostAt ? 'A janela do Chrome da automação foi fechada. Clique em Abrir janela de login e entre de novo.' : 'Informe a conta e clique em Abrir janela de login. As perguntas aparecem depois que o robô ler a Enquete do escritório.', config.sessionLostAt ? 'error' : '');
updateRecentSheetLinks();
renderQueue();
if (sourceType() === 'recent') refreshDownloads();
