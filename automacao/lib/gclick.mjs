import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCnpj, validCnpj, formatCnpj } from './data.mjs';
import { validateAnswerMapping } from './answer-map.mjs';
import { buildCatalog } from './catalog.mjs';

const BASE = 'https://app.gclick.com.br/Listar.do?obj=enqueteopen&tipo=0&empId=';
export const LOGIN_URL = 'https://appp.gclick.com.br/empresas';
function findEnquetePage(context, accountId) {
  return context.pages().find(page => {
    if (page.isClosed()) return false;
    try {
      const url = new URL(page.url());
      return url.hostname === 'app.gclick.com.br' && url.pathname === '/Listar.do' &&
        url.searchParams.get('obj') === 'enqueteopen' && url.searchParams.get('empId') === String(accountId);
    } catch { return false; }
  });
}
const radioSelector = rules => `input[type="radio"][name$="-${rules.questionRef}"]`;
const checkboxSelector = rules => `input[type="checkbox"][value="${rules.answerValue}"][id^="cb."]`;
const targetSelector = rules => rules.inputType === 'checkbox' ? checkboxSelector(rules) : `${radioSelector(rules)}[value="${rules.answerValue}"]`;
// Oscilações de rede (troca de Wi-Fi, VPN, DNS) não devem derrubar uma conferência inteira: tenta de novo antes de desistir.
const TRANSIENT = /net::ERR_(NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|TIMED_OUT|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE)|Timeout \d+ms exceeded/;
// O legado (app.gclick.com.br) mantém UMA empresa por sessão: a troca só acontece pelo card em appp /empresas
// (que faz o POST em g3login.do). Pedir outro empId pela URL devolve esta página em vez do módulo.
export const LEGACY_WRONG_EMPRESA = /ocorreu mudan[çc]a de empresa/i;
export class EmpresaSessionError extends Error {
  constructor(accountId) {
    super(`O G-Click está com a sessão aberta em outra empresa e recusou a conta ${accountId ?? 'solicitada'}. Alterne para a conta ${accountId ?? 'desejada'} em "Conexão & Conta G-Click" antes de continuar.`);
    this.code = 'empresa_session_mismatch';
    this.accountId = accountId ?? null;
  }
}
export async function assertLegacyEmpresa(page) {
  let u;
  try { u = new URL(page.url()); } catch { return; }
  if (u.hostname !== 'app.gclick.com.br') return;
  let text = '';
  try { text = await page.evaluate(() => document.body?.innerText ?? ''); } catch { /* página sem DOM legível: não há como afirmar a divergência */ }
  if (LEGACY_WRONG_EMPRESA.test(text)) throw new EmpresaSessionError(u.searchParams.get('empId'));
}
export async function gotoWithRetry(page, url, { attempts = 3, delayMs = 3000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try { response = await page.goto(url, { waitUntil: 'domcontentloaded' }); }
    catch (error) {
      if (attempt >= attempts || !TRANSIENT.test(error.message) || page.isClosed()) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      continue;
    }
    await assertLegacyEmpresa(page);
    return response;
  }
}
export async function getActiveEmpresa(page) {
  try {
    return await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('g3CurrentEmpresa');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
  } catch { return null; }
}

export async function getAccessEmpresas(page) {
  try {
    return await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('g3AccessEmpresas');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
  } catch { return null; }
}

// Foto da empresa: o G-Click só a mostra nos cartões de "Minhas Empresas", em link temporário do S3
// com o empId no caminho (…/gclick/empresa/<empId>/foto.jpg?X-Amz-…). Os links vistos ficam na memória
// até serem baixados; a cópia em disco é o que o painel exibe, porque o link expira.
const empresaFotoUrls = new Map();
const FOTO_EXTS = ['jpg', 'png', 'webp'];
const FOTO_MAX_BYTES = 2 * 1024 * 1024;

