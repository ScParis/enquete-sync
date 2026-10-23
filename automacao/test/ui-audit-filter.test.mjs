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

test('conferência manual permite escolher escopo total ou filtrar por obrigação', async () => {
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
    const previewCalls = [];

    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules, presets: [{ name: 'DeSTDA', rules }], catalog, catalogLive: true, loginReady: true, savedMappings: [{ accountId: '6581', task: 'DeSTDA', answerRef: '02.02.01', questionLabel: 'Obrigações Estaduais?', answerLabel: '01 - DeSTDA' }] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'DeSTDA', count: 1, clients: 1, invalidCnpjs: 0 }, { name: 'EFD REINF', count: 1, clients: 1, invalidCnpjs: 0 }] } }));
    await page.route('**/api/mappings/preview', async route => {
      const data = route.request().postDataJSON();
      previewCalls.push(data);
      if (data.filterTask === 'DeSTDA') {
        await route.fulfill({ json: { report: { mode: 'account_audit', filterTask: 'DeSTDA', createdAt: new Date().toISOString(), source: 'enquete.csv', sourceTaskCount: 2, sourceCnpjCount: 1,
          rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', questionRef: '02.02', answerRef: '02.02.01', clients: 1,
            summary: { vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }], pendingTasks: [], excludedTasks: [], failedTasks: [], invalidSource: [],
          inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Empresa Alpha', mappingTask: 'DeSTDA', uiStatus: 'ja_correto' }],
          summary: { total: 1, vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0, sem_mapeamento: 0, invalidSource: 0 } } } });
      } else {
        await route.fulfill({ json: { report: { mode: 'account_audit', createdAt: new Date().toISOString(), source: 'enquete.csv', sourceTaskCount: 2, sourceCnpjCount: 2,
          rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', questionRef: '02.02', answerRef: '02.02.01', clients: 1,
            summary: { vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }], pendingTasks: ['EFD REINF'], excludedTasks: [], failedTasks: [], invalidSource: [],
          inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Empresa Alpha', mappingTask: 'DeSTDA', uiStatus: 'ja_correto' },
            { cnpj: '63.665.522/0001-22', empId: '2', empresa: 'Empresa Beta', mappingTask: 'EFD REINF', uiStatus: 'sem_mapeamento', uiReason: 'Estado não verificado' }],
          summary: { total: 2, vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0, sem_mapeamento: 1, invalidSource: 0 } } } });
      }
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#auditStatus').textContent.includes('Concluído:'), null, { timeout: 10000 });

    assert.equal(previewCalls.length, 1);
    assert.equal(previewCalls[0].autoAudit, true);
    assert.equal(previewCalls[0].filterTask, undefined);

    // Pausar conferência automática via toggle
    await page.locator('#autoAuditToggle').click();
    assert.match(await page.locator('#auditStatus').innerText(), /Conferência automática pausada/);

    // Selecionar escopo de tarefa única
    await page.locator('#auditScopeSingle').click();
    assert.equal(await page.locator('#auditTaskSelectBox').isVisible(), true);

    // O dropdown de tarefas deve listar as opções
    const selectOptions = await page.locator('#auditTaskSelect option').allInnerTexts();
    assert.ok(selectOptions.some(opt => opt.includes('DeSTDA')));

    // Escolhe a obrigação DeSTDA (com auto-audit pausado, não dispara chamada automática)
    await page.locator('#auditTaskSelect').selectOption('DeSTDA');
    assert.equal(previewCalls.length, 1);

    // Executa conferência manual via botão
    await page.locator('#runAudit').click();
    await page.waitForFunction(() => document.querySelector('#modePill').textContent.includes('Conferência: DeSTDA'), null, { timeout: 10000 });

    assert.equal(previewCalls.length, 2);
    assert.equal(previewCalls[1].filterTask, 'DeSTDA');

    // Verifica que o modo exibido e filtro de foco estão restritos a DeSTDA
    assert.match(await page.locator('#modePill').innerText(), /Conferência: DeSTDA/);
    assert.match(await page.locator('#focusChip').innerText(), /Mostrando só: DeSTDA/);
    assert.match(await page.locator('#results').innerText(), /Empresa Alpha/);
    assert.doesNotMatch(await page.locator('#results').innerText(), /Empresa Beta/);

    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
