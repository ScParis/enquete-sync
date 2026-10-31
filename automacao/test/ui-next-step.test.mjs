import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const question = 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)';
const catalog = { accountId: '6581', capturedAt: '2026-10-20T12:00:00Z', questionCount: 1, answerCount: 1,
  questions: [{ ref: '02.03', label: question, category: 'Fiscal', answers: [{ ref: '02.03.08', value: '450', valueKnown: true, label: 'GIA ST', display: '08 - GIA ST' }] }] };

test('cartão mostra a situação real na Enquete e a tela orienta baixar CSV novo antes de gravar', async () => {
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
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', catalog, catalogLive: true, loginReady: true, savedMappings: [{ accountId: '6581', task: 'GIA-ST', answerRef: '02.03.08' }] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: '2026-10-17T22:48:25Z', size: 100, stale: true }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'GIA-ST', count: 2, clients: 2 }] } }));
    await page.route('**/api/mappings/preview', route => route.fulfill({ json: { previewId: 'p1', report: {
      mode: 'account_audit', accountId: '6581', complete: true, toWrite: 2, previewId: 'p1', sourceStale: true, sourceTaskCount: 1, sourceCnpjCount: 2,
      rules: { inputType: 'mixed', allowedTasks: ['GIA-ST'] }, mappings: [{ task: 'GIA-ST', questionRef: '02.03', answerRef: '02.03.08', clients: 2, summary: { vazio: 2, ja_correto: 0, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }],
      pendingTasks: [], excludedTasks: [], failedTasks: [], invalidSource: [], summary: { vazio: 2 },
      inspected: [{ cnpj: '68.699.407/0001-92', mappingTask: 'GIA-ST', uiStatus: 'vazio' }, { cnpj: '68.699.448/0001-89', mappingTask: 'GIA-ST', uiStatus: 'vazio' }] } } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click(); // a tela abre em Link do Google Sheets
    await page.waitForFunction(() => document.querySelector('#auditStatus').textContent.includes('Concluído'));
    const card = await page.locator('.queue-item', { hasText: 'GIA-ST' }).innerText();
    assert.match(card, /Regra: marcar 02\.03 → 08 - GIA ST/);
    assert.match(card, /Situação na Enquete: 2 sem marcação \(a gravar\) · 0 já marcada/);
    assert.match(await page.locator('#nextStep').innerText(), /2 resposta\(s\) a marcar.*Marcar 2 resposta\(s\) no G-Click.*confirme cada pergunta/);
    // CSV antigo é aviso, não bloqueio: a decisão é do operador.
    assert.equal(await page.locator('#apply').isEnabled(), true);
    assert.match(await page.locator('#applyReason').innerText(), /mais de 24 h/);
    // Gravação aparece no topo da coluna de resultados, antes da tabela.
    assert.ok(await page.evaluate(() => document.getElementById('applyCard').compareDocumentPosition(document.getElementById('results')) & Node.DOCUMENT_POSITION_FOLLOWING));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
