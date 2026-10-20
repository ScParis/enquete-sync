#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseCsv, makePlan, scopeFromEligible, formatCnpj, normalizeCnpj, validCnpj } from './lib/data.mjs';
import { LOGIN_URL, hasGclickSession, openBrowser, openQuestion, questionStillOpen, resolveColumnValue, readQuestionCatalog, inspectAll, applyQuestionWithOperator } from './lib/gclick.mjs';
import { readPublicGoogleCsv, readWithServiceAccount, parseSheetUrl } from './lib/google-service.mjs';
import { appsScriptSource, validScriptUrl, testSheetWriter, writeMarks } from './lib/sheet-writer.mjs';
import { listCsvDownloads, readCsvDownload } from './lib/downloads.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const host = '127.0.0.1';
const port = Number(process.env.GCLICK_PORT ?? 8766);
const profile = process.env.GCLICK_PROFILE_DIR ?? path.join(os.homedir(), '.local/share/gclick-enquete/browser-profile');
const downloadsDir = path.join(os.homedir(), 'Downloads');
const catalogsDir = path.join(root, 'catalogos');
const ledgerDir = path.join(root, 'registros');
const writersFile = path.join(root, 'escrita-planilha.json');
const token = crypto.randomBytes(24).toString('hex');
const accountsFile = path.join(root, 'contas.json');
const mappingsFile = path.join(root, 'mapeamentos.json');
const APPLY_CHUNK = 100;
const PREVIEW_TTL = 2 * 60 * 60 * 1000;
let savedMappings = [];
try { savedMappings = JSON.parse(await fs.readFile(mappingsFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(savedMappings)) throw new Error('mapeamentos.json inválido');
// Dados de cada escritório que não vêm da Enquete, como o link da planilha de obrigações.
let accountSettings = {};
try { accountSettings = JSON.parse(await fs.readFile(accountsFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!accountSettings || typeof accountSettings !== 'object' || Array.isArray(accountSettings)) throw new Error('contas.json inválido');
let busy = false, loginContext = null, loginLock = null, loginReady = false, catalogState = null, lastReport = null, previewState = null;
let auditProgress = { running: false, completed: 0, total: 0, task: '', error: null };
let lastAutoOpen = 0;
let applyProgress = { running: false };
// Leitura de cada tarefa na Enquete, reaproveitada enquanto planilha, catálogo e mapeamento não mudam.
const auditCache = new Map();
const AUDIT_CACHE_TTL = 20 * 60 * 1000;

function validateRules(r) {
  const columnAnswer = !r?.answerValue && (r?.inputType ?? 'auto') !== 'radio';
  if (!r || !/^\d+$/.test(String(r.accountId)) || !/^\d+(?:\.\d+)+$/.test(String(r.questionRef)) ||
      !(columnAnswer || /^\d+$/.test(String(r.answerValue))) || !['radio', 'checkbox', 'auto'].includes(r.inputType ?? 'auto') || !/^\d+(?:\.\d+)+$/.test(String(r.answerRef)) ||
      !String(r.answerRef).startsWith(`${r.questionRef}.`) || !String(r.answerLabel ?? '').trim() ||
      typeof r.question !== 'string' || !r.question.trim() || !Array.isArray(r.allowedTasks) || !r.allowedTasks.length ||
      !r.allowedTasks.every(x => typeof x === 'string' && x.trim()) || !Array.isArray(r.excludedTasks) ||
      !r.excludedTasks.every(x => typeof x === 'string') || r.allowedTasks.some(x => r.excludedTasks.includes(x)))
    throw new Error('Parâmetros da regra inválidos ou conflitantes');
  return { accountId: String(r.accountId), category: String(r.category ?? 'Qualificação Geral do Cliente').trim(), question: r.question.trim(), questionRef: r.questionRef,
    answerRef: r.answerRef, answerValue: r.answerValue ? String(r.answerValue) : '', answerLabel: String(r.answerLabel ?? ''), inputType: r.inputType ?? 'auto',
    allowedTasks: r.allowedTasks.map(x => x.trim()), excludedTasks: r.excludedTasks.map(x => x.trim()) };
}
function requireAccount(value) {
  const accountId = String(value ?? '').trim();
  if (!/^\d+$/.test(accountId)) throw new Error('Informe o código numérico da conta G-Click (empId do escritório)');
  return accountId;
}
const catalogFile = accountId => path.join(catalogsDir, `${requireAccount(accountId)}.json`);
async function readStoredCatalog(accountId) {
  try { return { ...JSON.parse(await fs.readFile(catalogFile(accountId), 'utf8')), source: 'reference' }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
// Registro das marcações confirmadas no diálogo do G-Click, por escritório (fora do git: contém CNPJs).
const ledgerFile = accountId => path.join(ledgerDir, `${requireAccount(accountId)}.json`);
async function readLedger(accountId) {
  try { return JSON.parse(await fs.readFile(ledgerFile(accountId), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function appendLedger(accountId, entries) {
  if (!entries.length) return;
  await fs.mkdir(ledgerDir, { recursive: true, mode: 0o700 });
  const all = [...await readLedger(accountId), ...entries];
  const temp = `${ledgerFile(accountId)}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, ledgerFile(accountId));
}
const ledgerLabel = entry => `Marcado na Enquete: ${entry.questionRef} → ${entry.answerLabel} em ${new Date(entry.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
function ledgerCsv(entries) {
  const quote = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const header = ['CNPJ', 'EmpID', 'Empresa', 'Obrigação / Tarefa', 'Enquete G-Click', 'Pergunta', 'Resposta', 'Marcado em', 'Cliente no diálogo do G-Click'];
  return '\uFEFF' + [header, ...entries.map(e => [e.cnpj, e.empId, e.empresa, e.task, ledgerLabel(e), e.questionRef, e.answerLabel, e.at, e.nomeNoDialogo])]
    .map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
async function writeLedger(accountId, entries) {
  await fs.mkdir(ledgerDir, { recursive: true, mode: 0o700 });
  const temp = `${ledgerFile(accountId)}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, ledgerFile(accountId));
}
// Endereço e chave do Apps Script de cada escritório (fora do git: a chave autoriza escrever na planilha).
async function readWriters() {
  try { return JSON.parse(await fs.readFile(writersFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
async function saveWriters(writers) {
  const temp = `${writersFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(writers, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, writersFile);
}
async function writerFor(accountId) {
  const writer = (await readWriters())[accountId];
  const sheetUrl = accountSettings[accountId]?.sheetUrl;
  if (!writer?.url || !sheetUrl) return null;
  return { url: writer.url, token: writer.token, gid: parseSheetUrl(sheetUrl).gid };
}
// Envia à planilha as marcações ainda não registradas nela; falha na planilha não desfaz a gravação no G-Click.
async function pushPendingMarks(accountId) {
  const writer = await writerFor(accountId);
  const ledger = await readLedger(accountId);
  const pending = ledger.filter(e => e.planilha !== 'gravado');
  if (!writer) return { configured: false, pending: pending.length };
  if (!pending.length) return { configured: true, pending: 0, linhas: 0 };
  try {
    const result = await writeMarks(writer, pending.map(e => ({ cnpj: e.cnpj, task: e.task, texto: ledgerLabel(e) })));
    const missing = new Set(result.naoEncontrados ?? []);
    const key = e => `${String(e.cnpj).replace(/\D/g, '')}|${String(e.task).trim()}`;
    const now = new Date().toISOString();
    await writeLedger(accountId, ledger.map(e => e.planilha === 'gravado' ? e : missing.has(key(e)) ? { ...e, planilha: 'linha_nao_encontrada' } : { ...e, planilha: 'gravado', planilhaEm: now }));
    return { configured: true, pending: missing.size, linhas: result.linhas, naoEncontrados: [...missing] };
  } catch (error) {
    return { configured: true, pending: pending.length, error: error.message };
  }
}
async function storeCatalog(catalog) {
  await fs.mkdir(catalogsDir, { recursive: true });
  const file = catalogFile(catalog.accountId);
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const { source, ...data } = catalog;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
async function listStoredAccounts() {
  let files = [];
  try { files = (await fs.readdir(catalogsDir)).filter(name => /^\d+\.json$/.test(name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const ids = new Set([...files.map(name => name.replace(/\.json$/, '')), ...Object.keys(accountSettings)]);
  return Promise.all([...ids].sort().map(async accountId => ({ accountId, capturedAt: (await readStoredCatalog(accountId))?.capturedAt ?? null,
    sheetUrl: accountSettings[accountId]?.sheetUrl ?? '', mappings: savedMappings.filter(m => m.accountId === accountId).length })));
}
function validSheetUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Link da planilha inválido'); }
  const gid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid');
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname) || !/^\d+$/.test(gid ?? ''))
    throw new Error('Informe o link de uma aba do Google Sheets (com gid)');
  return url.toString();
}
async function saveAccountSettings() {
  const temp = `${accountsFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(accountSettings, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, accountsFile);
}
async function captureCatalog(accountId) {
  catalogState = await readQuestionCatalog(loginContext, accountId);
  await storeCatalog(catalogState);
  previewState = null;
  return catalogState;
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
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const STATUSES = ['vazio', 'ja_correto', 'divergente', 'nao_encontrado', 'bloqueado', 'sem_mapeamento', 'nao_verificado'];
function summarize(report) {
  const items = report.inspected ?? report.plan ?? [];
  const byStatus = Object.fromEntries(STATUSES.map(s => [s, items.filter(x => (x.uiStatus ?? x.status) === s).length]));
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
  const header = ['Conta','CNPJ','EmpID','Empresa','Mapeamento','Tarefas','Status planilha','Status enquete','Resposta atual','Motivo','Linhas planilha'];
  const quote = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [header, ...rows.map(x => [report.accountId ?? report.rules?.accountId,x.cnpj,x.empId,x.empresa,x.mappingTask ?? '',x.tasks?.join(' | '),x.status,x.uiStatus,x.currentValue,x.uiReason ?? x.reason,x.matchingRows?.join(' | ')])].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
const sessionError = error => /sess[aã]o|expirad|closed|Target page|context or browser|janela/i.test(String(error?.message ?? error));
const WINDOW_CLOSED = 'A janela do Chrome da automação foi fechada. Clique em Abrir janela de login e entre de novo; mantenha a janela aberta até o fim da conferência ou da gravação.';
const humanError = error => /Target page, context or browser has been closed|Browser has been closed|browserContext\.newPage/i.test(String(error?.message ?? error)) ? WINDOW_CLOSED : String(error?.message ?? error);
let sessionLostAt = null;
// Se o operador fecha a janela (ou o Chrome cai), a sessão deixa de existir: o estado é limpo na hora.
function watchLoginContext(context) {
  context.on('close', async () => {
    if (loginContext !== context) return;
    loginContext = null; loginReady = false; catalogState = null; previewState = null; sessionLostAt = new Date().toISOString();
    if (loginLock) { const release = loginLock; loginLock = null; await release().catch(() => {}); }
  });
}
function unverified(plan, task, reason) {
  return plan.map(item => ({ ...item, mappingTask: task, uiStatus: 'nao_verificado', uiReason: reason }));
}
function mappingRules(accountId, task, mapping) {
  const question = catalogState.questions.find(q => q.answers.some(a => a.ref === mapping.answerRef));
  const answer = question?.answers.find(a => a.ref === mapping.answerRef);
  if (!question || !answer) return null;
  return validateRules({ accountId, category: question.category, question: question.label,
    questionRef: question.ref, answerRef: answer.ref, answerValue: answer.valueKnown === false ? '' : answer.value, answerLabel: answer.display,
    inputType: answer.valueKnown === false ? 'checkbox' : 'auto', allowedTasks: [task], excludedTasks: [] });
}
async function route(req, res) {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await fs.readFile(path.join(root, 'ui/index.html'), 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/app.js') return send(res, 200, await fs.readFile(path.join(root, 'ui/app.js'), 'utf8'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/style.css') return send(res, 200, await fs.readFile(path.join(root, 'ui/style.css'), 'utf8'), 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, { token, savedMappings,
    accounts: await listStoredAccounts(), loginOpen: Boolean(loginContext), loginReady, sessionLostAt, catalog: loginReady ? catalogState : null, catalogLive: Boolean(catalogState && loginReady), busy });
  if (req.method === 'GET' && url.pathname === '/api/report.json') return lastReport ? send(res, 200, lastReport) : send(res, 404, { error: 'Nenhum relatório gerado' });
  if (req.method === 'GET' && url.pathname === '/api/report.csv') return lastReport ? send(res, 200, csvExport(lastReport), 'text/csv; charset=utf-8') : send(res, 404, { error: 'Nenhum relatório gerado' });
  if (req.method === 'GET' && url.pathname === '/api/marcacoes.csv') {
    const accountId = requireAccount(url.searchParams.get('account'));
    return send(res, 200, ledgerCsv(await readLedger(accountId)), 'text/csv; charset=utf-8');
  }
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada' });
  if (req.headers.host !== `${host}:${port}` || req.headers['x-gclick-token'] !== token || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, { error: 'Sessão da interface expirada ou requisição não autorizada', code: 'invalid_session' });
  const payload = await body(req);
  if (url.pathname === '/api/catalog/reference') {
    const accountId = requireAccount(payload.accountId);
    const sheetUrl = accountSettings[accountId]?.sheetUrl ?? '';
    // Perguntas só existem para a interface depois da leitura da Enquete desta conta na sessão atual.
    return send(res, 200, { catalog: catalogState?.accountId === accountId && loginReady ? catalogState : null, live: true, sheetUrl });
  }
  if (url.pathname === '/api/accounts/save') {
    const accountId = requireAccount(payload.accountId);
    const sheetUrl = validSheetUrl(payload.sheetUrl);
    accountSettings[accountId] = { ...accountSettings[accountId], sheetUrl, updatedAt: new Date().toISOString() };
    await saveAccountSettings();
    return send(res, 200, { accounts: await listStoredAccounts() });
  }
  if (url.pathname === '/api/mappings/save') {
    const accountId = requireAccount(payload.accountId);
    const task = String(payload.task ?? '').trim();
    const answerRef = String(payload.answerRef ?? '');
    const excluded = payload.excluded === true;
    const availableCatalog = catalogState?.accountId === accountId && loginReady ? catalogState : null;
    if (!task || task.length > 250) throw new Error('Tarefa inválida');
    if (answerRef && excluded) throw new Error('Uma tarefa excluída não pode ter resposta associada');
    let found = null;
    if (answerRef) {
      if (!availableCatalog) throw new Error('Conecte a Enquete desta conta: as perguntas e respostas são lidas dela antes de mapear.');
      for (const question of availableCatalog.questions) { const answer = question.answers.find(a => a.ref === answerRef); if (answer) found = { question, answer }; }
      if (!found) throw new Error('Resposta não encontrada no catálogo desta conta');
    }
    const current = savedMappings.find(x => x.accountId === accountId && x.task === task);
    if (current && ((found && !current.excluded && current.answerRef === answerRef) || (excluded && current.excluded)))
      return send(res, 200, { savedMappings, unchanged: true });
    savedMappings = savedMappings.filter(x => !(x.accountId === accountId && x.task === task));
    if (found) savedMappings.push({ accountId, task, answerRef, questionLabel: found.question.label, answerLabel: found.answer.label,
      catalogSource: 'live', updatedAt: new Date().toISOString() });
    else if (excluded) savedMappings.push({ accountId, task, excluded: true, updatedAt: new Date().toISOString() });
    await saveMappings();
    previewState = null;
    return send(res, 200, { savedMappings });
  }
  if (url.pathname === '/api/audit/progress') return send(res, 200, auditProgress);
  if (url.pathname === '/api/sheet-writer/status') {
    const accountId = requireAccount(payload.accountId);
    const writer = (await readWriters())[accountId];
    const ledger = await readLedger(accountId);
    return send(res, 200, { configured: Boolean(writer?.url), url: writer?.url ?? '', aba: writer?.aba ?? null, testedAt: writer?.testedAt ?? null,
      hasSheetUrl: Boolean(accountSettings[accountId]?.sheetUrl), marks: ledger.length, pending: ledger.filter(e => e.planilha !== 'gravado').length });
  }
  if (url.pathname === '/api/sheet-writer/script') {
    const accountId = requireAccount(payload.accountId);
    const writers = await readWriters();
    if (!writers[accountId]?.token) { writers[accountId] = { ...writers[accountId], token: crypto.randomBytes(24).toString('hex') }; await saveWriters(writers); }
    return send(res, 200, { script: appsScriptSource(writers[accountId].token) });
  }
  if (url.pathname === '/api/sheet-writer/save') {
    const accountId = requireAccount(payload.accountId);
    const sheetUrl = accountSettings[accountId]?.sheetUrl;
    if (!sheetUrl) throw new Error('Salve antes o link da aba da planilha desta conta');
    const writers = await readWriters();
    if (!writers[accountId]?.token) throw new Error('Copie o script primeiro: ele contém a chave desta conta');
    const scriptUrl = validScriptUrl(payload.url);
    const tested = await testSheetWriter({ url: scriptUrl, token: writers[accountId].token, gid: parseSheetUrl(sheetUrl).gid });
    writers[accountId] = { ...writers[accountId], url: scriptUrl, aba: tested.aba, testedAt: new Date().toISOString() };
    await saveWriters(writers);
    return send(res, 200, { configured: true, aba: tested.aba, sync: await pushPendingMarks(accountId) });
  }
  if (url.pathname === '/api/sheet-writer/resend') return send(res, 200, await pushPendingMarks(requireAccount(payload.accountId)));
  if (url.pathname === '/api/mappings/plan') {
    const accountId = requireAccount(payload.accountId);
    const task = String(payload.task ?? '').trim();
    const saved = savedMappings.find(x => x.accountId === accountId && x.task === task);
    if (!saved) throw new Error('Tarefa sem mapeamento salvo nesta conta');
    const source = await loadSource(payload);
    const rows = parseCsv(source.csv);
    const derived = scopeFromEligible(rows, { allowedTasks: [task], excludedTasks: [] });
    const plan = derived.scope.length ? makePlan(rows, derived.scope, { allowedTasks: [task], excludedTasks: [] }) : [];
    const ledger = await readLedger(accountId);
    return send(res, 200, { task, excluded: Boolean(saved.excluded), answerRef: saved.answerRef ?? null, invalid: derived.invalid,
      rows: plan.map(item => {
        const marked = ledger.filter(e => e.cnpj === item.cnpj && e.task === task).pop();
        return { cnpj: item.cnpj, empId: item.empId, empresa: item.empresa, status: item.status, reason: item.reason, marcadoEm: marked?.at ?? null };
      }) });
  }
  if (url.pathname === '/api/downloads') return send(res, 200, { files: await listCsvDownloads(downloadsDir) });
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
    const accountId = requireAccount(payload.accountId);
    if (!catalogState || catalogState.accountId !== accountId || payload.refresh) await captureCatalog(accountId);
    return { catalog: catalogState };
  }));
  if (url.pathname === '/api/mappings/preview') return send(res, 200, await exclusive(async () => {
    if (!loginContext || !loginReady || !catalogState) throw new Error('Abra a Enquete da conta para capturar o catálogo antes da prévia');
    const accountId = requireAccount(payload.accountId);
    if (accountId !== catalogState.accountId) throw new Error('A conta selecionada difere da Enquete conectada');
    previewState = null;
    const source = await loadSource(payload);
    const rows = parseCsv(source.csv);
    if (!rows.length || !('Obrigação / Tarefa' in rows[0])) throw new Error('Planilha sem coluna Obrigação / Tarefa');
    if (['Empresa', 'EmpID', 'CNPJ'].some(column => !(column in rows[0]))) throw new Error('Planilha sem colunas Empresa, EmpID ou CNPJ');
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
      const saved = savedMappings.find(x => x.accountId === accountId && x.task === task);
      if (saved?.excluded) { excluded.push(task); if (autoAudit) auditProgress.completed++; continue; }
      const rules = saved ? mappingRules(accountId, task, saved) : null;
      if (!rules) { pending.push(task); if (autoAudit) auditProgress.completed++; continue; }
      mappings.push({ task, rules });
    }
    if (!autoAudit && (pending.length || excluded.length)) throw new Error(`Há ${pending.length + excluded.length} tarefa(s) selecionada(s) sem mapeamento válido; revise a fila`);
    if (!autoAudit && !mappings.length) throw new Error('Nenhum mapeamento confirmado foi encontrado na planilha');
    const results = [], inspected = [], invalidSource = [], failedTasks = [], applicable = [];
    let incompleteReason = null;
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
    const summarizeChecked = checked => Object.fromEntries(['vazio','ja_correto','divergente','nao_encontrado','bloqueado'].map(status => [status, checked.filter(x => x.uiStatus === status).length]));
    const work = [];
    for (const mapping of mappings) {
      const derived = scopeFromEligible(rows, mapping.rules);
      invalidSource.push(...derived.invalid.map(item => ({ ...item, task: mapping.task })));
      const scope = listScope ?? derived.scope;
      if (!scope.length) { if (autoAudit) auditProgress.completed++; continue; }
      const plan = makePlan(rows, scope, mapping.rules);
      const cacheKey = `${accountId}|${sha256(source.csv)}|${catalogState.capturedAt}|${mapping.task}|${mapping.rules.answerRef}|${JSON.stringify(listScope)}`;
      const cached = auditCache.get(cacheKey);
      if (cached && Date.now() - cached.at < AUDIT_CACHE_TTL) {
        inspected.push(...cached.checked); applicable.push(cached.applicable); results.push(cached.result);
        if (autoAudit) auditProgress.completed++;
        continue;
      }
      work.push({ mapping, plan, cacheKey });
    }
    // Cada pergunta é aberta uma única vez; todas as tarefas que caem nela são lidas na mesma página.
    const byQuestion = new Map();
    for (const item of work) byQuestion.set(item.mapping.rules.questionRef, [...(byQuestion.get(item.mapping.rules.questionRef) ?? []), item]);
    for (const [questionRef, items] of byQuestion) {
      const pendingItems = [...items];
      const fail = (item, error) => {
        failedTasks.push({ task: item.mapping.task, reason: humanError(error) });
        inspected.push(...unverified(item.plan, item.mapping.task, incompleteReason ?? `Leitura não concluída: ${humanError(error)}`));
        if (autoAudit) auditProgress.completed++;
      };
      if (incompleteReason) { for (const item of pendingItems) { inspected.push(...unverified(item.plan, item.mapping.task, incompleteReason)); if (autoAudit) auditProgress.completed++; } continue; }
      if (autoAudit) auditProgress.task = `${questionRef} · ${items.map(i => i.mapping.task).join(' | ')}`;
      const page = await loginContext.newPage();
      try {
        const opened = await openQuestion(page, items[0].mapping.rules);
        while (pendingItems.length) {
          const item = pendingItems[0];
          try {
            const answerValue = item === items[0] ? opened.answerValue : item.mapping.rules.answerValue || await resolveColumnValue(page, item.mapping.rules);
            const rules = { ...item.mapping.rules, inputType: opened.inputType, answerValue };
            const checked = (await inspectAll(page, item.plan, rules)).map(x => ({ ...x, mappingTask: item.mapping.task, mappingAnswer: rules.answerRef }));
            if (!(await questionStillOpen(page, rules))) throw new Error('Sessão do G-Click perdida durante a leitura desta tarefa');
            const result = { task: item.mapping.task, questionRef: rules.questionRef, answerRef: rules.answerRef, clients: checked.length, summary: summarizeChecked(checked) };
            inspected.push(...checked); applicable.push({ task: item.mapping.task, rules, plan: item.plan }); results.push(result);
            auditCache.set(item.cacheKey, { at: Date.now(), checked, applicable: { task: item.mapping.task, rules, plan: item.plan }, result });
            if (autoAudit) auditProgress.completed++;
          } catch (error) {
            if (sessionError(error)) throw error;
            if (!autoAudit) throw error;
            fail(item, error);
          }
          pendingItems.shift();
        }
      } catch (error) {
        if (!autoAudit && !sessionError(error)) throw error;
        if (sessionError(error)) incompleteReason = humanError(error) === WINDOW_CLOSED ? `Não verificado: a janela do Chrome da automação foi fechada durante a pergunta ${questionRef}. Abra o login de novo e mantenha a janela aberta.` : `Não verificado: a sessão do G-Click caiu durante a pergunta ${questionRef}`;
        for (const item of pendingItems) fail(item, error);
      } finally { await page.close().catch(() => {}); }
    }
    const report = { mode: autoAudit ? 'account_audit' : 'mapping_preview', createdAt: new Date().toISOString(), source: source.label, sourceSha256: sha256(source.csv), sourceStale: source.stale,
      accountId, complete: !incompleteReason && !failedTasks.length, incompleteReason, rules: { inputType: 'mixed', allowedTasks: mappings.map(x => x.task) }, mappings: results, pendingTasks: pending,
      excludedTasks: excluded, failedTasks, sourceTaskCount: sourceTasks.size, sourceCnpjCount: new Set(rows.filter(row => validCnpj(row.CNPJ)).map(row => normalizeCnpj(row.CNPJ))).size,
      invalidSource, inspected };
    const toWrite = inspected.filter(x => x.uiStatus === 'vazio').length;
    // Muitos CNPJs ausentes na Enquete costumam indicar planilha de outro escritório: a gravação fica bloqueada.
    const located = inspected.filter(x => ['vazio', 'ja_correto', 'divergente', 'bloqueado', 'nao_encontrado'].includes(x.uiStatus));
    const missing = located.filter(x => x.uiStatus === 'nao_encontrado').length;
    if (located.length >= 10 && missing / located.length > 0.5)
      report.sourceWarning = `${missing} de ${located.length} CNPJs da planilha não aparecem na Enquete da conta ${accountId}. Confira se a planilha é deste escritório; a gravação fica bloqueada.`;
    if (report.complete && toWrite && !report.sourceWarning) {
      previewState = { kind: 'mappings', id: crypto.randomBytes(16).toString('hex'), at: Date.now(), accountId, catalogCapturedAt: catalogState.capturedAt,
        sourceStale: source.stale, sourceSha256: report.sourceSha256, sourceType: payload.sourceType, downloadFile: payload.sourceType === 'recent' ? payload.downloadFile : null,
        toWrite, mappings: applicable.map(m => ({ ...m, plan: m.plan.filter(item => inspected.some(x => x.mappingTask === m.task && x.cnpj === item.cnpj && x.uiStatus === 'vazio')) })).filter(m => m.plan.length) };
      report.previewId = previewState.id;
    }
    report.toWrite = toWrite;
    await saveReport(report);
    if (autoAudit) auditProgress = { running: false, completed: taskNames.length, total: taskNames.length, task: '', error: incompleteReason };
    return { report, previewId: report.previewId ?? null };
    } catch (error) {
      if (autoAudit) auditProgress = { ...auditProgress, running: false, error: error.message };
      throw error;
    }
  }));
  if (url.pathname === '/api/apply/progress') return send(res, 200, applyProgress);
  if (url.pathname === '/api/mappings/apply') return send(res, 200, await exclusive(async () => {
    const state = previewState;
    if (!state || state.kind !== 'mappings' || state.id !== payload.previewId || Date.now() - state.at > PREVIEW_TTL) throw new Error('Conferência ausente ou vencida. Recarregue a planilha para conferir de novo.');
    if (!loginContext || !loginReady || catalogState?.accountId !== state.accountId || catalogState.capturedAt !== state.catalogCapturedAt)
      throw new Error('A Enquete conectada mudou desde a conferência. Confira de novo.');
    if (state.sourceType === 'recent') {
      const current = await readCsvDownload(downloadsDir, state.downloadFile);
      if (sha256(current.csv) !== state.sourceSha256) { previewState = null; throw new Error('O CSV mudou depois da conferência. Confira de novo antes de marcar.'); }
    }
    previewState = null;
    // O resultado conferido após a gravação atualiza a leitura guardada; a tela não precisa reabrir as perguntas.
    const updateCache = (task, answerRef, cnpjStatus) => {
      for (const [key, entry] of auditCache) {
        if (!key.includes(`|${task}|${answerRef}|`)) continue;
        const checked = entry.checked.map(x => cnpjStatus.has(x.cnpj) ? { ...x, ...cnpjStatus.get(x.cnpj) } : x);
        auditCache.set(key, { ...entry, checked, result: { ...entry.result, summary: Object.fromEntries(['vazio','ja_correto','divergente','nao_encontrado','bloqueado'].map(st => [st, checked.filter(x => x.uiStatus === st).length])) } });
      }
    };
    const forgetTasks = tasks => { for (const key of auditCache.keys()) if (tasks.some(task => key.includes(`|${task}|`))) auditCache.delete(key); };
    // Agrupa por pergunta: o operador confirma uma vez por pergunta, com todas as respostas e clientes dela.
    const byQuestion = new Map();
    for (const mapping of state.mappings) {
      const list = byQuestion.get(mapping.rules.questionRef) ?? [];
      list.push({ rules: mapping.rules, items: mapping.plan.map(item => ({ ...item, mappingTask: mapping.task })) });
      byQuestion.set(mapping.rules.questionRef, list);
    }
    const report = { mode: 'mapping_apply', createdAt: new Date().toISOString(), accountId: state.accountId, sourceSha256: state.sourceSha256, sourceStale: state.sourceStale,
      rules: { inputType: 'mixed', allowedTasks: state.mappings.map(m => m.task) }, results: [], inspected: [], status: 'em_andamento' };
    const questions = [...byQuestion.entries()];
    applyProgress = { running: true, questions: questions.length, done: 0, questionRef: null, stage: 'iniciando', count: 0 };
    try {
      for (const [questionRef, groups] of questions) {
        // Lotes grandes são divididos; cada lote pede uma confirmação.
        const total = Math.max(...groups.map(g => g.items.length));
        for (let i = 0; i < total; i += APPLY_CHUNK) {
          const chunk = groups.map(g => ({ rules: g.rules, items: g.items.slice(i, i + APPLY_CHUNK) })).filter(g => g.items.length);
          applyProgress = { ...applyProgress, questionRef, stage: 'abrindo', count: chunk.reduce((n, g) => n + g.items.length, 0) };
          const page = await loginContext.newPage();
          try {
            const result = await applyQuestionWithOperator(page, chunk, { onStage: (stage, info) => { applyProgress = { ...applyProgress, stage, ...(info ?? {}) }; } });
            for (const group of chunk) {
              const statuses = new Map();
              for (const x of result.changed.filter(c => c.answerRef === group.rules.answerRef)) statuses.set(x.cnpj, { uiStatus: 'ja_correto', currentValue: group.rules.answerValue, uiReason: 'Gravado e conferido após recarga' });
              for (const x of result.skipped.filter(c => c.answerRef === group.rules.answerRef)) statuses.set(x.cnpj, { uiStatus: x.uiStatus, currentValue: x.currentValue ?? null, uiReason: x.uiReason });
              updateCache(group.items[0]?.mappingTask, group.rules.answerRef, statuses);
            }
            const confirmedAt = new Date().toISOString();
            const entries = result.changed.map(x => ({ at: confirmedAt, accountId: state.accountId, cnpj: x.cnpj, empId: x.empId ?? null, empresa: x.empresa ?? null, task: x.mappingTask,
              questionRef: x.questionRef, answerRef: x.answerRef, answerLabel: x.answerLabel, nomeNoDialogo: x.nomeNoDialogo, sourceSha256: state.sourceSha256 }));
            await appendLedger(state.accountId, entries);
            report.ledger = [...(report.ledger ?? []), ...entries];
            report.results.push({ questionRef, task: chunk.map(g => g.items[0]?.mappingTask).filter(Boolean).join(' | '), answerRef: chunk.map(g => g.rules.answerRef).join(' | '),
              changed: result.changed.map(x => x.cnpj), skipped: result.skipped.map(x => ({ cnpj: x.cnpj, uiStatus: x.uiStatus, reason: x.uiReason })), cancelled: result.cancelled });
            report.inspected.push(...result.changed.map(x => ({ cnpj: x.cnpj, mappingTask: x.mappingTask, uiStatus: 'ja_correto', uiReason: `Gravado (${x.answerRef}) e conferido após recarga` })),
              ...result.skipped.map(x => ({ cnpj: x.cnpj, empId: x.empId, empresa: x.empresa, mappingTask: x.mappingTask, uiStatus: x.uiStatus, uiReason: x.uiReason })),
              ...(result.cancelled ? chunk.flatMap(g => g.items.map(x => ({ cnpj: x.cnpj, empId: x.empId, empresa: x.empresa, mappingTask: x.mappingTask, uiStatus: 'vazio', uiReason: 'Cancelado pelo operador no diálogo do G-Click' }))) : []));
          } finally { await page.close().catch(() => {}); }
        }
        applyProgress = { ...applyProgress, done: applyProgress.done + 1 };
      }
      report.status = 'verificado';
    } catch (e) {
      report.status = 'verificar_manualmente'; report.error = humanError(e);
      forgetTasks(state.mappings.map(m => m.task));
      if (e.partial) report.results.push({ questionRef: applyProgress.questionRef, changed: e.partial.changed.map(x => x.cnpj), failed: e.partial.failed.map(x => x.cnpj), skipped: [] });
      applyProgress = { running: false, error: report.error };
      report.planilha = await pushPendingMarks(state.accountId).catch(error => ({ error: error.message }));
      await saveReport(report); throw Object.assign(e, { report });
    }
    applyProgress = { running: false, done: questions.length, questions: questions.length };
    report.planilha = await pushPendingMarks(state.accountId);
    await saveReport(report);
    return { report };
  }));
  if (url.pathname === '/api/login/open') {
    if (busy) throw new Error('Outra operação está em andamento');
    busy = true;
    try {
      if (loginContext) await loginContext.close();
      loginContext = null; loginReady = false; catalogState = null; previewState = null; lastAutoOpen = 0; auditCache.clear();
      if (loginLock) await loginLock();
      loginLock = null;
      loginLock = await acquireLock();
      loginContext = await openBrowser(profile, true);
      watchLoginContext(loginContext); sessionLostAt = null;
      const page = loginContext.pages()[0] ?? await loginContext.newPage();
      await page.goto(LOGIN_URL);
      return send(res, 200, { open: true });
    } catch (e) { if (loginContext) await loginContext.close(); loginContext = null; loginReady = false; catalogState = null; if (loginLock) await loginLock(); loginLock = null; throw e; }
    finally { busy = false; }
  }
  if (url.pathname === '/api/login/close') {
    if (busy) throw new Error('Outra operação está em andamento');
    if (!loginContext) throw new Error('Abra primeiro a janela de login da automação.');
    const accountId = requireAccount(payload.accountId);
    busy = true;
    try {
      if (payload.auto) {
        const urls = loginContext.pages().map(page => { try { return new URL(page.url()); } catch { return null; } }).filter(Boolean);
        const onEnquete = urls.some(current => current.hostname === 'app.gclick.com.br' && current.pathname.endsWith('/Listar.do') &&
          current.searchParams.get('obj') === 'enqueteopen' && current.searchParams.get('empId') === accountId);
        // Após o login o G-Click abre o painel (appp.gclick.com.br); dali a Enquete abre direto pelo endereço da conta.
        const loggedIn = urls.some(current => /(^|\.)gclick\.com\.br$/.test(current.hostname) && !current.pathname.startsWith('/autenticacao'));
        if (!onEnquete && !loggedIn) return send(res, 200, { open: true, ready: false, stage: 'login', message: 'Aguardando o login no Chrome da automação.' });
        if (!onEnquete && Date.now() - lastAutoOpen < 20000) return send(res, 200, { open: true, ready: false, stage: 'opening', message: `Login detectado. Abrindo a Enquete da conta ${accountId}…` });
        lastAutoOpen = Date.now();
        if (!(await hasGclickSession(loginContext, accountId)))
          return send(res, 200, { open: true, ready: false, stage: 'no_access', message: `Login detectado, mas a Enquete da conta ${accountId} não abriu. Confira se o usuário tem acesso a esse escritório; nova tentativa em 20 s.` });
      } else if (!(await hasGclickSession(loginContext, accountId)))
        throw new Error(`A Enquete da conta ${accountId} não abriu no Chrome da automação. Confira o login e o acesso a esse escritório.`);
      await captureCatalog(accountId);
      loginReady = true;
      return send(res, 200, { open: true, ready: true, catalog: catalogState });
    } finally { busy = false; }
  }
  return send(res, 404, { error: 'Rota não encontrada' });
}
const server = http.createServer((req, res) => { route(req, res).catch(async e => { if (e.report) lastReport = e.report; send(res, 400, { error: humanError(e), report: e.report ?? null }); }); });
server.listen(port, host, () => console.log(`G-Click local: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { try { if (loginContext) await loginContext.close(); if (loginLock) await loginLock(); } finally { server.close(() => process.exit(0)); } });