export async function rememberEmpresaFotos(page) {
  const found = await page.evaluate(() => Array.from(document.querySelectorAll('.empresa-card img'))
    .map(img => img.currentSrc || img.src)
    .map(src => ({ src, id: (src.match(/\/empresa\/(\d+)\//) || [])[1] }))
    .filter(item => item.id)).catch(() => []);
  for (const { id, src } of found) empresaFotoUrls.set(String(id), src);
  return found.length;
}

async function findEmpresaFotoUrl(context, accountId) {
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    let host = '';
    try { host = new URL(page.url()).hostname; } catch { continue; }
    if (!/(^|\.)gclick\.com\.br$/.test(host)) continue;
    const src = await page.evaluate(id => {
      const img = Array.from(document.images).find(item => (item.currentSrc || item.src).includes(`/empresa/${id}/`));
      if (img) return img.currentSrc || img.src;
      // Header do dashboard: a SPA guarda a empresa ativa no localStorage, às vezes com o link da imagem.
      for (const key of ['g3CurrentEmpresa', 'g3AccessEmpresas']) {
        let value;
        try { value = JSON.parse(localStorage.getItem(key) || 'null'); } catch { continue; }
        const list = Array.isArray(value) ? value : [value];
        const empresa = list.find(item => item && String(item.id) === id);
        const url = empresa && Object.values(empresa).find(field => typeof field === 'string' && /^https?:\/\/\S+\.(jpe?g|png|webp)(\?|$)/i.test(field));
        if (url) return url;
      }
      return null;
    }, String(accountId)).catch(() => null);
    if (src) return src;
  }
  return empresaFotoUrls.get(String(accountId)) ?? null;
}

// Diagnóstico quando a foto não é achada: lista as imagens das páginas abertas, sem query string
// (o link assinado não vai para o log), e os campos da empresa ativa no localStorage.
export async function describeEmpresaFotoCandidates(context) {
  const report = [];
  for (const page of context?.pages() ?? []) {
    if (page.isClosed()) continue;
    let host = '';
    try { host = new URL(page.url()).hostname; } catch { continue; }
    if (!/(^|\.)gclick\.com\.br$/.test(host)) continue;
    report.push(await page.evaluate(() => {
      const clean = src => String(src || '').split('?')[0];
      const images = Array.from(document.images).map(img => clean(img.currentSrc || img.src)).filter(Boolean);
      const backgrounds = Array.from(document.querySelectorAll('header *, nav *, [class*="empresa"], [class*="logo"]'))
        .map(el => getComputedStyle(el).backgroundImage).filter(bg => bg && bg !== 'none').map(clean);
      let current = null;
      try { current = JSON.parse(localStorage.getItem('g3CurrentEmpresa') || 'null'); } catch { /* sem empresa */ }
      return { url: clean(location.href), images: [...new Set(images)].slice(0, 30), backgrounds: [...new Set(backgrounds)].slice(0, 10), currentEmpresaKeys: current ? Object.keys(current) : null };
    }).catch(error => ({ url: page.url(), error: error.message })));
  }
  return report;
}

export function empresaFotoPath(dir, accountId, ext) {
  if (!/^\d+$/.test(String(accountId))) throw new Error('Conta inválida');
  return path.join(dir, `${accountId}.${ext}`);
}

export async function findSavedEmpresaFoto(dir, accountId) {
  if (!/^\d+$/.test(String(accountId))) return null;
  for (const ext of FOTO_EXTS) {
    const file = empresaFotoPath(dir, accountId, ext);
    try { await fs.access(file); return { file, ext }; } catch { /* tenta o próximo formato */ }
  }
  return null;
}

// Baixa e guarda a foto da empresa; devolve o caminho salvo ou null quando a foto não está ao alcance.
export async function saveEmpresaFoto(context, accountId, dir) {
  if (!context || !/^\d+$/.test(String(accountId))) return null;
  const url = await findEmpresaFotoUrl(context, accountId);
  if (!url) return null;
  const response = await context.request.get(url, { timeout: 15000 }).catch(() => null);
  if (!response?.ok()) return null;
  const type = String(response.headers()['content-type'] ?? '');
  if (!type.startsWith('image/')) return null;
  const body = await response.body();
  if (!body.length || body.length > FOTO_MAX_BYTES) return null;
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  await fs.mkdir(dir, { recursive: true });
  for (const other of FOTO_EXTS.filter(item => item !== ext)) await fs.rm(empresaFotoPath(dir, accountId, other), { force: true });
  const file = empresaFotoPath(dir, accountId, ext);
  await fs.writeFile(file, body);
  empresaFotoUrls.delete(String(accountId));
  return file;
}

export async function enterEmpresa(page, accountId) {
  if (!page || page.isClosed()) return { entered: false };
  let currentUrl;
  try { currentUrl = new URL(page.url()); } catch { return { entered: false }; }

  const isAppp = /(^|\.)gclick\.com\.br$/.test(currentUrl.hostname) || currentUrl.hostname === '127.0.0.1' || currentUrl.hostname === 'localhost';
  if (!isAppp) return { entered: false };

  // Se já está no painel ou outra tela autenticada, verifica se já é a empresa certa
  const current = await getActiveEmpresa(page);
  if (current && String(current.id) === String(accountId)) {
    return { entered: true, accountId, empresaNome: current.nome };
  }

  // 1. Abre a tela de empresas se não estivermos vendo os cards
  let hasCards = (await page.locator('.empresa-card:not(.disabled)').count()) > 0;
  if (!hasCards) {
    try {
      const onGclick = currentUrl.hostname.includes('gclick.com.br');
      if (onGclick && currentUrl.hostname !== 'appp.gclick.com.br') {
        await page.goto('https://appp.gclick.com.br/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      const switchBtn = page.locator('[title="Minhas Empresas"], [aria-label="Minhas Empresas"], a[href*="/empresas"]').last();
      let clicked = false;
      try {
        await switchBtn.waitFor({ state: 'attached', timeout: 3000 });
        if ((await switchBtn.count()) > 0) {
          await switchBtn.click();
          clicked = true;
        }
      } catch {}
      if (!clicked) {
        await page.goto(onGclick ? 'https://appp.gclick.com.br/empresas' : `${currentUrl.origin}/empresas`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
      // Aguarda os cards aparecerem ou a URL mudar
      await Promise.race([
        page.waitForSelector('.empresa-card', { timeout: 12000 }).catch(() => {}),
        page.waitForURL(u => u.pathname.includes('/empresas'), { timeout: 12000 }).catch(() => {})
      ]);
    } catch {}
  }

  // 2. Busca e clica no card da empresa solicitada
  try {
    await page.waitForSelector('.empresa-card', { timeout: 10000 });
    await rememberEmpresaFotos(page);
    const enabledCards = () => page.locator('.empresa-card:not(.disabled)');

    const allAccess = await getAccessEmpresas(page) || [];
    const targetEmp = allAccess.find(e => String(e.id) === String(accountId));
    const targetNome = targetEmp?.nome || '';
    const targetApelido = targetEmp?.apelido || '';

    // 1. Procura por imagem com ID no src
    let card = enabledCards().filter({
      has: page.locator(`img[src*="/empresa/${accountId}/"], img[src*="/${accountId}/"]`)
    }).first();

    // 2. Procura por nome ou apelido
    if ((await card.count()) === 0 && (targetNome || targetApelido)) {
      if (targetNome) card = enabledCards().filter({ hasText: targetNome }).first();
      if ((await card.count()) === 0 && targetApelido) card = enabledCards().filter({ hasText: targetApelido }).first();
    }

    // 3. Procura por texto contendo o ID
    if ((await card.count()) === 0) {
      card = enabledCards().filter({ hasText: String(accountId) }).first();
    }

    let clicked = false;
    if ((await card.count()) > 0) {
      try {
        await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await card.click({ timeout: 5000 });
        clicked = true;
      } catch {
        clicked = await card.evaluate(el => { el.click(); return true; }).catch(() => false);
      }
    }

    if (!clicked) {
      // Fallback robusto via evaluate procurando em todos os cards
      clicked = await page.evaluate((targetId) => {
        const cards = Array.from(document.querySelectorAll('.empresa-card:not(.disabled)'));
        const found = cards.find(c => {
          const h = c.innerHTML || '';
          const t = c.innerText || '';
          return h.includes(`/empresa/${targetId}/`) || h.includes(`/${targetId}/`) || t.includes(String(targetId)) || c.id?.includes(String(targetId));
        });
        if (found) { found.click(); return true; }
        return false;
      }, accountId).catch(() => false);
    }

    if (clicked) {
      // Aguarda confirmação ativa gravada no localStorage pelo G-Click
      await page.waitForFunction((id) => {
        try {
          const cur = JSON.parse(localStorage.getItem('g3CurrentEmpresa') || 'null');
          return cur && String(cur.id) === String(id);
        } catch { return false; }
      }, String(accountId), { timeout: 15000 }).catch(() => {});

      await page.waitForTimeout(1000);
      const currentAfter = await getActiveEmpresa(page);
      return {
        entered: Boolean(currentAfter && String(currentAfter.id) === String(accountId)),
        accountId,
        empresaNome: currentAfter?.nome || targetNome || null
      };
    }
  } catch {}

  const finalCheck = await getActiveEmpresa(page);
  return {
    entered: Boolean(finalCheck && String(finalCheck.id) === String(accountId)),
    accountId,
    empresaNome: finalCheck?.nome || null
  };
}

/**
 * Garante que a empresa ativa no G-Click coincide com accountId.
 * Se estiver conectado em outra empresa (ex: 2420), alterna automaticamente para accountId.
 */
export async function ensureEmpresaActive(contextOrPage, accountId, { autoSwitch = true } = {}) {
  if (!contextOrPage || !accountId) return { active: false, reason: 'missing_context_or_account' };

  let context = null;
  let page = null;
  if (typeof contextOrPage.pages === 'function') {
    context = contextOrPage;
    const pages = context.pages().filter(p => !p.isClosed());
    page = pages.find(p => {
      try { return new URL(p.url()).hostname === 'appp.gclick.com.br'; } catch { return false; }
    }) || pages.find(p => {
      try { return /(^|\.)gclick\.com\.br$/.test(new URL(p.url()).hostname); } catch { return false; }
    });
  } else {
    page = contextOrPage;
    context = page.context?.();
  }

  if (!page || page.isClosed()) {
    return { active: false, reason: 'no_gclick_page_open' };
  }

  // 1. Verifica empresa ativa atual
  const active = await getActiveEmpresa(page);
  const allAccess = await getAccessEmpresas(page) || [];

  if (active && String(active.id) === String(accountId)) {
    return {
      active: true,
      accountId: String(accountId),
      currentEmpresaId: active.id,
      currentAccountId: String(active.id),
      currentEmpresaNome: active.nome || null,
      empresaNome: active.nome || null,
      availableEmpresas: allAccess
    };
  }

  // 2. Se o usuário não possui acesso à empresa solicitada
  if (allAccess.length > 0 && !allAccess.some(e => String(e.id) === String(accountId))) {
    return {
      active: false,
      reason: 'account_not_in_access_list',
      currentAccountId: active?.id ? String(active.id) : null,
      currentEmpresaId: active?.id || null,
      currentEmpresaNome: active?.nome || null,
      requestedAccountId: String(accountId),
      targetAccountId: String(accountId),
      availableEmpresas: allAccess
    };
  }

  // Se autoSwitch for false, não realiza a troca e reporta a divergência
  if (!autoSwitch) {
    return {
      active: false,
      reason: 'account_mismatch',
      currentAccountId: active?.id ? String(active.id) : null,
      currentEmpresaId: active?.id || null,
      currentEmpresaNome: active?.nome || null,
      requestedAccountId: String(accountId),
      targetAccountId: String(accountId),
      availableEmpresas: allAccess
    };
  }

  // 3. Empresa ativa é diferente ou estamos em /empresas: aciona troca para accountId
  const result = await enterEmpresa(page, accountId);
  if (result.entered) {
    const updated = await getActiveEmpresa(page);
    return {
      active: true,
      accountId: String(accountId),
      currentEmpresaId: updated?.id || accountId,
      currentAccountId: String(updated?.id || accountId),
      currentEmpresaNome: updated?.nome || result.empresaNome || null,
      empresaNome: updated?.nome || result.empresaNome || null,
      switchedFrom: active?.id ? String(active.id) : null,
      availableEmpresas: allAccess
    };
  }

  // Se não conseguiu entrar
  const currentAfter = await getActiveEmpresa(page);
  return {
    active: Boolean(currentAfter && String(currentAfter.id) === String(accountId)),
    reason: 'failed_to_switch',
    currentAccountId: currentAfter?.id ? String(currentAfter.id) : (active?.id ? String(active.id) : null),
    currentEmpresaId: currentAfter?.id || active?.id || null,
    currentEmpresaNome: currentAfter?.nome || active?.nome || null,
    requestedAccountId: String(accountId),
    targetAccountId: String(accountId),
    availableEmpresas: allAccess
  };
}

export async function hasGclickSession(context, accountId) {
  const pages = context.pages().filter(p => !p.isClosed());
  const apppPage = pages.find(p => {
    try { return new URL(p.url()).hostname === 'appp.gclick.com.br'; } catch { return false; }
  });
  if (apppPage) {
    try {
      let u = new URL(apppPage.url());
      if (u.pathname.includes('/empresas')) {
        await enterEmpresa(apppPage, accountId);
      } else if (!u.pathname.startsWith('/autenticacao')) {
        const cur = await getActiveEmpresa(apppPage);
        if (cur && String(cur.id) !== String(accountId)) {
          await enterEmpresa(apppPage, accountId);
        }
      }
    } catch {}
  }

  const enquiryUrl = BASE + encodeURIComponent(accountId);
  const existingPage = findEnquetePage(context, accountId);
  const page = existingPage ?? await context.newPage();
  let verified = false;
  try {
    if (!existingPage) await gotoWithRetry(page, enquiryUrl);
    if (!page.url().startsWith('https://app.gclick.com.br/')) return false;
    try {
      await page.getByText('Respondendo Enquete', { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
      verified = true;
      return true;
    } catch {
      return false;
    }
  } finally { if (!verified && !existingPage) await page.close(); }
}
const loggedInUrl = url => { try { const u = new URL(url); return /(^|\.)gclick\.com\.br$/.test(u.hostname) && !u.pathname.startsWith('/autenticacao'); } catch { return false; } };
// Espera o operador entrar no G-Click e abre sozinho a Enquete da conta; não depende de navegação manual até o módulo.
export async function waitForEnquete(context, accountId, { timeoutMs = 10 * 60 * 1000, intervalMs = 3000, onStatus = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastTry = 0;
  while (Date.now() < deadline) {
    if (context.pages().some(page => loggedInUrl(page.url())) && Date.now() - lastTry > 20000) {
      lastTry = Date.now();
      onStatus(`Login detectado. Abrindo a Enquete da conta ${accountId}…`);
      try {
        if (await hasGclickSession(context, accountId)) return true;
        onStatus(`A Enquete da conta ${accountId} não abriu. Confira se o usuário tem acesso a esse escritório; nova tentativa em 20 s.`);
      } catch (error) {
        if (!(error instanceof EmpresaSessionError)) throw error;
        onStatus(`${error.message} Nova tentativa em 20 s.`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Tempo esgotado aguardando o login e a Enquete da conta ${accountId}`);
}
export async function openBrowser(profile, headed = false) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: !headed, viewport: { width: 1600, height: 1000 },
    acceptDownloads: false, locale: 'pt-BR'
  });
}
export async function readGoogleCsv(context, url) {
  const u = new URL(url);
  if (u.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+\//.test(u.pathname)) throw new Error('URL de Google Sheets inválida');
  const id = u.pathname.split('/')[3];
  const gid = u.searchParams.get('gid') ?? new URLSearchParams(u.hash.slice(1)).get('gid');
  if (!/^\d+$/.test(gid ?? '')) throw new Error('gid não encontrado na URL da planilha');
  const response = await context.request.get(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
  if (response.status() === 401 || response.status() === 403) throw new Error('Sem acesso à planilha nesta janela do Chrome. Clique em Abrir janela de login, entre no Google na aba da planilha e tente novamente; ou envie um CSV/XLSX.');
  if (!response.ok()) throw new Error(`Falha ao exportar planilha: HTTP ${response.status()}`);
  const body = await response.text();
  if (/^\s*<!doctype html|^\s*<html/i.test(body) || !body.includes('Obrigação / Tarefa')) throw new Error('Google Sheets não retornou CSV. Faça login ou use --csv com exportação local.');
  return body;
}
export async function readQuestionCatalog(context, accountId) {
  const existingPage = findEnquetePage(context, accountId);
  const page = existingPage ?? await context.newPage();
  try {
    if (!existingPage) await gotoWithRetry(page, BASE + encodeURIComponent(accountId));
    if (!page.url().includes('app.gclick.com.br') || (await page.getByText('Respondendo Enquete', { exact: true }).count()) === 0)
      throw new Error('A sessão do G-Click expirou antes da leitura das perguntas');
    const table = page.locator('#DataTables_Table_0');
    await table.waitFor({ state: 'visible', timeout: 15000 });
    const search = page.locator('#DataTables_Table_0_filter input');
    if (await search.count()) await search.fill('');
    const lengthSelect = page.locator('select[name="DataTables_Table_0_length"]');
    if (await lengthSelect.count() && await lengthSelect.locator('option[value="-1"]').count()) await lengthSelect.selectOption('-1');
    const rows = [];
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const current = await table.locator('tbody tr').evaluateAll(els => els.map(el => {
        const cells = Array.from(el.cells, cell => cell.innerText.replace(/\s+/g, ' ').trim());
        return { type: cells[1], ref: cells[2], label: cells[3] };
      }).filter(row => row.ref && row.type));
      rows.push(...current);
      const next = page.locator('#DataTables_Table_0_next');
      if (!(await next.count()) || (await next.getAttribute('class'))?.includes('disabled')) break;
      await next.click();
      if (pageNumber === 99) throw new Error('Catálogo da Enquete excede o limite de páginas');
    }
    return buildCatalog(rows, accountId);
  } finally { if (!existingPage) await page.close(); }
}

export async function openQuestion(page, rules) {
  await gotoWithRetry(page, BASE + encodeURIComponent(rules.accountId));
  if (!page.url().includes('app.gclick.com.br') || (await page.getByText('Respondendo Enquete', { exact: true }).count()) === 0) throw new Error('Sessão do G-Click ausente/expirada. Execute o comando login.');
  const search = page.locator('#DataTables_Table_0_filter input');
  await search.waitFor({ state: 'visible', timeout: 15000 });
  async function configurationRow(ref) {
    await search.fill(ref);
    const next = page.locator('#DataTables_Table_0_next');
    let found = null;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const rows = await page.locator('#DataTables_Table_0 tbody tr').evaluateAll(els => els.map(el => {
        const cells = Array.from(el.cells, cell => cell.innerText.replace(/\s+/g, ' ').trim());
        return { type: cells[1], ref: cells[2], label: cells[3] };
      }));
      for (const row of rows.filter(row => row.ref === ref)) {
        if (found) throw new Error(`Referência ${ref} duplicada na aba Enquete`);
        found = row;
      }
      if (!(await next.count()) || (await next.getAttribute('class'))?.includes('disabled')) break;
      await next.click();
    }
    if (!found) throw new Error(`Referência ${ref} não encontrada na aba Enquete`);
    return found;
  }
  const questionRow = await configurationRow(rules.questionRef);
  const answerRow = await configurationRow(rules.answerRef);
  validateAnswerMapping(questionRow, answerRow, rules);
  await page.getByText('Respondendo Enquete', { exact: true }).click();
  const respondingTab = page.locator('#tabenqconfiglist');
  await respondingTab.waitFor({ state: 'visible', timeout: 15000 });
  const questionLinks = respondingTab.locator('a[href*="enqconfigclientes"]');
  async function matchingLinks() {
    return (await questionLinks.evaluateAll(els => els.map((el, index) => ({
      index, href: el.getAttribute('href') ?? '',
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    })))).filter(link => link.href.includes(`'enqconfigclientes','${rules.questionRef}'`) && link.text === rules.question);
  }
  let matches = await matchingLinks();
  if (matches.length !== 1 || !matches[0].visible) {
    const category = respondingTab.getByText(rules.category ?? 'Qualificação Geral do Cliente', { exact: false }).filter({ visible: true }).first();
    await category.waitFor({ state: 'visible', timeout: 15000 });
    await category.click();
    matches = await matchingLinks();
  }
  if (matches.length !== 1 || !matches[0].visible)
    throw new Error(`Pergunta ${rules.questionRef} indisponível na aba Respondendo Enquete: ${JSON.stringify(matches)}`);
  await questionLinks.nth(matches[0].index).evaluate(el => el.click());
  await page.locator(`${radioSelector(rules)}, input[type="checkbox"][id^="cb."]`).first().waitFor({ state: 'attached', timeout: 15000 });
  const lengthSelect = page.locator('select[name$=\"_length\"]');
  if (await lengthSelect.count() === 1 && await lengthSelect.locator('option[value=\"-1\"]').count()) await lengthSelect.selectOption('-1');
  const inscricaoSelect = page.locator('select').filter({
    has: page.locator('option').filter({ hasText: /Todos os Clientes/i })
  });
  if (await inscricaoSelect.count() > 0) {
    const currentVal = await inscricaoSelect.first().inputValue().catch(() => '');
    const allOpt = inscricaoSelect.first().locator('option').filter({ hasText: /Todos os Clientes/i }).first();
    const targetVal = await allOpt.getAttribute('value').catch(() => null);
    if (targetVal !== null && currentVal !== targetVal) {
      await inscricaoSelect.first().selectOption(targetVal).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  const activeNext = page.locator('.dataTables_paginate:visible .next:not(.disabled)');
  if (await activeNext.count()) throw new Error('A tabela da pergunta continua paginada; leitura incompleta dos CNPJs. Nenhum cliente foi classificado como ausente.');
  const answerValue = rules.answerValue ? String(rules.answerValue) : await resolveColumnValue(page, rules);
  const resolved = { ...rules, answerValue };
  const radioCount = await page.locator(`${radioSelector(resolved)}[value="${answerValue}"]`).count();
  const checkboxCount = await page.locator(checkboxSelector(resolved)).count();
  if (Boolean(radioCount) === Boolean(checkboxCount)) throw new Error('Tipo de resposta ambíguo ou não encontrado na pergunta');
  const detectedType = checkboxCount ? 'checkbox' : 'radio';
  if (rules.inputType && rules.inputType !== 'auto' && rules.inputType !== detectedType)
    throw new Error(`A resposta configurada como ${rules.inputType} aparece como ${detectedType} no G-Click`);
  return { inputType: detectedType, answerValue };
}
const headerKey = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Respostas sem código interno no catálogo (ex.: 02.03.08 "GIA ST") aparecem como coluna da grade.
// A coluna precisa ter cabeçalho idêntico e único, e todas as caixas dela precisam compartilhar o mesmo valor.
export async function resolveColumnValue(page, rules) {
  const ordinal = String(rules.answerRef).split('.').pop();
  const label = String(rules.answerLabel ?? '').replace(/^\d+\s*-\s*/, '');
  const accepted = new Set([headerKey(`${ordinal} ${label}`), headerKey(label)].filter(Boolean));
  const columns = await page.locator('table').filter({ has: page.locator('input[type="checkbox"][id^="cb."]') }).evaluateAll((tables, keys) => {
    const key = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const out = [];
    tables.forEach((table, tableIndex) => {
      const headers = [...(table.tHead?.rows[table.tHead.rows.length - 1]?.cells ?? [])].map(cell => cell.innerText.replace(/\s+/g, ' ').trim());
      headers.forEach((header, index) => {
        if (!keys.includes(key(header))) return;
        const values = [...table.tBodies].flatMap(body => [...body.rows]).map(row => row.cells[index]?.querySelector('input[type="checkbox"][id^="cb."]')?.value).filter(Boolean);
        out.push({ tableIndex, header, values: [...new Set(values)] });
      });
    });
    return out;
  }, [...accepted]);
  if (columns.length !== 1) throw new Error(`Coluna "${ordinal} ${label}" ${columns.length ? 'aparece mais de uma vez' : 'não encontrada'} na grade da pergunta ${rules.questionRef}`);
  const [column] = columns;
  if (column.values.length !== 1 || !/^\d+$/.test(column.values[0]))
    throw new Error(`Coluna "${column.header}" sem código interno único (${column.values.join(', ') || 'nenhuma caixa'})`);
  return column.values[0];
}
export async function questionStillOpen(page, rules) {
  if (page.isClosed() || !page.url().startsWith('https://app.gclick.com.br/')) return false;
  try { return (await page.locator(targetSelector(rules)).count()) > 0; } catch { return false; }
}
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rowFor(page, item) {
  if (item.cnpj && validCnpj(item.cnpj)) {
    return page.locator('tr').filter({ hasText: formatCnpj(item.cnpj) });
  }
  const id = String(item.empId ?? item.cod ?? '').trim();
  if (id && id !== '-') {
    const idPattern = new RegExp(`(?:^|\\s)${escapeRegex(id)}\\s*(?:[↗\\u2197]|\\s*$|\\s*\\n)`);
    if (item.empresa) {
      const cleanEmp = item.empresa
        .replace(/[&]/g, 'E')
        .replace(/^(ASSOC|CLINICA|INSTITUTO|SOCIEDADE|FARMACIA|CENTRO|COMERCIO)\s+/i, '')
        .trim();
      const firstWord = cleanEmp.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 3) {
        return page.locator('tr')
          .filter({ hasText: new RegExp(escapeRegex(firstWord), 'i') })
          .filter({ has: page.locator('a, td').filter({ hasText: idPattern }) });
      }
    }
    return page.locator('tr').filter({
      has: page.locator('a, td').filter({ hasText: idPattern })
    });
  }
  if (item.empresa) {
    const cleanEmp = item.empresa.replace(/[&]/g, 'E').trim();
    const firstTwo = cleanEmp.split(/\s+/).slice(0, 2).join(' ');
    if (firstTwo.length >= 4) {
      return page.locator('tr').filter({ hasText: new RegExp(escapeRegex(firstTwo), 'i') });
    }
    return page.locator('tr').filter({ hasText: item.empresa });
  }
  return page.locator('tr').filter({ hasText: String(item.cnpj || '') });
}
export async function inspectClient(page, item, rules) {
  let matches = rowFor(page, item);
  let count = await matches.count();
  const id = String(item.empId ?? item.cod ?? '').trim();
  const idPattern = id && id !== '-' ? new RegExp(`(?:^|\\s)${escapeRegex(id)}\\s*(?:[↗\\u2197]|\\s*$|\\s*\\n)`) : null;
  if (count === 0 && idPattern) {
    matches = page.locator('tr').filter({
      has: page.locator('a, td').filter({ hasText: idPattern })
    });
    count = await matches.count();
  }
  if (count === 0 && item.empresa) {
    matches = page.locator('tr').filter({ hasText: item.empresa });
    count = await matches.count();
    if (count === 0) {
      const cleanEmp = item.empresa.replace(/[&]/g, 'E').trim();
      const firstTwo = cleanEmp.split(/\s+/).slice(0, 2).join(' ');
      if (firstTwo.length >= 4) {
        matches = page.locator('tr').filter({ hasText: new RegExp(escapeRegex(firstTwo), 'i') });
        count = await matches.count();
      }
    }
  }
  if (count > 1 && idPattern) {
    const refined = matches.filter({
      has: page.locator('a, td').filter({ hasText: idPattern })
    });
    const refinedCount = await refined.count();
    if (refinedCount === 1) {
      matches = refined;
      count = 1;
    }
  }
  const idLabel = item.cnpj && validCnpj(item.cnpj) ? `CNPJ ${formatCnpj(item.cnpj)}` : `Cliente (Cod./ID ${item.empId ?? item.cod ?? item.empresa ?? '-'})`;
  if (count === 0) return { ...item, uiStatus: 'nao_encontrado', uiReason: `${idLabel} não localizado na enquete` };
  if (count !== 1) return { ...item, uiStatus: 'bloqueado', uiReason: `${idLabel} encontrado em ${count} linhas` };
  const row = matches.first();
  const text = await row.innerText();
  const cnpjs = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) ?? [];
  if (item.cnpj && validCnpj(item.cnpj)) {
    if (cnpjs.length !== 1 || normalizeCnpj(cnpjs[0]) !== normalizeCnpj(item.cnpj)) return { ...item, uiStatus: 'bloqueado', uiReason: 'CNPJ não é único na linha' };
  } else if (cnpjs.length === 1 && (!item.cnpj || !validCnpj(item.cnpj))) {
    item.cnpj = formatCnpj(cnpjs[0]);
  }
  const links = await row.locator('a').all();
  const linkTexts = [];
  const linkHrefs = [];
  for (const l of links) {
    linkTexts.push(await l.innerText().catch(() => ''));
    linkHrefs.push(await l.getAttribute('href').catch(() => ''));
  }
  let foundEmpId = linkTexts.find(t => /^\d+$/.test(t.replace(/[↗\u2197]/g, '').trim()))?.replace(/[↗\u2197]/g, '').trim() ?? null;
  if (!foundEmpId) {
    for (const t of linkTexts) {
      const clean = t.replace(/[↗\u2197]/g, '').trim();
      const m = clean.match(/(?:^|\s)(\d+)\s*$/);
      if (m) { foundEmpId = m[1]; break; }
    }
  }
  if (!foundEmpId) {
    for (const h of linkHrefs) {
      const m = h?.match(/abrirEmpresa\s*\(\s*\d+\s*,\s*(\d+)\s*\)/) || h?.match(/[?&]empId=(\d+)/);
      if (m) { foundEmpId = m[1]; break; }
    }
  }
  const targetId = item.empId ?? item.cod;
  if (targetId && foundEmpId && String(foundEmpId) !== String(targetId))
    return { ...item, uiStatus: 'bloqueado', uiReason: `EmpID/Cod. ${targetId} não confere com a linha do G-Click (${foundEmpId})` };
  const effectiveEmpId = targetId ?? foundEmpId;
  if (rules.inputType === 'checkbox') {
    const target = row.locator(checkboxSelector(rules));
    if (await target.count() !== 1) return { ...item, uiStatus: 'bloqueado', uiReason: 'Caixa da resposta não encontrada uma única vez' };
    const id = await target.getAttribute('id');
    const match = id?.match(new RegExp(`^cb\\.(\\d+)-${rules.answerValue}$`));
    if (!match) return { ...item, uiStatus: 'bloqueado', uiReason: 'ID interno da resposta inválido' };
    const marked = await target.evaluate(el => el.checked);
    const label = rules.answerLabel || rules.answerValue;
    return {
      ...item,
      internalId: match[1],
      uiStatus: marked ? 'ja_correto' : 'vazio',
      currentValue: marked ? rules.answerValue : null,
      uiReason: marked
        ? `Já respondido com esta opção na Enquete (${label})`
        : `Opção não marcada na Enquete (${label})`
    };
  }
  const radios = row.locator(radioSelector(rules));
  if (await radios.count() === 0) return { ...item, uiStatus: 'bloqueado', uiReason: 'Pergunta ausente na linha' };
  const checked = await radios.evaluateAll(els => els.filter(el => el.checked).map(el => el.value));
  const targetCount = await row.locator(`${radioSelector(rules)}[value="${rules.answerValue}"]`).count();
  if (targetCount !== 1) return { ...item, uiStatus: 'bloqueado', uiReason: 'Opção de resposta não encontrada uma única vez' };
  const inputName = await radios.first().getAttribute('name');
  const internalId = inputName?.split('-')[0];
  if (!/^\d+$/.test(internalId ?? '')) return { ...item, uiStatus: 'bloqueado', uiReason: 'ID interno inválido' };
  const label = rules.answerLabel || rules.answerValue;
  const isCorrect = checked.length === 1 && checked[0] === rules.answerValue;
  const isVazio = checked.length === 0;
  const uiStatus = isVazio ? 'vazio' : isCorrect ? 'ja_correto' : 'divergente';
  const uiReason = isCorrect
    ? `Já respondido com esta opção na Enquete (${label})`
    : isVazio
      ? `Pergunta sem resposta para este cliente no G-Click`
      : `Respondido com outra opção no G-Click (valor: ${checked[0]})`;
  return { ...item, internalId, uiStatus, currentValue: checked[0] ?? null, uiReason };
}
export async function inspectAll(page, plan, rules) {
  const out = [];
  for (let i = 0; i < plan.length; i += 10) {
    const group = plan.slice(i, i + 10);
    out.push(...await Promise.all(group.map(item => item.status === 'pronto' ? inspectClient(page, item, rules) : { ...item, uiStatus: 'bloqueado', uiReason: item.reason })));
  }
  return out;
}

async function pendingChanges(page) {
  return page.evaluate(() => ['marcados', 'desmarcados'].map(id => document.getElementById(id)?.value ?? ';').filter(v => v.split(';').some(Boolean)));
}
const OPERATOR_BANNER = 'gclick-robo-aviso';
async function showOperatorBanner(page, text) {
  await page.evaluate(([id, message]) => {
    document.getElementById(id)?.remove();
    const div = document.createElement('div');
    div.id = id; div.textContent = message;
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#123c44;color:#fff;font:600 15px/1.4 system-ui,sans-serif;padding:12px 18px;text-align:center;box-shadow:0 2px 8px #0005';
    document.body.append(div);
  }, [OPERATOR_BANNER, text]).catch(() => {});
}
// Marca, numa pergunta, todas as respostas pendentes de todos os clientes do grupo e clica em Alterar.
// A decisão de gravar é do operador: ele clica em Confirmar no diálogo do G-Click. O robô confere a lista
// do diálogo antes, espera a decisão e confere a gravação depois de recarregar.
// groups: [{ rules, items: [{ cnpj, empId, ... }] }], todos da mesma pergunta.
export async function applyQuestionWithOperator(page, groups, { confirmTimeoutMs = 15 * 60 * 1000, onStage = () => {} } = {}) {
  const question = groups[0].rules;
  if (groups.some(g => g.rules.questionRef !== question.questionRef)) throw new Error('Grupo com perguntas diferentes');
  onStage('abrindo');
  await openQuestion(page, question);
  if ((await pendingChanges(page)).length) throw new Error('A tela já contém alterações não salvas. Recarregue a Enquete antes de continuar.');
  onStage('marcando');
  const clicked = [], skipped = [], perClient = new Map();
  for (const group of groups) {
    for (const item of group.items) {
      const fresh = await inspectClient(page, item, group.rules);
      if (fresh.uiStatus !== 'vazio') { skipped.push({ ...fresh, answerRef: group.rules.answerRef, uiReason: fresh.uiReason ?? (fresh.uiStatus === 'ja_correto' ? 'Já estava marcada' : 'Estado mudou desde a conferência') }); continue; }
      // Pergunta de escolha única: um cliente não pode receber duas respostas diferentes no mesmo lote.
      if (group.rules.inputType === 'radio' && perClient.has(fresh.internalId) && perClient.get(fresh.internalId) !== group.rules.answerValue) {
        skipped.push({ ...fresh, answerRef: group.rules.answerRef, uiStatus: 'bloqueado', uiReason: 'Duas tarefas pedem respostas diferentes nesta pergunta de escolha única' });
        continue;
      }
      await rowFor(page, fresh).first().locator(targetSelector(group.rules)).click();
      perClient.set(fresh.internalId, group.rules.answerValue);
      clicked.push({ ...fresh, rules: group.rules });
    }
  }
  if (!clicked.length) return { questionRef: question.questionRef, changed: [], skipped, cancelled: false };
  await page.getByRole('button', { name: 'Alterar', exact: true }).click();
  const modal = page.locator('#dialogoEnqueteClientesAlterarPerfil');
  await modal.waitFor({ state: 'visible', timeout: 15000 });
  // O próprio G-Click diz o que vai gravar: #marcados (cliente-resposta), #desmarcados e #csalterar (clientes).
  const plan = await page.evaluate(() => ({
    marcados: (document.getElementById('marcados')?.value ?? '').split(';').filter(Boolean).map(x => x.split('-').slice(0, 2).join('-')),
    desmarcados: (document.getElementById('desmarcados')?.value ?? '').split(';').filter(Boolean),
    clientes: (document.getElementById('csalterar')?.value ?? '').split(',').filter(Boolean)
  }));
  const expectedPairs = [...new Set(clicked.map(x => `${x.internalId}-${x.rules.answerValue}`))].sort();
  const expected = [...new Set(clicked.map(x => x.internalId))].sort();
  const problems = [];
  if (JSON.stringify([...new Set(plan.marcados)].sort()) !== JSON.stringify(expectedPairs)) problems.push(`marcaria ${plan.marcados.length} resposta(s), esperadas ${expectedPairs.length}`);
  if (plan.desmarcados.length) problems.push(`desmarcaria ${plan.desmarcados.length} resposta(s)`);
  if (JSON.stringify([...new Set(plan.clientes)].sort()) !== JSON.stringify(expected)) problems.push(`alteraria ${plan.clientes.length} cliente(s), esperados ${expected.length}`);
  if (problems.length) {
    await modal.locator('.modal-footer button[data-dismiss="modal"], button.close[data-dismiss="modal"]').first().click().catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    throw new Error(`O G-Click ${problems.join(' e ')} na pergunta ${question.questionRef}. Nada foi gravado.`);
  }
  onStage('aguardando_confirmacao', { count: expected.length });
  await showOperatorBanner(page, `Robô: ${clicked.length} resposta(s) marcada(s) para ${expected.length} cliente(s) na pergunta ${question.questionRef}. Confira e clique em Confirmar (ou feche para cancelar).`);
  await page.bringToFront().catch(() => {});
  const deadline = Date.now() + confirmTimeoutMs;
  let outcome = null, lastRemaining = null, lastChange = Date.now();
  while (!outcome) {
    const state = await page.evaluate(() => {
      const modalEl = document.getElementById('dialogoEnqueteClientesAlterarPerfil');
      const visible = Boolean(modalEl && getComputedStyle(modalEl).display !== 'none');
      const progress = document.getElementById('progressConfirmar');
      const saving = Boolean(progress && getComputedStyle(progress).display !== 'none');
      const remaining = (document.getElementById('csalterar')?.value ?? '').split(',').filter(Boolean).length;
      const reset = (document.getElementById('marcados')?.value ?? '') === ';';
      return { visible, saving, remaining, reset };
    });
    if (state.remaining !== lastRemaining) { lastRemaining = state.remaining; lastChange = Date.now(); }
    if (state.remaining === 0 && state.reset && !state.saving) outcome = 'confirmed';
    else if (state.saving && Date.now() - lastChange > 120000) outcome = 'partial';
    else if (!state.visible && !state.saving) outcome = state.remaining < expected.length ? 'partial' : 'cancelled';
    else if (Date.now() > deadline) outcome = 'timeout';
    else await page.waitForTimeout(500);
  }
  if (outcome !== 'confirmed') {
    await modal.locator('.modal-footer button[data-dismiss="modal"], button.close[data-dismiss="modal"]').first().click().catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    if (outcome === 'cancelled') return { questionRef: question.questionRef, changed: [], skipped, cancelled: true };
    throw new Error(outcome === 'timeout' ? `Sem confirmação em ${Math.round(confirmTimeoutMs / 60000)} min na pergunta ${question.questionRef}; marcações descartadas.` : `Gravação parcial na pergunta ${question.questionRef}: confira a Enquete.`);
  }
  onStage('conferindo');
  // Lista do diálogo: cada cliente gravado pelo G-Click fica verde. É a confirmação de origem para o registro.
  const confirmedInDialog = await page.evaluate(ids => ids.map(id => {
    const el = document.getElementById(`cliente${id}`);
    const color = el ? getComputedStyle(el).backgroundColor : '';
    return { internalId: id, nome: el?.innerText.replace(/\s+/g, ' ').trim() ?? '', gravado: color === 'rgb(102, 205, 170)' || el?.style.backgroundColor === 'mediumaquamarine' };
  }), expected);
  await modal.locator('.modal-footer button[data-dismiss="modal"], button.close[data-dismiss="modal"]').first().click().catch(() => {});
  const changed = [], failed = [];
  await openQuestion(page, question);
  for (const group of groups) {
    const mine = clicked.filter(x => x.rules === group.rules);
    if (!mine.length) continue;
    for (const item of mine) {
      const after = await inspectClient(page, item, group.rules);
      const dialog = confirmedInDialog.find(x => x.internalId === item.internalId);
      (after.uiStatus === 'ja_correto' && dialog?.gravado ? changed : failed).push({ cnpj: item.cnpj, empId: item.empId, empresa: item.empresa, answerRef: group.rules.answerRef,
        answerLabel: group.rules.answerLabel, questionRef: group.rules.questionRef, mappingTask: item.mappingTask, nomeNoDialogo: dialog?.nome ?? '' });
    }
  }
  if (failed.length) throw Object.assign(new Error(`Conferência após gravar falhou para ${failed.map(x => x.cnpj).join(', ')} na pergunta ${question.questionRef}`), { partial: { changed, failed, skipped } });
  return { questionRef: question.questionRef, changed, skipped, cancelled: false, confirmedInDialog };
}
