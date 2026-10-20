import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const oldFile = { name: 'obrigações.csv', modifiedAt: '2026-10-18T10:00:00.000Z', size: 100, stale: false };
const newFile = { name: 'obrigações (1).csv', modifiedAt: '2026-10-18T10:05:00.000Z', size: 101, stale: false };

test('novo CSV invalida a prévia e desabilita a gravação', async () => {
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
    let downloads = 0;
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules: {
      accountId: '6581', category: 'Qualificação Geral do Cliente', question: 'Qual é o atual Regime Tributário desta empresa?',
      questionRef: '01.02', answerRef: '01.02.04', answerValue: '9', answerLabel: '04 - Simples',
      allowedTasks: ['DAS - Mensal'], excludedTasks: ['DAS - Mensal - CDB']
    } } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: ++downloads === 1 ? [oldFile] : [newFile, oldFile] } }));
    await page.route('**/api/run', route => route.fulfill({ json: { previewId: 'preview-1', report: {
      mode: 'preview', sourceStale: false, rules: { allowedTasks: ['DAS - Mensal'] }, summary: { vazio: 1 }, invalidSource: [],
      inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Teste', tasks: ['DAS - Mensal'], status: 'pronto', uiStatus: 'vazio' }]
    } } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'Navegador integrado' }).click();
    await page.getByRole('button', { name: 'Abrir modo legado de DAS e DeSTDA' }).click();
    await page.getByRole('button', { name: 'Prévia da regra manual' }).click();
    await page.locator('#confirmText').fill('APLICAR 1');
    assert.equal(await page.locator('#apply').isEnabled(), true);
    await page.getByRole('button', { name: 'Atualizar downloads' }).click();
    await page.waitForFunction(name => document.getElementById('downloadFile').value === name, newFile.name);
    assert.equal(await page.locator('#downloadFile').inputValue(), newFile.name);
    assert.equal(await page.locator('#apply').isEnabled(), false);
    assert.match(await page.locator('#status').innerText(), /CSV selecionado mudou/);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
