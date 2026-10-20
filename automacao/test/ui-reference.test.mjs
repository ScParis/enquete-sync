import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const known = { accountId: '6581', category: 'Fiscal', question: 'Obrigações Estaduais?', questionRef: '02.02',
  answerRef: '02.02.01', answerValue: '409', answerLabel: '01 - DeSTDA', inputType: 'checkbox',
  allowedTasks: ['DeSTDA'], excludedTasks: [] };
const referenceCatalog = { accountId: '6581', source: 'reference', capturedAt: '2026-10-17T12:00:00Z', questionCount: 1, answerCount: 2,
  questions: [{ ref: '02.02', label: 'Obrigações Estaduais?', category: 'Fiscal', answers: [
    { ref: '02.02.01', value: '409', label: 'DeSTDA', display: '01 - DeSTDA' },
    { ref: '02.02.02', value: '379', label: 'DAC', display: '02 - DAC' }
  ] }] };

test('catálogo anterior permite preparar mapeamentos e exige sessão atual para prévia', async () => {
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
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules: known, presets: [{ name: 'DeSTDA', rules: known }], catalog: referenceCatalog, catalogLive: false, referenceCatalog, savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'DeSTDA', count: 1, clients: 1, invalidCnpjs: 0 }, { name: 'DAC - Mensal', count: 1, clients: 1, invalidCnpjs: 0 }] } }));
    await page.route('**/api/mappings/save', route => route.fulfill({ json: { savedMappings: [{ accountId: '6581', task: 'DAC - Mensal', answerRef: '02.02.02' }] } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#queueSummary').textContent.includes('2 tarefas da planilha'));
    assert.match(await page.locator('#queueSummary').innerText(), /1 associadas no catálogo anterior/);
    assert.equal(await page.locator('#previewMappings').isEnabled(), false);
    await page.locator('#queueFilter').selectOption('ready');
    await page.locator('.queue-select input').check();
    assert.match(await page.locator('#queueSummary').innerText(), /1 selecionada/);
    assert.equal(await page.locator('#previewMappings').isEnabled(), false);
    await page.locator('#queueFilter').selectOption('attention');
    await page.locator('.queue-item button').click();
    assert.equal(await page.locator('#editorAnswer').inputValue(), '02.02.02');
    await page.locator('#confirmMapping').click();
    await page.waitForFunction(() => document.querySelector('#queueSummary').textContent.includes('2 associadas no catálogo anterior'));
    assert.equal(await page.locator('#previewMappings').isEnabled(), false);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
