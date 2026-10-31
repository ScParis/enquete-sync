import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

const mockEmpresas = [
  { id: '3032', nome: 'PROSPERA CONTABILIDADE', apelido: 'PROSPERA', cnpj: '33306871000185', ativo: true, imagemUrl: null },
  { id: '2420', nome: 'TEKHNE CONTABIL LTDA', apelido: 'TEKHNE', cnpj: '11222333000199', ativo: true, imagemUrl: 'https://example.com/logo2420.png' },
  { id: '6581', nome: 'ASSERT CONTABILIDADE EIRELI', apelido: 'ASSERT', cnpj: '44555666000188', ativo: false, imagemUrl: null }
];

test('Grid de Empresas: renderização, busca dinâmica e alternância por clique de cartão', async () => {
  let switchRequestedId = null;

  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        authenticated: true,
        user: { id: 1, name: 'Admin', email: 'admin@gclick.local', role: 'admin' },
        token: 'test'
      }));
    }

    if (req.url.startsWith('/api/gclick/session')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        browserStatus: 'open',
        gclickAuthStatus: 'login_detected',
        onEmpresas: false,
        accountMatches: true,
        isReadyForModules: true,
        activeAccountId: switchRequestedId || '3032',
        activeEmpresaNome: switchRequestedId === '2420' ? 'TEKHNE CONTABIL LTDA' : 'PROSPERA CONTABILIDADE',
        currentEmpresaId: switchRequestedId || '3032',
        currentEmpresaNome: switchRequestedId === '2420' ? 'TEKHNE CONTABIL LTDA' : 'PROSPERA CONTABILIDADE',
        availableEmpresas: mockEmpresas,
        message: 'Conectado'
      }));
    }

    if (req.url === '/api/gclick/switch-empresa' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      switchRequestedId = String(parsed.accountId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        active: true,
        accountId: switchRequestedId,
        currentAccountId: switchRequestedId,
        empresaNome: switchRequestedId === '2420' ? 'TEKHNE CONTABIL LTDA' : 'PROSPERA CONTABILIDADE',
        message: 'Empresa alternada'
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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.route('**/api/config', route => route.fulfill({ json: {
      token: 'test',
      rules: { category: 'Fiscal', question: 'Teste?', questionRef: '01.01', answerRef: '01.01.01', answerValue: '1', answerLabel: 'Sim', inputType: 'radio', allowedTasks: [], excludedTasks: [] },
      presets: [],
      accounts: []
    }}));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));

    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    // 1. Aguarda renderização dos cartões de empresas
    await page.waitForSelector('.empresa-card-item');
    const cards = page.locator('.empresa-card-item');
    assert.equal(await cards.count(), 3, 'deve renderizar 3 cartões de empresas');

    // 2. Verifica cartão ativo (3032 - PROSPERA)
    const card3032 = page.locator('.empresa-card-item[data-id="3032"]');
    assert.equal(await card3032.count(), 1);
    assert.ok(await card3032.evaluate(el => el.classList.contains('is-active')), 'cartão 3032 deve ter a classe is-active');
    assert.match(await card3032.innerText(), /Conectada Agora/i);
    assert.match(await card3032.innerText(), /PROSPERA CONTABILIDADE/);
    assert.match(await card3032.innerText(), /33\.306\.871\/0001-85/);

    // 3. Verifica cartão suspenso (6581 - ASSERT)
    const card6581 = page.locator('.empresa-card-item[data-id="6581"]');
    assert.ok(await card6581.evaluate(el => el.classList.contains('is-disabled')), 'cartão 6581 deve ter classe is-disabled');
    assert.match(await card6581.innerText(), /Suspensa/i);

    // 4. Teste de busca dinâmica
    const searchInput = page.locator('#empresaGridSearch');
    await searchInput.fill('tekhne');
    assert.equal(await page.locator('.empresa-card-item').count(), 1, 'filtro por tekhne deve mostrar apenas 1 card');
    assert.equal(await page.locator('.empresa-card-item').first().getAttribute('data-id'), '2420');

    // Filtro por CNPJ
    await searchInput.fill('44555');
    assert.equal(await page.locator('.empresa-card-item').count(), 1, 'filtro por CNPJ deve mostrar a conta correspondente');
    assert.equal(await page.locator('.empresa-card-item').first().getAttribute('data-id'), '6581');

    // Limpa busca
    await searchInput.fill('');
    assert.equal(await page.locator('.empresa-card-item').count(), 3, 'ao limpar o filtro, todos os 3 cartões reaparecem');

    // 5. Teste de clique para alternar para 2420
    const card2420 = page.locator('.empresa-card-item[data-id="2420"]');
    await card2420.click();

    // Aguarda atualização da empresa ativa
    await page.waitForFunction(() => {
      const c = document.querySelector('.empresa-card-item[data-id="2420"]');
      return c && c.classList.contains('is-active');
    });

    assert.equal(switchRequestedId, '2420', 'deve ter acionado o endpoint com accountId 2420');
    assert.equal(await page.locator('#accountId').inputValue(), '2420', 'input manual de contingência deve sincronizar com o ID');

    assert.equal(errors.length, 0, 'nenhum erro de página deve ocorrer');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
