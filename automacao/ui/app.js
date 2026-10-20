const $ = id => document.getElementById(id);
let authToken = '', previewId = null, lastReport = null, working = false, downloadFiles = [], liveCatalog = null, catalogLive = false, referenceCatalog = null, taskCatalog = [], tasksAutoFilled = false, loginPoll = null, loginPollBusy = false, savedMappings = [], editingTask = null, selectedTasks = new Set();
let sourceVersion = 0, lastAuditKey = '', auditPoll = null, resultsPage = 0;
const RESULTS_PAGE_SIZE = 50;
const labels = { vazio: 'Sem resposta', ja_correto: 'Já correto', divergente: 'Divergente', nao_encontrado: 'Não localizado', bloqueado: 'Bloqueado', sem_mapeamento: 'Sem mapeamento', pronto: 'Elegível' };
function status(message, kind = '') { $('status').textContent = message; $('status').className = `status ${kind}`; }
function sourceType() { return document.querySelector('input[name="sourceType"]:checked').value; }
function scopeMode() { return document.querySelector('input[name="scopeMode"]:checked').value; }
function readRules() { return { accountId: $('accountId').value.trim(), category: $('category').value.trim(), question: $('question').value.trim(), questionRef: $('questionRef').value.trim(), answerRef: $('answerRef').value.trim(), answerValue: $('answerValue').value.trim(), answerLabel: $('answerLabel').value.trim(), inputType: $('inputType').value, allowedTasks: $('allowedTasks').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean), excludedTasks: $('excludedTasks').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean) }; }
const normalizeTask = value => String(value ?? '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
function taskSuggestions(label) { const target = normalizeTask(label); return taskCatalog.filter(task => normalizeTask(task.name) === target || normalizeTask(task.name).startsWith(`${target} - `)); }
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
    for (const answer of question.answers) { const p = document.createElement('p'); p.textContent = `${answer.ref} · ${answer.display} · código ${answer.value}`; details.append(p); }
    $('catalogOverviewList').append(details);
  }
}
function mappingFor(task) {
  const accountId = $('accountId').value.trim();
  const excluded = (config.presets ?? []).some(p => p.rules.accountId === accountId && p.rules.excludedTasks.includes(task.name));
  if (excluded) return { state: 'excluded', label: 'Excluída por regra salva' };
  const custom = savedMappings.find(m => m.accountId === accountId && m.task === task.name);
  if (custom) {
    const found = catalogAnswer(custom.answerRef);
    return found ? { state: catalogLive ? 'ready' : 'candidate', origin: 'Confirmada', ref: custom.answerRef, label: `${found.question.ref} · ${found.question.label} → ${found.answer.display}${catalogLive ? '' : ' · conferir na conta'}` }
      : { state: liveCatalog ? 'attention' : 'known', label: liveCatalog ? 'A resposta salva não consta no catálogo atual' : `Associação salva ${custom.answerRef} · aguardando catálogo`, ref: custom.answerRef };
  }
  const preset = (config.presets ?? []).find(p => p.rules.accountId === accountId && p.rules.allowedTasks.includes(task.name));
  if (preset) {
    const found = catalogAnswer(preset.rules.answerRef);
    return { state: found ? catalogLive ? 'ready' : 'candidate' : liveCatalog ? 'attention' : 'known', origin: 'Regra conhecida', ref: preset.rules.answerRef,
      label: found ? `${found.question.ref} · ${found.question.label} → ${found.answer.display}${catalogLive ? '' : ' · conferir na conta'}` : liveCatalog ? 'A resposta da regra conhecida não consta no catálogo disponível' : `${preset.rules.questionRef} → ${preset.rules.answerRef} · aguardando catálogo` };
  }
  if (!liveCatalog) return { state: 'awaiting', label: 'Aguardando catálogo da Enquete' };
  const suggestions = liveCatalog.questions.flatMap(question => question.answers
    .filter(answer => normalizeTask(task.name) === normalizeTask(answer.label) || normalizeTask(task.name).startsWith(`${normalizeTask(answer.label)} - `))
    .map(answer => ({ question, answer })));
  if (suggestions.length === 1) return { state: 'suggested', ref: suggestions[0].answer.ref,
    label: `Sugestão pelo nome: ${suggestions[0].question.ref} → ${suggestions[0].answer.display}${catalogLive ? '' : ' · catálogo anterior'}` };
  return { state: 'attention', label: suggestions.length ? `${suggestions.length} respostas possíveis; escolha uma` : `Nenhuma associação segura pelo nome${catalogLive ? '' : ' no catálogo anterior'}` };
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
    const facts = [[all.length, 'tarefas da planilha'], [ready, 'verificadas na conta'], [candidate, 'associadas no catálogo anterior'], [known, 'salvas aguardando catálogo'], [awaiting, 'aguardam catálogo'], [suggested, 'sugestões para revisar'], [attention - suggested, 'sem associação segura'], [excluded, 'excluídas'], [selectedTasks.size, 'selecionada(s)']];
    for (const [count, label] of facts.filter(([count, label]) => count || label === 'tarefas da planilha' || label === 'selecionada(s)')) {
      const chip = document.createElement('span'); chip.textContent = `${count} ${label}`; $('queueSummary').append(chip, document.createTextNode(' '));
    }
  } else $('queueSummary').textContent = 'Carregue a planilha para listar as obrigações e tarefas.';
  $('previewMappings').disabled = !catalogLive || !selectedTasks.size || working;
  $('previewHint').textContent = catalogLive ? selectedTasks.size ? 'As tarefas marcadas serão consultadas na Enquete. Nenhuma resposta será gravada.' : 'Abra “Associadas”, marque uma ou mais tarefas e gere a prévia.' : 'Você pode preparar os mapeamentos agora. Para a prévia, abra a Enquete no Chrome da automação; as referências serão conferidas na conta atual.';
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
    if (['ready', 'candidate'].includes(mapping.state)) {
      const choice = document.createElement('label'); choice.className = 'queue-select';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedTasks.has(task.name);
      checkbox.addEventListener('change', () => { if (checkbox.checked) selectedTasks.add(task.name); else selectedTasks.delete(task.name); renderQueue(); });
      choice.append(checkbox, document.createTextNode(' Incluir nesta prévia')); main.append(choice);
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
async function saveMapping(answerRef) {
  if (!editingTask) return;
  if (answerRef && !catalogAnswer(answerRef)) { $('editorHint').textContent = 'Selecione uma resposta válida.'; return; }
  try {
    const result = await api('mappings/save', { accountId: $('accountId').value.trim(), task: editingTask, answerRef });
    savedMappings = result.savedMappings;
    if (answerRef) selectedTasks.add(editingTask); else selectedTasks.delete(editingTask);
    $('mappingEditor').hidden = true; editingTask = null; clearPreview(); renderQueue();
    status(answerRef ? catalogLive ? 'Mapeamento salvo após conferência no catálogo atual.' : 'Mapeamento provisório salvo. Conecte a Enquete para conferir antes da prévia.' : 'Associação personalizada removida.', 'ok');
    maybeAutoAudit();
  } catch (error) { $('editorHint').textContent = error.message; }
}
function fillQuestionChoices(search = '') {
  if (!liveCatalog) return;
  const current = $('questionRef').value;
  const query = normalizeTask(search);
  $('questionChoice').replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecione uma pergunta'; $('questionChoice').append(placeholder);
  for (const q of liveCatalog.questions.filter(q => normalizeTask(`${q.ref} ${q.label} ${q.category}`).includes(query))) {
    const option = document.createElement('option'); option.value = q.ref; option.textContent = `${q.ref} — ${q.label} · ${q.category}`; $('questionChoice').append(option);
  }
  $('questionChoice').value = [...$('questionChoice').options].some(o => o.value === current) ? current : '';
  fillAnswerChoices();
}
function fillAnswerChoices() {
  $('answerChoice').replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecione uma resposta'; $('answerChoice').append(placeholder);
  const q = liveCatalog?.questions.find(x => x.ref === $('questionChoice').value);
  if (!q) return;
  for (const answer of q.answers) { const option = document.createElement('option'); option.value = answer.ref; option.textContent = `${answer.ref} — ${answer.display} (código ${answer.value})`; $('answerChoice').append(option); }
  $('answerChoice').value = q.answers.some(x => x.ref === $('answerRef').value) ? $('answerRef').value : '';
}
function useCatalog(catalog, verified = false) {
  if (!catalog || String(catalog.accountId) !== $('accountId').value.trim()) throw new Error('O catálogo pertence a outra conta G-Click');
  liveCatalog = catalog; catalogLive = verified;
  renderCatalogOverview();
  $('catalogPanel').hidden = false;
  $('catalogStatus').textContent = `${catalog.questionCount} perguntas e ${catalog.answerCount} respostas ${verified ? 'conferidas na conta' : 'da cópia anterior'} ${catalog.accountId} (${new Date(catalog.capturedAt).toLocaleString('pt-BR')}).`;
  fillQuestionChoices($('questionSearch').value);
  $('mappingHint').textContent = verified ? 'Catálogo atual carregado. As associações podem ser conferidas na prévia.' : 'Catálogo anterior disponível para preparar associações; a prévia exige conexão atual.';
  if ($('queueFilter').value === 'attention' && !$('queueSearch').value && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state)))
    $('queueFilter').value = 'ready';
  renderQueue();
  maybeAutoAudit();
}
function stopLoginPoll() { if (loginPoll) clearInterval(loginPoll); loginPoll = null; }
function startLoginPoll() {
  if (loginPoll) return;
  loginPoll = setInterval(async () => {
    if (working || loginPollBusy || catalogLive) return;
    loginPollBusy = true;
    try {
      const result = await api('login/close', { accountId: $('accountId').value.trim(), auto: true });
      if (result.catalog) {
        useCatalog(result.catalog, true);
        stopLoginPoll();
        status(`Acesso confirmado. Catálogo com ${result.catalog.questionCount} perguntas carregado.`, 'ok');
      }
    } catch { /* O login ou a escolha da conta ainda está em andamento. */ }
    finally { loginPollBusy = false; }
  }, 5000);
}
function selectAnswer() {
  const q = liveCatalog?.questions.find(x => x.ref === $('questionChoice').value);
  const answer = q?.answers.find(x => x.ref === $('answerChoice').value);
  if (!q || !answer) return;
  const presetIndex = config.presets.findIndex(p => p.rules.accountId === liveCatalog.accountId && p.rules.answerRef === answer.ref);
  $('category').value = q.category; $('question').value = q.label; $('questionRef').value = q.ref;
  $('answerRef').value = answer.ref; $('answerValue').value = answer.value; $('answerLabel').value = answer.display; $('inputType').value = 'auto';
  const matches = presetIndex < 0 ? taskSuggestions(answer.label) : [];
  if (presetIndex >= 0) $('rulePreset').value = String(presetIndex);
  $('allowedTasks').value = presetIndex >= 0 ? config.presets[presetIndex].rules.allowedTasks.join('\n') : matches.map(x => x.name).join('\n');
  $('excludedTasks').value = presetIndex >= 0 ? config.presets[presetIndex].rules.excludedTasks.join('\n') : '';
  tasksAutoFilled = presetIndex < 0;
  $('mappingHint').textContent = presetIndex >= 0 ? `Tarefas salvas em ${config.presets[presetIndex].name}. Dados da pergunta atualizados pelo G-Click.` : matches.length ? `${matches.length} tarefa(s) sugerida(s) pelo nome da resposta. Revise antes da prévia.` : 'Nenhuma tarefa corresponde claramente ao nome da resposta. Selecione as tarefas exatas na planilha antes da prévia.';
  clearPreview();
}
async function loadTasks() {
  try {
    $('taskStatus').textContent = 'Lendo as tarefas da fonte selecionada…';
    const result = await api('tasks', await payload('tasks'));
    taskCatalog = result.tasks;
    sourceVersion++;
    $('taskStatus').textContent = `${taskCatalog.length} nomes de tarefa encontrados em ${result.rowCount} linhas (${result.source}).`;
    if ($('queueFilter').value === 'attention' && !$('queueSearch').value.trim() && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state))) $('queueFilter').value = 'ready';
    renderQueue();
    maybeAutoAudit();
    const q = liveCatalog?.questions.find(x => x.ref === $('questionChoice').value);
    const answer = q?.answers.find(x => x.ref === $('answerChoice').value);
    const saved = (config.presets ?? []).some(p => p.rules.answerRef === answer?.ref && p.rules.accountId === liveCatalog?.accountId);
    if (answer && !saved && tasksAutoFilled) selectAnswer();
  } catch (e) { taskCatalog = []; renderQueue(); $('taskStatus').textContent = e.message; }
}
function dataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function payload(mode) {
  const out = { mode, rules: readRules(), sourceType: sourceType(), scopeMode: scopeMode(), cnpjsText: $('cnpjsText').value };
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
function setBusy(value) { working = value; for (const id of ['openLogin','closeLogin','loadTasks','plan','preview','previewMappings']) $(id).disabled = value; updateApply(); }
function metric(label, value, kind = '') { const d = document.createElement('div'); d.className = `metric ${kind}`; const strong = document.createElement('strong'); strong.textContent = value; const span = document.createElement('span'); span.textContent = label; d.append(strong, span); return d; }
function render(report) {
  lastReport = report;
  const items = report.inspected ?? report.plan ?? [];
  const missing = items.filter(x => x.uiStatus === 'nao_encontrado');
  $('modePill').textContent = report.mode === 'account_audit' ? 'Conferência automática' : report.mode === 'preview' || report.mode === 'mapping_preview' ? 'Prévia' : report.mode === 'apply' ? 'Gravação' : 'Planilha';
  $('mappingResult').hidden = !['mapping_preview', 'account_audit'].includes(report.mode);
  if (['mapping_preview', 'account_audit'].includes(report.mode)) {
    const lines = report.mappings.map(x => `${x.task}: ${x.clients} CNPJ(s) · ${x.summary.vazio} sem marcação · ${x.summary.ja_correto} corretos · ${x.summary.nao_encontrado} não localizados · ${x.summary.divergente + x.summary.bloqueado} bloqueados`);
    $('mappingResult').replaceChildren();
    if (report.mode === 'account_audit') { const p = document.createElement('p'); p.textContent = `${report.sourceCnpjCount} CNPJs distintos na planilha · ${report.sourceTaskCount} tarefas · ${report.mappings.length} tarefas verificadas na Enquete.`; $('mappingResult').append(p); }
    for (const line of lines) { const p = document.createElement('p'); p.textContent = line; $('mappingResult').append(p); }
    if (report.pendingTasks.length) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.className = 'queue-warning'; summary.textContent = `${report.pendingTasks.length} tarefa(s) sem associação com uma resposta da Enquete: estado não verificável`; details.append(summary); for (const task of report.pendingTasks) { const p = document.createElement('p'); p.textContent = task; details.append(p); } $('mappingResult').append(details); }
    if (report.failedTasks?.length) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.className = 'queue-warning'; summary.textContent = `${report.failedTasks.length} tarefa(s) com falha na leitura`; details.append(summary); for (const item of report.failedTasks) { const p = document.createElement('p'); p.textContent = `${item.task}: ${item.reason}`; details.append(p); } $('mappingResult').append(details); }
    if (report.excludedTasks?.length) { const p = document.createElement('p'); p.textContent = `${report.excludedTasks.length} tarefa(s) excluída(s) por regra.`; $('mappingResult').append(p); }
  }
  const summary = $('summary'); summary.hidden = false; summary.replaceChildren(metric(report.mode === 'account_audit' ? 'Pares CNPJ/tarefa na fonte' : 'CNPJs no escopo', items.length), metric(report.rules.inputType === 'checkbox' ? 'Não marcadas' : 'Sem resposta', report.summary?.vazio ?? 0), metric('Já corretos', report.summary?.ja_correto ?? 0), metric('Sem mapeamento', report.summary?.sem_mapeamento ?? 0, report.summary?.sem_mapeamento ? 'warn' : ''), metric('Não localizados', missing.length, missing.length ? 'bad' : ''), metric('Divergentes / bloqueados', (report.summary?.divergente ?? 0) + (report.summary?.bloqueado ?? 0), 'warn'), metric('CNPJ inválido na fonte', report.invalidSource?.length ?? 0, report.invalidSource?.length ? 'warn' : ''));
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
function updateApply() {
  const items = lastReport?.inspected ?? [];
  const blockers = items.some(x => ['nao_encontrado','divergente','bloqueado'].includes(x.uiStatus));
  const allowed = Boolean(previewId && !working && lastReport?.mode === 'preview' && !blockers && !lastReport?.sourceStale && items.some(x => x.uiStatus === 'vazio'));
  $('confirmText').disabled = !allowed; $('apply').disabled = !allowed || $('confirmText').value.trim() !== `APLICAR ${items.length}`;
  $('confirmText').placeholder = allowed ? `Digite APLICAR ${items.length}` : 'Gere uma prévia sem bloqueios';
  $('applyReason').textContent = blockers ? 'Prévia com CNPJ ausente, divergência ou bloqueio. Revise o relatório.' : lastReport?.sourceStale ? 'Arquivo antigo. Envie uma exportação com menos de 24 horas.' : allowed ? `Para liberar, digite APLICAR ${items.length}.` : 'A gravação só é liberada após uma prévia sem bloqueios e com opções a marcar.';
}
async function run(mode) { try { setBusy(true); previewId = null; status(mode === 'preview' ? 'Consultando a enquete. Aguarde…' : 'Analisando a planilha…'); const result = await api('run', await payload(mode)); previewId = result.previewId; render(result.report); status(mode === 'preview' ? 'Prévia concluída. Confira os CNPJs não localizados e os bloqueios.' : 'Análise da planilha concluída. Gere uma prévia para consultar a enquete.', 'ok'); } catch (e) { status(e.message, 'error'); } finally { setBusy(false); } }
async function previewMappings() { try { if (!selectedTasks.size) throw new Error('Abra “Associadas” e marque uma tarefa para esta prévia'); if (!catalogLive) throw new Error('Conecte a Enquete para conferir o catálogo atual antes da prévia'); setBusy(true); clearPreview(); status('Consultando as perguntas das tarefas selecionadas…'); const request = await payload('mapping_preview'); request.accountId = $('accountId').value.trim(); request.selectedTasks = [...selectedTasks]; const result = await api('mappings/preview', request); render(result.report); status('Prévia de leitura concluída. Confira os CNPJs não localizados e os bloqueios.', 'ok'); } catch (error) { status(error.message, 'error'); } finally { setBusy(false); renderQueue(); } }
function auditKey() { return `${$('accountId').value.trim()}:${liveCatalog?.capturedAt}:${sourceVersion}:${JSON.stringify(savedMappings)}`; }
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
    const request = await payload('account_audit'); request.accountId = $('accountId').value.trim(); request.autoAudit = true;
    const result = await api('mappings/preview', request);
    render(result.report);
    $('auditProgress').value = 100;
    $('auditStatus').textContent = `Concluído: ${result.report.mappings.length} tarefas verificadas; ${result.report.pendingTasks.length} sem associação; ${result.report.failedTasks.length} com falha de leitura.`;
    status('Conferência automática concluída. Confira o estado por tarefa e os CNPJs não localizados.', 'ok');
  } catch (error) { $('auditStatus').textContent = `Não foi possível conferir automaticamente: ${error.message}`; status(error.message, 'error'); }
  finally { if (auditPoll) clearInterval(auditPoll); auditPoll = null; $('auditProgress').hidden = true; setBusy(false); renderQueue(); if (auditKey() !== key) maybeAutoAudit(); }
}
async function apply() { try { setBusy(true); status('Relendo a enquete e processando o lote. Não feche esta página…'); const result = await api('apply', { previewId, confirmText: $('confirmText').value.trim() }); previewId = null; $('confirmText').value = ''; render(result.report); status(`Gravação verificada: ${result.report.result.changed.length} respostas alteradas.`, 'ok'); } catch (e) { status(`${e.message} Verifique o relatório e a enquete antes de repetir.`, 'error'); previewId = null; } finally { setBusy(false); } }
function showDownloadSelection() { const selected = downloadFiles.find(x => x.name === $('downloadFile').value); $('downloadHint').textContent = selected ? `Selecionado: ${selected.name} · baixado em ${new Date(selected.modifiedAt).toLocaleString('pt-BR')}${selected.stale ? ' · antigo para gravação' : ''}` : 'Nenhum CSV da aba selecionado.'; }
function updateRecentSheetLinks() {
  const download = $('directExport'), open = $('openSheet'), hint = $('recentUrlHint');
  try {
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
      clearPreview(); $('confirmText').value = '';
    }
    showDownloadSelection(); updateApply(); if (select.value) await loadTasks();
  } catch (e) { status(e.message, 'error'); }
}
async function login(endpoint) {
  try {
    setBusy(true); clearPreview(); stopLoginPoll();
    status(endpoint === 'login/open' ? 'Abrindo o Chrome na página de autenticação do G-Click…' : 'Capturando perguntas e respostas da Enquete…');
    const result = await api(endpoint, { accountId: $('accountId').value.trim() });
    if (result.catalog) useCatalog(result.catalog, true);
    else if (endpoint === 'login/open') {
      if (referenceCatalog?.accountId === $('accountId').value.trim()) useCatalog(referenceCatalog, false);
      else { liveCatalog = null; catalogLive = false; renderQueue(); }
      startLoginPoll();
    }
    status(endpoint === 'login/open' ? 'Entre no G-Click e abra a Enquete desta conta. Até lá, você pode preparar mapeamentos com o catálogo anterior.' : `Catálogo atual conferido: ${result.catalog.questionCount} perguntas.`, 'ok');
  } catch (error) { status(error.message, 'error'); if (endpoint === 'login/close') startLoginPoll(); }
  finally { setBusy(false); maybeAutoAudit(); }
}
for (const input of document.querySelectorAll('input[name="sourceType"]')) input.addEventListener('change', () => { $('fileBox').hidden = sourceType() !== 'file'; $('urlBox').hidden = sourceType() !== 'url'; $('recentBox').hidden = sourceType() !== 'recent'; taskCatalog = []; selectedTasks.clear(); renderQueue(); $('taskStatus').textContent = 'Leia as tarefas da fonte selecionada.'; clearPreview(); if (sourceType() === 'recent') refreshDownloads(); });
for (const input of document.querySelectorAll('input[name="scopeMode"]')) input.addEventListener('change', () => { $('listBox').hidden = scopeMode() !== 'list'; previewId = null; updateApply(); });
for (const id of ['accountId','category','question','questionRef','answerRef','answerValue','answerLabel','inputType','allowedTasks','excludedTasks','file','sheetName','sourceUrl','recentSheetUrl','serviceKey','cnpjsText']) $(id).addEventListener('input', () => { previewId = null; updateApply(); });
$('recentSheetUrl').addEventListener('input', updateRecentSheetLinks);
$('directExport').addEventListener('click', () => { status('Download solicitado. Confira o arquivo e o horário antes de analisar.'); setTimeout(refreshDownloads, 1800); });
$('refreshDownloads').addEventListener('click', refreshDownloads); $('downloadFile').addEventListener('change', () => { taskCatalog = []; selectedTasks.clear(); renderQueue(); clearPreview(); showDownloadSelection(); loadTasks(); });
$('file').addEventListener('change', () => { if (sourceType() === 'file' && $('file').files.length) loadTasks(); });
$('loadTasks').addEventListener('click', loadTasks);
$('questionSearch').addEventListener('input', () => fillQuestionChoices($('questionSearch').value));
$('questionChoice').addEventListener('change', () => { const q = liveCatalog?.questions.find(x => x.ref === $('questionChoice').value); $('questionRef').value = q?.ref ?? ''; $('question').value = q?.label ?? ''; $('category').value = q?.category ?? ''; $('answerRef').value = ''; $('answerValue').value = ''; $('answerLabel').value = ''; $('inputType').value = 'auto'; $('allowedTasks').value = ''; $('excludedTasks').value = ''; fillAnswerChoices(); clearPreview(); $('mappingHint').textContent = 'Selecione a resposta desta pergunta.'; });
$('answerChoice').addEventListener('change', selectAnswer);
$('queueSearch').addEventListener('input', renderQueue); $('queueFilter').addEventListener('change', renderQueue);
$('editorSearch').addEventListener('input', () => fillEditorQuestions($('editorSearch').value));
$('catalogOverviewSearch').addEventListener('input', renderCatalogOverview);
$('editorQuestion').addEventListener('change', () => fillEditorAnswers());
$('confirmMapping').addEventListener('click', () => saveMapping($('editorAnswer').value));
$('clearMapping').addEventListener('click', () => saveMapping(''));
$('cancelMapping').addEventListener('click', () => { $('mappingEditor').hidden = true; editingTask = null; });
$('manualToggle').addEventListener('click', () => { const open = $('manualRuleCard').hidden; $('manualRuleCard').hidden = !open; $('manualActions').hidden = !open; $('applyCard').hidden = !open; $('manualToggle').textContent = open ? 'Fechar modo legado' : 'Abrir modo legado de DAS e DeSTDA'; });
$('previewMappings').addEventListener('click', previewMappings);
$('allowedTasks').addEventListener('input', () => { tasksAutoFilled = false; });
$('accountId').addEventListener('input', () => { if (liveCatalog && liveCatalog.accountId !== $('accountId').value.trim()) { liveCatalog = null; catalogLive = false; $('catalogPanel').hidden = true; $('mappingHint').textContent = 'Nenhum catálogo disponível para esta conta.'; renderCatalogOverview(); } selectedTasks.clear(); renderQueue(); maybeAutoAudit(); });
$('filter').addEventListener('change', () => { resultsPage = 0; if (lastReport) renderResultRows(lastReport); });
$('resultsPrev').addEventListener('click', () => { if (lastReport && resultsPage > 0) { resultsPage--; renderResultRows(lastReport); } });
$('resultsNext').addEventListener('click', () => { if (lastReport) { resultsPage++; renderResultRows(lastReport); } });
$('confirmText').addEventListener('input', updateApply);
$('plan').addEventListener('click', () => run('plan')); $('preview').addEventListener('click', () => run('preview')); $('apply').addEventListener('click', apply);
$('openLogin').addEventListener('click', () => login('login/open')); $('closeLogin').addEventListener('click', () => login('login/close'));
function loadRules(r) { $('accountId').value = r.accountId; $('category').value = r.category ?? 'Qualificação Geral do Cliente'; $('question').value = r.question; $('questionRef').value = r.questionRef; $('answerRef').value = r.answerRef; $('answerValue').value = r.answerValue; $('answerLabel').value = r.answerLabel ?? ''; $('inputType').value = r.inputType ?? 'auto'; $('allowedTasks').value = r.allowedTasks.join('\n'); $('excludedTasks').value = r.excludedTasks.join('\n'); clearPreview(); if (liveCatalog) fillQuestionChoices($('questionSearch').value); }
const config = await fetch('/api/config').then(r => r.json()); authToken = config.token; savedMappings = config.savedMappings ?? []; referenceCatalog = config.referenceCatalog ?? (config.catalog?.source === 'reference' ? config.catalog : null);
for (const [index, preset] of (config.presets ?? []).entries()) { const option = document.createElement('option'); option.value = String(index); option.textContent = preset.name; $('rulePreset').append(option); }
$('rulePreset').addEventListener('change', () => loadRules(config.presets[Number($('rulePreset').value)].rules));
loadRules(config.rules);
if (config.catalog) useCatalog(config.catalog, Boolean(config.catalogLive));
if (config.loginReady) status('Sessão da Enquete pronta. Mantenha a janela do Chrome aberta durante o uso.', 'ok');
else if (config.loginOpen) { status('Janela de login aberta. A captura ocorrerá quando a Enquete da conta estiver disponível.'); startLoginPoll(); }
else if (referenceCatalog) status('Catálogo anterior disponível para preparar mapeamentos. Conecte a Enquete para gerar uma prévia.');
updateRecentSheetLinks();
renderQueue();
if (sourceType() === 'recent') refreshDownloads();

