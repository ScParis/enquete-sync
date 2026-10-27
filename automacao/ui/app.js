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
const currentAccount = () => $('accountId').value.trim();
function status(message, kind = '') { $('status').textContent = message; $('status').className = `status ${kind}`; }
function sourceStatus(message, kind = '') { $('sourceStatus').textContent = message; $('sourceStatus').className = `source-status ${kind}`; }
function clearImportedTable() { importedTable = null; importedPage = 0; $('sourcePreview').hidden = true; $('sourceTable').replaceChildren(); }
function renderImportedTable() {
  if (!importedTable) { $('sourcePreview').hidden = true; return; }
  const { columns, rows } = importedTable;
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
  if (accountId && accountId !== lastKnownAccountId) {
    lastKnownAccountId = accountId;
    if (empresaNome === undefined) currentEmpresaNome = null;
  }
  if (empresaNome !== undefined) currentEmpresaNome = empresaNome;
  if (sessionStatus !== undefined) currentSessionStatus = sessionStatus;

  if ($('topAccountId')) $('topAccountId').textContent = accountId || '—';
  if ($('topAccountNome')) $('topAccountNome').textContent = currentEmpresaNome ? `· ${currentEmpresaNome}` : '';
  const badge = $('topSessionBadge');
  if (badge) {
    if (currentSessionStatus === 'login_detected') {
      badge.style.display = 'inline-block';
      badge.textContent = 'Login detectado';
      badge.style.background = '#065f46';
      badge.style.color = '#a7f3d0';
    } else if (currentSessionStatus === 'awaiting_login') {
      badge.style.display = 'inline-block';
      badge.textContent = 'Aguardando login';
      badge.style.background = '#854d0e';
      badge.style.color = '#fef08a';
    } else {
      badge.style.display = 'none';
    }
  }
}

