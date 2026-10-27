import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

const mockObrigacoes = [
  {
    indice: 1,
    id: 8,
    coid: 4,
    departamento: 'Contabilidade',
    nome: 'CSLL e IRPJ - LR (Trimestral) *',
    frequencia: 'Trimestral',
    diaVencimento: '30',
    fatoGerador: 'Mesmo mês',
    orgao: 'Federal',
    status: 'Ativo',
    atividades: [
      { ordem: 1, tipo: 'C', texto: 'Apurar' },
      { ordem: 2, tipo: 'E', texto: 'Enviar e-mail' }
    ]
  },
  {
    indice: 2,
    id: 9,
    coid: 4,
    departamento: 'Fiscal',
    nome: 'DAS SIMPLES *',
    frequencia: 'Mensal',
    diaVencimento: '20',
    fatoGerador: 'Mês anterior',
    orgao: 'Federal',
    status: 'Ativo',
    atividades: [
      { ordem: 1, tipo: 'E', texto: 'Enviar e-mail' },
      { ordem: 2, tipo: '16', texto: 'Disparar WhatsApp' }
    ]
  }
];

test('ui-obrigacoes: renderiza catálogo, aplica busca, abre modal e insere tags dinâmicas', async () => {
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
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.route('**/api/config', route => route.fulfill({
      json: {
        token: 'test',
        accounts: ['6581'],
        savedMappings: [],
        savedProfiles: [],
        targetModels: [],
        availableFields: [],
        catalogLive: true,
        loginReady: true,
        user: { id: 1, nome: 'Admin' }
      }
    }));
    await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: { tasks: [] } }));

    // Mock das rotas de obrigações
    await page.route('**/api/obrigacoes/catalog', route => route.fulfill({
      json: { accountId: '6581', items: mockObrigacoes, total: mockObrigacoes.length, source: 'file', live: true }
    }));
    await page.route('**/api/obrigacoes/audit', route => route.fulfill({
      json: {
        accountId: '6581',
        total: 2,
        conforme: 1,
        pendenteWhatsapp: 1,
        pendenteEmail: 0,
        semDisparo: 0,
        items: [
          { id: 8, paridade: { status: 'pendente_whatsapp', hasEmail: true, hasWhatsapp: false } },
          { id: 9, paridade: { status: 'conforme', hasEmail: true, hasWhatsapp: true } }
        ]
      }
    }));
    await page.route('**/api/obrigacoes/templates', route => route.fulfill({
      json: {
        accountId: '6581',
        templates: {
          whatsapp: { habilitado: true, texto: 'Aviso [obrigacao.nome]', particularidadeId: '539' },
          email: { assunto: '[obrigacao.nome]', texto: 'Corpo [obrigacao.nome]' }
        }
      }
    }));

    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('#sidebarNav') !== null);

    // 1. Clicar no menu de Obrigações
    await page.locator('#navObrigacoes').click();

    // 2. Verificar visibilidade da seção
    assert.equal(await page.locator('#section-obrigacoes').isVisible(), true);
    assert.equal(await page.locator('#section-connection').isVisible(), false);

    // 3. Verificar cards de métricas
    await page.waitForFunction(() => document.querySelector('#obrigMetricTotal')?.textContent === '2');
    assert.equal(await page.locator('#obrigMetricTotal').innerText(), '2');
    assert.equal(await page.locator('#obrigMetricConforme').innerText(), '1');
    assert.equal(await page.locator('#obrigMetricPendente').innerText(), '1');

    // 4. Verificar linhas da tabela
    const rows = await page.locator('#obrigacoesTableBody tr').count();
    assert.equal(rows, 2);

    // 5. Testar busca rápida
    await page.locator('#obrigSearchInput').fill('DAS SIMPLES');
    await page.waitForTimeout(100);
    const rowsFiltered = await page.locator('#obrigacoesTableBody tr').count();
    assert.equal(rowsFiltered, 1);
    assert.match(await page.locator('#obrigacoesTableBody').innerText(), /DAS SIMPLES/);

    // Limpar busca
    await page.locator('#obrigSearchInput').fill('');
    await page.waitForTimeout(100);

    // 6. Testar abertura do modal de templates
    assert.equal(await page.locator('#modalObrigTemplates').isVisible(), false);
    await page.locator('#btnOpenObrigTemplates').click();
    await page.waitForSelector('#modalObrigTemplates', { state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('#modalObrigTemplates').isVisible(), true);

    // 7. Testar inserção de tag dinâmica
    const textarea = page.locator('#tmplWhatsappTexto');
    await textarea.click();
    await page.locator('button[data-tag="[cliente.apelido]"]').click();
    const val = await textarea.inputValue();
    assert.match(val, /\[cliente\.apelido\]/);

    // 8. Testar fechamento do modal
    await page.locator('#btnCloseObrigTemplates').click();
    assert.equal(await page.locator('#modalObrigTemplates').isVisible(), false);

    // 9. Testar Barra de Ação em Massa e bloqueio sem departamento
    assert.equal(await page.locator('#btnOpenBatchEmailModal').isDisabled(), true);
    assert.equal(await page.locator('#obrigBatchDeptoWarning').isVisible(), true);

    // 10. Selecionar Departamento 'Contabilidade'
    await page.locator('#obrigDeptoFilter').selectOption('Contabilidade');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#obrigBatchDeptoWarning').isVisible(), false);
    // Ainda desabilitado pois 0 obrigações selecionadas
    assert.equal(await page.locator('#btnOpenBatchEmailModal').isDisabled(), true);

    // 11. Marcar checkbox da obrigação filtrada (#8)
    const rowCheck = page.locator('.obrig-row-check[data-id="8"]');
    assert.equal(await rowCheck.count(), 1);
    await rowCheck.check();
    await page.waitForTimeout(100);

    // Agora deve estar habilitado com '1 obrigação(ões) selecionada(s)'
    assert.match(await page.locator('#obrigBatchCountText').innerText(), /1 obrigação/);
    assert.equal(await page.locator('#btnOpenBatchEmailModal').isDisabled(), false);

    // 12. Abrir Modal de E-mail em Massa
    await page.route('**/api/obrigacoes/email-inspect', route => route.fulfill({
      json: {
        success: true,
        categoriasDisponiveis: [{ value: '3', label: 'Contábil' }, { value: '2', label: 'Fiscal' }],
        categoriasSelecionadas: [],
        assunto: '[obrigacao.nome] - [tarefa.competencia]',
        corpoTexto: 'Olá [cliente.apelido]',
        automacao: '1',
        tipoCancelamento: '1',
        tiposCancelamentoDisponiveis: [
          { value: '0', label: 'Sem justificativa' },
          { value: '1', label: 'Com justificativa' }
        ],
        particularidadesDisponiveis: [
          { value: '543', label: 'Qualificação: 543 - E-mail' }
        ],
        particularidadeAtual: '543'
      }
    }));

    await page.locator('#btnOpenBatchEmailModal').click();
    await page.waitForSelector('#modalBatchEmail', { state: 'visible', timeout: 3000 });
    assert.equal(await page.locator('#modalBatchEmail').isVisible(), true);
    assert.equal(await page.locator('#batchEmailDeptoBadge').innerText(), 'Contabilidade');

    // Fechar modal em massa
    await page.locator('#btnCloseBatchEmail').click();
    assert.equal(await page.locator('#modalBatchEmail').isVisible(), false);

    assert.equal(errors.length, 0, `Erros na página: ${errors.join(', ')}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