// --- Onboarding & Raio-X ---
let currentOnboardingData = null;
let currentEnqueteAnswers = null;

if ($('tabOnboarding') && $('tabLegacy')) {
  $('tabOnboarding').addEventListener('click', () => {
    $('tabOnboarding').classList.add('active');
    $('tabLegacy').classList.remove('active');
    $('viewOnboarding').scrollIntoView({ behavior: 'smooth' });
  });
  $('tabLegacy').addEventListener('click', () => {
    $('tabLegacy').classList.add('active');
    $('tabOnboarding').classList.remove('active');
    $('viewLegacy').scrollIntoView({ behavior: 'smooth' });
  });
}

if ($('onbBuscarCnpj')) {
  $('onbBuscarCnpj').addEventListener('click', async () => {
    const cnpj = $('onbCnpj').value.replace(/\D/g, '');
    if (cnpj.length !== 14) {
      $('onbCnpjStatus').textContent = 'Digite um CNPJ válido com 14 dígitos.';
      $('onbCnpjStatus').style.color = '#a83f36';
      return;
    }
    $('onbCnpjStatus').textContent = 'Consultando base do CNPJ...';
    $('onbCnpjStatus').style.color = '#7c8c92';
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!res.ok) throw new Error('CNPJ não localizado na base pública.');
      const data = await res.json();
      $('onbRazaoSocial').value = data.razao_social || data.nome_fantasia || '';
      $('onbUf').value = data.uf || '';
      $('onbMunicipio').value = data.municipio || '';
      $('onbCnaePrincipal').value = data.cnae_fiscal ? `${data.cnae_fiscal} - ${data.cnae_fiscal_descricao || ''}` : '';
      if (Array.isArray(data.cnaes_secundarios)) {
        $('onbCnaesSecundarios').value = data.cnaes_secundarios.map(c => c.codigo).join(', ');
      }
      if (data.opcao_pelo_simples) {
        $('onbRegime').value = 'simples';
      } else if (data.opcao_pelo_mei) {
        $('onbRegime').value = 'mei';
      }
      if (data.identificador_matriz_filial === 2) {
        $('onbTipo').value = 'filial';
      } else {
        $('onbTipo').value = 'matriz';
      }
      $('onbCnpjStatus').textContent = `Dados carregados: ${data.descricao_situacao_cadastral || 'Ativa'}`;
      $('onbCnpjStatus').style.color = '#227d65';
    } catch (e) {
      $('onbCnpjStatus').textContent = `Aviso: ${e.message}. Você pode preencher os campos manualmente.`;
      $('onbCnpjStatus').style.color = '#7c8c92';
    }
  });
}

