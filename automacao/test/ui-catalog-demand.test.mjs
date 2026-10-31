import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const das = { accountId: '6581', category: 'Geral', question: 'Regime Tributário?', questionRef: '01.02', answerRef: '01.02.04', answerValue: '9', answerLabel: '04 - Simples', inputType: 'radio', allowedTasks: ['DAS - Mensal'], excludedTasks: [] };
const catalog = {
  accountId: '6581',
  capturedAt: '2026-10-26T12:00:00Z',
  questionCount: 1,
  answerCount: 1,
  questions: [
    { ref: '01.02', label: 'Regime Tributário?', category: 'Geral', answers: [{ ref: '01.02.04', value: '9', label: 'Simples', display: '04 - Simples' }] }
  ]
};

test('Fase 2: detecção de login não carrega catálogo automaticamente; busca ocorre sob demanda pelo botão manual', async () => {
  const server = http.createServer(async (req, res) => {
    const file = req.url === '/' ? 'ui/index.html' : req.url === '/ui/app.js' ? 'ui/app.js' : 'ui/style.css';
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await fs.readFile(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let browser;
  let catalogRequested = false;

  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.on('pageerror', error => { throw error; });

    await page.route('**/api/config', route => route.fulfill({
      json: { token: 'test', rules: das, presets: [], savedMappings: [] }
    }));
    await page.route('**/api/login/open', route => route.fulfill({
      json: { open: true, catalogStatus: 'not_requested' }
    }));
    await page.route('**/api/gclick/session*', route => route.fulfill({
      json: {
        browserStatus: 'open',
        gclickAuthStatus: 'login_detected',
        activeEmpresaNome: 'Contabilidade Alpha',
        accountId: '6581'
      }
    }));
    await page.route('**/api/catalog', route => {
      catalogRequested = true;
      route.fulfill({ json: { catalog } });
    });
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('radio', { name: 'CSV baixado do Sheets' }).click();
    await page.locator('#accountId').fill('6581');

    // Abre janela de login
    await page.getByRole('button', { name: 'Abrir janela de login' }).click();

    // Aguarda o polling de login detectar a sessão
    await page.waitForFunction(() => {
      const text = document.querySelector('#status')?.textContent || '';
      return text.includes('Login detectado no G-Click') && text.includes('Contabilidade Alpha');
    }, null, { timeout: 10000 });

    // Verifica que o topo exibe o nome da empresa e o badge
    assert.match(await page.locator('#topAccountNome').innerText(), /Contabilidade Alpha/);
    assert.equal(await page.locator('#topSessionBadge').innerText(), 'Conectado');

    // Confirma que o catálogo NÃO foi solicitado automaticamente
    assert.equal(catalogRequested, false, 'Catálogo não deve ser requisitado automaticamente após detecção de login');
    assert.equal(await page.locator('#catalogOverview').isHidden(), true, 'Overview de catálogo deve permanecer oculto');

    // Agora o operador clica no botão sob demanda
    await page.locator('#refreshCatalogManual').click();

    // Aguarda o catálogo carregar
    await page.waitForFunction(() => {
      const summary = document.querySelector('#catalogOverview');
      return summary && !summary.hidden && summary.textContent.includes('Regime Tributário?');
    }, null, { timeout: 10000 });

    assert.equal(catalogRequested, true, 'Catálogo deve ter sido requisitado sob demanda');
    assert.match(await page.locator('#status').innerText(), /Catálogo da Enquete atualizado sob demanda/);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
