#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseCsv, makePlan, scopeFromEligible, formatCnpj, normalizeCnpj, validCnpj } from './lib/data.mjs';
import { LOGIN_URL, hasGclickSession, openBrowser, openQuestion, readQuestionCatalog, inspectAll, applyBatch, applyClientOnboarding, applyByColumnMatrix } from './lib/gclick.mjs';
import { readPublicGoogleCsv, readWithServiceAccount } from './lib/google-service.mjs';
import { listCsvDownloads, readCsvDownload } from './lib/downloads.mjs';
import { buildCatalog } from './lib/catalog.mjs';
import { diagnoseClient } from './lib/tax-engine.mjs';
import { translateDiagnosisToEnquete } from './lib/enquete-translator.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const host = '127.0.0.1';
const port = Number(process.env.GCLICK_PORT ?? 8766);
const profile = process.env.GCLICK_PROFILE_DIR ?? path.join(os.homedir(), '.local/share/gclick-enquete/browser-profile');
const downloadsDir = path.join(os.homedir(), 'Downloads');
const token = crypto.randomBytes(24).toString('hex');
const defaultRules = validateRules(JSON.parse(await fs.readFile(path.join(root, 'regras.json'), 'utf8')));
const destdaRules = validateRules(JSON.parse(await fs.readFile(path.join(root, 'regras-destda.json'), 'utf8')));
const catalogSnapshotFile = path.join(root, 'enquete-catalogo.json');
const snapshotRows = JSON.parse(await fs.readFile(catalogSnapshotFile, 'utf8'));
const referenceCatalog = { ...buildCatalog(snapshotRows.map(row => ({ ...row, ref: row.code })), defaultRules.accountId,
  (await fs.stat(catalogSnapshotFile)).mtime.toISOString()), source: 'reference' };
