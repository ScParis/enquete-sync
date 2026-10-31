import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const storedCatalog = { accountId: '6581', capturedAt: '2026-10-17T12:00:00Z', questionCount: 1, answerCount: 1,
  questions: [{ ref: '02.02', label: 'Obrigações Estaduais?', category: 'Fiscal', answers: [{ ref: '02.02.01', value: '409', label: 'DeSTDA', display: '01 - DeSTDA' }] }] };

test('sem login a tela não mostra perguntas nem permite mapear; mapeamentos salvos aguardam a leitura da Enquete', async () => {
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
    // Mesmo que algo antigo chegue na configuração, catálogo não lido nesta sessão é ignorado.
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', catalog: storedCatalog, catalogLive: false, loginReady: false,
      accounts: [{ accountId: '6581', capturedAt: storedCatalog.capturedAt, sheetUrl: '', mappings: 1 }], savedMappings: [{ accountId: '6581', task: 'DeSTDA', answerRef: '02.02.01' }] } }));
    await page.route('**/api/catalog/reference', route => route.fulfill({ json: { catalog: null, live: true, sheetUrl: '' } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'DeSTDA', count: 1, clients: 1 }, { name: 'DAC - Mensal', count: 1, clients: 1 }] } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click(); // a tela abre em Link do Google Sheets
    await page.locator('#accountId').fill('6581');
    await page.locator('#accountId').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#queueSummary').textContent.includes('2 tarefas da planilha'));
    assert.equal(await page.locator('#catalogOverview').isHidden(), true, 'nenhuma pergunta antes da leitura da Enquete');
    assert.match(await page.locator('#queueSummary').innerText(), /1 salvas aguardando catálogo/);
    await page.locator('#queueFilter').selectOption('all');
    for (const button of await page.locator('.queue-item button').all()) assert.equal(await button.isEnabled(), false);
    assert.equal(await page.locator('#applyCard').isHidden(), true);
    assert.match(await page.locator('#status').innerText(), /As perguntas aparecem depois que o robô ler a Enquete/);
    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
