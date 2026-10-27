import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const rules = { accountId: '6581', category: 'Fiscal', question: 'Obrigações Estaduais?', questionRef: '02.02',
  answerRef: '02.02.01', answerValue: '409', answerLabel: '01 - DeSTDA', inputType: 'checkbox',
  allowedTasks: ['DeSTDA'], excludedTasks: [] };
const catalog = { accountId: '6581', capturedAt: '2026-10-18T12:00:00Z', questionCount: 1, answerCount: 2,
  questions: [{ ref: '02.02', label: 'Obrigações Estaduais?', category: 'Fiscal', answers: [
    { ref: '02.02.01', value: '409', label: 'DeSTDA', display: '01 - DeSTDA' },
    { ref: '02.02.02', value: '379', label: 'DAC', display: '02 - DAC' }
  ] }] };

test('conta e planilha iniciam conferência de leitura e mostram perguntas, respostas e pendências', async () => {
  const server = http.createServer(async (req, res) => {
    const file = req.url === '/' ? 'ui/index.html' : req.url === '/ui/app.js' ? 'ui/app.js' : 'ui/style.css';
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await fs.readFile(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const calls = [];
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules, presets: [{ name: 'DeSTDA', rules }], catalog, catalogLive: true, loginReady: true, savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'DeSTDA', count: 1, clients: 1, invalidCnpjs: 0 }, { name: 'EFD REINF', count: 1, clients: 1, invalidCnpjs: 0 }] } }));
    await page.route('**/api/mappings/preview', async route => {
      calls.push(route.request().postDataJSON());
      await route.fulfill({ json: { report: { mode: 'account_audit', createdAt: new Date().toISOString(), source: 'enquete.csv', sourceTaskCount: 2, sourceCnpjCount: 2,
        rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', questionRef: '02.02', answerRef: '02.02.01', clients: 1,
          summary: { vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }], pendingTasks: ['EFD REINF'], excludedTasks: [], failedTasks: [], invalidSource: [],
        inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Teste', mappingTask: 'DeSTDA', uiStatus: 'ja_correto' },
          { cnpj: '63.665.522/0001-22', empId: '2', empresa: 'Teste 2', mappingTask: 'EFD REINF', uiStatus: 'sem_mapeamento', uiReason: 'Estado não verificado' },
          ...Array.from({ length: 55 }, (_, index) => ({ cnpj: `Teste-${index + 3}`, empId: String(index + 3), empresa: `Cliente ${index + 3}`, mappingTask: 'EFD REINF', uiStatus: 'sem_mapeamento' }))],
        summary: { total: 57, vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0, sem_mapeamento: 56, invalidSource: 0 } } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#auditStatus').textContent.includes('Concluído:'), null, { timeout: 10000 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].autoAudit, true);
    assert.equal(calls[0].headless, true);
    assert.equal(calls[0].accountId, '6581');
    assert.equal(calls[0].downloadFile, 'enquete.csv');

    // Desmarca a opção headless para testar auditoria acompanhada em tela
    await page.locator('#headlessAuditToggle').uncheck();
    await page.locator('#runAudit').click();
    await page.waitForFunction(() => document.querySelectorAll('#results tr').length > 0, null, { timeout: 10000 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].headless, false);

    assert.match(await page.locator('#catalogOverviewStatus').innerText(), /1 perguntas e 2 respostas capturadas agora/);
    assert.match(await page.locator('#catalogOverviewList').innerText(), /02\.02.*Obrigações Estaduais/);
    await page.locator('#catalogOverviewList details').first().click();
    assert.match(await page.locator('#catalogOverviewList').innerText(), /02\.02\.01.*DeSTDA/);
    assert.match(await page.locator('#mappingResult').innerText(), /1 tarefa\(s\) sem associação/);
    await page.locator('#filter').selectOption('sem_mapeamento');
    assert.match(await page.locator('#results').innerText(), /EFD REINF.*Sem mapeamento/s);
    assert.equal(await page.locator('#results tr').count(), 50);
    assert.match(await page.locator('#resultsPageInfo').innerText(), /1–50 de 56/);
    await page.locator('#resultsNext').click();
    assert.equal(await page.locator('#results tr').count(), 6);
    assert.match(await page.locator('#resultsPageInfo').innerText(), /51–56 de 56/);
    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
