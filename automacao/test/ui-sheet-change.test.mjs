import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

test('trocar o link remove tarefas do CSV antigo até selecionar o novo arquivo', async () => {
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
    let files = [{ name: 'antigo.csv', modifiedAt: '2026-10-22T12:00:00Z', size: 100, stale: true }];
    const taskRequests = [];
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', accounts: [], savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files } }));
    await page.route('**/api/tasks', route => {
      const name = route.request().postDataJSON().downloadFile;
      taskRequests.push(name);
      return route.fulfill({ json: { source: name, rowCount: 1, tasks: [{ name, count: 1, clients: 1 }] } });
    });
    await page.route('**/api/accounts/save', route => route.fulfill({ json: { accounts: [] } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click(); // a tela abre em Link do Google Sheets
    await page.waitForFunction(() => document.querySelector('#taskStatus').textContent.includes('antigo.csv'));

    await page.locator('#recentSheetUrl').fill('https://docs.google.com/spreadsheets/d/abc123/edit?gid=7#gid=42');
    assert.match(await page.locator('#directExport').getAttribute('href'), /gid=42$/, 'usa a aba ativa indicada no fragmento');
    assert.equal(await page.locator('#downloadFile').inputValue(), '');
    assert.match(await page.locator('#taskStatus').innerText(), /Link da aba alterado/);
    await page.locator('#refreshDownloads').click();
    assert.equal(await page.locator('#downloadFile').inputValue(), '', 'atualizar não seleciona CSV antigo');
    assert.deepEqual(taskRequests, ['antigo.csv']);

    files = [{ name: 'novo.csv', modifiedAt: '2026-10-24T02:00:00Z', size: 110, stale: false }, ...files];
    await page.locator('#refreshDownloads').click();
    assert.equal(await page.locator('#downloadFile').inputValue(), '', 'download novo exige seleção após a troca de link');
    await page.locator('#downloadFile').selectOption('novo.csv');
    await page.waitForFunction(() => document.querySelector('#taskStatus').textContent.includes('novo.csv'));
    assert.deepEqual(taskRequests, ['antigo.csv', 'novo.csv']);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('erro de link privado aparece na fonte e o CSV escolhido pode ser importado', async () => {
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
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', accounts: [], savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));
    await page.route('**/api/tasks', route => {
      const request = route.request().postDataJSON();
      return request.sourceType === 'url'
        ? route.fulfill({ status: 400, json: { error: 'A planilha exige acesso. Envie um CSV/XLSX ou informe um JSON de conta de serviço.' } })
        : route.fulfill({ json: { source: request.fileName, rowCount: 1, tasks: [{ name: 'DeSTDA', count: 1, clients: 1 }] } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'Link do Google Sheets' }).click();
    await page.locator('#sourceUrl').fill('https://docs.google.com/spreadsheets/d/abc123/edit?gid=42');
    await page.locator('#loadSourceBtn').click();
    await page.waitForFunction(() => document.querySelector('#sourceStatus').textContent.includes('planilha exige acesso'));
    assert.match(await page.locator('#sourceStatus').innerText(), /planilha exige acesso/);
    assert.match(await page.locator('#sourceStatus').getAttribute('class'), /error/);

    await page.getByRole('radio', { name: 'Arquivo CSV/XLSX' }).click();
    await page.locator('#file').setInputFiles({ name: 'nova.csv', mimeType: 'text/csv', buffer: Buffer.from('Obrigação / Tarefa,Empresa,EmpID,CNPJ\nDeSTDA,A,1,19.402.991/0001-67\n') });
    await page.waitForFunction(() => document.querySelector('#sourceStatus').textContent.includes('nova.csv'));
    assert.match(await page.locator('#sourceStatus').getAttribute('class'), /ok/);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('aba sem colunas de obrigação mostra todos os campos e pagina os registros', async () => {
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
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', accounts: [], savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { kind: 'table', source: 'Clientes.csv', rowCount: 30,
      missingForAutomation: ['Obrigação / Tarefa', 'Empresa', 'EmpID', 'CNPJ'], tasks: [],
      table: { columns: [{ name: 'Cliente', filled: 30, distinct: 30 }, { name: 'Cód. Enquete', filled: 30, distinct: 30 }],
        rows: Array.from({ length: 30 }, (_, i) => [`Cliente ${i + 1}`, i === 0 ? '<script>alert(1)</script>' : String(i + 1)]) } } }));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'Arquivo CSV/XLSX' }).click();
    await page.locator('#file').setInputFiles({ name: 'Clientes.csv', mimeType: 'text/csv', buffer: Buffer.from('Cliente,Cód. Enquete\nA,1\n') });
    await page.waitForFunction(() => document.querySelector('#sourceStatus').textContent.includes('30 linha(s)'));
    assert.equal(await page.locator('#sourceTable thead th').count(), 3);
    assert.equal(await page.locator('#sourceTable tbody tr').count(), 25);
    assert.equal(await page.locator('#sourceTable script').count(), 0);
    assert.match(await page.locator('#sourceTable tbody tr').first().innerText(), /<script>alert\(1\)<\/script>/);
    await page.locator('#sourceNext').click();
    assert.equal(await page.locator('#sourceTable tbody tr').count(), 5);
    assert.equal(await page.locator('#sourcePageInfo').innerText(), '26–30 de 30');
    assert.equal(await page.locator('#navBadgeSource').innerText(), '30 linhas');
    // Aba sem Obrigação / Tarefa: aviso amarelo com o caminho para a Carteira, sem disparar nada sozinho
    assert.match(await page.locator('#sourceStatusBox').getAttribute('class'), /warn/);
    assert.equal(await page.locator('#btnSourceToCarteira').isVisible(), true);
    assert.equal(await page.locator('#inspectSourceBtn').isVisible(), true);
    await page.locator('#btnSourceToCarteira').click();
    assert.equal(await page.locator('#section-carteira').isVisible(), true);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
