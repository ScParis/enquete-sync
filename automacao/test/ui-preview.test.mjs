import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const oldFile = { name: 'obrigações.csv', modifiedAt: '2026-10-18T10:00:00.000Z', size: 100, stale: false };
const newFile = { name: 'obrigações (1).csv', modifiedAt: '2026-10-18T10:05:00.000Z', size: 101, stale: false };
const catalog = { accountId: '6581', capturedAt: '2026-10-20T12:00:00Z', questionCount: 1, answerCount: 1,
  questions: [{ ref: '02.02', label: 'Obrigações Estaduais?', category: 'Fiscal', answers: [{ ref: '02.02.01', value: '409', valueKnown: true, label: 'DeSTDA', display: '01 - DeSTDA' }] }] };

test('novo CSV invalida a conferência e desabilita a gravação', async () => {
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
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', catalog, catalogLive: true, loginReady: true, savedMappings: [{ accountId: '6581', task: 'DeSTDA', answerRef: '02.02.01' }] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: ++downloads === 1 ? [oldFile] : [newFile, oldFile] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'obrigações.csv', rowCount: 1, tasks: [{ name: 'DeSTDA', count: 1, clients: 1 }] } }));
    let audits = 0;
    await page.route('**/api/mappings/preview', async route => { if (++audits > 1) await new Promise(r => setTimeout(r, 1500)); await route.fulfill({ json: { previewId: 'p1', report: {
      mode: 'account_audit', complete: true, toWrite: 1, previewId: 'p1', sourceStale: false, sourceTaskCount: 1, sourceCnpjCount: 1,
      rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', clients: 1, summary: { vazio: 1, ja_correto: 0, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }],
      pendingTasks: [], excludedTasks: [], failedTasks: [], invalidSource: [], summary: { vazio: 1 },
      inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Teste', mappingTask: 'DeSTDA', uiStatus: 'vazio' }] } } }); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#auditStatus').textContent.includes('Concluído'));
    assert.equal(await page.locator('#apply').isEnabled(), true);
    await page.getByRole('button', { name: 'Atualizar downloads' }).click();
    await page.waitForFunction(name => document.getElementById('downloadFile').value === name, newFile.name);
    assert.equal(await page.locator('#apply').isEnabled(), false, 'conferência do CSV anterior deixa de valer na hora');
    await page.waitForFunction(() => document.querySelector('#auditStatus').textContent.includes('Concluído'));
    assert.equal(audits, 2, 'o CSV novo é conferido de novo automaticamente');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