function renderOnboardingRaiox(diag, answers) {
  $('onbRaioxPlaceholder').hidden = true;
  $('onbResultSegmento').textContent = `SEGMENTO: ${diag.dadosGerais.segmento.toUpperCase()}`;
  $('onbResultEmpresa').textContent = diag.dadosGerais.razaoSocial || `CNPJ: ${diag.dadosGerais.cnpj}`;
  $('onbResultRegime').textContent = diag.dadosGerais.regimeLabel;

  $('onbPrazosFataisList').innerHTML = diag.prazosFatais.map(p => `
    <div class="raiox-item">
      <strong>${p.obrigacao}</strong>
      <p><strong>Prazo:</strong> ${p.prazo} · <strong>Órgão:</strong> ${p.orgao}</p>
      <p style="color:#b33b2e">${p.risco}</p>
      <span class="badge danger">${p.departamento}</span>
    </div>
  `).join('');

  if (diag.fatorR.sujeitoFatorR) {
    $('onbFatorRBlock').hidden = false;
    $('onbFatorRText').textContent = diag.fatorR.mensagem;
  } else {
    $('onbFatorRBlock').hidden = true;
  }

  const fiscalItems = [
    ...diag.departamentos.fiscal.federais.map(f => `<div class="raiox-item"><strong>[Federal] ${f.nome}</strong><p>${f.descricao}</p><span class="badge">${f.frequencia} · Venc: ${f.vencimento}</span></div>`),
    ...diag.departamentos.fiscal.estaduais.map(e => `<div class="raiox-item"><strong>[Estadual] ${e.nome}</strong><p>${e.descricao}</p><span class="badge info">${e.frequencia} · Venc: ${e.vencimento}</span></div>`),
    ...diag.departamentos.fiscal.municipais.map(m => `<div class="raiox-item"><strong>[Municipal] ${m.nome}</strong><p>${m.descricao}</p><span class="badge">${m.frequencia} · Venc: ${m.vencimento}</span></div>`)
  ];
  $('onbFiscalList').innerHTML = fiscalItems.join('') || '<p class="hint">Nenhuma obrigação fiscal adicional para este perfil.</p>';

  $('onbPessoalList').innerHTML = diag.departamentos.pessoal.map(p => `
    <div class="raiox-item">
      <strong>${p.nome}</strong>
      <p>${p.descricao}</p>
      <span class="badge">${p.frequencia} · Venc: ${p.vencimento}</span>
    </div>
  `).join('');

  $('onbContabilList').innerHTML = diag.departamentos.contabil.map(c => `
    <div class="raiox-item">
      <strong>${c.nome}</strong>
      <p>${c.descricao}</p>
      <span class="badge">${c.frequencia} · Venc: ${c.vencimento}</span>
    </div>
  `).join('');

  $('onbEnqueteChecklist').innerHTML = answers.map(a => `
    <div class="enquete-check-item">
      <span class="ref">${a.questionRef}</span>
      <span class="q-label">${a.question}</span>
      <span class="a-label">👉 ${a.answerLabel}</span>
    </div>
  `).join('');

  $('onbRaioxCard').hidden = false;
  $('onbEnqueteCard').hidden = false;
}