function startLoginPoll() {
  if (loginPoll) return;
  loginPoll = setInterval(async () => {
    if (working || loginPollBusy || !/^\d+$/.test(currentAccount())) return;
    loginPollBusy = true;
    try {
      // 1. Endpoint observacional passivo /api/gclick/session
      const res = await fetch(`/api/gclick/session?accountId=${encodeURIComponent(currentAccount())}`);
      if (res.ok) {
        const result = await res.json().catch(() => null);
        if (result && result.browserStatus) {
          updateTopAccountDisplay(currentAccount(), result.activeEmpresaNome, result.gclickAuthStatus);

          if (result.gclickAuthStatus === 'login_detected') {
            status(`Login detectado no G-Click pela URL da aba. Conta: ${currentAccount()}${result.activeEmpresaNome ? ` (${result.activeEmpresaNome})` : ''}. Para ler perguntas e respostas da Enquete, abra Enquete -> Mapeamento e clique em Buscar Perguntas e Respostas (Sob Demanda).`, 'ok');
            stopLoginPoll();
            return;
          } else if (result.onEmpresas) {
            status(`Login realizado. Selecione a empresa no G-Click (conta ${currentAccount()}) para continuar.`);
            return;
          } else if (result.message) {
            status(result.message);
            return;
          }
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

async function inspectSource() {
  try {
    sourceStatus('Inspecionando estrutura da fonte…');
    const loadPayload = await payload('inspect');
    const result = await api('source/inspect', loadPayload);
    currentStructure = result.structure;
    currentProfile = result.existingProfile ?? result.suggestedProfile;
    renderMappingEditor();
    $('mappingEditorSection').hidden = false;
    sourceStatus(`Estrutura conhecida: ${result.structure.columnCount} coluna(s) identificada(s). Configure ou confirme o mapeamento abaixo.`, 'ok');
  } catch (e) {
    sourceStatus(`Falha ao inspecionar estrutura: ${e.message}`, 'error');
  }
}

function renderMappingEditor() {
  if (!currentStructure || !currentProfile) return;
  if ($('targetModelSelect')) $('targetModelSelect').value = currentProfile.targetModel || 'enquete_automacao';
  if ($('profileVersionBadge')) $('profileVersionBadge').textContent = currentProfile.version ? `Perfil: v${currentProfile.version}` : 'Perfil: Proposta';

  const body = $('mappingColumnsBody');
  if (!body) return;
  body.replaceChildren();

  const targetFields = [
    { id: '', label: '(Não mapeado / Preservar)' },
    { id: 'cnpj', label: 'CNPJ' },
    { id: 'empresa', label: 'Empresa / Razão Social' },
    { id: 'empId', label: 'EmpID (G-Click)' },
    { id: 'cod', label: 'Código Interno (Cod.)' },
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
    targetModel: $('targetModelSelect')?.value || currentProfile.targetModel || 'enquete_automacao',
    headerRow: parseInt($('headerRowInput')?.value || '1', 10),
    columns
  };
}

async function saveMappingProfile() {
  const profile = gatherProfileFromEditor();
  if (!profile) return;
  try {
    sourceStatus('Salvando perfil de mapeamento…');
    const res = await api('mapping/profiles/save', { profile });
    currentProfile = res.profile;
    if ($('profileVersionBadge')) $('profileVersionBadge').textContent = `Perfil: v${currentProfile.version}`;
    sourceStatus(`Perfil salvo com sucesso (v${currentProfile.version}).`, 'ok');
  } catch (e) {
    sourceStatus(`Erro ao salvar perfil: ${e.message}`, 'error');
  }
}

async function applyMappingAndLoad() {
  const profile = gatherProfileFromEditor();
  if (!profile) return;
  currentProfile = profile;
  clearPreview();
  await loadTasks(profile);
}

async function loadTasks(profileParam) {
  try {
    $('taskStatus').textContent = 'Lendo e normalizando dados da fonte…';
    sourceStatus('Lendo e normalizando dados da fonte…');
    const p = await payload('tasks');
    if (profileParam || currentProfile) p.profile = profileParam || currentProfile;
    const result = await api('tasks', p);
    if (result.profile && !currentProfile) {
      currentProfile = result.profile;
      if ($('profileVersionBadge')) $('profileVersionBadge').textContent = currentProfile.version ? `Perfil: v${currentProfile.version}` : 'Perfil: Sugerido';
    }
    taskCatalog = result.tasks ?? [];
    importedTable = result.table ?? null; importedPage = 0; renderImportedTable();
    if (importedTable) {
      const auditNote = result.audit ? ` · Auditados: ${result.audit.totalRows} registros (${result.audit.uniqueCnpjs ?? 0} CNPJs distintos)` : '';
      $('sourcePreviewInfo').textContent = `${result.rowCount} linha(s) e ${importedTable.columns.length} coluna(s) lidas de ${result.source}${auditNote}.`;
    }
    const key = sourceKey();
    if (key !== lastSourceKey) { lastSourceKey = key; sourceVersion++; }
    const message = result.kind === 'table'
      ? `${result.rowCount} linha(s) e ${importedTable.columns.length} coluna(s) importadas. Esta aba não possui ${result.missingForAutomation.join(', ')}; a conferência e a gravação de obrigações ficam indisponíveis para ela.`
      : `${taskCatalog.length} nomes de tarefa encontrados em ${result.rowCount} linhas (${result.source}).`;
    $('taskStatus').textContent = message;
    sourceStatus(message, 'ok');
    if ($('queueFilter').value === 'attention' && !$('queueSearch').value.trim() && taskCatalog.some(task => ['ready', 'candidate'].includes(mappingFor(task).state))) $('queueFilter').value = 'ready';
    renderQueue();
    updateAuditTaskSelect();
    if (result.kind !== 'table') maybeAutoAudit();
  } catch (e) { taskCatalog = []; clearImportedTable(); renderQueue(); updateAuditTaskSelect(); $('taskStatus').textContent = e.message; sourceStatus(e.message, 'error'); }
}
$('sourcePrev').addEventListener('click', () => { if (importedPage) { importedPage--; renderImportedTable(); } });
$('sourceNext').addEventListener('click', () => { if (importedTable && (importedPage + 1) * SOURCE_PAGE_SIZE < importedTable.rows.length) { importedPage++; renderImportedTable(); } });
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
  const out = { mode, sourceType: sourceType(), accountId: currentAccount() };
  if ($('headerRowInput')) out.headerRow = parseInt($('headerRowInput').value || '1', 10);
  if (currentProfile) out.profile = currentProfile;
  if (out.sourceType === 'recent') { out.downloadFile = $('downloadFile').value; if (!out.downloadFile) throw new Error('Selecione o CSV baixado da aba da planilha'); }
  else if (out.sourceType === 'file') { const file = $('file').files[0]; if (!file) throw new Error('Selecione um arquivo CSV ou XLSX'); out.fileName = file.name; out.fileLastModified = file.lastModified; out.fileBase64 = await dataUrl(file); out.sheetName = $('sheetName').value.trim(); }
  else { out.sourceUrl = $('sourceUrl').value.trim(); const key = $('serviceKey').files[0]; if (key) { if (key.size > 100 * 1024) throw new Error('JSON da conta de serviço maior que 100 KB'); out.serviceKeyBase64 = await dataUrl(key); } }
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
function setBusy(value) { working = value; for (const id of ['openLogin','closeLogin']) $(id).disabled = value; updateApply(); }
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
  $('applyCard').hidden = !['mapping_preview', 'account_audit', 'mapping_apply'].includes(lastReport?.mode);
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
    showDownloadSelection(); updateApply(); if (select.value) await loadTasks();
  } catch (e) { status(e.message, 'error'); }
}
async function login(endpoint) {
  try {
    setBusy(true); clearPreview(); stopLoginPoll();
    status(endpoint === 'login/open' ? 'Abrindo o Chrome na página de autenticação do G-Click…' : 'Verificando login no G-Click…');
    if (!/^\d+$/.test(currentAccount())) throw new Error('Informe o código da conta G-Click (empId do escritório) antes de conectar.');
    const result = await api(endpoint, { accountId: currentAccount() });
    if (result.catalog) useCatalog(result.catalog, true);
    else if (endpoint === 'login/open') {
      liveCatalog = null; catalogLive = false; renderCatalogOverview(); renderQueue();
      startLoginPoll();
    }
    if (result.empresaNome) {
      updateTopAccountDisplay(currentAccount(), result.empresaNome, result.stage === 'login_detected' ? 'login_detected' : 'logged_in');
    }
    status(endpoint === 'login/open'
      ? 'Entre no G-Click na janela que abriu. Quando o login for detectado, abra Enquete -> Mapeamento e clique em Buscar Perguntas e Respostas (Sob Demanda).'
      : (result.catalog ? `Catálogo atual conferido: ${result.catalog.questionCount} perguntas.` : (result.message || 'Login verificado no G-Click.')), 'ok');
  } catch (error) { status(error.message, 'error'); if (endpoint === 'login/close') startLoginPoll(); }
  finally { setBusy(false); }
}
for (const input of document.querySelectorAll('input[name="sourceType"]')) input.addEventListener('change', () => { $('fileBox').hidden = sourceType() !== 'file'; $('urlBox').hidden = sourceType() !== 'url'; $('recentBox').hidden = sourceType() !== 'recent'; taskCatalog = []; selectedTasks.clear(); clearImportedTable(); renderQueue(); $('taskStatus').textContent = 'Leia as tarefas da fonte selecionada.'; sourceStatus(sourceType() === 'url' ? 'Links privados exigem JSON de conta de serviço. Para usar seu login do Google, baixe a aba como CSV e importe em Arquivo.' : sourceType() === 'file' ? 'Escolha o CSV ou XLSX e clique em Importar arquivo selecionado.' : 'Baixe o CSV da aba e selecione o arquivo recebido.'); clearPreview(); if (sourceType() === 'recent') refreshDownloads(); });
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
  $('accountList').replaceChildren(...(config.accounts ?? []).map(a => new Option(`${a.mappings} mapeamento(s)${a.capturedAt ? ` · catálogo de ${new Date(a.capturedAt).toLocaleDateString('pt-BR')}` : ''}${a.sheetUrl ? ' · planilha salva' : ''}`, a.accountId)));
}
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
$('refreshDownloads').addEventListener('click', refreshDownloads); $('downloadFile').addEventListener('change', () => { awaitingSheetDownload = false; sheetDownloadRequestedAt = 0; taskCatalog = []; selectedTasks.clear(); clearImportedTable(); renderQueue(); clearPreview(); showDownloadSelection(); if ($('downloadFile').value) loadTasks(); });
$('loadUrlTasks').addEventListener('click', () => { clearPreview(); loadTasks(); });
$('loadFileTasks').addEventListener('click', () => { clearPreview(); loadTasks(); });
$('inspectSourceBtn')?.addEventListener('click', inspectSource);
$('saveProfileBtn')?.addEventListener('click', saveMappingProfile);
$('applyAndLoadBtn')?.addEventListener('click', applyMappingAndLoad);
$('file').addEventListener('change', () => { if (sourceType() === 'file' && $('file').files.length) { taskCatalog = []; selectedTasks.clear(); clearPreview(); clearImportedTable(); renderQueue(); loadTasks(); } });
$('sourceUrl').addEventListener('input', () => { if (sourceType() === 'url') { taskCatalog = []; selectedTasks.clear(); clearPreview(); clearImportedTable(); renderQueue(); sourceStatus('Link alterado. Clique em Ler tarefas do link; links privados exigem uma conta de serviço.'); } });
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
    taskCatalog = []; selectedTasks.clear(); clearPreview(); clearImportedTable();
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
}
$('accountId').addEventListener('change', loadAccountCatalog);
$('accountId').addEventListener('input', () => updateTopAccountDisplay($('accountId').value.trim()));
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
  try {
    $('writerStatus').textContent = 'Testando o Apps Script…';
    const r = await api('sheet-writer/save', { accountId: currentAccount(), url: $('writerUrl').value.trim() });
    status(`Registro na planilha ativo (aba “${r.aba}”).${r.sync?.linhas ? ` ${r.sync.linhas} linha(s) atualizadas com marcações anteriores.` : ''}`, 'ok');
  } catch (error) { status(error.message, 'error'); }
  refreshWriterStatus();
});
$('resendMarks').addEventListener('click', async () => {
  try { const r = await api('sheet-writer/resend', { accountId: currentAccount() }); status(r.error ? `Planilha: ${r.error}` : `Planilha: ${r.linhas ?? 0} linha(s) atualizada(s)${r.pending ? `; ${r.pending} sem linha correspondente` : ''}.`, r.error ? 'error' : 'ok'); }
  catch (error) { status(error.message, 'error'); }
  refreshWriterStatus();
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
$('openLogin').addEventListener('click', () => login('login/open')); $('closeLogin').addEventListener('click', () => login('login/close'));
const AUTO_AUDIT_KEY = 'enqueteSync_autoAudit';
try {
  const savedAuto = localStorage.getItem(AUTO_AUDIT_KEY);
  if (savedAuto !== null && $('autoAuditToggle')) $('autoAuditToggle').checked = savedAuto === 'true';
} catch { /* sem preferência local */ }
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
$('runAudit')?.addEventListener('click', () => {
  if (working) return;
  if (!catalogLive) {
    status('A sessão do G-Click não está ativa. Abra o menu "Conexão & Conta G-Click" e clique em "Abrir janela de login".', 'error');
    $('auditStatus').textContent = 'Aguardando o login: a conferência começa quando o robô ler a Enquete da conta.';
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
        <button type="button" class="ghost btn-edit-user" data-id="${u.id}" style="padding:4px 8px;font-size:12px;margin-right:4px">✏️ Editar</button>
        <button type="button" class="secondary btn-overrides-user" data-id="${u.id}" style="padding:4px 8px;font-size:12px;margin-right:4px">⚡ Exceções</button>
        ${!u.is_superadmin ? `<button type="button" class="ghost btn-del-user" data-id="${u.id}" style="padding:4px 8px;font-size:12px;color:#ef4444">🗑️</button>` : ''}
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
  if (config.catalogLive && config.catalog?.accountId) $('accountId').value = config.catalog.accountId;
  else { try { const last = localStorage.getItem(ACCOUNT_KEY); if (last) $('accountId').value = last; } catch { /* sem preferência local */ } }
  updateTopAccountDisplay(currentAccount());
  if (config.catalog && config.catalogLive) useCatalog(config.catalog, true);
  else if (currentAccount()) await loadAccountCatalog();
  loadedAccount = currentAccount() || null;
  if (currentAccount() && !$('recentSheetUrl').value) setSheetUrl((config.accounts ?? []).find(a => a.accountId === currentAccount())?.sheetUrl ?? '');
  
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

function switchSection(sectionId) {
  const target = sectionId || 'all';
  const navBtns = document.querySelectorAll('#sidebarNav .nav-btn');
  const sections = document.querySelectorAll('.app-section');

  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === target);
  });

  if (target === 'all') {
    sections.forEach(sec => {
      sec.hidden = false;
      sec.classList.remove('active');
    });
  } else {
    sections.forEach(sec => {
      const match = sec.id === `section-${target}`;
      sec.hidden = !match;
      sec.classList.toggle('active', match);
    });
  }

  if (target === 'users') {
    loadUsersTable();
  }

  $('sidebar')?.classList.remove('open');
  updateSidebarBadges();

  try {
    localStorage.setItem(SECTION_STORAGE_KEY, target);
  } catch { /* sem preferência local */ }
}

function updateSidebarBadges() {
  const acc = currentAccount();
  const accText = acc ? `Conta: ${acc}` : 'Conta: —';
  if ($('topAccountId')) $('topAccountId').textContent = acc || '—';
  if ($('sidebarAccountDisplay')) $('sidebarAccountDisplay').textContent = accText;

  const isOnline = Boolean(catalogLive && (liveCatalog ? (!acc || String(liveCatalog.accountId) === String(acc)) : true));
  const isEntering = Boolean(config?.loginOpen && !isOnline);
  if ($('sidebarStatusDot')) {
    $('sidebarStatusDot').className = `status-dot ${isOnline ? 'active' : ''}`;
  }
  if ($('sidebarSessionDisplay')) {
    $('sidebarSessionDisplay').textContent = isOnline ? 'Enquete conectada' : isEntering ? 'Entrando…' : 'Sessão desconectada';
  }

  const badgeConn = $('navBadgeConnection');
  if (badgeConn) {
    if (isOnline) { badgeConn.textContent = 'Conectado'; badgeConn.className = 'nav-badge badge-ok'; }
    else if (isEntering) { badgeConn.textContent = 'Entrando…'; badgeConn.className = 'nav-badge badge-warn'; }
    else if (acc) { badgeConn.textContent = 'Conta OK'; badgeConn.className = 'nav-badge badge-info'; }
    else { badgeConn.textContent = 'Aguardando'; badgeConn.className = 'nav-badge badge-neutral'; }
  }

  const badgeSource = $('navBadgeSource');
  if (badgeSource) {
    if (taskCatalog.length) { badgeSource.textContent = `${taskCatalog.length} tarefas`; badgeSource.className = 'nav-badge badge-ok'; }
    else if (importedTable) { badgeSource.textContent = `${importedTable.rows.length} linhas`; badgeSource.className = 'nav-badge badge-ok'; }
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

  const badgeAudit = $('navBadgeAudit');
  if (badgeAudit) {
    if (lastReport) {
      const pendingMarks = lastReport.toWrite ?? 0;
      if (pendingMarks > 0) { badgeAudit.textContent = `${pendingMarks} a marcar`; badgeAudit.className = 'nav-badge badge-warn'; }
      else { badgeAudit.textContent = 'Conferido'; badgeAudit.className = 'nav-badge badge-ok'; }
    } else {
      badgeAudit.textContent = '0'; badgeAudit.className = 'nav-badge badge-neutral';
    }
  }

  const badgeApply = $('navBadgeApply');
  if (badgeApply) {
    const toWrite = lastReport?.toWrite ?? 0;
    if (toWrite > 0) { badgeApply.textContent = `${toWrite} pronta(s)`; badgeApply.className = 'nav-badge badge-warn'; }
    else if (lastReport?.mode === 'mapping_apply') { badgeApply.textContent = 'Concluído'; badgeApply.className = 'nav-badge badge-ok'; }
    else { badgeApply.textContent = 'Aguardando'; badgeApply.className = 'nav-badge badge-neutral'; }
  }

  const badgeWriter = $('navBadgeWriter');
  if (badgeWriter) {
    const isConfigured = Boolean($('writerUrl')?.value?.trim());
    badgeWriter.textContent = isConfigured ? 'Ativo' : 'Pendente';
    badgeWriter.className = `nav-badge ${isConfigured ? 'badge-ok' : 'badge-neutral'}`;
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
    badgeObrigacoes.textContent = 'Em breve';
    badgeObrigacoes.className = 'nav-badge badge-new';
  }
}

$('refreshCatalogManual')?.addEventListener('click', async () => {
  const accountId = currentAccount();
  if (!/^\d+$/.test(accountId)) {
    status('Informe o código da conta G-Click (empId) em Conexão & Conta antes de buscar o catálogo.', 'error');
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
    status(`Busca sob demanda: ${error.message}. Se a janela do G-Click não estiver aberta, clique em "Abrir janela de login" no menu Conexão & Conta.`, 'error');
  } finally {
    setBusy(false);
    if (btn) btn.disabled = false;
    updateSidebarBadges();
  }
});

for (const btn of document.querySelectorAll('#sidebarNav .nav-btn')) {
  btn.addEventListener('click', () => switchSection(btn.dataset.section));
}
$('sidebarToggle')?.addEventListener('click', () => {
  $('sidebar')?.classList.toggle('open');
});
const savedSection = localStorage.getItem(SECTION_STORAGE_KEY) || 'all';
switchSection(savedSection);
updateSidebarBadges();