const mappingsFile = path.join(root, 'mapeamentos.json');
let savedMappings = [];
try { savedMappings = JSON.parse(await fs.readFile(mappingsFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(savedMappings)) throw new Error('mapeamentos.json inválido');
let busy = false, loginContext = null, loginLock = null, loginReady = false, catalogState = null, lastReport = null, previewState = null;
let auditProgress = { running: false, completed: 0, total: 0, task: '', error: null };

function validateRules(r) {
  if (!r || !/^\d+$/.test(String(r.accountId)) || !/^\d+(?:\.\d+)+$/.test(String(r.questionRef)) ||
      !/^\d+$/.test(String(r.answerValue)) || !['radio', 'checkbox', 'auto'].includes(r.inputType ?? 'auto') || !/^\d+(?:\.\d+)+$/.test(String(r.answerRef)) ||
      !String(r.answerRef).startsWith(`${r.questionRef}.`) || !String(r.answerLabel ?? '').trim() ||
      typeof r.question !== 'string' || !r.question.trim() || !Array.isArray(r.allowedTasks) || !r.allowedTasks.length ||
      !r.allowedTasks.every(x => typeof x === 'string' && x.trim()) || !Array.isArray(r.excludedTasks) ||
      !r.excludedTasks.every(x => typeof x === 'string') || r.allowedTasks.some(x => r.excludedTasks.includes(x)))
    throw new Error('Parâmetros da regra inválidos ou conflitantes');
  return { accountId: String(r.accountId), category: String(r.category ?? 'Qualificação Geral do Cliente').trim(), question: r.question.trim(), questionRef: r.questionRef,
    answerRef: r.answerRef, answerValue: String(r.answerValue), answerLabel: String(r.answerLabel ?? ''), inputType: r.inputType ?? 'auto',
    allowedTasks: r.allowedTasks.map(x => x.trim()), excludedTasks: r.excludedTasks.map(x => x.trim()) };
}
function parseScope(text) {
  const entries = String(text ?? '').split(/[\r\n;,]+/).map(x => x.trim()).filter(Boolean);
  if (!entries.length) throw new Error('Informe ao menos um CNPJ no lote');
  const normalized = entries.map(normalizeCnpj);
  for (let i = 0; i < normalized.length; i++) if (!validCnpj(normalized[i])) throw new Error(`CNPJ inválido no lote: ${entries[i]}`);
  if (new Set(normalized).size !== normalized.length) throw new Error('Há CNPJ repetido no lote');
  return normalized;
}
async function loadSource(payload) {
  if (payload.sourceType === 'recent') return readCsvDownload(downloadsDir, payload.downloadFile);
  if (payload.sourceType === 'url') {
    let csv;
    if (payload.serviceKeyBase64) {
      const keyBytes = Buffer.from(String(payload.serviceKeyBase64), 'base64');
      if (!keyBytes.length || keyBytes.length > 100 * 1024) throw new Error('JSON da conta de serviço inválido ou muito grande');
      let key;
      try { key = JSON.parse(keyBytes.toString('utf8')); }
      catch { throw new Error('JSON da conta de serviço inválido'); }
      csv = await readWithServiceAccount(payload.sourceUrl, key);
    } else csv = await readPublicGoogleCsv(payload.sourceUrl);
    return { csv, label: payload.sourceUrl, stale: false };
  }
  if (payload.sourceType !== 'file') throw new Error('Escolha arquivo ou link do Google Sheets');
  const name = path.basename(String(payload.fileName ?? ''));
  const data = Buffer.from(String(payload.fileBase64 ?? ''), 'base64');
  if (!name || !data.length || data.length > 15 * 1024 * 1024) throw new Error('Arquivo vazio ou maior que 15 MB');
  const stale = Number.isFinite(payload.fileLastModified) && Date.now() - payload.fileLastModified > 24 * 60 * 60 * 1000;
  if (/\.csv$/i.test(name)) return { csv: data.toString('utf8'), label: name, stale };
  if (!/\.xlsx$/i.test(name)) throw new Error('Envie arquivo .csv ou .xlsx');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gclick-xlsx-'));
  const tempFile = path.join(tempDir, 'upload.xlsx');
  try {
    await fs.writeFile(tempFile, data, { mode: 0o600 });
    const result = spawnSync('python3', [path.join(root, 'lib/xlsx_to_csv.py'), tempFile, String(payload.sheetName ?? '')], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, timeout: 30000 });
    if (result.error || result.status !== 0) throw new Error(`Falha ao ler XLSX: ${result.stderr?.trim() || result.error?.message || 'erro desconhecido'}`);
    return { csv: result.stdout, label: `${name} (${JSON.parse(result.stderr).sheet})`, stale };
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}
function summarize(report) {
  const items = report.inspected ?? report.plan ?? [];
  const byStatus = Object.fromEntries(['vazio', 'ja_correto', 'divergente', 'nao_encontrado', 'bloqueado', 'sem_mapeamento'].map(s => [s, items.filter(x => (x.uiStatus ?? x.status) === s).length]));
  return { total: items.length, ...byStatus, invalidSource: report.invalidSource?.length ?? 0 };
}
async function saveReport(report) {
  report.summary = summarize(report);
  await fs.mkdir(path.join(root, 'runs'), { recursive: true });
  const file = path.join(root, 'runs', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '.json');
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  report.file = file;
  lastReport = report;
  return report;
}
async function saveMappings() {
  const temp = `${mappingsFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(savedMappings, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, mappingsFile);
}
async function acquireLock() {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const lockPath = path.join(profile, 'automation.lock');
  let handle;
  try { handle = await fs.open(lockPath, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number((await fs.readFile(lockPath, 'utf8')).trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Outra execução pode estar ativa. Verifique ${lockPath}`);
    try { process.kill(pid, 0); throw new Error(`Outra execução pode estar ativa (PID ${pid}). Verifique ${lockPath}`); }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    await fs.rename(lockPath, `${lockPath}.stale-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    handle = await fs.open(lockPath, 'wx', 0o600);
  }
  await handle.writeFile(String(process.pid));
  return async () => { await handle.close(); await fs.unlink(lockPath).catch(() => {}); };
}
async function exclusive(fn, allowLoginPending = false) {
  if (busy || (loginContext && !loginReady && !allowLoginPending)) throw new Error('Outra operação está em andamento ou a janela de login ainda não foi validada');
  busy = true;
  let unlock;
  try { if (!loginContext) unlock = await acquireLock(); return await fn(); }
  finally { if (unlock) await unlock(); busy = false; }
}
function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
async function body(req) {
  let total = 0; const chunks = [];
  for await (const chunk of req) { total += chunk.length; if (total > 25 * 1024 * 1024) throw new Error('Envio maior que 25 MB'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function csvExport(report) {
  const rows = report.inspected ?? report.plan ?? [];
  const header = ['CNPJ','EmpID','Empresa','Mapeamento','Tarefas','Status planilha','Status enquete','Resposta atual','Motivo','Linhas planilha'];
  const quote = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  return '\uFEFF' + [header, ...rows.map(x => [x.cnpj,x.empId,x.empresa,x.mappingTask ?? '',x.tasks?.join(' | '),x.status,x.uiStatus,x.currentValue,x.uiReason ?? x.reason,x.matchingRows?.join(' | ')])].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
async function route(req, res) {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await fs.readFile(path.join(root, 'ui/index.html'), 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/app.js') return send(res, 200, await fs.readFile(path.join(root, 'ui/app.js'), 'utf8'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/style.css') return send(res, 200, await fs.readFile(path.join(root, 'ui/style.css'), 'utf8'), 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { token, rules: defaultRules, presets: [{ name: 'DAS / Simples', rules: defaultRules }, { name: 'DeSTDA', rules: destdaRules }], savedMappings, loginOpen: Boolean(loginContext), loginReady, catalog: catalogState ?? referenceCatalog, referenceCatalog, catalogLive: Boolean(catalogState && loginReady), busy });
  if (req.method === 'GET' && url.pathname === '/api/report.json') return lastReport ? send(res, 200, lastReport) : send(res, 404, { error: 'Nenhum relatório gerado' });
  if (req.method === 'GET' && url.pathname === '/api/report.csv') return lastReport ? send(res, 200, csvExport(lastReport), 'text/csv; charset=utf-8') : send(res, 404, { error: 'Nenhum relatório gerado' });
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada' });
  if (req.headers.host !== `${host}:${port}` || req.headers['x-gclick-token'] !== token || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, { error: 'Sessão da interface expirada ou requisição não autorizada', code: 'invalid_session' });
  const payload = await body(req);
  if (url.pathname === '/api/mappings/save') {
    const accountId = String(payload.accountId ?? '');
    const task = String(payload.task ?? '').trim();
    const answerRef = String(payload.answerRef ?? '');
    const availableCatalog = catalogState?.accountId === accountId ? catalogState : referenceCatalog.accountId === accountId ? referenceCatalog : null;
    if (!availableCatalog || !task || task.length > 250)
      throw new Error('Nenhum catálogo disponível para esta conta');
    if (answerRef && !availableCatalog.questions.some(q => q.answers.some(a => a.ref === answerRef)))
      throw new Error('Resposta não encontrada no catálogo disponível');
    savedMappings = savedMappings.filter(x => !(x.accountId === accountId && x.task === task));
    if (answerRef) savedMappings.push({ accountId, task, answerRef, catalogSource: availableCatalog === catalogState ? 'live' : 'reference', updatedAt: new Date().toISOString() });
    await saveMappings();
    previewState = null;
    return send(res, 200, { savedMappings });
  }
  if (url.pathname === '/api/audit/progress') return send(res, 200, auditProgress);
  if (url.pathname === '/api/downloads') return send(res, 200, { files: await listCsvDownloads(downloadsDir) });
  if (url.pathname === '/api/onboarding/diagnostico') {
    const client = payload.client ?? {};
    if (!client.cnpj && !client.cnaePrincipal) throw new Error('Informe ao menos o CNPJ ou CNAE Principal');
    const diagnosis = diagnoseClient(client);
    const enqueteAnswers = translateDiagnosisToEnquete(diagnosis, client);
    return send(res, 200, { diagnosis, enqueteAnswers });
  }
  if (url.pathname === '/api/onboarding/apply') {
    return send(res, 200, await exclusive(async () => {
      if (!loginContext || !loginReady) throw new Error('Valide o acesso ao G-Click para gravar a Enquete');
      const accountId = /^\d+$/.test(String(payload.accountId)) ? String(payload.accountId) : defaultRules.accountId;
      if (!payload.client || !payload.client.cnpj) throw new Error('Cliente sem CNPJ para gravação');
      if (!Array.isArray(payload.enqueteAnswers) || !payload.enqueteAnswers.length) throw new Error('Nenhuma resposta selecionada');
      const results = await applyClientOnboarding(loginContext, accountId, payload.client, payload.enqueteAnswers);
      return { success: true, results };
    }));
  }
  if (url.pathname === '/api/matrix/apply') {
    return send(res, 200, await exclusive(async () => {
      if (!loginContext || !loginReady) throw new Error('Valide o acesso ao G-Click para gravar a Enquete');
      const accountId = /^\d+$/.test(String(payload.accountId)) ? String(payload.accountId) : defaultRules.accountId;
      const page = loginContext.pages()[0] ?? await loginContext.newPage();
      const result = await applyByColumnMatrix(page, {
        accountId,
        category: payload.category ?? 'Dpto. Fiscal/Tributário',
        questionRef: payload.questionRef ?? '02.03',
        question: payload.question ?? 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)',
        columnName: payload.columnName ?? '08 GIA ST',
        cnpjs: payload.cnpjs ?? [],
        autoConfirm: payload.autoConfirm === true
      });
      return { success: true, result };
    }));
  }
  if (url.pathname === '/api/tasks') {
    const source = await loadSource(payload);
    const rows = parseCsv(source.csv);
    if (!rows.length || !('Obrigação / Tarefa' in rows[0])) throw new Error('Planilha sem coluna Obrigação / Tarefa');
    const counts = new Map();
    for (const row of rows) {
      const name = String(row['Obrigação / Tarefa'] ?? '').trim();
      if (!name) continue;
      const item = counts.get(name) ?? { name, count: 0, clients: new Set(), invalidCnpjs: 0 };
      item.count++;
      if (validCnpj(row.CNPJ)) item.clients.add(normalizeCnpj(row.CNPJ));
      else item.invalidCnpjs++;
      counts.set(name, item);
    }
    return send(res, 200, { source: source.label, stale: source.stale, rowCount: rows.length,
      tasks: [...counts.values()].map(({ name, count, clients, invalidCnpjs }) => ({ name, count, clients: clients.size, invalidCnpjs }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) });
  }
  if (url.pathname === '/api/catalog') return send(res, 200, await exclusive(async () => {
    if (!loginContext || !loginReady) throw new Error('Valide o acesso ao G-Click para carregar as perguntas');
    const accountId = /^\d+$/.test(String(payload.accountId)) ? String(payload.accountId) : defaultRules.accountId;
    if (!catalogState || catalogState.accountId !== accountId || payload.refresh) {
      catalogState = await readQuestionCatalog(loginContext, accountId);
      previewState = null;
    }
    return { catalog: catalogState };
  }));
  if (url.pathname === '/api/mappings/preview') return send(res, 200, await exclusive(async () => {
    if (!loginContext || !loginReady || !catalogState) throw new Error('Abra a Enquete da conta para capturar o catálogo antes da prévia');
    const accountId = String(payload.accountId ?? '');
    if (accountId !== catalogState.accountId) throw new Error('A conta selecionada difere da Enquete conectada');
    previewState = null;
    const source = await loadSource(payload);
    const rows = parseCsv(source.csv);
    if (!rows.length || !('Obrigação / Tarefa' in rows[0])) throw new Error('Planilha sem coluna Obrigação / Tarefa');
    if (payload.autoAudit && ['Empresa', 'EmpID', 'CNPJ'].some(column => !(column in rows[0]))) throw new Error('Planilha sem colunas Empresa, EmpID ou CNPJ');
    const presets = [defaultRules, destdaRules];
    const sourceTasks = new Set(rows.map(row => String(row['Obrigação / Tarefa'] ?? '').trim()).filter(Boolean));
    const autoAudit = payload.autoAudit === true;
    if (!autoAudit && (!Array.isArray(payload.selectedTasks) || !payload.selectedTasks.length || payload.selectedTasks.length > 30 ||
        payload.selectedTasks.some(task => typeof task !== 'string' || !sourceTasks.has(task)) ||
        new Set(payload.selectedTasks).size !== payload.selectedTasks.length)) throw new Error('Selecione até 30 tarefas distintas da planilha para esta prévia');
    const taskNames = autoAudit ? [...sourceTasks] : payload.selectedTasks;
    if (autoAudit) auditProgress = { running: true, completed: 0, total: taskNames.length, task: 'Identificando tarefas da planilha', error: null };
    try {
    const mappings = [], pending = [], excluded = [];
    for (const task of taskNames) {
      if (presets.some(rule => rule.accountId === accountId && rule.excludedTasks.includes(task))) { excluded.push(task); if (autoAudit) auditProgress.completed++; continue; }
      const custom = savedMappings.find(x => x.accountId === accountId && x.task === task);
      const preset = presets.find(rule => rule.accountId === accountId && rule.allowedTasks.includes(task));
      const answerRef = custom?.answerRef ?? preset?.answerRef;
      const question = catalogState.questions.find(q => q.answers.some(a => a.ref === answerRef));
      const answer = question?.answers.find(a => a.ref === answerRef);
      if (!question || !answer) { pending.push(task); if (autoAudit) auditProgress.completed++; continue; }
      mappings.push({ task, rules: validateRules({ accountId, category: question.category, question: question.label,
        questionRef: question.ref, answerRef: answer.ref, answerValue: answer.value, answerLabel: answer.display,
        inputType: 'auto', allowedTasks: [task], excludedTasks: [] }) });
    }
    if (!autoAudit && (pending.length || excluded.length)) throw new Error(`Há ${pending.length + excluded.length} tarefa(s) selecionada(s) sem mapeamento válido; revise a fila`);
    if (!autoAudit && !mappings.length) throw new Error('Nenhum mapeamento confirmado foi encontrado na planilha');
    if (!autoAudit && mappings.length > 30) throw new Error('Prévia limitada a 30 mapeamentos por lote; filtre a fonte');
    const context = loginContext;
    const results = [], inspected = [], invalidSource = [], failedTasks = [];
    if (autoAudit) for (const task of pending) {
      const seen = new Set();
      for (const row of rows.filter(item => String(item['Obrigação / Tarefa'] ?? '').trim() === task)) {
        if (!validCnpj(row.CNPJ)) { invalidSource.push({ row: row._row, cnpj: row.CNPJ, empresa: row.Empresa, task, reason: 'CNPJ inválido ou ausente' }); continue; }
        const cnpj = normalizeCnpj(row.CNPJ);
        if (seen.has(cnpj)) continue;
        seen.add(cnpj);
        inspected.push({ cnpj: formatCnpj(cnpj), empId: row.EmpID, empresa: row.Empresa, mappingTask: task,
          uiStatus: 'sem_mapeamento', uiReason: 'Tarefa sem associação confirmada com uma resposta da Enquete; estado não verificado' });
      }
    }
    const listScope = !autoAudit && payload.scopeMode === 'list' ? parseScope(payload.cnpjsText) : null;
    for (const mapping of mappings) {
      if (autoAudit) auditProgress.task = mapping.task;
      const derived = scopeFromEligible(rows, mapping.rules);
      invalidSource.push(...derived.invalid.map(item => ({ ...item, task: mapping.task })));
      const scope = listScope ?? derived.scope;
      if (!scope.length) { if (autoAudit) auditProgress.completed++; continue; }
      const plan = makePlan(rows, scope, mapping.rules);
      const page = await context.newPage();
      try {
        const detectedType = await openQuestion(page, mapping.rules);
        const rules = { ...mapping.rules, inputType: detectedType };
        const checked = (await inspectAll(page, plan, rules)).map(item => ({ ...item, mappingTask: mapping.task, mappingAnswer: rules.answerRef }));
        inspected.push(...checked);
        results.push({ task: mapping.task, questionRef: rules.questionRef, answerRef: rules.answerRef,
          clients: checked.length, summary: Object.fromEntries(['vazio','ja_correto','divergente','nao_encontrado','bloqueado'].map(status => [status, checked.filter(x => x.uiStatus === status).length])) });
      } catch (error) {
        if (!autoAudit) throw error;
        failedTasks.push({ task: mapping.task, reason: error.message });
      } finally { await page.close(); if (autoAudit) auditProgress.completed++; }
    }
    const report = { mode: autoAudit ? 'account_audit' : 'mapping_preview', createdAt: new Date().toISOString(), source: source.label, sourceStale: source.stale,
      accountId, rules: { inputType: 'mixed', allowedTasks: mappings.map(x => x.task) }, mappings: results, pendingTasks: pending,
      excludedTasks: excluded, failedTasks, sourceTaskCount: sourceTasks.size, sourceCnpjCount: new Set(rows.filter(row => validCnpj(row.CNPJ)).map(row => normalizeCnpj(row.CNPJ))).size,
      invalidSource, inspected };
    await saveReport(report);
    if (autoAudit) auditProgress = { running: false, completed: taskNames.length, total: taskNames.length, task: '', error: null };
    return { report };
    } catch (error) {
      if (autoAudit) auditProgress = { ...auditProgress, running: false, error: error.message };
      throw error;
    }
  }));
  if (url.pathname === '/api/login/open') {
    if (busy) throw new Error('Outra operação está em andamento');
    busy = true;
    try {
      if (loginContext) await loginContext.close();
      loginContext = null; loginReady = false; catalogState = null; previewState = null;
      if (loginLock) await loginLock();
      loginLock = null;
      loginLock = await acquireLock();
      loginContext = await openBrowser(profile, true);
      const page = loginContext.pages()[0] ?? await loginContext.newPage();
      await page.goto(LOGIN_URL);
      return send(res, 200, { open: true });
    } catch (e) { if (loginContext) await loginContext.close(); loginContext = null; loginReady = false; catalogState = null; if (loginLock) await loginLock(); loginLock = null; throw e; }
    finally { busy = false; }
  }
  if (url.pathname === '/api/login/close') {
    if (busy) throw new Error('Outra operação está em andamento');
    if (!loginContext) throw new Error('Abra primeiro a janela de login da automação.');
    busy = true;
    try {
      const accountId = /^\d+$/.test(String(payload.accountId)) ? String(payload.accountId) : defaultRules.accountId;
      if (payload.auto && !loginContext.pages().some(page => {
        const current = new URL(page.url());
        return current.hostname === 'app.gclick.com.br' && current.pathname.endsWith('/Listar.do') &&
          current.searchParams.get('obj') === 'enqueteopen' && current.searchParams.get('empId') === accountId;
      })) return send(res, 200, { open: true, ready: false });
      if (!(await hasGclickSession(loginContext, accountId)))
        throw new Error(`A conta ${accountId} ainda não abriu a Enquete no Chrome da automação. Selecione essa conta no painel e tente concluir novamente.`);
      catalogState = await readQuestionCatalog(loginContext, accountId);
      previewState = null;
      loginReady = true;
      return send(res, 200, { open: true, ready: true, catalog: catalogState });
    } finally { busy = false; }
  }
  if (url.pathname === '/api/run') return send(res, 200, await exclusive(async () => {
    const mode = payload.mode;
    if (!['plan', 'preview'].includes(mode)) throw new Error('Modo inválido');
    previewState = null;
    const rules = validateRules(payload.rules);
    const source = await loadSource(payload);
    const rows = parseCsv(source.csv);
    const derived = scopeFromEligible(rows, rules);
    const scope = payload.scopeMode === 'list' ? parseScope(payload.cnpjsText) : derived.scope;
    if (!scope.length) throw new Error('Nenhum CNPJ elegível encontrado na planilha');
    const plan = makePlan(rows, scope, rules);
    const report = { mode, createdAt: new Date().toISOString(), source: source.label,
      sourceSha256: crypto.createHash('sha256').update(source.csv).digest('hex'), sourceStale: source.stale,
      rules, scopeMode: payload.scopeMode, invalidSource: derived.invalid, plan };
    if (mode === 'preview') {
      const context = loginContext ?? await openBrowser(profile);
      try {
        const page = await context.newPage();
        try { const detectedType = await openQuestion(page, rules); report.rules = { ...rules, inputType: detectedType }; report.inspected = await inspectAll(page, plan, report.rules); }
        finally { await page.close(); }
      } finally { if (context !== loginContext) await context.close(); }
      previewState = { id: crypto.randomBytes(16).toString('hex'), at: Date.now(), plan, rules: report.rules, sourceStale: source.stale, sourceSha256: report.sourceSha256,
        sourceType: payload.sourceType, downloadFile: payload.sourceType === 'recent' ? payload.downloadFile : null };
    } else previewState = null;
    await saveReport(report);
    return { report, previewId: mode === 'preview' ? previewState.id : null };
  }, payload.mode === 'plan'));
  if (url.pathname === '/api/apply') return send(res, 200, await exclusive(async () => {
    if (!previewState || previewState.id !== payload.previewId || Date.now() - previewState.at > 30 * 60 * 1000) throw new Error('Prévia ausente ou vencida. Gere uma nova prévia.');
    if (previewState.sourceStale) throw new Error('Arquivo enviado tem mais de 24 horas. Envie uma exportação atual.');
    if (previewState.sourceType === 'recent') {
      const current = await readCsvDownload(downloadsDir, previewState.downloadFile);
      const hash = crypto.createHash('sha256').update(current.csv).digest('hex');
      if (current.stale || hash !== previewState.sourceSha256) {
        previewState = null;
        throw new Error('O CSV baixado mudou ou ficou antigo após a prévia. Gere uma nova prévia antes de gravar.');
      }
    }
    const plan = previewState.plan, rules = previewState.rules;
    if (payload.confirmText !== `APLICAR ${plan.length}`) throw new Error(`Digite APLICAR ${plan.length} para confirmar`);
    const context = loginContext ?? await openBrowser(profile);
    const report = { mode: 'apply', createdAt: new Date().toISOString(), sourceSha256: previewState.sourceSha256, rules, plan };
    try {
      const page = await context.newPage();
      try {
        const detectedType = await openQuestion(page, rules);
        if (detectedType !== rules.inputType) throw new Error('Tipo de resposta mudou desde a prévia');
        report.inspected = await inspectAll(page, plan, rules);
        report.result = await applyBatch(page, report.inspected, rules);
      } finally { await page.close(); }
      report.status = 'verificado';
      previewState = null;
    } catch (e) { report.status = 'verificar_manualmente'; report.error = e.message; throw Object.assign(e, { report }); }
    finally { if (context !== loginContext) await context.close(); await saveReport(report); }
    return { report };
  }));
  return send(res, 404, { error: 'Rota não encontrada' });
}
const server = http.createServer((req, res) => { route(req, res).catch(async e => { if (e.report) lastReport = e.report; send(res, 400, { error: e.message, report: e.report ?? null }); }); });
server.listen(port, host, () => console.log(`G-Click local: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { try { if (loginContext) await loginContext.close(); if (loginLock) await loginLock(); } finally { server.close(() => process.exit(0)); } });
