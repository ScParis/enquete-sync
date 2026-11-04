import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const rules = { accountId: '6581', category: 'Fiscal', question: 'Obrigações Estaduais?', questionRef: '02.02',
  answerRef: '02.02.01', answerValue: '409', answerLabel: '01 - DeSTDA', inputType: 'checkbox',
  allowedTasks: ['DeSTDA'], excludedTasks: [] };
const catalog = { accountId: '6581', capturedAt: '2026-10-18T12:00:00Z', questionCount: 1, answerCount: 2,
  questions: [{ ref: '02.02', label: 'Obrigações Estaduais?', category: 'Fiscal', answers: [
    { ref: '02.02.01', value: '409', label: 'DeSTDA', display: '01 - DeSTDA' },
    { ref: '02.02.02', value: '379', label: 'DAC', display: '02 - DAC' }
  ] }] };

test('menu lateral por módulos unificados e navegação por abas na Enquete', async () => {
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

    await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', rules, presets: [{ name: 'DeSTDA', rules }], catalog, catalogLive: true, loginReady: true, savedMappings: [] } }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [{ name: 'enquete.csv', modifiedAt: new Date().toISOString(), size: 100, stale: false }] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { source: 'enquete.csv', rowCount: 1, tasks: [{ name: 'DeSTDA', count: 1, clients: 1, invalidCnpjs: 0 }] } }));
    await page.route('**/api/mappings/preview', async route => {
      await route.fulfill({ json: { report: { mode: 'account_audit', createdAt: new Date().toISOString(), source: 'enquete.csv', sourceTaskCount: 1, sourceCnpjCount: 1,
        rules: { inputType: 'mixed', allowedTasks: ['DeSTDA'] }, mappings: [{ task: 'DeSTDA', questionRef: '02.02', answerRef: '02.02.01', clients: 1,
        summary: { vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0 } }], pendingTasks: [], excludedTasks: [], failedTasks: [], invalidSource: [],
        inspected: [{ cnpj: '19.402.991/0001-67', empId: '1', empresa: 'Teste', mappingTask: 'DeSTDA', uiStatus: 'ja_correto' }],
        summary: { total: 1, vazio: 0, ja_correto: 1, divergente: 0, nao_encontrado: 0, bloqueado: 0, sem_mapeamento: 0, invalidSource: 0 } } } });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#sidebarNav') !== null);

    // Verificação de Remoção do Stepper Inconsistente e Dashboard Geral
    assert.equal(await page.locator('#enquetePipeline').count(), 0);
    assert.equal(await page.locator('#navAll').count(), 0);

    // Navega para Enquete G-Click via Sidebar
    await page.locator('#navEnquete').click();
    assert.equal(await page.locator('#section-enquete').isVisible(), true);
    assert.match(await page.locator('#navEnquete').getAttribute('class'), /active/);

    // As outras seções ficam ocultas
    assert.equal(await page.locator('#section-connection').isVisible(), false);
    assert.equal(await page.locator('#section-obrigacoes').isVisible(), false);
    assert.equal(await page.locator('#section-carteira').isVisible(), false);
    assert.equal(await page.locator('#section-valida-pdf').isVisible(), false);

    // No Workspace da Enquete, o painel principal de operação (Planilha, Mapeamento, Conferência & Gravação) inicia ativo
    assert.equal(await page.locator('#enqueteTabPaneDados').isVisible(), true);
    assert.match(await page.locator('#tabEnqueteDados').getAttribute('class'), /active/);

    // Alternar sub-aba para Cadastro de Respostas (Particularidades)
    await page.locator('#tabEnqueteCadastro').click();
    assert.equal(await page.locator('#enqueteTabPaneCadastro').isVisible(), true);
    assert.equal(await page.locator('#enqueteTabPaneDados').isVisible(), false);
    assert.match(await page.locator('#tabEnqueteCadastro').getAttribute('class'), /active/);

    // Alternar sub-aba para Sincronização Sheets
    await page.locator('#tabEnqueteSheets').click();
    assert.equal(await page.locator('#enqueteTabPaneSheets').isVisible(), true);
    assert.equal(await page.locator('#enqueteTabPaneCadastro').isVisible(), false);
    assert.match(await page.locator('#tabEnqueteSheets').getAttribute('class'), /active/);

    // Retornar para Operação da Enquete
    await page.locator('#tabEnqueteDados').click();
    assert.equal(await page.locator('#enqueteTabPaneDados').isVisible(), true);
    assert.match(await page.locator('#tabEnqueteDados').getAttribute('class'), /active/);

    // Navegar para Obrigações & Canais via Sidebar
    await page.locator('#navObrigacoes').click();
    assert.equal(await page.locator('#section-obrigacoes').isVisible(), true);
    assert.equal(await page.locator('#section-enquete').isVisible(), false);
    assert.match(await page.locator('#navObrigacoes').getAttribute('class'), /active/);

    // Navegar para Carteira de Clientes via Sidebar
    await page.locator('#navCarteira').click();
    assert.equal(await page.locator('#section-carteira').isVisible(), true);
    assert.equal(await page.locator('#section-obrigacoes').isVisible(), false);
    assert.match(await page.locator('#navCarteira').getAttribute('class'), /active/);

    // Navegar para Validador de PDF via Sidebar
    await page.locator('#navValidaPdf').click();
    assert.equal(await page.locator('#section-valida-pdf').isVisible(), true);
    assert.equal(await page.locator('#section-carteira').isVisible(), false);
    assert.match(await page.locator('#navValidaPdf').getAttribute('class'), /active/);

    // Navegar para Conexão G-Click via Sidebar
    await page.locator('#navConnection').click();
    assert.equal(await page.locator('#section-connection').isVisible(), true);
    assert.equal(await page.locator('#section-valida-pdf').isVisible(), false);
    assert.match(await page.locator('#navConnection').getAttribute('class'), /active/);

    // Navegar para Central de Ajuda via Sidebar
    await page.locator('#navHelp').click();
    assert.equal(await page.locator('#section-help').isVisible(), true);
    assert.equal(await page.locator('#section-connection').isVisible(), false);
    assert.match(await page.locator('#navHelp').getAttribute('class'), /active/);

    // Retornar para Enquete
    await page.locator('#navEnquete').click();
    assert.equal(await page.locator('#section-enquete').isVisible(), true);
    assert.equal(await page.locator('#section-help').isVisible(), false);
    assert.match(await page.locator('#navEnquete').getAttribute('class'), /active/);

    // Badge de Conexão reflete estado
    await page.waitForFunction(() => document.querySelector('#navBadgeConnection')?.innerText.includes('Conectado'));
    assert.match(await page.locator('#navBadgeConnection').innerText(), /Conectado/);

    assert.equal(errors.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
