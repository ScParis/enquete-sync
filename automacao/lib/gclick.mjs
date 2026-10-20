import { chromium } from 'playwright';
import { normalizeCnpj } from './data.mjs';
import { validateAnswerMapping } from './answer-map.mjs';
import { buildCatalog } from './catalog.mjs';

const BASE = 'https://app.gclick.com.br/Listar.do?obj=enqueteopen&tipo=0&empId=';
export const LOGIN_URL = 'https://appp.gclick.com.br/autenticacao';
const radioSelector = rules => `input[type="radio"][name$="-${rules.questionRef}"]`;
const checkboxSelector = rules => `input[type="checkbox"][value="${rules.answerValue}"][id^="cb."]`;
const targetSelector = rules => rules.inputType === 'checkbox' ? checkboxSelector(rules) : `${radioSelector(rules)}[value="${rules.answerValue}"]`;
// Oscilações de rede (troca de Wi-Fi, VPN, DNS) não devem derrubar uma conferência inteira: tenta de novo antes de desistir.
const TRANSIENT = /net::ERR_(NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|TIMED_OUT|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE)|Timeout \d+ms exceeded/;
export async function gotoWithRetry(page, url, { attempts = 3, delayMs = 3000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await page.goto(url, { waitUntil: 'domcontentloaded' }); }
    catch (error) {
      if (attempt >= attempts || !TRANSIENT.test(error.message) || page.isClosed()) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
}
export async function hasGclickSession(context, accountId) {
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, BASE + encodeURIComponent(accountId));
    if (!page.url().startsWith('https://app.gclick.com.br/')) return false;
    try {
      await page.getByText('Respondendo Enquete', { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  } finally { await page.close(); }
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
      if (await hasGclickSession(context, accountId)) return true;
      onStatus(`A Enquete da conta ${accountId} não abriu. Confira se o usuário tem acesso a esse escritório; nova tentativa em 20 s.`);
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
  const page = await context.newPage();
  try {
    await gotoWithRetry(page, BASE + encodeURIComponent(accountId));
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
  } finally { await page.close(); }
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
function rowFor(page, item) {
  return page.locator('tr').filter({ hasText: item.cnpj });
}
export async function inspectClient(page, item, rules) {
  const matches = rowFor(page, item);
  const count = await matches.count();
  if (count === 0) return { ...item, uiStatus: 'nao_encontrado', uiReason: 'CNPJ da planilha não localizado na enquete' };
  if (count !== 1) return { ...item, uiStatus: 'bloqueado', uiReason: `CNPJ encontrado em ${count} linhas` };
  const row = matches.first();
  const text = await row.innerText();
  const cnpjs = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) ?? [];
  if (cnpjs.length !== 1 || normalizeCnpj(cnpjs[0]) !== normalizeCnpj(item.cnpj)) return { ...item, uiStatus: 'bloqueado', uiReason: 'CNPJ não é único na linha' };
  const links = await row.locator('a').allInnerTexts();
  const foundEmpId = links.find(t => /^\d+$/.test(t.trim()))?.trim() ?? null;
  if (item.empId && !links.some(t => new RegExp(`(?:^|\\s)${String(item.empId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(t.trim())))
    return { ...item, uiStatus: 'bloqueado', uiReason: 'EmpID não confere com a linha do G-Click' };
  const effectiveEmpId = item.empId ?? foundEmpId;
  if (rules.inputType === 'checkbox') {
    const target = row.locator(checkboxSelector(rules));
    if (await target.count() !== 1) return { ...item, uiStatus: 'bloqueado', uiReason: 'Caixa da resposta não encontrada uma única vez' };
    const id = await target.getAttribute('id');
    const match = id?.match(new RegExp(`^cb\\.(\\d+)-${rules.answerValue}$`));
    if (!match) return { ...item, uiStatus: 'bloqueado', uiReason: 'ID interno da resposta inválido' };
    const marked = await target.evaluate(el => el.checked);
    return { ...item, internalId: match[1], uiStatus: marked ? 'ja_correto' : 'vazio', currentValue: marked ? rules.answerValue : null };
  }
  const radios = row.locator(radioSelector(rules));
  if (await radios.count() === 0) return { ...item, uiStatus: 'bloqueado', uiReason: 'Pergunta ausente na linha' };
  const checked = await radios.evaluateAll(els => els.filter(el => el.checked).map(el => el.value));
  const targetCount = await row.locator(`${radioSelector(rules)}[value="${rules.answerValue}"]`).count();
  if (targetCount !== 1) return { ...item, uiStatus: 'bloqueado', uiReason: 'Opção de resposta não encontrada uma única vez' };
  const inputName = await radios.first().getAttribute('name');
  const internalId = inputName?.split('-')[0];
  if (!/^\d+$/.test(internalId ?? '')) return { ...item, uiStatus: 'bloqueado', uiReason: 'ID interno inválido' };
  return { ...item, internalId, uiStatus: checked.length === 0 ? 'vazio' : checked.length === 1 && checked[0] === rules.answerValue ? 'ja_correto' : 'divergente', currentValue: checked[0] ?? null };
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
  for (const group of groups) {
    const mine = clicked.filter(x => x.rules === group.rules);
    if (!mine.length) continue;
    await openQuestion(page, group.rules);
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
