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

test('menu lateral alterna entre funcionalidades e atualiza visibilidade de seções', async () => {
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

    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules, presets: [{ name: 'DeSTDA', rules }], catalog, catalogLive: true, loginReady: true, savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 1, tasks: [{ name: 'DeSTDA', count: 1, clients: 1, invalidCnpjs: 0 }] } }));
    await page.route('**/api/mappings/preview', async route => {
      await route.fulfill({ json: { report: { mode: 'account_audit', createdAt: new Date().toISOString(), source: 'enquete.csv', sourceTaskCount: 1, sourceCnpjCount: 1,
        rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', questionRef: '02.02', answerRef: '02.02.01', clients: 1,
          summary: { vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }], pendingTasks: [], excludedTasks: [], failedTasks: [], invalidSource: [],
        inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Teste', mappingTask: 'DeSTDA', uiStatus: 'ja_correto' }],
        summary: { total: 1, vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0, sem_mapeamento: 0, invalidSource: 0 } } } });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#sidebarNav') !== null);

    // No modo padrão (Visão Geral), todas as seções estão visíveis
    assert.equal(await page.locator('#section-connection').isVisible(), true);
    assert.equal(await page.locator('#section-source').isVisible(), true);
    assert.equal(await page.locator('#section-mapping').isVisible(), true);
    assert.equal(await page.locator('#section-audit').isVisible(), true);
    assert.equal(await page.locator('#section-writer').isVisible(), true);

    // Clicar em Auditoria & Conferência
    await page.locator('#navAudit').click();
    assert.equal(await page.locator('#section-audit').isVisible(), true);
    assert.equal(await page.locator('#section-connection').isVisible(), false);
    assert.equal(await page.locator('#section-source').isVisible(), false);
    assert.equal(await page.locator('#section-mapping').isVisible(), false);
    assert.equal(await page.locator('#section-writer').isVisible(), false);
    assert.match(await page.locator('#navAudit').getAttribute('class'), /active/);

    // Clicar em Mapeamento
    await page.locator('#navMapping').click();
    assert.equal(await page.locator('#section-mapping').isVisible(), true);
    assert.equal(await page.locator('#section-audit').isVisible(), false);
    assert.match(await page.locator('#navMapping').getAttribute('class'), /active/);

    // Clicar em Conexão
    await page.locator('#navConnection').click();
    assert.equal(await page.locator('#section-connection').isVisible(), true);
    assert.equal(await page.locator('#section-mapping').isVisible(), false);
    assert.match(await page.locator('#navConnection').getAttribute('class'), /active/);

    // Clicar em Visão Geral para voltar a ver todas
    await page.locator('#navAll').click();
    assert.equal(await page.locator('#section-connection').isVisible(), true);
    assert.equal(await page.locator('#section-source').isVisible(), true);
    assert.equal(await page.locator('#section-mapping').isVisible(), true);
    assert.equal(await page.locator('#section-audit').isVisible(), true);
    assert.match(await page.locator('#navAll').getAttribute('class'), /active/);

    // Badges atualizados
    assert.match(await page.locator('#navBadgeConnection').innerText(), /Conectado/);

    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
