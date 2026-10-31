#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseCsv, parseCsvTable, makePlan, scopeFromEligible, formatCnpj, normalizeCnpj, validCnpj } from './lib/data.mjs';
import { parseHeaderAndSample } from './lib/source-inspector.mjs';
import { TARGET_MODELS, AVAILABLE_FIELDS, TRANSFORMS, createSuggestedProfile, validateProfileAgainstStructure, normalizeTable, profileFitsUse } from './lib/mapping-engine.mjs';
import { LOGIN_URL, hasGclickSession, openBrowser, openQuestion, questionStillOpen, resolveColumnValue, readQuestionCatalog, inspectAll, applyQuestionWithOperator, enterEmpresa, getActiveEmpresa, getAccessEmpresas, ensureEmpresaActive, saveEmpresaFoto, findSavedEmpresaFoto, describeEmpresaFotoCandidates } from './lib/gclick.mjs';
import { readPublicGoogleCsv, readWithServiceAccount, parseSheetUrl } from './lib/google-service.mjs';
import { appsScriptSource, validScriptUrl, testSheetWriter, writeMarks, writeAuditLog } from './lib/sheet-writer.mjs';
import { listCsvDownloads, readCsvDownload } from './lib/downloads.mjs';
import * as obrigacoesLib from './lib/obrigacoes.mjs';
import {
  inspectObrigacoesPage,
  extractObrigacoesList,
  syncObrigacoesComCanais,
  auditObrigacoesList,
  classifyObrigacaoParidade,
  inspectEmailConfig,
  configureEmailActivity,
  configureBatchEmailActivities,
  applyWhatsappActivity,
  mapWhatsappFlow,
  inspectWhatsappConfig,
  createAndConfigureWhatsappActivity,
  configureBatchWhatsappActivities
} from './lib/obrigacoes.mjs';
import { buildAuditLogRows, auditLogCsv } from './lib/audit-logger.mjs';
import { AuthService } from './lib/auth-service.mjs';