if ($('onbGerarDiagnostico')) {
  $('onbGerarDiagnostico').addEventListener('click', async () => {
    const cnpj = $('onbCnpj').value.replace(/\D/g, '');
    const cnaePrincipal = $('onbCnaePrincipal').value.split('-')[0].replace(/\D/g, '');
    const cnaesSecundarios = $('onbCnaesSecundarios').value.split(/[,;\n]/).map(c => c.trim().replace(/\D/g, '')).filter(Boolean);
    const clientPayload = {
      cnpj,
      razaoSocial: $('onbRazaoSocial').value.trim(),
      uf: $('onbUf').value.trim().toUpperCase(),
      municipio: $('onbMunicipio').value.trim(),
      cnaePrincipal,
      cnaesSecundarios,
      regime: $('onbRegime').value,
      tipoEmpresa: $('onbTipo').value,
      operacoes: {
        temProlabore: $('onbProlabore').checked,
        temFuncionarios: $('onbFuncionarios').checked,
        vendaInterestadual: $('onbInterestadual').checked
      }
    };
    try {
      const res = await api('onboarding/diagnostico', { client: clientPayload });
      currentOnboardingData = res.diagnosis;
      currentEnqueteAnswers = res.enqueteAnswers;
      renderOnboardingRaiox(res.diagnosis, res.enqueteAnswers);
    } catch (err) {
      alert('Erro ao gerar diagnóstico: ' + err.message);
    }
  });
}

