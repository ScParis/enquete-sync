import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { getActiveEmpresa, getAccessEmpresas } from '../lib/gclick.mjs';

test('enterEmpresa localiza o card da empresa pelo empId na imagem e clica', async () => {
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div class="empresa-card" id="card6581">
    <img src="https://assets.gclick.com.br/empresa/6581/logo.png">
    <span>NOU CERVELL</span>
  </div>
  <div class="empresa-card" id="card2420">
    <img src="https://assets.gclick.com.br/empresa/2420/logo.png">
    <span>Tekhne Contabil Ltda</span>
  </div>
  <script>
    document.getElementById('card2420').addEventListener('click', () => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 2420, nome: 'Tekhne Contabil Ltda' }));
      location.href = '/dashboard';
    });
  </script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    if (req.url === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Dashboard</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/empresas`);

    const card = page.locator('.empresa-card').filter({
      has: page.locator('img[src*="/empresa/2420/"]')
    }).first();
    assert.equal(await card.count(), 1);
    await card.click();
    await page.waitForURL(u => !u.pathname.endsWith('/empresas'));

    const current = await page.evaluate(() => JSON.parse(localStorage.getItem('g3CurrentEmpresa')));
    assert.equal(current.id, 2420);
    assert.equal(current.nome, 'Tekhne Contabil Ltda');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('getActiveEmpresa e getAccessEmpresas leem os dados do localStorage', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/`);

    await page.evaluate(() => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 6581, nome: 'NOU CERVELL' }));
      localStorage.setItem('g3AccessEmpresas', JSON.stringify([
        { id: 6581, nome: 'NOU CERVELL' },
        { id: 2420, nome: 'Tekhne Contabil Ltda' }
      ]));
    });

    const active = await getActiveEmpresa(page);
    assert.deepEqual(active, { id: 6581, nome: 'NOU CERVELL' });

    const all = await getAccessEmpresas(page);
    assert.equal(all.length, 2);
    assert.equal(all[1].id, 2420);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