import { handleAuthRoutes, handleUserAdminPostRoutes } from './routes/auth.routes.mjs';
import { handleSheetsRoutes } from './routes/sheets.routes.mjs';
import { handleObrigacoesRoutes } from './routes/obrigacoes.routes.mjs';
import { handleSourceProfileRoutes } from './routes/source-profile.routes.mjs';
import { handleCarteiraRoutes } from './routes/carteira.routes.mjs';
import * as carteiraLib from './lib/carteira.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const authService = new AuthService();
const host = '127.0.0.1';
const port = Number(process.env.GCLICK_PORT ?? 8766);
const ALLOWED_ORIGIN_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'app.jb-consultoria.com',
  'jb-consultoria.com'
]);
if (process.env.GCLICK_ALLOWED_HOSTS) {
  process.env.GCLICK_ALLOWED_HOSTS.split(',').forEach(h => {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) ALLOWED_ORIGIN_HOSTS.add(trimmed);
  });
}
function isAllowedHost(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const h = hostname.trim().toLowerCase();
  if (ALLOWED_ORIGIN_HOSTS.has(h)) return true;
  if (h.endsWith('.jb-consultoria.com') || h.endsWith('.local')) return true;
  return false;
}
const profile = process.env.GCLICK_PROFILE_DIR ?? path.join(os.homedir(), '.local/share/gclick-enquete/browser-profile');
const downloadsDir = path.join(os.homedir(), 'Downloads');
const catalogsDir = path.join(root, 'catalogos');
const empresaFotosDir = path.join(catalogsDir, 'fotos');
const empresaFotoAttempts = new Map();
const ledgerDir = path.join(root, 'registros');
const writersFile = path.join(root, 'escrita-planilha.json');
const token = crypto.randomBytes(24).toString('hex');
const accountsFile = path.join(root, 'contas.json');
const mappingsFile = path.join(root, 'mapeamentos.json');
const profilesFile = path.join(root, 'perfis-mapeamento.json');
const APPLY_CHUNK = 100;
const PREVIEW_TTL = 2 * 60 * 60 * 1000;
let savedMappings = [];
try { savedMappings = JSON.parse(await fs.readFile(mappingsFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(savedMappings)) throw new Error('mapeamentos.json inválido');
let savedProfiles = [];
try { savedProfiles = JSON.parse(await fs.readFile(profilesFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(savedProfiles)) savedProfiles = [];
async function saveProfiles() {
  const temp = `${profilesFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(savedProfiles, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, profilesFile);
}
// Dados de cada escritório que não vêm da Enquete, como o link da planilha de obrigações.
let accountSettings = {};
try { accountSettings = JSON.parse(await fs.readFile(accountsFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!accountSettings || typeof accountSettings !== 'object' || Array.isArray(accountSettings)) throw new Error('contas.json inválido');
const obrigacoesTemplatesFile = path.join(root, 'obrigacoes-templates.json');
let savedObrigacoesTemplates = {};
try { savedObrigacoesTemplates = JSON.parse(await fs.readFile(obrigacoesTemplatesFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') console.warn('Erro ao ler templates de obrigações:', error); }
function getDefaultTemplates() {
  return {
    whatsapp: {
      habilitado: true,
      particularidadeId: '539',
      textoAtividade: 'Atendimento: DIGISAC / WhatsApp',
      texto: 'Olá, tudo bem?\n\nInformamos que a obrigação [obrigacao.nome] referente ao período [tarefa.competencia] está disponível para download e conferência.\n\nVencimento: [tarefa.vencimento].\n\nQualquer dúvida, estamos à disposição!'
    },
    email: {
      assunto: '[obrigacao.nome] - [tarefa.competencia]',
      texto: '<p>Olá [cliente.apelido],</p><p>Segue [obrigacao.nome] referente a [tarefa.competencia], com o vencimento: [tarefa.vencimento].</p><p>Qualquer dúvida, ficamos à disposição!</p><p>Atenciosamente,</p>'
    }
  };
}
async function saveObrigacoesTemplates() {
  const temp = `${obrigacoesTemplatesFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.writeFile(temp, JSON.stringify(savedObrigacoesTemplates, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, obrigacoesTemplatesFile);
}
let busy = false, loginContext = null, loginLock = null, loginReady = false, catalogState = null, lastReport = null, previewState = null;
let activeAbortController = null;
let catalogStatus = 'not_requested'; // 'not_requested' | 'loading' | 'ready' | 'failed' | 'invalidated'
let catalogSessionGeneration = 0;
let ongoingCatalogPromise = null;
let auditProgress = { running: false, completed: 0, total: 0, task: '', error: null };
let autoAttemptedAccountId = null;
let applyProgress = { running: false };
let obrigacoesProgress = {
  running: false,
  action: null,
  stage: '',
  current: 0,
  total: 0,
  percent: 0,
  nome: '',
  id: null,
  matched: 0,
  updatedAt: 0
};
function hasGclickActiveSession(context) {
  if (!context) return false;
  try {
    const pages = context.pages().filter(p => !p.isClosed());
    return pages.some(p => {
      try {
        const u = new URL(p.url());
        return /(^|\.)gclick\.com\.br$/.test(u.hostname) && !u.pathname.startsWith('/autenticacao');
      } catch { return false; }
    });
  } catch {
    return false;
  }
}
// Leitura de cada tarefa na Enquete, reaproveitada enquanto planilha, catálogo e mapeamento não mudam.
const auditCache = new Map();
const AUDIT_CACHE_TTL = 2 * 60 * 60 * 1000;
const auditCacheFile = path.join(catalogsDir, 'audit-cache.json');
async function loadAuditCache() {
  try {
    const raw = JSON.parse(await fs.readFile(auditCacheFile, 'utf8'));
    for (const [k, v] of Object.entries(raw)) {
      if (v?.at && Date.now() - v.at < AUDIT_CACHE_TTL) auditCache.set(k, v);
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Cache de auditoria inválido, reiniciando'); }
}
async function persistAuditCache() {
  try {
    await fs.mkdir(catalogsDir, { recursive: true });
    const obj = {};
    for (const [k, v] of auditCache) {
      if (Date.now() - v.at < AUDIT_CACHE_TTL) obj[k] = v;
    }
    const temp = `${auditCacheFile}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    await fs.writeFile(temp, JSON.stringify(obj) + '\n', { mode: 0o600 });
    await fs.rename(temp, auditCacheFile);
  } catch {}
}
await loadAuditCache();

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
    sheetUrl: accountSettings[accountId]?.sheetUrl ?? '', carteiraSheetUrl: accountSettings[accountId]?.carteiraSheetUrl ?? '', mappings: savedMappings.filter(m => m.accountId === accountId).length })));
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
const STATUSES = ['vazio', 'ja_correto', 'divergente', 'nao_encontrado', 'bloqueado', 'sem_mapeamento', 'sem_tarefa', 'nao_verificado'];
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
  const isSessionValid = loginReady || hasGclickActiveSession(loginContext);
  if (busy || (loginContext && !isSessionValid && !allowLoginPending)) throw new Error('Outra operação está em andamento ou a janela de login ainda não foi validada');
  busy = true;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  let unlock;
  try {
    if (!loginContext) unlock = await acquireLock();
    return await fn(signal);
  } finally {
    if (unlock) await unlock();
    busy = false;
    activeAbortController = null;
  }
}
function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function sendCookie(res, code, data, cookieHeader, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Set-Cookie': cookieHeader
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}
function getAuthUser(req) {
  const sessionId = getCookie(req, 'gclick_session') || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null);
  if (!sessionId) return null;
  return authService.validateSession(sessionId);
}
async function body(req) {
  let total = 0; const chunks = [];
  for await (const chunk of req) { total += chunk.length; if (total > 25 * 1024 * 1024) throw new Error('Envio maior que 25 MB'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}


function csvExport(report, catalog, savedMappings = [], ledger = []) {
  const rows = buildAuditLogRows(report, catalog, savedMappings, ledger);
  return auditLogCsv(rows);
}

async function getLatestReport(accountId) {
  if (lastReport && (!accountId || lastReport.accountId === accountId)) return lastReport;
  try {
    const runsDir = path.join(root, 'runs');
    const files = (await fs.readdir(runsDir)).filter(f => f.endsWith('.json')).sort().reverse();
    for (const f of files) {
      const data = JSON.parse(await fs.readFile(path.join(runsDir, f), 'utf8'));
      if (['account_audit', 'mapping_preview', 'mapping_apply'].includes(data.mode)) {
        if (!accountId || data.accountId === accountId) return data;
      }
    }
  } catch {}
  return lastReport;
}
const sessionError = error => /sess[aã]o|expirad|closed|Target page|context or browser|janela/i.test(String(error?.message ?? error));
const WINDOW_CLOSED = 'A janela do Chrome da automação foi fechada. Clique em Abrir janela de login e entre de novo; mantenha a janela aberta até o fim da conferência ou da gravação.';
const humanError = error => /Target page, context or browser has been closed|Browser has been closed|browserContext\.newPage/i.test(String(error?.message ?? error)) ? WINDOW_CLOSED : String(error?.message ?? error);
let sessionLostAt = null;
// Se o operador fecha a janela (ou o Chrome cai), a sessão deixa de existir: o estado é limpo na hora.
function watchLoginContext(context) {
  context.on('close', async () => {
    if (loginContext !== context) return;
    loginContext = null; loginReady = false; catalogState = null; previewState = null;
    catalogStatus = 'invalidated'; catalogSessionGeneration++; ongoingCatalogPromise = null;
    sessionLostAt = new Date().toISOString();
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
const normalizeTaskStr = value => String(value ?? '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const stripOrdinal = s => String(s ?? '').replace(/^\s*\d+\s*[-–—:]?\s+/, '').trim();

export function findAutoMatch(task, taskRows, catalog) {
  if (!catalog?.questions) return null;
  const normTask = normalizeTaskStr(task);
  const normTaskClean = normalizeTaskStr(stripOrdinal(task));

  // 1. Prioridade máxima: correspondência por nome exato da tarefa (ou resposta)
  const matches = [];
  for (const q of catalog.questions) {
    for (const a of q.answers) {
      const aLabelNorm = normalizeTaskStr(a.label);
      const aDisplayNorm = normalizeTaskStr(a.display);
      const aClean = normalizeTaskStr(stripOrdinal(a.label));
      if (
        aLabelNorm === normTask ||
        aDisplayNorm === normTask ||
        (normTaskClean && aClean === normTaskClean)
      ) {
        matches.push({ question: q, answer: a });
      }
    }
  }
  if (matches.length === 1) {
    return { question: matches[0].question, answer: matches[0].answer, matchBy: 'exact_name' };
  }

  // 2. Correspondência secundária por código numérico bruto (resposta) caso não haja colisão nem conflito flagrante
  const codeVal = taskRows?.find(r => r._norm?.resposta)?._norm?.resposta;
  if (codeVal && String(codeVal).trim()) {
    const code = String(codeVal).trim();
    for (const q of catalog.questions) {
      for (const a of q.answers) {
        if (String(a.value ?? '').trim() === code) {
          // Não aceitar match espúrio em meses de ALVARÁ se a tarefa for de outro assunto (ex.: sindicato)
          const aNorm = normalizeTaskStr(a.label);
          const isMonth = /^(0\d\s*-\s*)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/i.test(aNorm);
          if (isMonth && !/(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|trimestre|mes)/i.test(normTask)) {
            continue;
          }
          return { question: q, answer: a, matchBy: 'code' };
        }
      }
    }
  }
  return null;
}
async function route(req, res) {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) return send(res, 200, await fs.readFile(path.join(root, 'ui/index.html'), 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/app.js') return send(res, 200, await fs.readFile(path.join(root, 'ui/app.js'), 'utf8'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/toast.js') return send(res, 200, await fs.readFile(path.join(root, 'ui/toast.js'), 'utf8'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/style.css') return send(res, 200, await fs.readFile(path.join(root, 'ui/style.css'), 'utf8'), 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/ui/jb-logo.svg') return send(res, 200, await fs.readFile(path.join(root, 'ui/jb-logo.svg'), 'utf8'), 'image/svg+xml; charset=utf-8');
  if (req.method === 'GET' && (url.pathname === '/ui/jb-favicon.svg' || url.pathname === '/favicon.ico')) return send(res, 200, await fs.readFile(path.join(root, 'ui/jb-favicon.svg'), 'utf8'), 'image/svg+xml; charset=utf-8');

  // Rotas de Autenticação Públicas / Sessão
  const authHandled = await handleAuthRoutes(req, res, { url, currentUser: getAuthUser(req), authService, body, send, sendCookie, getCookie });
  if (authHandled !== false) return;

  // Identificação e Autorização Geral estritamente via Sessão (sem bypass de token)
  const currentUser = getAuthUser(req);

  if (req.method === 'GET' && url.pathname === '/api/config') {
    if (!currentUser) return send(res, 401, { error: 'Sessão necessária', code: 'unauthenticated' });
    return send(res, 200, {
      savedMappings, savedProfiles, targetModels: TARGET_MODELS, availableFields: AVAILABLE_FIELDS,
      accounts: await listStoredAccounts(), loginOpen: Boolean(loginContext), loginReady, sessionLostAt,
      catalog: catalogState,
      catalogLive: Boolean(catalogState && catalogStatus === 'ready'),
      catalogStatus,
      catalogAccountId: catalogState?.accountId ?? null,
      catalogCapturedAt: catalogState?.capturedAt ?? null,
      busy,
      user: currentUser,
      headless: process.env.GCLICK_HEADLESS === 'true'
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/gclick/empresa-foto') {
    if (!currentUser) return send(res, 401, { error: 'Sessão necessária', code: 'unauthenticated' });
    const saved = await findSavedEmpresaFoto(empresaFotosDir, url.searchParams.get('accountId')?.trim());
    if (!saved) return send(res, 404, { error: 'Foto da empresa ainda não capturada' });
    res.writeHead(200, { 'Content-Type': saved.ext === 'png' ? 'image/png' : saved.ext === 'webp' ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'no-cache' });
    return res.end(await fs.readFile(saved.file));
  }
  if (req.method === 'GET' && url.pathname === '/api/gclick/session') {
    if (!currentUser) return send(res, 401, { error: 'Sessão necessária', code: 'unauthenticated' });
    const accountId = url.searchParams.get('accountId')?.trim();
    if (!loginContext) {
      return send(res, 200, {
        browserStatus: 'closed',
        gclickAuthStatus: 'unknown',
        accountMatches: false,
        isReadyForModules: false,
        activeAccountId: accountId || null,
        activeEmpresaNome: null,
        currentEmpresaId: null,
        currentEmpresaNome: null,
        availableEmpresas: [],
        message: 'Navegador de automação fechado.'
      });
    }

    const pages = loginContext.pages().filter(p => !p.isClosed());
    const urls = pages.map(page => { try { return new URL(page.url()); } catch { return null; } }).filter(Boolean);
    const onAuth = urls.some(current => /(^|\.)gclick\.com\.br$/.test(current.hostname) && current.pathname.startsWith('/autenticacao'));
    const onEmpresas = urls.some(current => current.hostname === 'appp.gclick.com.br' && current.pathname.includes('/empresas'));
    const hasInternalPage = urls.some(current => /(^|\.)gclick\.com\.br$/.test(current.hostname) && !current.pathname.startsWith('/autenticacao'));

    // Leitura passiva do localStorage (empresa ativa e lista de acessos)
    let activeEmpresa = null;
    let accessEmpresas = [];
    for (const p of pages) {
      if (p.isClosed()) continue;
      try {
        const u = new URL(p.url());
        if (!/(^|\.)gclick\.com\.br$/.test(u.hostname) || u.pathname.startsWith('/autenticacao')) continue;
        const empresaData = await p.evaluate(() => {
          try {
            const curRaw = localStorage.getItem('g3CurrentEmpresa');
            const allRaw = localStorage.getItem('g3AccessEmpresas');
            return {
              current: curRaw ? JSON.parse(curRaw) : null,
              all: allRaw ? JSON.parse(allRaw) : []
            };
          } catch { return null; }
        }).catch(() => null);

        if (empresaData) {
          if (!activeEmpresa && empresaData.current) activeEmpresa = empresaData.current;
          if (Array.isArray(empresaData.all) && empresaData.all.length) accessEmpresas = empresaData.all;
        }
        if (activeEmpresa && accessEmpresas.length) break;
      } catch { /* inspeção passiva sem falhar requisição */ }
    }

    // Identifica o nome da empresa solicitada ou ativa
    let resolvedNome = null;
    if (accountId && accessEmpresas.length) {
      const match = accessEmpresas.find(e => String(e.id) === String(accountId));
      if (match?.nome) resolvedNome = match.nome;
    }
    if (!resolvedNome && activeEmpresa?.nome) {
      resolvedNome = activeEmpresa.nome;
    }

    const accountMatches = Boolean(accountId && activeEmpresa?.id && String(activeEmpresa.id) === String(accountId));

    let authStatus = 'unknown';
    let message = 'Aguardando login no G-Click no navegador de automação.';

    if (urls.length === 0 || onAuth) {
      authStatus = 'awaiting_login';
      message = 'Aguardando o login no Chrome da automação.';
    } else if (onEmpresas) {
      authStatus = 'select_company';
      message = accountId
        ? `Login realizado. Selecione a empresa no G-Click (conta ${accountId}) para continuar.`
        : 'Login realizado. Selecione uma empresa no G-Click.';
    } else if (hasInternalPage) {
      if (accountId && activeEmpresa?.id && !accountMatches) {
        authStatus = 'account_mismatch';
        message = `G-Click conectado em "${activeEmpresa.nome || activeEmpresa.id}" (${activeEmpresa.id}), diferente da conta ${accountId}. Alterne para a conta ${accountId} para liberar os módulos.`;
      } else {
        authStatus = 'login_detected';
        message = accountId
          ? `Conta ${accountId}${resolvedNome ? ` (${resolvedNome})` : ''} conectada e validada no G-Click. Módulos liberados!`
          : 'Login detectado no G-Click.';
      }
    }

    const isReadyForModules = Boolean(authStatus === 'login_detected' && (accountId ? accountMatches : true));
    // Foto da empresa: tenta uma vez por minuto enquanto não houver cópia; só lê o que já está aberto, sem navegar.
    if (isReadyForModules && accountId && Date.now() - (empresaFotoAttempts.get(accountId) ?? 0) > 60000) {
      empresaFotoAttempts.set(accountId, Date.now());
      findSavedEmpresaFoto(empresaFotosDir, accountId)
        .then(async saved => {
          if (saved || await saveEmpresaFoto(loginContext, accountId, empresaFotosDir)) return;
          console.log(`[foto-empresa] conta ${accountId}: foto não localizada nas páginas abertas`, JSON.stringify(await describeEmpresaFotoCandidates(loginContext)));
        })
        .catch(() => null);
    }

    return send(res, 200, {
      browserStatus: 'open',
      gclickAuthStatus: authStatus,
      onEmpresas,
      accountMatches,
      isReadyForModules,
      activeAccountId: accountId || (activeEmpresa?.id ? String(activeEmpresa.id) : null),
      activeEmpresaNome: resolvedNome,
      currentEmpresaId: activeEmpresa?.id ? String(activeEmpresa.id) : null,
      currentEmpresaNome: activeEmpresa?.nome || null,
      availableEmpresas: accessEmpresas.map(e => ({
        id: String(e.id),
        nome: e.nome,
        apelido: e.apelido || null,
        cnpj: e.cnpj || null,
        ativo: e.ativo !== 0,
        imagemUrl: e.imagemUrl || e.foto || e.avatar || null
      })),
      message
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/users') {
    if (!currentUser || !authService.hasPermission(currentUser.id, 'usuarios.administrar')) {
      return send(res, 403, { error: 'Acesso negado: permissão "usuarios.administrar" necessária' });
    }
    return send(res, 200, {
      users: authService.listUsers(),
      roles: authService.listRoles(),
      permissions: authService.listPermissions()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/report.json') {
    const accountId = url.searchParams.get('account') || lastReport?.accountId || '2420';
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: sem permissão para esta conta' });
    }
    const rep = (await getLatestReport(accountId)) || lastReport;
    return rep ? send(res, 200, rep) : send(res, 404, { error: 'Nenhum relatório gerado' });
  }
  if (req.method === 'GET' && (url.pathname === '/api/report.csv' || url.pathname === '/api/audit/log.csv')) {
    const accountId = url.searchParams.get('account') || lastReport?.accountId || '2420';
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.exportar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: sem permissão para esta conta' });
    }
    const rep = (await getLatestReport(accountId)) || lastReport;
    if (!rep) return send(res, 404, { error: 'Nenhum relatório de auditoria gerado' });
    const catalog = catalogState?.accountId === rep.accountId ? catalogState : (await readStoredCatalog(rep.accountId));
    const ledger = await readLedger(rep.accountId);
    const rows = buildAuditLogRows(rep, catalog, savedMappings, ledger);
    return send(res, 200, auditLogCsv(rows), 'text/csv; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/marcacoes.csv') {
    const accountId = requireAccount(url.searchParams.get('account'));
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.exportar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: sem permissão para esta conta' });
    }
    const type = url.searchParams.get('type');
    if (type === 'ledger_only') {
      return send(res, 200, ledgerCsv(await readLedger(accountId)), 'text/csv; charset=utf-8');
    }
    const rep = (await getLatestReport(accountId)) || lastReport;
    if (!rep) {
      if (type === 'ledger') return send(res, 200, ledgerCsv(await readLedger(accountId)), 'text/csv; charset=utf-8');
      return send(res, 404, { error: 'Nenhum relatório de auditoria gerado' });
    }
    const catalog = catalogState?.accountId === accountId ? catalogState : (await readStoredCatalog(accountId));
    const ledger = await readLedger(accountId);
    const rows = buildAuditLogRows(rep, catalog, savedMappings, ledger);
    return send(res, 200, auditLogCsv(rows), 'text/csv; charset=utf-8');
  }
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada' });
  
  // Validação de Origem/CSRF local para rotas com efeitos
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!isAllowedHost(originUrl.hostname)) {
        return send(res, 403, { error: 'Origem não permitida', code: 'forbidden_origin' });
      }
    } catch {
      return send(res, 403, { error: 'Origem inválida', code: 'forbidden_origin' });
    }
  } else if (referer) {
    try {
      const refUrl = new URL(referer);
      if (!isAllowedHost(refUrl.hostname)) {
        return send(res, 403, { error: 'Referer não permitido', code: 'forbidden_origin' });
      }
    } catch {
      return send(res, 403, { error: 'Referer inválido', code: 'forbidden_origin' });
    }
  }

  if (!currentUser) return send(res, 401, { error: 'Sessão da interface expirada ou não autenticada', code: 'unauthenticated' });
  const payload = await body(req);

  // Endpoints Administrativos de Usuários
  const userAdminHandled = await handleUserAdminPostRoutes(req, res, { url, currentUser, payload, authService, send });
  if (userAdminHandled !== false) return;

  if (url.pathname === '/api/cancel') {
    let cancelled = false;
    if (activeAbortController) {
      activeAbortController.abort();
      cancelled = true;
    }
    busy = false;
    applyProgress = { running: false, stage: 'cancelado', done: 0 };
    obrigacoesProgress = { ...obrigacoesProgress, running: false, stage: 'Operação cancelada pelo operador.' };
    return send(res, 200, {
      success: true,
      cancelled,
      message: cancelled ? 'Operação cancelada com sucesso.' : 'Nenhuma operação ativa para cancelar.'
    });
  }

  const previewStateRef = {
    get value() { return previewState; },
    set value(v) { previewState = v; }
  };
  const sourceProfileHandled = await handleSourceProfileRoutes(req, res, {
    url,
    payload,
    loadSource,
    parseHeaderAndSample,
    createSuggestedProfile,
    validateProfileAgainstStructure,
    parseCsvTable,
    normalizeTable,
    savedProfiles,
    saveProfiles,
    targetModels: TARGET_MODELS,
    availableFields: AVAILABLE_FIELDS,
    previewStateRef,
    send
  });
  if (sourceProfileHandled !== false) return sourceProfileHandled;
  if (url.pathname === '/api/catalog/reference') {
    const accountId = requireAccount(payload.accountId);
    const sheetUrl = accountSettings[accountId]?.sheetUrl ?? '';
    // Perguntas só existem para a interface depois da leitura da Enquete desta conta na sessão atual.
    return send(res, 200, { catalog: catalogState?.accountId === accountId && loginReady ? catalogState : null, live: true, sheetUrl });
  }
  const obrigacoesProgressRef = {
    get value() { return obrigacoesProgress; },
    set value(v) { obrigacoesProgress = v; }
  };
  const obrigacoesHandled = await handleObrigacoesRoutes(req, res, {
    url,
    payload,
    currentUser,
    authService,
    requireAccount,
    loginContext,
    hasGclickActiveSession,
    exclusive,
    catalogsDir,
    savedObrigacoesTemplates,
    getDefaultTemplates,
    saveObrigacoesTemplates,
    obrigacoesProgressRef,
    obrigacoesLib,
    send
  });
  if (obrigacoesHandled !== false) return obrigacoesHandled;

  const carteiraHandled = await handleCarteiraRoutes(req, res, {
    url,
    payload,
    currentUser,
    authService,
    requireAccount,
    loginContext,
    hasGclickActiveSession,
    exclusive,
    catalogsDir,
    runsDir: path.join(root, 'runs'),
    carteiraLib,
    send
  });
  if (carteiraHandled !== false) return carteiraHandled;

  if (url.pathname === '/api/accounts/save') {
    const accountId = requireAccount(payload.accountId);
    // Cada uso guarda o próprio link; só os campos enviados são alterados.
    const changes = {};
    if ('sheetUrl' in payload) changes.sheetUrl = validSheetUrl(payload.sheetUrl);
    if ('carteiraSheetUrl' in payload) changes.carteiraSheetUrl = validSheetUrl(payload.carteiraSheetUrl);
    accountSettings[accountId] = { ...accountSettings[accountId], ...changes, updatedAt: new Date().toISOString() };
    await saveAccountSettings();
    return send(res, 200, { accounts: await listStoredAccounts() });
  }
  if (url.pathname === '/api/mappings/save') {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'mapeamentos.gerenciar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "mapeamentos.gerenciar" necessária' });
    }
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
  if (url.pathname === '/api/mappings/save-batch') {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'mapeamentos.gerenciar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "mapeamentos.gerenciar" necessária' });
    }
    const mappingsToSave = Array.isArray(payload.mappings) ? payload.mappings : [];
    const availableCatalog = catalogState?.accountId === accountId && loginReady ? catalogState : null;
    if (!availableCatalog) throw new Error('Conecte a Enquete desta conta antes de salvar lote de mapeamentos.');
    let updatedCount = 0;
    for (const item of mappingsToSave) {
      const task = String(item.task ?? '').trim();
      const answerRef = String(item.answerRef ?? '').trim();
      if (!task || !answerRef) continue;
      let found = null;
      for (const question of availableCatalog.questions) {
        const answer = question.answers.find(a => a.ref === answerRef);
        if (answer) { found = { question, answer }; break; }
      }
      if (!found) continue;
      savedMappings = savedMappings.filter(x => !(x.accountId === accountId && x.task === task));
      savedMappings.push({
        accountId, task, answerRef,
        questionLabel: found.question.label,
        answerLabel: found.answer.label,
        catalogSource: 'live',
        updatedAt: new Date().toISOString()
      });
      updatedCount++;
    }
    if (updatedCount > 0) {
      await saveMappings();
      previewState = null;
    }
    return send(res, 200, { savedMappings, updatedCount });
  }
  if (url.pathname === '/api/audit/progress') return send(res, 200, auditProgress);
  const sheetsHandled = await handleSheetsRoutes(req, res, {
    url,
    payload,
    currentUser,
    authService,
    requireAccount,
    readWriters,
    saveWriters,
    writeAuditLog,
    writerFor,
    pushPendingMarks,
    testSheetWriter,
    validScriptUrl,
    appsScriptSource,
    accountSettings,
    readLedger,
    getLatestReport,
    lastReport,
    catalogState,
    readStoredCatalog,
    savedMappings,
    buildAuditLogRows,
    send
  });
  if (sheetsHandled !== false) return sheetsHandled;
  if (url.pathname === '/api/mappings/plan') {
    const accountId = requireAccount(payload.accountId);
    const task = String(payload.task ?? '').trim();
    const saved = savedMappings.find(x => x.accountId === accountId && x.task === task);
    if (!saved) throw new Error('Tarefa sem mapeamento salvo nesta conta');
    const source = await loadSource(payload);
    const sheetId = String(payload.sheetName ?? payload.sheetId ?? source.label);
    const structure = parseHeaderAndSample(source.csv, { headerRow: payload.headerRow ?? 1 });
    let profile = payload.profile ?? savedProfiles.find(p => p.accountId === accountId && profileFitsUse(p, 'enquete_automacao') && (p.sourceFingerprint === source.label || p.sheetIdentifier === sheetId));
    if (profile) {
      const val = validateProfileAgainstStructure(profile, structure);
      if (!val.valid) {
        const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, 'enquete_automacao');
        const valSug = validateProfileAgainstStructure(suggested, structure);
        if (valSug.valid) profile = suggested;
      }
    } else {
      const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, 'enquete_automacao');
      const valSug = validateProfileAgainstStructure(suggested, structure);
      if (valSug.valid) profile = suggested;
    }
    let rows;
    if (profile) {
      const table = parseCsvTable(source.csv);
      const normResult = normalizeTable(table, profile);
      rows = normResult.normalizedRows;
    } else {
      rows = parseCsv(source.csv);
    }
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
    const table = parseCsvTable(source.csv);
    const accountId = payload.accountId ? String(payload.accountId).trim() : '';
    const sheetId = String(payload.sheetName ?? payload.sheetId ?? source.label);
    const structure = parseHeaderAndSample(source.csv, { headerRow: payload.headerRow ?? 1 });
    let profile = payload.profile ?? savedProfiles.find(p => p.accountId === accountId && profileFitsUse(p, 'enquete_automacao') && (p.sourceFingerprint === source.label || p.sheetIdentifier === sheetId));
    let normalized = null;
    let audit = null;
    let isEligible = true;
    let missingForAutomation = [];

    if (profile) {
      const val = validateProfileAgainstStructure(profile, structure);
      if (!val.valid) {
        const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, 'enquete_automacao');
        const valSug = validateProfileAgainstStructure(suggested, structure);
        if (valSug.valid) profile = suggested;
      }
    } else {
      const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, 'enquete_automacao');
      const val = validateProfileAgainstStructure(suggested, structure);
      if (val.valid) profile = suggested;
    }

    if (profile) {
      const normResult = normalizeTable(table, profile);
      normalized = normResult.normalizedRows;
      audit = normResult.audit;
      if (profile.targetModel !== 'enquete_automacao') {
        isEligible = false;
        missingForAutomation = ['Obrigações/Tarefas (perfil: ' + (TARGET_MODELS[profile.targetModel]?.label || profile.targetModel) + ')'];
      } else {
        const mappedFields = new Set(profile.columns?.filter(c => c.action === 'map').map(c => c.targetField));
        const missing = [];
        if (!mappedFields.has('tarefa')) missing.push('Obrigação / Tarefa');
        if (!mappedFields.has('cnpj') && !mappedFields.has('empId') && !mappedFields.has('cod')) {
          missing.push('Identificador do Cliente (CNPJ ou Cod./EmpID)');
        }
        missingForAutomation = missing;
        if (missingForAutomation.length) isEligible = false;
      }
    } else {
      const hasTask = ['Obrigação / Tarefa', 'Obrigação', 'Tarefa', 'tarefa'].some(col => table.columns.includes(col));
      const hasId = ['CNPJ', 'EmpID', 'Cod.', 'Código', 'cnpj', 'empId', 'cod'].some(col => table.columns.includes(col));
      const missing = [];
      if (!hasTask) missing.push('Obrigação / Tarefa');
      if (!hasId) missing.push('Identificador do Cliente (CNPJ ou Cod./EmpID)');
      missingForAutomation = missing;
      if (missingForAutomation.length) isEligible = false;
    }

    const columns = table.columns.map((name, index) => {
      const values = table.rows.map(row => row[index].trim()).filter(Boolean);
      return { name, index, filled: values.length, distinct: new Set(values).size };
    });
    const tableResult = { columns, rows: table.rows, profile: profile ?? null, audit };
    if (!isEligible || missingForAutomation.length) return send(res, 200, { source: source.label, stale: source.stale,
      rowCount: table.rows.length, kind: 'table', missingForAutomation, tasks: [], table: tableResult, profile: profile ?? null, audit });

    const rows = normalized ?? parseCsv(source.csv);
    const counts = new Map();
    for (const row of rows) {
      const name = String(row._norm?.tarefa ?? row['Obrigação / Tarefa'] ?? row['Obrigação'] ?? row['Tarefa'] ?? '').trim();
      if (!name) continue;
      const item = counts.get(name) ?? { name, count: 0, clients: new Set(), invalidCnpjs: 0 };
      item.count++;
      const cnpjVal = row._norm?.cnpj ?? row.CNPJ ?? row.cnpj;
      const idVal = row._norm?.empId ?? row._norm?.cod ?? row.EmpID ?? row['Cod.'] ?? row.cod ?? row.empId;
      if (validCnpj(cnpjVal)) item.clients.add(normalizeCnpj(cnpjVal));
      else if (idVal && String(idVal).trim() && String(idVal).trim() !== '-') item.clients.add(`id:${String(idVal).trim()}`);
      else item.invalidCnpjs++;
      counts.set(name, item);
    }
    return send(res, 200, { source: source.label, stale: source.stale, rowCount: rows.length, kind: 'tasks', table: tableResult,
      profile: profile ?? null, audit,
      tasks: [...counts.values()].map(({ name, count, clients, invalidCnpjs }) => ({ name, count, clients: clients.size, invalidCnpjs }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) });
  }
  if (url.pathname === '/api/catalog') {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'enquete.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "enquete.visualizar" necessária nesta conta' });
    }
    if (!loginContext) throw new Error('Abra primeiro a janela de login do G-Click no menu Conexão & Conta');

    // Se já houver captura em andamento para a mesma conta, reaproveita a mesma Promise (deduplicação contra clique duplo)
    if (ongoingCatalogPromise && ongoingCatalogPromise.accountId === accountId) {
      const result = await ongoingCatalogPromise.promise;
      return send(res, 200, result);
    }

    const currentGen = ++catalogSessionGeneration;
    catalogStatus = 'loading';

    const executeCapture = async () => {
      try {
        if (!(await hasGclickSession(loginContext, accountId))) {
          catalogStatus = 'failed';
          throw new Error(`A Enquete da conta ${accountId} não abriu no Chrome da automação. Confira se o usuário logado tem acesso a este escritório.`);
        }
        await captureCatalog(accountId);

        // Se a geração mudou durante a captura (ex.: usuário trocou de conta ou reiniciou login), descarta resultado desatualizado
        if (catalogSessionGeneration !== currentGen) {
          return { catalog: null, invalidated: true };
        }

        loginReady = true;
        catalogStatus = 'ready';
        return {
          catalog: catalogState,
          catalogStatus: 'ready',
          catalogAccountId: catalogState?.accountId,
          catalogCapturedAt: catalogState?.capturedAt
        };
      } catch (err) {
        if (catalogSessionGeneration === currentGen) catalogStatus = 'failed';
        throw err;
      } finally {
        if (ongoingCatalogPromise?.accountId === accountId) ongoingCatalogPromise = null;
      }
    };

    const promise = exclusive(executeCapture, true);
    ongoingCatalogPromise = { accountId, promise };

    return send(res, 200, await promise);
  }
  if (url.pathname === '/api/mappings/preview') return send(res, 200, await exclusive(async () => {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'enquete.conferir', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "enquete.conferir" necessária nesta conta' });
    }
    if (!loginContext || !loginReady || !catalogState) throw new Error('Abra a Enquete da conta para capturar o catálogo antes da prévia');
    if (accountId !== catalogState.accountId) throw new Error('A conta selecionada difere da Enquete conectada');
    previewState = null;
    const source = await loadSource(payload);
    const table = parseCsvTable(source.csv);
    const sheetId = String(payload.sheetName ?? payload.sheetId ?? source.label);
    const structure = parseHeaderAndSample(source.csv, { headerRow: payload.headerRow ?? 1 });
    let profile = payload.profile ?? savedProfiles.find(p => p.accountId === accountId && profileFitsUse(p, 'enquete_automacao') && (p.sourceFingerprint === source.label || p.sheetIdentifier === sheetId));
    if (profile) {
      const val = validateProfileAgainstStructure(profile, structure);
      if (!val.valid) {
        const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, 'enquete_automacao');
        const valSug = validateProfileAgainstStructure(suggested, structure);
        if (valSug.valid) profile = suggested;
      }
    } else {
      const suggested = createSuggestedProfile(accountId, source.label, sheetId, structure, 'enquete_automacao');
      const val = validateProfileAgainstStructure(suggested, structure);
      if (val.valid) profile = suggested;
    }
    let rows;
    if (profile) {
      if (profile.targetModel !== 'enquete_automacao') {
        throw new Error(`O perfil "${TARGET_MODELS[profile.targetModel]?.label ?? profile.targetModel}" não permite conferência de Enquete.`);
      }
      const normResult = normalizeTable(table, profile);
      rows = normResult.normalizedRows;
      const hasTask = rows.some(r => Boolean(r._norm?.tarefa));
      if (!rows.length || !hasTask) throw new Error('Planilha sem coluna Obrigação / Tarefa mapeada');
      const hasId = rows.some(r => Boolean(r._norm?.empId || r._norm?.cod || r._norm?.cnpj));
      if (!hasId) throw new Error('Planilha sem colunas de identificação (CNPJ, EmpID ou Cod.) mapeadas');
    } else {
      rows = parseCsv(source.csv);
      const hasTask = rows.length && ['Obrigação / Tarefa', 'Obrigação', 'Tarefa', 'tarefa'].some(col => col in rows[0]);
      if (!hasTask) throw new Error('Planilha sem coluna Obrigação / Tarefa');
      const hasId = rows.length && ['EmpID', 'Cod.', 'CNPJ', 'empId', 'cod', 'cnpj'].some(col => col in rows[0]);
      if (!hasId) throw new Error('Planilha sem colunas de identificação (CNPJ, EmpID ou Cod.)');
    }
    const sourceTasks = new Set(rows.map(row => String(row._norm?.tarefa ?? row['Obrigação / Tarefa'] ?? row['Obrigação'] ?? row['Tarefa'] ?? '').trim()).filter(Boolean));
    const filterTask = typeof payload.filterTask === 'string' && payload.filterTask.trim() ? payload.filterTask.trim() : null;
    if (filterTask && !sourceTasks.has(filterTask)) throw new Error(`Obrigação "${filterTask}" não encontrada na planilha`);
    const autoAudit = payload.autoAudit === true;
    if (!autoAudit && !filterTask && (!Array.isArray(payload.selectedTasks) || !payload.selectedTasks.length || payload.selectedTasks.length > 30 ||
        payload.selectedTasks.some(task => typeof task !== 'string' || !sourceTasks.has(task)) ||
        new Set(payload.selectedTasks).size !== payload.selectedTasks.length)) throw new Error('Selecione até 30 tarefas distintas da planilha para esta prévia');
    const taskNames = filterTask ? [filterTask] : autoAudit ? [...sourceTasks] : payload.selectedTasks;
    if (autoAudit) auditProgress = { running: true, completed: 0, total: taskNames.length, task: filterTask ? `Conferindo ${filterTask}` : 'Identificando tarefas da planilha', error: null };
    try {
    const mappings = [], pending = [], excluded = [];
    for (const task of taskNames) {
      let saved = savedMappings.find(x => x.accountId === accountId && x.task === task);
      if (!saved && catalogState?.questions) {
        const taskRows = rows.filter(item => String(item._norm?.tarefa ?? item['Obrigação / Tarefa'] ?? item['Obrigação'] ?? item['Tarefa'] ?? '').trim() === task);
        const match = findAutoMatch(task, taskRows, catalogState);
        if (match) {
          saved = {
            accountId,
            task,
            answerRef: match.answer.ref,
            questionLabel: match.question.label,
            answerLabel: match.answer.label,
            catalogSource: 'live',
            updatedAt: new Date().toISOString(),
            isSuggestion: true
          };
        }
      }
      if (saved?.excluded) { excluded.push(task); if (autoAudit) auditProgress.completed++; continue; }
      const rules = saved ? mappingRules(accountId, task, saved) : null;
      if (!rules) { pending.push(task); if (autoAudit) auditProgress.completed++; continue; }
      mappings.push({ task, rules });
    }
    if (!autoAudit && (pending.length || excluded.length)) throw new Error(`Há ${pending.length + excluded.length} tarefa(s) selecionada(s) sem mapeamento válido; revise a fila`);
    if (!autoAudit && !mappings.length) throw new Error('Nenhum mapeamento confirmado foi encontrado na planilha');
    const results = [], inspected = [], invalidSource = [], failedTasks = [], applicable = [];
    let incompleteReason = null;
    if (autoAudit) {
      for (const task of pending) {
        const seen = new Set();
        for (const row of rows.filter(item => String(item._norm?.tarefa ?? item['Obrigação / Tarefa'] ?? item['Obrigação'] ?? item['Tarefa'] ?? '').trim() === task)) {
          const cnpjVal = row._norm?.cnpj ?? row.CNPJ ?? row.cnpj;
          const empVal = row._norm?.empresa ?? row.Empresa ?? row.empresa ?? (validCnpj(cnpjVal) ? formatCnpj(cnpjVal) : '-');
          const idVal = row._norm?.empId ?? row._norm?.cod ?? row.EmpID ?? row['Cod.'] ?? row.empId ?? row.cod;
          const hasCnpj = validCnpj(cnpjVal);
          const hasId = Boolean(idVal && String(idVal).trim() && String(idVal).trim() !== '-');
          if (!hasCnpj && !hasId) { invalidSource.push({ row: row._row, cnpj: cnpjVal || '-', empresa: empVal, task, reason: 'CNPJ e ID do cliente (Cod.) ausentes' }); continue; }
          const key = hasCnpj ? normalizeCnpj(cnpjVal) : `id:${String(idVal).trim()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          inspected.push({
            row: row._row,
            matchingRows: [row._row],
            cnpj: hasCnpj ? formatCnpj(cnpjVal) : `ID ${String(idVal).trim()}`,
            empId: idVal,
            cod: idVal,
            empresa: empVal,
            mappingTask: task,
            uiStatus: 'sem_mapeamento',
            uiReason: 'Tarefa sem associação confirmada com uma resposta da Enquete; estado não verificado'
          });
        }
      }
      const emptyTaskRows = rows.filter(item => !String(item._norm?.tarefa ?? item['Obrigação / Tarefa'] ?? '').trim());
      for (const row of emptyTaskRows) {
        const cnpjVal = row._norm?.cnpj ?? row.CNPJ;
        const empVal = row._norm?.empresa ?? row.Empresa;
        const idVal = row._norm?.empId ?? row._norm?.cod ?? row.EmpID ?? row['Cod.'];
        const hasCnpj = validCnpj(cnpjVal);
        const hasId = Boolean(idVal && String(idVal).trim() && String(idVal).trim() !== '-');
        const fallbackTask = String(row._raw?.['Enquadramento informado'] ?? row['Enquadramento informado'] ?? '').trim();
        const rowNum = row._row ?? (rows.indexOf(row) + 2);
        if (!hasCnpj && !hasId) {
          invalidSource.push({
            row: rowNum,
            cnpj: cnpjVal || '-',
            empresa: empVal,
            task: fallbackTask || '',
            reason: 'CNPJ, ID do cliente (Cod.) e tarefa ausentes na planilha'
          });
          continue;
        }
        inspected.push({
          row: rowNum,
          matchingRows: [rowNum],
          cnpj: hasCnpj ? formatCnpj(cnpjVal) : `ID ${String(idVal).trim()}`,
          empId: idVal || '',
          cod: idVal || '',
          empresa: empVal || '',
          mappingTask: fallbackTask ? `${fallbackTask} (sem enquete)` : 'Sem obrigação / tarefa na planilha',
          task: fallbackTask || '',
          uiStatus: 'sem_tarefa',
          uiReason: fallbackTask 
            ? `Coluna "Descrição da enquete" vazia na planilha (enquadramento informado: "${fallbackTask}")`
            : 'Coluna "Descrição da enquete" vazia na planilha; nenhuma tarefa informada para este cliente'
        });
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
            const checked = (await inspectAll(page, item.plan, rules)).map(x => ({
              ...x,
              mappingTask: item.mapping.task,
              mappingAnswer: rules.answerRef,
              questionRef: rules.questionRef,
              questionLabel: rules.question,
              answerRef: rules.answerRef,
              answerLabel: rules.answerLabel,
              answerValue: rules.answerValue,
              category: rules.category
            }));
            if (!(await questionStillOpen(page, rules))) throw new Error('Sessão do G-Click perdida durante a leitura desta tarefa');
            const result = { task: item.mapping.task, questionRef: rules.questionRef, answerRef: rules.answerRef, clients: checked.length, summary: summarizeChecked(checked) };
            inspected.push(...checked); applicable.push({ task: item.mapping.task, rules, plan: item.plan }); results.push(result);
            auditCache.set(item.cacheKey, { at: Date.now(), checked, applicable: { task: item.mapping.task, rules, plan: item.plan }, result });
            await persistAuditCache();
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
    // Detecta clientes com tarefas conflitantes em perguntas de escolha única (radio)
    const radioQuestions = new Set(mappings.filter(m => m.rules.inputType === 'radio').map(m => m.rules.questionRef));
    if (radioQuestions.size) {
      const byCnpjQuestion = new Map();
      for (const item of inspected) {
        const rules = mappings.find(m => m.task === item.mappingTask)?.rules;
        if (!rules || rules.inputType !== 'radio') continue;
        const key = `${item.cnpj}|${rules.questionRef}`;
        const list = byCnpjQuestion.get(key) ?? [];
        list.push({ item, rules });
        byCnpjQuestion.set(key, list);
      }
      for (const [, entries] of byCnpjQuestion) {
        const distinctAnswers = new Set(entries.map(e => e.rules.answerRef));
        if (distinctAnswers.size > 1) {
          const taskNames = [...new Set(entries.map(e => `“${e.item.mappingTask}”`))].join(' e ');
          for (const { item, rules } of entries) {
            item.uiStatus = 'bloqueado';
            item.uiReason = `Conflito: ${taskNames} exigem respostas diferentes na pergunta ${rules.questionRef} (escolha única)`;
          }
        }
      }
      for (const res of results) {
        const taskItems = inspected.filter(x => x.mappingTask === res.task);
        res.summary = summarizeChecked(taskItems);
      }
    }
    const report = { mode: autoAudit ? 'account_audit' : 'mapping_preview', createdAt: new Date().toISOString(), source: source.label, sourceSha256: sha256(source.csv), sourceStale: source.stale,
      accountId, complete: !incompleteReason && !failedTasks.length, incompleteReason, rules: { inputType: 'mixed', allowedTasks: mappings.map(x => x.task) }, mappings: results, pendingTasks: pending,
      excludedTasks: excluded, failedTasks, sourceTaskCount: sourceTasks.size,
      sourceCnpjCount: new Set(rows.map(row => {
        const c = row._norm?.cnpj ?? row.CNPJ;
        if (validCnpj(c)) return normalizeCnpj(c);
        const id = row._norm?.empId ?? row._norm?.cod ?? row.EmpID ?? row['Cod.'];
        return id ? `id:${id}` : null;
      }).filter(Boolean)).size,
      invalidSource, inspected, filterTask };
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
  if (url.pathname === '/api/mappings/apply') return send(res, 200, await exclusive(async (signal) => {
    const state = previewState;
    if (!state || state.kind !== 'mappings' || state.id !== payload.previewId || Date.now() - state.at > PREVIEW_TTL) throw new Error('Conferência ausente ou vencida. Recarregue a planilha para conferir de novo.');
    if (!authService.hasPermission(currentUser.id, 'enquete.gravar', state.accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "enquete.gravar" necessária nesta conta' });
    }
    if (!loginContext || !loginReady || catalogState?.accountId !== state.accountId || catalogState.capturedAt !== state.catalogCapturedAt)
      throw new Error('A Enquete conectada mudou desde a conferência. Confira de novo.');
    if (state.sourceType === 'recent') {
      const current = await readCsvDownload(downloadsDir, state.downloadFile);
      if (sha256(current.csv) !== state.sourceSha256) { previewState = null; throw new Error('O CSV mudou depois da conferência. Confira de novo antes de marcar.'); }
    }
    previewState = null;
    // O resultado conferido após a gravação atualiza a leitura guardada; a tela não precisa reabrir as perguntas.
    const updateCache = async (task, answerRef, cnpjStatus) => {
      for (const [key, entry] of auditCache) {
        if (!key.includes(`|${task}|${answerRef}|`)) continue;
        const checked = entry.checked.map(x => cnpjStatus.has(x.cnpj) ? { ...x, ...cnpjStatus.get(x.cnpj) } : x);
        auditCache.set(key, { ...entry, checked, result: { ...entry.result, summary: Object.fromEntries(['vazio','ja_correto','divergente','nao_encontrado','bloqueado'].map(st => [st, checked.filter(x => x.uiStatus === st).length])) } });
      }
      await persistAuditCache();
    };
    const forgetTasks = async tasks => { for (const key of auditCache.keys()) if (tasks.some(task => key.includes(`|${task}|`))) auditCache.delete(key); await persistAuditCache(); };
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
        if (signal?.aborted) {
          applyProgress = { ...applyProgress, running: false, stage: 'cancelado' };
          break;
        }
        // Lotes grandes são divididos; cada lote pede uma confirmação.
        const total = Math.max(...groups.map(g => g.items.length));
        for (let i = 0; i < total; i += APPLY_CHUNK) {
          if (signal?.aborted) {
            applyProgress = { ...applyProgress, running: false, stage: 'cancelado' };
            break;
          }
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
      loginContext = null; loginReady = false; catalogState = null; previewState = null; autoAttemptedAccountId = null;
      catalogStatus = 'not_requested'; catalogSessionGeneration++; ongoingCatalogPromise = null;
      auditCache.clear(); await persistAuditCache();
      if (loginLock) await loginLock();
      loginLock = null;
      loginLock = await acquireLock();
      loginContext = await openBrowser(profile, true);
      watchLoginContext(loginContext); sessionLostAt = null;
      const page = loginContext.pages()[0] ?? await loginContext.newPage();
      await page.goto(LOGIN_URL);
      return send(res, 200, { open: true, catalogStatus: 'not_requested' });
    } catch (e) { if (loginContext) await loginContext.close(); loginContext = null; loginReady = false; catalogState = null; catalogStatus = 'not_requested'; if (loginLock) await loginLock(); loginLock = null; throw e; }
    finally { busy = false; }
  }
  if (url.pathname === '/api/gclick/switch-empresa') {
    if (!currentUser) return send(res, 401, { error: 'Sessão necessária', code: 'unauthenticated' });
    if (!loginContext) throw new Error('Abra primeiro a janela de login da automação.');
    const accountId = requireAccount(payload?.accountId);
    const result = await ensureEmpresaActive(loginContext, accountId);
    if (result.active) result.fotoSaved = Boolean(await saveEmpresaFoto(loginContext, accountId, empresaFotosDir).catch(() => null));
    if (!result.active) {
      const atual = result.currentEmpresaNome || result.currentAccountId;
      result.message = result.reason === 'no_gclick_page_open'
        ? 'Nenhuma aba do G-Click aberta no Chrome da automação. Faça o login antes de alternar.'
        : result.reason === 'account_not_in_access_list'
          ? `A conta ${accountId} não consta entre as empresas acessíveis deste usuário no G-Click.`
          : `Não foi possível alternar para a conta ${accountId}${atual ? `; o G-Click segue em ${atual}` : ''}. Selecione a empresa manualmente no Chrome da automação.`;
    }
    return send(res, 200, result);
  }
  if (url.pathname === '/api/login/close') {
    if (!loginContext) throw new Error('Abra primeiro a janela de login da automação.');
    const accountId = requireAccount(payload.accountId);
    const pages = loginContext.pages().filter(p => !p.isClosed());
    const urls = pages.map(page => { try { return new URL(page.url()); } catch { return null; } }).filter(Boolean);
    const onAuth = urls.some(current => /(^|\.)gclick\.com\.br$/.test(current.hostname) && current.pathname.startsWith('/autenticacao'));
    const onEmpresas = urls.some(current => current.hostname === 'appp.gclick.com.br' && current.pathname.includes('/empresas'));
    const loggedIn = urls.some(current => /(^|\.)gclick\.com\.br$/.test(current.hostname) && !current.pathname.startsWith('/autenticacao'));

    if (!loggedIn || onAuth) {
      return send(res, 200, { open: true, ready: false, stage: 'login', message: 'Aguardando o login no Chrome da automação.' });
    }

    // Tenta garantir que a empresa ativa seja a solicitada
    const empresaResult = await ensureEmpresaActive(loginContext, accountId);

    if (!empresaResult.active) {
      if (empresaResult.reason === 'account_not_in_access_list') {
        const available = empresaResult.availableEmpresas?.map(e => `${e.nome} (${e.id})`).slice(0, 5).join(', ') || 'Nenhuma identificada';
        return send(res, 200, {
          open: true,
          ready: false,
          stage: 'account_mismatch',
          accountMatches: false,
          currentAccountId: empresaResult.currentAccountId,
          currentEmpresaNome: empresaResult.currentEmpresaNome,
          message: `A conta ${accountId} não consta na lista de empresas acessíveis deste usuário no G-Click. Empresas disponíveis: ${available}.`
        });
      }

      if (onEmpresas) {
        return send(res, 200, {
          open: true,
          ready: false,
          stage: 'select_company',
          accountMatches: false,
          message: `Login realizado. Selecione a empresa no G-Click (conta ${accountId}) para continuar.`
        });
      }

      return send(res, 200, {
        open: true,
        ready: false,
        stage: 'account_mismatch',
        accountMatches: false,
        currentAccountId: empresaResult.currentAccountId,
        currentEmpresaNome: empresaResult.currentEmpresaNome,
        message: `O G-Click está conectado na empresa ${empresaResult.currentEmpresaNome || empresaResult.currentAccountId} (${empresaResult.currentAccountId}), diferente da conta ${accountId}. Clique em "Alternar para conta ${accountId}" ou selecione-a no G-Click.`
      });
    }

    // Empresa ativa confirmada
    return send(res, 200, {
      open: true,
      ready: true,
      stage: 'login_detected',
      accountMatches: true,
      accountId,
      empresaNome: empresaResult.empresaNome,
      catalog: catalogState?.accountId === accountId ? catalogState : null,
      message: `Conta ${accountId} (${empresaResult.empresaNome || 'Ativa'}) conectada e confirmada no G-Click. Módulos liberados!`
    });
  }
  return send(res, 404, { error: 'Rota não encontrada' });
}
const server = http.createServer((req, res) => { route(req, res).catch(async e => { console.error(`[API 400] ${req.method} ${req.url}: ${e.message}`); if (e.report) lastReport = e.report; send(res, 400, { error: humanError(e), report: e.report ?? null }); }); });
export { server, route, isAllowedHost, ALLOWED_ORIGIN_HOSTS };
if (process.argv[1] === new URL(import.meta.url).pathname) {
  server.listen(port, host, () => console.log(`G-Click local: http://${host}:${port}`));
}
process.on('uncaughtException', err => { console.error('[UNCAUGHT EXCEPTION]', err); });
process.on('unhandledRejection', reason => { console.error('[UNHANDLED REJECTION]', reason); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { try { if (loginContext) await loginContext.close(); if (loginLock) await loginLock(); } finally { server.close(() => process.exit(0)); } });