if ($('onbGravarGclick')) {
  $('onbGravarGclick').addEventListener('click', async () => {
    if (!currentOnboardingData || !currentEnqueteAnswers) return;
    const cnpj = currentOnboardingData.dadosGerais.cnpj;
    const accountId = $('onbAccountId').value.trim();
    if (!confirm(`Confirmar gravação das ${currentEnqueteAnswers.length} respostas na Enquete do G-Click para a empresa ${cnpj}?`)) return;
    $('onbGravarStatus').textContent = 'Conectando ao G-Click e gravando respostas da Enquete. Aguarde...';
    $('onbGravarStatus').style.color = '#7c8c92';
    $('onbGravarGclick').disabled = true;
    try {
      const res = await api('onboarding/apply', {
        accountId,
        client: { cnpj },
        enqueteAnswers: currentEnqueteAnswers
      });
      $('onbGravarStatus').textContent = `Gravação concluída com sucesso! ${res.results.length} perguntas processadas.`;
      $('onbGravarStatus').style.color = '#227d65';
    } catch (err) {
      $('onbGravarStatus').textContent = 'Erro ao gravar: ' + err.message;
      $('onbGravarStatus').style.color = '#a83f36';
    } finally {
      $('onbGravarGclick').disabled = false;
    }
  });
}

if ($('onbOpenLogin') && $('onbCheckLogin')) {
  $('onbOpenLogin').addEventListener('click', () => login('login/open'));
  $('onbCheckLogin').addEventListener('click', async () => {
    try {
      const res = await api('login/close', { accountId: $('onbAccountId').value.trim() });
      $('onbLoginStatus').textContent = res.ready ? 'Sessão do G-Click ativa e validada!' : 'Enquete ainda não detectada. Abra a Enquete na janela do Chrome.';
      $('onbLoginStatus').style.color = res.ready ? '#227d65' : '#7c8c92';
    } catch (e) {
      $('onbLoginStatus').textContent = e.message;
      $('onbLoginStatus').style.color = '#a83f36';
    }
  });
}

