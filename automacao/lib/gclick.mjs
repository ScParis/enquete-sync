import { chromium } from 'playwright';
import { formatCnpj, normalizeCnpj } from './data.mjs';
import { validateAnswerMapping } from './answer-map.mjs';
import { buildCatalog } from './catalog.mjs';

const BASE = 'https://app.gclick.com.br/Listar.do?obj=enqueteopen&tipo=0&empId=';
export const LOGIN_URL = 'https://appp.gclick.com.br/autenticacao';
const radioSelector = rules => `input[type=\"radio\"][name$=\"-${rules.questionRef}\"]`;
const checkboxSelector = rules => `input[type="checkbox"][value="${rules.answerValue}"][id^="cb."]`;
const targetSelector = rules => rules.inputType === 'checkbox' ? checkboxSelector(rules) : `${radioSelector(rules)}[value="${rules.answerValue}"]`;
export async function hasGclickSession(context, accountId) {
  const page = await context.newPage();
  try {
    await page.goto(BASE + encodeURIComponent(accountId), { waitUntil: 'domcontentloaded' });
    if (!page.url().startsWith('https://app.gclick.com.br/')) return false;
    try {
      await page.getByText('Respondendo Enquete', { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  } finally { await page.close(); }
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
    await page.goto(BASE + encodeURIComponent(accountId), { waitUntil: 'domcontentloaded' });
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
  await page.goto(BASE + encodeURIComponent(rules.accountId), { waitUntil: 'domcontentloaded' });
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
  const radioTarget = page.locator(`${radioSelector(rules)}[value="${rules.answerValue}"]`);
  const checkboxTarget = page.locator(checkboxSelector(rules));
  await page.locator(`${radioSelector(rules)}[value="${rules.answerValue}"], ${checkboxSelector(rules)}`).first().waitFor({ state: 'attached', timeout: 15000 });
  const radioCount = await radioTarget.count(), checkboxCount = await checkboxTarget.count();
  if (Boolean(radioCount) === Boolean(checkboxCount)) throw new Error('Tipo de resposta ambíguo ou não encontrado na pergunta');
  const detectedType = checkboxCount ? 'checkbox' : 'radio';
  if (rules.inputType && rules.inputType !== 'auto' && rules.inputType !== detectedType)
    throw new Error(`A resposta configurada como ${rules.inputType} aparece como ${detectedType} no G-Click`);
  const lengthSelect = page.locator('select[name$=\"_length\"]');
  if (await lengthSelect.count() === 1 && await lengthSelect.locator('option[value=\"-1\"]').count()) await lengthSelect.selectOption('-1');
  const activeNext = page.locator('.dataTables_paginate:visible .next:not(.disabled)');
  if (await activeNext.count()) throw new Error('A tabela da pergunta continua paginada; leitura incompleta dos CNPJs. Nenhum cliente foi classificado como ausente.');
  return detectedType;
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
export async function applyBatch(page, inspected, rules) {
  const pending = inspected.filter(x => x.uiStatus === 'vazio');
  const blockers = inspected.filter(x => x.uiStatus === 'bloqueado' || x.uiStatus === 'divergente' || x.uiStatus === 'nao_encontrado');
  if (blockers.length) throw new Error(`Lote contém ${blockers.length} conflito(s). Nada foi selecionado.`);
  if (!pending.length) return { changed: [], verified: inspected.filter(x => x.uiStatus === 'ja_correto').map(x => x.cnpj) };
  const pendingIndicators = await page.locator('input[name="marcados"], input[name="desmarcados"]').evaluateAll(els => els.map(e => e.value).filter(v => v && v !== ';'));
  if (pendingIndicators.length) throw new Error('A tela já contém alterações não salvas. Reabra o navegador após resolver esse estado.');
  for (const item of pending) {
    await rowFor(page, item).first().locator(targetSelector(rules)).click();
  }
  await page.getByRole('button', { name: 'Alterar', exact: true }).click();
  const modal = page.locator('#dialogoEnqueteClientesAlterarPerfil');
  await modal.waitFor({ state: 'visible' });
  const shown = await modal.locator('div[id^="cliente"]').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.id.replace('cliente', '')));
  const expected = pending.map(x => x.internalId).sort();
  if (JSON.stringify(shown.sort()) !== JSON.stringify(expected)) throw new Error(`Confirmação contém clientes inesperados (${shown.length} exibidos, ${expected.length} esperados). Não confirme.`);
  await modal.locator('#botaoConfirmar').click();
  await modal.locator('#progressConfirmar').waitFor({ state: 'hidden', timeout: 120000 });
  const colors = await Promise.all(expected.map(async id => modal.locator(`#cliente${id}`).evaluate(el => getComputedStyle(el).backgroundColor)));
  if (colors.some(x => x !== 'rgb(102, 205, 170)' && x !== 'mediumaquamarine')) throw new Error('Nem todos os clientes receberam confirmação visual de gravação. Verifique manualmente.');
  await modal.locator('.modal-footer button[data-dismiss="modal"]').click();
  await openQuestion(page, rules);
  const after = await inspectAll(page, inspected, rules);
  const failures = after.filter(x => x.uiStatus !== 'ja_correto');
  if (failures.length) throw new Error(`Pós-verificação falhou para ${failures.map(x => x.cnpj).join(', ')}`);
  return { changed: pending.map(x => x.cnpj), verified: after.map(x => x.cnpj) };
}

export async function applyClientOnboarding(context, accountId, client, answersList) {
  const page = await context.newPage();
  const results = [];
  try {
    for (const item of answersList) {
      const rules = {
        accountId,
        category: item.category ?? 'Qualificação Geral do Cliente',
        question: item.question,
        questionRef: item.questionRef,
        answerRef: item.answerRef,
        answerValue: item.answerValue,
        answerLabel: item.answerLabel,
        inputType: item.inputType ?? 'auto',
        allowedTasks: [],
        excludedTasks: []
      };
      const detectedType = await openQuestion(page, rules);
      const resolvedRules = { ...rules, inputType: detectedType };
      const inspected = await inspectClient(page, { cnpj: formatCnpj(client.cnpj), empId: client.empId ?? null }, resolvedRules);
      if (inspected.uiStatus === 'vazio') {
        const res = await applyBatch(page, [inspected], resolvedRules);
        results.push({ questionRef: item.questionRef, answerRef: item.answerRef, status: 'alterado', changed: res.changed });
      } else if (inspected.uiStatus === 'ja_correto') {
        results.push({ questionRef: item.questionRef, answerRef: item.answerRef, status: 'ja_correto' });
      } else {
        results.push({ questionRef: item.questionRef, answerRef: item.answerRef, status: inspected.uiStatus, reason: inspected.uiReason });
      }
    }
    return results;
  } finally {
    await page.close();
  }
}

export async function applyByColumnMatrix(page, {
  accountId = '6581',
  category = 'Dpto. Fiscal/Tributário',
  questionRef = '02.03',
  question = 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)',
  columnName = '08 GIA ST',
  cnpjs = [],
  onModalReady = null,
  autoConfirm = false
}) {
  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const url = BASE + encodeURIComponent(accountId);
  if (!page.url().includes('obj=enqueteopen') || !page.url().includes(`empId=${accountId}`)) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  if (!page.url().includes('app.gclick.com.br')) {
    throw new Error('Sessão do G-Click ausente ou expirada.');
  }

  const btnAlterarCheck = page.getByRole('button', { name: 'Alterar', exact: true });
  const alreadyOnMatrix = (await btnAlterarCheck.count()) > 0 && (await btnAlterarCheck.isVisible());

  if (!alreadyOnMatrix) {
    // Passo 1: Clicar na aba "Respondendo Enquete"
    console.log('Passo 1: Clicando na aba "Respondendo Enquete"...');
    const tabBtn = page.locator('a, li').filter({ hasText: /^Respondendo Enquete$/i }).first();
    await tabBtn.waitFor({ state: 'visible', timeout: 15000 });
    await tabBtn.click();
    await page.waitForTimeout(1000);

    // Passo 2: Clicar no departamento 02 (Dpto. Fiscal/Tributário) para expandir
    console.log('Passo 2: Clicando no departamento 02 (Dpto. Fiscal/Tributário)...');
    const rowFiscal = page.locator('tr').filter({ hasText: 'Dpto. Fiscal/Tributário' }).first();
    await rowFiscal.waitFor({ state: 'visible', timeout: 15000 });

    const q0203 = page.locator('tr').filter({ hasText: '02.03' }).first();
    if (!(await q0203.count()) || !(await q0203.isVisible())) {
      await rowFiscal.locator('td').first().click();
      await page.waitForTimeout(800);
      if (!(await q0203.count()) || !(await q0203.isVisible())) {
        await rowFiscal.click();
        await page.waitForTimeout(800);
      }
    }

    // Passo 3: Clicar na pergunta 02.03 para abrir a grade de respostas
    console.log('Passo 3: Clicando na pergunta 02.03 para abrir a grade de respostas...');
    const questionRow = page.locator('tr').filter({ hasText: '02.03' }).first();
    await questionRow.waitFor({ state: 'visible', timeout: 15000 });
    const targetCell = questionRow.locator('td').filter({ hasText: /Obrigações Estaduais/i }).first();
    if (await targetCell.count()) {
      await targetCell.click();
    } else {
      await questionRow.click();
    }
  }

  // Passo 4: Aguardar a grade da pergunta 02.03 carregar
  console.log('Passo 4: Aguardando grade de respostas da pergunta 02.03...');
  const btnAlterar = page.getByRole('button', { name: 'Alterar', exact: true });
  await btnAlterar.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1000);

  const lengthSelect = page.locator('select[name$="_length"]:visible');
  if (await lengthSelect.count() === 1 && await lengthSelect.locator('option[value="-1"]').count()) {
    await lengthSelect.selectOption('-1');
    await page.waitForTimeout(800);
  }

  // Tabela da grade de respostas (contendo os checkboxes dos clientes)
  const matrixTable = page.locator('table').filter({ has: page.locator('input[type="checkbox"][id^="cb."]') }).first();
  const headers = await matrixTable.locator('thead th').evaluateAll(els =>
    els.map(el => el.innerText.replace(/\s+/g, ' ').trim())
  );

  const targetNorm = norm(columnName);
  let colIndex = headers.findIndex(h => norm(h) && norm(h) === targetNorm);
  if (colIndex === -1) {
    colIndex = headers.findIndex(h => norm(h) && (norm(h).includes(targetNorm) || targetNorm.includes(norm(h))));
  }
  if (colIndex === -1) {
    throw new Error(`Coluna "${columnName}" não encontrada nos cabeçalhos da grade: [${headers.join(' | ')}]`);
  }

  const results = [];
  const clientsToMark = [];

  for (const rawCnpj of cnpjs) {
    const formatted = formatCnpj(rawCnpj);
    const row = matrixTable.locator('tbody tr').filter({ hasText: formatted });
    const count = await row.count();
    if (count === 0) {
      results.push({ cnpj: formatted, status: 'nao_encontrado', reason: 'CNPJ não encontrado na tabela da enquete' });
      continue;
    }
    if (count > 1) {
      results.push({ cnpj: formatted, status: 'bloqueado', reason: `CNPJ encontrado em ${count} linhas` });
      continue;
    }

    const rowEl = row.first();
    const rowText = await rowEl.innerText();
    const cell = rowEl.locator('td').nth(colIndex);
    const checkbox = cell.locator('input[type="checkbox"]');
    if (await checkbox.count() === 0) {
      results.push({ cnpj: formatted, status: 'bloqueado', reason: `Checkbox ausente na coluna ${headers[colIndex]}` });
      continue;
    }

    const isChecked = await checkbox.isChecked();
    const checkboxId = await checkbox.getAttribute('id');
    const matchId = checkboxId?.match(/^cb\.(\d+)-/);
    const internalId = matchId ? matchId[1] : null;

    if (isChecked) {
      results.push({ cnpj: formatted, internalId, status: 'ja_correto', reason: 'Obrigação já estava selecionada' });
    } else {
      await checkbox.click();
      clientsToMark.push({ cnpj: formatted, internalId, rowText: rowText.slice(0, 80) });
      results.push({ cnpj: formatted, internalId, status: 'selecionado_para_alterar' });
    }
  }

  if (!clientsToMark.length) {
    return {
      success: true,
      column: headers[colIndex],
      colIndex,
      changed: [],
      results,
      message: 'Todos os clientes solicitados já estavam com a opção marcada.'
    };
  }

  await btnAlterar.click();

  const modal = page.locator('#dialogoEnqueteClientesAlterarPerfil');
  await modal.waitFor({ state: 'visible', timeout: 15000 });

  const shownIds = await modal.locator('div[id^="cliente"]').evaluateAll(els =>
    els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.id.replace('cliente', ''))
  );

  if (onModalReady) {
    await onModalReady({
      modal,
      page,
      column: headers[colIndex],
      clientsToMark,
      shownIds,
      confirm: async () => {
        await modal.locator('#botaoConfirmar').click();
      }
    });
  } else if (autoConfirm) {
    await modal.locator('#botaoConfirmar').click();
  } else {
    await Promise.race([
      modal.locator('#progressConfirmar').waitFor({ state: 'visible', timeout: 300000 }),
      page.waitForEvent('close', { timeout: 300000 }).catch(() => {})
    ]);
  }

  await modal.locator('#progressConfirmar').waitFor({ state: 'hidden', timeout: 120000 });

  const colors = await Promise.all(
    clientsToMark.filter(c => c.internalId).map(async c => {
      const el = modal.locator(`#cliente${c.internalId}`);
      if (await el.count()) {
        return el.evaluate(e => getComputedStyle(e).backgroundColor);
      }
      return null;
    })
  );

  const closeBtn = modal.locator('.modal-footer button[data-dismiss="modal"]');
  if (await closeBtn.count()) {
    await closeBtn.click();
  }

  return {
    success: true,
    column: headers[colIndex],
    colIndex,
    changed: clientsToMark.map(c => c.cnpj),
    results,
    confirmedColors: colors
  };
}
