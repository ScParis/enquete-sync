import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const question = 'Obrigações Estaduais?';
const otherCatalog = { accountId: '7000', capturedAt: '2026-10-20T12:00:00Z', questionCount: 1, answerCount: 2,
  questions: [{ ref: '05.01', label: question, category: 'Fiscal', answers: [
    { ref: '05.01.01', value: '900', valueKnown: true, label: 'DeSTDA', display: '01 - DeSTDA' },
    { ref: '05.01.02', value: '901', valueKnown: true, label: 'DAC', display: '02 - DAC' }] }] };

test('conta nova carrega o próprio catálogo e recebe sugestão de mapeamento de outro escritório', async () => {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ authenticated: true, user: { id: 1, name: 'Admin', email: 'admin@gclick.local', role: 'admin' }, token: 'test' }));
    }
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
    const requested = [];
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules: { category: 'Fiscal', question, questionRef: '02.02', answerRef: '02.02.01', answerValue: '409', answerLabel: '01 - DeSTDA', inputType: 'checkbox', allowedTasks: ['DeSTDA'], excludedTasks: [] },
      presets: [], accounts: [{ accountId: '6581', capturedAt: '2026-10-18T12:00:00Z', mappings: 2 }, { accountId: '7000', capturedAt: '2026-10-20T12:00:00Z', mappings: 0 }],
      savedMappings: [{ accountId: '6581', task: 'DeSTDA', answerRef: '02.02.01', questionLabel: question, answerLabel: 'DeSTDA' }, { accountId: '6581', task: 'DAS - Mensal - CDB', excluded: true }] } }));
    await page.route('**/api/catalog/reference', async route => { requested.push(route.request().postDataJSON().accountId); await route.fulfill({ json: { catalog: otherCatalog, live: false, sheetUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit?gid=42#gid=42' } }); });
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'DeSTDA', count: 1, clients: 1 }, { name: 'DAS - Mensal - CDB', count: 1, clients: 1 }] } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click(); // a tela abre em Link do Google Sheets
    assert.equal(await page.locator('#accountId').inputValue(), '', 'nenhuma conta fixa como padrão');
    await page.locator('#accountId').fill('7000');
    await page.locator('#accountId').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#queueSummary').textContent.includes('sugestões para revisar'));
    assert.deepEqual(requested, ['7000']);
    await page.locator('#queueFilter').selectOption('all');
    const text = await page.locator('#queueList').innerText();
    assert.match(text, /Sugestão de outro escritório \(conta 6581\): 05\.01 → 01 - DeSTDA/);
    assert.doesNotMatch(text, /Excluída/, 'exclusão de outro escritório não vale para esta conta');
    assert.equal(await page.locator('#recentSheetUrl').inputValue(), 'https://docs.google.com/spreadsheets/d/abc123/edit?gid=42#gid=42', 'cada conta traz a própria planilha');
    assert.match(await page.locator('#directExport').getAttribute('href'), /abc123\/export\?format=csv&gid=42/);
    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
