import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const das = { accountId: '6581', category: 'Qualificação Geral do Cliente', question: 'Qual é o atual Regime Tributário desta empresa?', questionRef: '01.02', answerRef: '01.02.04', answerValue: '9', answerLabel: '04 - Simples', inputType: 'radio', allowedTasks: ['DAS - Mensal'], excludedTasks: [] };
const destda = { accountId: '6581', category: 'Dpto. Fiscal/Tributário', question: 'Obrigações Estaduais?', questionRef: '02.02', answerRef: '02.02.01', answerValue: '409', answerLabel: '01 - DeSTDA', inputType: 'checkbox', allowedTasks: ['DeSTDA - Declaração mensal', 'DeSTDA'], excludedTasks: [] };
const catalog = { accountId: '6581', capturedAt: '2026-10-18T12:00:00Z', questionCount: 2, answerCount: 3, questions: [
  { ref: '01.02', label: das.question, category: das.category, answers: [{ ref: '01.02.04', value: '9', label: 'Simples', display: '04 - Simples' }] },
  { ref: '02.02', label: destda.question, category: destda.category, answers: [{ ref: '02.02.01', value: '409', label: 'DeSTDA', display: '01 - DeSTDA' }, { ref: '02.02.02', value: '379', label: 'DAC', display: '02 - DAC' }] }
] };

test('login carrega catálogo e escolha da resposta preenche a regra', async () => {
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
    page.on('pageerror', error => { throw error; });
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules: das, presets: [{ name: 'DAS / Simples', rules: das }, { name: 'DeSTDA', rules: destda }] } }));
    await page.route('**/api/login/open', route => route.fulfill({ json: { open: true } }));
    await page.route('**/api/login/close', route => route.fulfill({ json: { ready: true, catalog } }));
    await page.route('**/api/mappings/save', route => route.fulfill({ json: { savedMappings: [{ accountId: '6581', task: 'DAC - Mensal', answerRef: '02.02.02' }] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'obrigações.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'obrigações.csv', rowCount: 4, tasks: ['DeSTDA', 'DeSTDA - Declaração mensal', 'DAC - Mensal', 'DAS - Mensal'].map(name => ({ name, count: 1 })) } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'Navegador integrado' }).click();
    await page.getByRole('button', { name: 'Abrir janela de login' }).click();
    await page.waitForFunction(() => document.querySelector('#queueSummary').textContent.includes('1 sugestões para revisar'), null, { timeout: 10000 });
    assert.match(await page.locator('#queueSummary').innerText(), /1 sugestões para revisar/);
    assert.equal(await page.locator('#queueFilter').inputValue(), 'ready');
    assert.equal(await page.locator('.queue-item').count(), 3);
    await page.locator('#queueFilter').selectOption('attention');
    assert.equal(await page.locator('.queue-item').count(), 1);
    assert.match(await page.locator('.queue-item').innerText(), /DAC - Mensal/);
    await page.locator('.queue-item button').click();
    assert.equal(await page.locator('#editorQuestion').inputValue(), '02.02');
    assert.equal(await page.locator('#editorAnswer').inputValue(), '02.02.02');
    await page.locator('#confirmMapping').click();
    await page.waitForFunction(() => document.querySelector('#queueSummary').textContent.includes('4 verificadas na conta'));
    assert.equal(await page.locator('.queue-item').count(), 0);
    assert.match(await page.locator('#queueSummary').innerText(), /1 selecionada/);
    assert.equal(await page.locator('#previewMappings').isEnabled(), true);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
