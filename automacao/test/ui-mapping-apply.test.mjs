import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const question = 'Obrigações Estaduais?';
const catalog = { accountId: '6581', capturedAt: '2026-10-20T12:00:00Z', questionCount: 1, answerCount: 1,
  questions: [{ ref: '02.02', label: question, category: 'Fiscal', answers: [{ ref: '02.02.01', value: '409', valueKnown: true, label: 'DeSTDA', display: '01 - DeSTDA' }] }] };
const item = (cnpj, uiStatus) => ({ cnpj, empId: '1', empresa: 'Cliente', mappingTask: 'DeSTDA', uiStatus });
const report = complete => ({ mode: 'account_audit', complete, incompleteReason: complete ? null : 'Não verificado: a sessão do G-Click caiu durante a tarefa "DeSTDA"',
  createdAt: new Date().toISOString(), source: 'enquete.csv', sourceTaskCount: 1, sourceCnpjCount: 4, toWrite: 2, previewId: complete ? 'p1' : undefined,
  rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', questionRef: '02.02', answerRef: '02.02.01', clients: 4, summary: { vazio: 2, ja_correto: 1, divergente: 1, nao_encontrado: 0, bloqueado: 0 } }],
  pendingTasks: [], excludedTasks: [], failedTasks: complete ? [] : [{ task: 'DeSTDA', reason: 'Sessão perdida' }], invalidSource: [],
  inspected: [item('19.402.991/0001-67', 'vazio'), item('63.665.522/0001-22', 'vazio'), item('58.291.475/0001-64', 'ja_correto'), item('33.678.064/0001-03', complete ? 'divergente' : 'nao_verificado')],
  summary: { total: 4, vazio: 2, ja_correto: 1, divergente: complete ? 1 : 0, nao_encontrado: 0, bloqueado: 0, sem_mapeamento: 0, nao_verificado: complete ? 0 : 1, invalidSource: 0 } });

for (const [complete, warning] of [[false, false], [true, false], [true, true]]) test(`conferência ${warning ? 'com planilha suspeita bloqueia' : complete ? 'completa libera' : 'incompleta bloqueia'} a gravação por mapeamentos`, async () => {
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
    const applied = [];
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules: { category: 'Fiscal', question, questionRef: '02.02', answerRef: '02.02.01', answerValue: '409', answerLabel: '01 - DeSTDA', inputType: 'checkbox', allowedTasks: ['DeSTDA'], excludedTasks: [] },
      presets: [], catalog, catalogLive: true, loginReady: true, savedMappings: [{ accountId: '6581', task: 'DeSTDA', answerRef: '02.02.01' }] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 4, tasks: [{ name: 'DeSTDA', count: 4, clients: 4 }] } }));
    await page.route('**/api/mappings/preview', route => { const r = report(complete); return route.fulfill({ json: { report: warning ? { ...r, previewId: undefined, sourceWarning: '3 de 4 CNPJs da planilha não aparecem na Enquete da conta 6581.' } : r, previewId: warning ? null : r.previewId ?? null } }); });
    await page.route('**/api/mappings/apply', async route => { applied.push(route.request().postDataJSON()); await route.fulfill({ json: { report: { mode: 'mapping_apply', accountId: '6581', status: 'verificado', rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] },
      results: [{ questionRef: '02.02', task: 'DeSTDA', answerRef: '02.02.01', changed: ['19.402.991/0001-67', '63.665.522/0001-22'], skipped: [] }], inspected: [], summary: { total: 0 } } } }); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click(); // a tela abre em Link do Google Sheets
    await page.waitForFunction(() => /Concluído|Incompleto/.test(document.querySelector('#auditStatus').textContent));
    assert.equal(await page.locator('#applyCard').isVisible(), true);
    if (warning) {
      assert.match(await page.locator('#mappingResult').innerText(), /não aparecem na Enquete/);
      assert.equal(await page.locator('#apply').isEnabled(), false);
      assert.match(await page.locator('#applyReason').innerText(), /não aparecem na Enquete/);
      return;
    }
    if (!complete) {
      assert.match(await page.locator('#mappingResult').innerText(), /Conferência incompleta/);
      assert.equal(await page.locator('#apply').isEnabled(), false);
      assert.match(await page.locator('#applyReason').innerText(), /incompleta/);
      return;
    }
    assert.match(await page.locator('#applyReason').innerText(), /2 resposta\(s\) sem marcação.*1 par\(es\) divergente/);
    assert.equal(await page.locator('#apply').innerText(), 'Marcar 2 resposta(s) no G-Click', 'N é o total a marcar, não o total da planilha');
    await page.locator('#apply').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Gravação concluída'));
    assert.deepEqual(applied, [{ previewId: 'p1' }]);
    assert.match(await page.locator('#status').innerText(), /2 resposta\(s\) marcada\(s\)/);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
