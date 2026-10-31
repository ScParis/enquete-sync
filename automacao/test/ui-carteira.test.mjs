import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

test('ui-carteira: navega para Carteira, carrega planilha e audita vínculos', async (t) => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    let file = 'ui/index.html';
    if (pathname === '/ui/app.js') file = 'ui/app.js';
    else if (pathname === '/ui/style.css') file = 'ui/style.css';
    else if (pathname === '/ui/jb-logo.svg') file = 'ui/jb-logo.svg';
    else if (pathname === '/ui/jb-favicon.svg') file = 'ui/jb-favicon.svg';

    try {
      const content = await fs.readFile(path.join(root, file));
      res.writeHead(200, {
        'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html'
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  // Mock de APIs
  await page.route('**/api/auth/me', route => route.fulfill({
    json: { authenticated: true, user: { id: 1, name: 'Admin', email: 'admin@gclick.local', is_superadmin: 1 } }
  }));
  await page.route('**/api/config', route => route.fulfill({
    json: { token: 'test', rules: {}, catalog: null, catalogLive: false, loginReady: true, savedMappings: [] }
  }));
  await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));

  // Mock das rotas de Carteira
  await page.route('**/api/carteira/users*', route => route.fulfill({
    json: {
      accountId: '6581',
      count: 2,
      users: [
        { id: '1', apelido: 'ana.exito', nome: 'Ana Paula Silva' },
        { id: '2', apelido: 'raquel.exito', nome: 'Raquel Ferreira Lima' }
      ],
      minhaCarteira: {
        accountId: '6581', syncedAt: '2026-10-30T15:00:00.000Z', totalUsuarios: 2, totalEmpresas: 1,
        usuarios: [
          { valor: '11', nome: 'Ana Paula Silva', total: 1, empresas: [{ cnpj: '59994000000105', cnpjFormatado: '59.994.000/0001-05', empresa: 'AGUIAR PACK' }] },
          { valor: '12', nome: 'Raquel Ferreira Lima', total: 0, empresas: [] }
        ]
      }
    }
  }));

  const sheetLink = 'https://docs.google.com/spreadsheets/d/1fxVpJ6WMWFdsQmmquaJK-_7IFTeIBepVGoBPUSHED5g/edit?gid=1472433772#gid=1472433772';
  const loadCalls = [], parseCalls = [];
  const carteiraProfile = { id: 'sug-cart', version: 1, targetModel: 'carteira_responsaveis', columns: [] };
  await page.route('**/api/source/load', route => { loadCalls.push(route.request().postDataJSON()); route.fulfill({ json: {
    source: sheetLink, rowCount: 2, profile: carteiraProfile, missingFields: [],
    normalized: [
      { _row: 2, _norm: { responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpj: '59994000000105' } },
      { _row: 3, _norm: { responsavel: 'ana.exito', empresa: 'ASA COMERCIO', cnpj: '05396572000155' } }],
    table: { columns: ['Pessoa responsável', 'Empresa', 'CNPJ'].map((name, index) => ({ name, index, filled: 2, distinct: 2 })),
      rows: [['ana.exito', 'AGUIAR PACK', '59994000000105'], ['ana.exito', 'ASA COMERCIO', '05396572000155']] } } }); });
  await page.route('**/api/source/inspect', route => route.fulfill({ json: { source: sheetLink, existingProfile: null, suggestedProfile: carteiraProfile,
    structure: { columnCount: 3, headerRow: 1, columns: ['Pessoa responsável', 'Empresa', 'CNPJ'].map((name, index) => ({ index, position: index + 1, name, suggestedField: ['responsavel', 'empresa', 'cnpj'][index], samples: [] })) } } }));
  await page.route('**/api/carteira/sheet/parse', route => { parseCalls.push(route.request().postDataJSON()); route.fulfill({
    json: {
      success: true,
      accountId: '6581',
      totalRows: 2,
      validCnpjs: 2,
      invalidCnpjs: 0,
      detectedColumns: { responsavel: 'Pessoa responsável', empresa: 'Empresa', cnpj: 'CNPJ' },
      users: [
        {
          responsavel: 'ana.exito',
          totalEmpresas: 2,
          resolvido: true,
          usuarioGclick: { id: '1', nome: 'Ana Paula Silva' },
          empresas: [
            { linha: 2, responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpj: '59994000000105', cnpjFormatado: '59.994.000/0001-05', valido: true },
            { linha: 3, responsavel: 'ana.exito', empresa: 'ASA COMERCIO', cnpj: '05396572000155', cnpjFormatado: '05.396.572/0001-55', valido: true }
          ]
        }
      ]
    }
  }); });

  await page.route('**/api/carteira/audit', route => route.fulfill({
    json: {
      success: true,
      audit: {
        total: 2,
        jaVinculados: 1,
        disponiveis: 1,
        disponiveisMesmoCargo: 1,
        disponiveisRestantes: 0,
        naoLocalizados: 0,
        items: [
          {
            linha: 2,
            responsavel: 'ana.exito',
            empresa: 'AGUIAR PACK',
            cnpj: '59994000000105',
            cnpjFormatado: '59.994.000/0001-05',
            status: 'ja_vinculado',
            situacao: 'Já vinculado ao usuário',
            colunaGclick: 'Minha Carteira',
            detalhe: 'Empresa já presente na carteira do usuário'
          },
          {
            linha: 3,
            responsavel: 'ana.exito',
            empresa: 'ASA COMERCIO',
            cnpj: '05396572000155',
            cnpjFormatado: '05.396.572/0001-55',
            status: 'disponivel_para_vincular',
            situacao: 'Disponível para vincular',
            colunaGclick: 'Clientes Disponíveis com o mesmo Cargo',
            origens: ['mesmo_cargo'],
            detalhe: 'Empresa disponível para ser vinculada ao usuário'
          }
        ]
      }
    }
  }));

  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#sidebarNav') !== null);

  // Preenche conta ativa
  await page.locator('#accountId').fill('6581');

  const retirarCalls = [];
  let operacoes = [];
  await page.route('**/api/carteira/operacoes*', route => route.fulfill({ json: { accountId: '6581', operacoes } }));
  await page.route('**/api/carteira/retirar', route => {
    retirarCalls.push(route.request().postDataJSON());
    operacoes = [{ id: 1, acao: 'retirar', usuario: 'Ana Paula Silva', solicitados: ['59994000000105'], concluidos: [], status: 'erro',
      erro: 'Mensagem do G-Click: Não é possível retirar: cliente com tarefas em aberto.', operador: 'admin@gclick.local', createdAt: '2026-10-30T15:10:00.000Z' }];
    route.fulfill({ status: 400, json: { error: 'Nenhum CNPJ foi retirado.' } });
  });
  const vincularCalls = [];
  await page.route('**/api/carteira/vincular', route => { vincularCalls.push(route.request().postDataJSON()); route.fulfill({ json: { success: true, verifiedCount: 1 } }); });

  // 1. Navegação para seção Carteira
  await page.locator('#navCarteira').click();
  assert.equal(await page.locator('#section-carteira').isVisible(), true);
  assert.equal(await page.locator('#section-connection').isVisible(), false);
  assert.match(await page.locator('#navCarteira').getAttribute('class'), /active/);

  // Minha Carteira sincronizada aparece por usuário
  await page.waitForFunction(() => !document.querySelector('#carteiraMinhaWrap').hidden);
  assert.match(await page.locator('#carteiraMinhaSyncedAt').innerText(), /^1 empresa\(s\) em 2 usuário\(s\)/);
  assert.deepEqual(await page.locator('.carteira-minha-user summary').allInnerTexts(), ['Ana Paula Silva\n1 empresa(s)', 'Raquel Ferreira Lima\n0 empresa(s)']);
  assert.equal(await page.locator('#cardCarteiraOperacoes').isHidden(), true);

  // Retirar: marca a empresa na carteira da Ana, confirma e o erro do G-Click aparece no histórico
  await page.locator('.carteira-minha-user summary').first().click();
  const retirarBtn = page.locator('.carteira-retirar-btn').first();
  assert.equal(await retirarBtn.isDisabled(), true);
  await page.locator('.carteira-retirar-cb').first().check();
  assert.equal(await retirarBtn.innerText(), 'Retirar 1 empresa(s)');
  page.once('dialog', dialog => dialog.accept());
  await retirarBtn.click();
  await page.waitForFunction(() => !document.querySelector('#cardCarteiraOperacoes').hidden);
  assert.deepEqual(retirarCalls[0], { accountId: '6581', usuario: 'Ana Paula Silva', valor: '11', cnpjs: ['59994000000105'] });
  assert.match(await page.locator('#carteiraOperacoesBody').innerText(), /Retirar\s+Ana Paula Silva\s+0\/1\s+Erro\s+Mensagem do G-Click: Não é possível retirar/);
  assert.match(await page.locator('#carteiraOperacoesResumo').innerText(), /1 com erro ou incompletos/);

  // 2. Sem planilha, a Carteira orienta a ler em Planilhas; o atalho abre Planilhas já no uso Carteira
  assert.equal(await page.locator('#carteiraSheetTitle').innerText(), 'Planilha da Carteira não carregada');
  assert.equal(await page.locator('#carteiraUserSelectWrap').isVisible(), false);
  await page.locator('#btnCarteiraChangeSheet').click();
  assert.equal(await page.locator('#section-source').isVisible(), true);
  assert.equal(await page.getByRole('radio', { name: 'Carteira por Usuário (responsável × empresa)' }).isChecked(), true);
  await page.locator('#carteiraSourceUrl').fill(sheetLink);
  await page.locator('#loadSourceBtn').click();
  await page.waitForFunction(() => document.querySelector('#sourceStatus')?.textContent.includes('prontas para a Carteira'));
  assert.equal(loadCalls[0].targetModel, 'carteira_responsaveis');
  assert.equal(loadCalls[0].sourceUrl, sheetLink);
  assert.deepEqual(parseCalls[0].rows[0], { linha: 2, responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpj: '59994000000105' });
  await page.waitForFunction(() => !document.querySelector('#mappingEditorSection').hidden); // DE/PARA sugerido abre para conferência

  // A planilha da Enquete não é tocada pela leitura da Carteira
  await page.getByRole('radio', { name: 'Enquete (obrigações)' }).click();
  assert.equal(await page.locator('#sourcePreview').isHidden(), true);
  await page.getByRole('radio', { name: 'Carteira por Usuário (responsável × empresa)' }).click();
  assert.equal(await page.locator('#sourceTable tbody tr').count(), 2);

  await page.locator('#btnSourceToCarteira').click();
  assert.equal(await page.locator('#section-carteira').isVisible(), true);
  assert.match(await page.locator('#carteiraSheetTitle').innerText(), /2 empresa\(s\) · 1 responsável\(is\)/);
  assert.equal(await page.locator('#btnCarteiraChangeSheet').innerText(), 'Trocar planilha');

  // Verifica KPIs e seletor
  await page.waitForFunction(() => document.querySelector('#carteiraMetricUsers')?.textContent === '1');
  assert.equal(await page.locator('#carteiraMetricUsers').textContent(), '1');
  assert.equal(await page.locator('#carteiraMetricTotalEmpresas').textContent(), '2');

  const selectVisible = await page.locator('#carteiraUserSelectWrap').isVisible();
  assert.equal(selectVisible, true);

  // 3. Executar Auditoria
  await page.locator('#carteiraSelectResponsavel').selectOption('ana.exito');
  await page.locator('#btnAuditCarteira').click();

  // Verifica tabela de resultados e KPIs de auditoria
  await page.waitForFunction(() => document.querySelector('#cardCarteiraAudit')?.style.display !== 'none');
  assert.equal(await page.locator('#carteiraMetricJaVinculados').textContent(), '1');
  assert.equal(await page.locator('#carteiraMetricDisponiveis').textContent(), '1');
  assert.equal(await page.locator('#carteiraMetricDisponiveisHint').textContent(), '1 mesmo Cargo · 0 Restantes');

  // Origem do vínculo: Restantes não tem nada; mesmo Cargo tem 1 e é o que vai para o G-Click
  await page.locator('#carteiraVincularOrigem').selectOption('restantes');
  assert.equal(await page.locator('#btnVincularCarteira').isDisabled(), true);
  await page.locator('#carteiraVincularOrigem').selectOption('mesmo_cargo');
  assert.equal(await page.locator('#btnVincularCarteira').isDisabled(), false);
  assert.match(await page.locator('#carteiraVincularOrigem option[value="mesmo_cargo"]').innerText(), /\(1\)$/);

  const rows = await page.locator('#carteiraAuditTableBody tr').count();
  assert.equal(rows, 2);

  const textTable = await page.locator('#carteiraAuditTableBody').innerText();
  assert.ok(textTable.includes('Já vinculado ao usuário'));
  assert.ok(textTable.includes('Disponível para vincular'));
  assert.ok(textTable.includes('59.994.000/0001-05'));
  assert.ok(textTable.includes('05.396.572/0001-55'));

  // 4. Testar filtro por status e por coluna de origem
  await page.locator('#carteiraAuditStatusFilter').selectOption('origem:restantes');
  assert.match(await page.locator('#carteiraAuditTableBody').innerText(), /Nenhum registro/);
  await page.locator('#carteiraAuditStatusFilter').selectOption('disponivel_para_vincular');
  const filteredRows = await page.locator('#carteiraAuditTableBody tr').count();
  assert.equal(filteredRows, 1);
  const filteredText = await page.locator('#carteiraAuditTableBody').innerText();
  assert.ok(filteredText.includes('ASA COMERCIO'));
  assert.ok(!filteredText.includes('AGUIAR PACK'));

  // 5. Vincular envia a origem escolhida
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#btnVincularCarteira').click();
  for (let i = 0; i < 50 && !vincularCalls.length; i++) await page.waitForTimeout(100);
  assert.equal(vincularCalls.length, 1);
  assert.equal(vincularCalls[0].origem, 'mesmo_cargo');
  assert.deepEqual(vincularCalls[0].cnpjs, ['05396572000155']);

  assert.equal(errors.length, 0, `Erros no console da página: ${errors.join(', ')}`);
});
