import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const catalog = { accountId: '6581', capturedAt: '2026-10-20T15:30:00Z', questionCount: 1, answerCount: 2,
  questions: [{ ref: '02.07', label: 'Como funciona o ISS deste cliente ?', category: 'Fiscal', answers: [
    { ref: '02.07.01', value: '470', valueKnown: true, label: 'ISS Retido', display: '01 - ISS Retido' },
    { ref: '02.07.03', value: '472', valueKnown: true, label: 'ISS Próprio', display: '03 - ISS Próprio' }] }] };

test('confirmar mapeamento mostra na saída os CNPJs da tarefa com a resposta a gravar e o progresso da conferência', async () => {
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
    let saved = [], releaseAudit;
    const auditGate = new Promise(resolve => { releaseAudit = resolve; });
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', catalog, catalogLive: true, loginReady: true, savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 2, tasks: [{ name: 'ISS RETIDO - OUTROS MUNICIPIOS', count: 2, clients: 2 }] } }));
    await page.route('**/api/mappings/save', route => { saved = [{ accountId: '6581', task: 'ISS RETIDO - OUTROS MUNICIPIOS', answerRef: '02.07.01' }]; return route.fulfill({ json: { savedMappings: saved } }); });
    await page.route('**/api/mappings/plan', route => route.fulfill({ json: { task: 'ISS RETIDO - OUTROS MUNICIPIOS', answerRef: '02.07.01', invalid: [], rows: [
      { cnpj: '19.402.991/0001-67', empId: '887', empresa: 'CASA RODRIGUEZ', status: 'pronto', marcadoEm: null },
      { cnpj: '63.665.522/0001-22', empId: '889', empresa: 'OUTRA', status: 'pronto', marcadoEm: null }] } }));
    await page.route('**/api/audit/progress', route => route.fulfill({ json: { running: true, completed: 0, total: 1, task: '02.07 · ISS RETIDO - OUTROS MUNICIPIOS' } }));
    await page.route('**/api/mappings/preview', async route => {
      if (!saved.length) return route.fulfill({ json: { previewId: null, report: { mode: 'account_audit', accountId: '6581', complete: true, toWrite: 0, rules: { inputType: 'mixed', allowedTasks: [] }, mappings: [], pendingTasks: ['ISS RETIDO - OUTROS MUNICIPIOS'], excludedTasks: [], failedTasks: [], invalidSource: [], inspected: [], summary: {} } } });
      await auditGate;
      await route.fulfill({ json: { previewId: 'p2', report: { mode: 'account_audit', accountId: '6581', complete: true, toWrite: 2, previewId: 'p2', sourceTaskCount: 1, sourceCnpjCount: 2,
        rules: { inputType: 'mixed', allowedTasks: ['ISS RETIDO - OUTROS MUNICIPIOS'] }, mappings: [{ task: 'ISS RETIDO - OUTROS MUNICIPIOS', questionRef: '02.07', answerRef: '02.07.01', clients: 2, summary: { vazio: 2, ja_correto: 0, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }],
        pendingTasks: [], excludedTasks: [], failedTasks: [], invalidSource: [], summary: { vazio: 2 },
        inspected: [{ cnpj: '19.402.991/0001-67', mappingTask: 'ISS RETIDO - OUTROS MUNICIPIOS', mappingAnswer: '02.07.01', uiStatus: 'vazio' }, { cnpj: '63.665.522/0001-22', mappingTask: 'ISS RETIDO - OUTROS MUNICIPIOS', mappingAnswer: '02.07.01', uiStatus: 'vazio' }] } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click(); // a tela abre em Link do Google Sheets
    await page.waitForFunction(() => document.querySelector('#auditStatus').textContent.includes('Concluído'));
    await page.locator('#queueFilter').selectOption('all');
    await page.locator('.queue-item button').click();
    await page.locator('#editorQuestion').selectOption('02.07');
    await page.locator('#editorAnswer').selectOption('02.07.01');
    await page.locator('#confirmMapping').click();
    // Na hora: CNPJs da tarefa com a resposta a gravar, e a tela diz que está conferindo.
    await page.waitForFunction(() => document.querySelector('#results').innerText.includes('19.402.991/0001-67'));
    const rows = await page.locator('#results').innerText();
    assert.match(rows, /19\.402\.991\/0001-67[\s\S]*A conferir[\s\S]*Resposta: 02\.07 → 01 - ISS Retido/);
    assert.match(rows, /63\.665\.522\/0001-22/);
    assert.match(await page.locator('#focusLabel').innerText(), /Mostrando só: ISS RETIDO - OUTROS MUNICIPIOS/);
    assert.equal(await page.locator('.status-tag.a_conferir').count(), 2);
    // Testa que alternar o filtro mantém os resultados e não esvazia a tabela
    await page.locator('#filter').selectOption('a_conferir');
    assert.equal(await page.locator('#results tr').count(), 2);
    await page.locator('#filter').selectOption('all');
    assert.equal(await page.locator('#results tr').count(), 2);
    await page.waitForFunction(() => /Conferindo na Enquete/.test(document.querySelector('#nextStep').textContent));
    // Fim da conferência: estado real dos mesmos CNPJs e gravação liberada.
    releaseAudit();
    await page.waitForFunction(() => document.querySelector('#results').innerText.includes('Sem resposta'));
    assert.match(await page.locator('#results').innerText(), /Sem resposta[\s\S]*Resposta: 02\.07 → 01 - ISS Retido/);
    assert.equal(await page.locator('#apply').innerText(), 'Marcar 2 resposta(s) no G-Click');
    assert.match(await page.locator('#ledgerLink').getAttribute('href'), /marcacoes\.csv\?account=6581/);
    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
