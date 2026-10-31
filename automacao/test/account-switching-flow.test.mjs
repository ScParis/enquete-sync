import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { enterEmpresa, ensureEmpresaActive, getActiveEmpresa } from '../lib/gclick.mjs';

test('enterEmpresa navega para /empresas e alterna para a conta solicitada quando há mismatch', async () => {
  let currentEmpresa = { id: 2420, nome: 'Tekhne Contabil Ltda' };
  const accessEmpresas = [
    { id: 2420, nome: 'Tekhne Contabil Ltda' },
    { id: 6581, nome: 'NOU CERVELL CONSULTORIA' }
  ];

  const htmlEmpresas = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <h1>Selecione a Empresa</h1>
  <div class="empresa-card" id="card2420">
    <img src="https://assets.gclick.com.br/empresa/2420/logo.png">
    <span>Tekhne Contabil Ltda</span>
  </div>
  <div class="empresa-card" id="card6581">
    <img src="https://assets.gclick.com.br/empresa/6581/logo.png">
    <span>NOU CERVELL CONSULTORIA</span>
  </div>
  <script>
    document.getElementById('card6581').addEventListener('click', () => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 6581, nome: 'NOU CERVELL CONSULTORIA' }));
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
    res.end(htmlEmpresas);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const port = server.address().port;

    // Inicializa na página de empresas com a empresa antiga (2420)
    await page.goto(`http://127.0.0.1:${port}/empresas`);
    await page.evaluate(({ cur, acc }) => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify(cur));
      localStorage.setItem('g3AccessEmpresas', JSON.stringify(acc));
    }, { cur: currentEmpresa, acc: accessEmpresas });

    // Verifica que a empresa inicial é 2420
    const initial = await getActiveEmpresa(page);
    assert.equal(initial.id, 2420);

    // Clica e alterna manualmente
    const card = page.locator('.empresa-card').filter({
      has: page.locator('img[src*="/empresa/6581/"]')
    }).first();
    assert.equal(await card.count(), 1);
    await card.click();
    await page.waitForURL(u => !u.pathname.endsWith('/empresas'));

    const updated = await getActiveEmpresa(page);
    assert.equal(updated.id, 6581);
    assert.equal(updated.nome, 'NOU CERVELL CONSULTORIA');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('ensureEmpresaActive detecta empresa ativa correspondente e diverge se diferente', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><div id="app"></div></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/`);

    await page.evaluate(() => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 2420, nome: 'Tekhne Contabil Ltda' }));
      localStorage.setItem('g3AccessEmpresas', JSON.stringify([
        { id: 2420, nome: 'Tekhne Contabil Ltda' },
        { id: 6581, nome: 'NOU CERVELL' }
      ]));
    });

    // Teste 1: Passivo com conta igual (2420) -> Deve retornar active: true
    const checkSame = await ensureEmpresaActive(page, '2420', { autoSwitch: false });
    assert.equal(checkSame.active, true);
    assert.equal(checkSame.currentEmpresaId, 2420);

    // Teste 2: Passivo com conta diferente (6581) -> Deve retornar active: false com reason: account_mismatch
    const checkMismatch = await ensureEmpresaActive(page, '6581', { autoSwitch: false });
    assert.equal(checkMismatch.active, false);
    assert.equal(checkMismatch.reason, 'account_mismatch');
    assert.equal(checkMismatch.currentEmpresaId, 2420);
    assert.equal(checkMismatch.targetAccountId, '6581');

    // Teste 3: Passivo com conta que nem existe na lista de acesso do operador
    const checkNotInList = await ensureEmpresaActive(page, '99999', { autoSwitch: false });
    assert.equal(checkNotInList.active, false);
    assert.equal(checkNotInList.reason, 'account_not_in_access_list');
    assert.equal(checkNotInList.availableEmpresas.length, 2);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('UI bloqueia acesso a outros módulos se o login e a conta não estiverem validados', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');

  let sessionState = {
    browserStatus: 'open',
    gclickAuthStatus: 'account_mismatch',
    accountMatches: false,
    isReadyForModules: false,
    currentEmpresaId: 2420,
    currentEmpresaNome: 'Tekhne Contabil Ltda',
    activeAccountId: '6581',
    message: 'G-Click conectado em outra empresa (Tekhne Contabil Ltda).'
  };

  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ authenticated: true, user: { id: 1, name: 'Admin', email: 'admin@gclick.local', role: 'admin' }, token: 'test' }));
    }
    if (req.url.startsWith('/api/gclick/session')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sessionState));
    }
    if (req.url === '/api/gclick/switch-empresa') {
      sessionState = {
        browserStatus: 'open',
        gclickAuthStatus: 'login_detected',
        accountMatches: true,
        isReadyForModules: true,
        currentEmpresaId: 6581,
        currentEmpresaNome: 'NOU CERVELL CONSULTORIA',
        activeAccountId: '6581',
        message: 'Login confirmado com sucesso na empresa NOU CERVELL CONSULTORIA'
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        active: true,
        accountId: '6581',
        currentAccountId: '6581',
        empresaNome: 'NOU CERVELL CONSULTORIA'
      }));
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

    await page.route('**/api/config', route => route.fulfill({ json: {
      token: 'test',
      accounts: [{ accountId: '6581' }],
      savedMappings: []
    }}));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));
    await page.route('**/api/users/list', route => route.fulfill({ json: { users: [] } }));
    await page.route('**/api/carteira/users/list', route => route.fulfill({ json: { users: [] } }));

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#accountId').fill('6581');
    await page.locator('#accountId').dispatchEvent('input');

    // 1. Simula detecção de mismatch clicando em "Verificar login no G-Click"
    await page.route('**/api/login/close', route => route.fulfill({ json: {
      stage: 'account_mismatch',
      accountMatches: false,
      isReadyForModules: false,
      currentEmpresaId: 2420,
      currentEmpresaNome: 'Tekhne Contabil Ltda',
      activeAccountId: '6581',
      message: 'G-Click conectado em outra empresa (Tekhne Contabil Ltda). Alterne para a conta 6581.'
    }}));

    await page.locator('#closeLogin').click();

    // O status deve apontar a divergência e oferecer a troca
    assert.equal(await page.locator('#connectionCard').getAttribute('data-state'), 'mismatch');
    assert.match(await page.locator('#connStatusTitle').innerText(), /Tekhne Contabil Ltda \(2420\)/);
    assert.equal(await page.locator('#btnSwitchEmpresa').isVisible(), true, 'Botão de troca deve estar visível');
    assert.equal(await page.locator('#btnSwitchEmpresa').innerText(), 'Alternar para a conta 6581');

    // 2. Com mismatch ativo, tenta clicar na Carteira
    await page.locator('#navCarteira').click();

    // Deve permanecer na section-connection e bloquear a navegação
    const isConnVisible = await page.locator('#section-connection').isVisible();
    assert.equal(isConnVisible, true, 'Deve manter na seção Conexão enquanto houver mismatch de conta');

    // 3. Clica no botão de alternar automaticamente para a conta selecionada
    await page.locator('#btnSwitchEmpresa').click();

    // Aguarda o resultado e a liberação
    await page.waitForFunction(() => document.querySelector('#connectionCard').dataset.state === 'ok');
    assert.equal(await page.locator('#btnSwitchEmpresa').isHidden(), true, 'Botão de troca deve sumir após a troca');
    assert.equal(await page.locator('#navBadgeConnection').innerText(), 'Conectado');

    // Agora clicar em Carteira deve ter sucesso e abrir #section-carteira
    await page.locator('#navCarteira').click();
    const isCarteiraVisible = await page.locator('#section-carteira').isVisible();
    assert.equal(isCarteiraVisible, true, 'Deve permitir acesso à Carteira após conexão resolvida');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('após abrir o login, se o G-Click entrar em outra empresa o painel alterna sozinho uma única vez', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');
  let switchCalls = 0;
  let active = { id: '2420', nome: 'Tekhne Contabil Ltda' };

  const server = http.createServer(async (req, res) => {
    const json = data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/api/auth/me') return json({ authenticated: true, user: { id: 1, name: 'Admin', email: 'admin@gclick.local', role: 'admin' }, token: 'test' });
    if (req.url === '/api/login/open') return json({ open: true, catalogStatus: 'not_requested' });
    if (req.url.startsWith('/api/gclick/session')) {
      const match = active.id === '4966';
      return json({ browserStatus: 'open', gclickAuthStatus: match ? 'login_detected' : 'account_mismatch', accountMatches: match, isReadyForModules: match,
        currentEmpresaId: active.id, currentEmpresaNome: active.nome, activeAccountId: '4966', message: match ? 'ok' : 'Conectado em outra empresa.' });
    }
    if (req.url === '/api/gclick/switch-empresa') {
      switchCalls++;
      active = { id: '4966', nome: 'EXITO CONTABILIDADE' };
      return json({ active: true, accountId: '4966', currentAccountId: '4966', empresaNome: 'EXITO CONTABILIDADE', switchedFrom: '2420' });
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
    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', accounts: [{ accountId: '4966' }], savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));
    await page.route('**/api/users/list', route => route.fulfill({ json: { users: [] } }));
    await page.route('**/api/carteira/users/list', route => route.fulfill({ json: { users: [] } }));

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#accountId').fill('4966');
    await page.locator('#accountId').dispatchEvent('input');
    await page.locator('#openLogin').click();

    await page.waitForFunction(() => document.querySelector('#connectionCard')?.dataset.state === 'ok', null, { timeout: 15000 });
    await page.waitForTimeout(4500); // mais ciclos do poll não devem repetir a troca
    assert.equal(switchCalls, 1);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
