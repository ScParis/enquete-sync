import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHeaderAndSample } from '../lib/source-inspector.mjs';
import { parseCsvTable, makePlan, scopeFromEligible } from '../lib/data.mjs';
import {
  TARGET_MODELS,
  createSuggestedProfile,
  validateProfileAgainstStructure,
  normalizeTable
} from '../lib/mapping-engine.mjs';

test('Critério 1: CSV Clientes permite mapear 20 colunas e consultar 50 registros mesmo sem Obrigação/Tarefa', async () => {
  const path = '/home/piperun/Documentos/temp/G-click/HoraSync - Registro de Horas (2026) - Clientes.csv';
  const content = await fs.readFile(path, 'utf8');

  // Inspeciona estrutura
  const structure = parseHeaderAndSample(content);
  assert.equal(structure.columnCount, 20);
  assert.equal(structure.totalRows, 50);

  // Mapeia para consulta / tabela geral
  const profile = createSuggestedProfile('2420', 'Clientes.csv', 'Clientes', structure, 'generico_consulta');
  const table = parseCsvTable(content);
  const result = normalizeTable(table, profile);

  assert.equal(result.totalRows, 50);
  assert.equal(result.normalizedRows.length, 50);
  assert.equal(result.audit.isEligibleForEnquete, false);

  // Todos os dados originais foram preservados
  assert.equal(result.normalizedRows[0]._raw['Cliente'], 'FLORIR COSMETICOS E PERFUMES LTDA');
  assert.equal(result.normalizedRows[49]._raw['Cliente'], 'DOMESTICAS');
});

test('Critério 2: Perfil distingue colunas com mesmo nome pela posição e avisa quando cabeçalho mudar', () => {
  const csvOriginal = `Status,Valor,Status\nAtivo,100,Pendente`;
  const structure = parseHeaderAndSample(csvOriginal);

  assert.equal(structure.columns[0].isDuplicate, false);
  assert.equal(structure.columns[0].position, 1);
  assert.equal(structure.columns[2].isDuplicate, true);
  assert.equal(structure.columns[2].position, 3);

  const profile = createSuggestedProfile('6581', 'planilha.csv', 'Aba1', structure, 'generico_consulta');
  assert.equal(profile.columns[0].sourceIndex, 0);
  assert.equal(profile.columns[2].sourceIndex, 2);

  // Altera cabeçalho na coluna 3
  const csvModificado = `Status,Valor,Situacao\nAtivo,100,Pendente`;
  const structureModificada = parseHeaderAndSample(csvModificado);

  const val = validateProfileAgainstStructure(profile, structureModificada);
  assert.equal(val.valid, true);
  assert.ok(val.warnings.some(w => w.includes('Coluna 3') || w.includes('Situacao')));
});

test('Critério 3: Aba sem campos de obrigações pode ser importada mas bloqueia conferência e gravação', async () => {
  const path = '/home/piperun/Documentos/temp/G-click/HoraSync - Registro de Horas (2026) - Clientes.csv';
  const content = await fs.readFile(path, 'utf8');
  const structure = parseHeaderAndSample(content);
  const profile = createSuggestedProfile('2420', 'Clientes.csv', 'Clientes', structure, 'generico_consulta');

  // Validação para Enquete deve falhar
  const valEnquete = validateProfileAgainstStructure({ ...profile, targetModel: 'enquete_automacao' }, structure);
  assert.equal(valEnquete.valid, false);
  assert.ok(valEnquete.errors.some(e => e.includes('tarefa')));

  // Tentativa de makePlan sem tarefa deve lançar erro
  const table = parseCsvTable(content);
  const norm = normalizeTable(table, profile);
  assert.throws(() => {
    makePlan(norm.normalizedRows, ['12345678000190'], { allowedTasks: ['DAS'], excludedTasks: [] });
  }, /Planilha sem colunas obrigatórias/);
});

test('Critério 4: Planilha no formato atual de obrigações continua funcionando com perfil compatível', () => {
  const csv = `Empresa,Obrigação / Tarefa,EmpID,CNPJ\nPadaria ABC,DAS - Mensal,6581,12.345.678/0001-90`;
  const structure = parseHeaderAndSample(csv);
  const profile = createSuggestedProfile('6581', 'obrigacoes.csv', 'Aba1', structure, 'enquete_automacao');

  const val = validateProfileAgainstStructure(profile, structure);
  assert.equal(val.valid, true);

  const table = parseCsvTable(csv);
  const norm = normalizeTable(table, profile);
  assert.equal(norm.audit.isEligibleForEnquete, true);

  const plan = makePlan(norm.normalizedRows, ['12345678000190'], { allowedTasks: ['DAS - Mensal'], excludedTasks: [] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].status, 'pronto');
  assert.equal(plan[0].empresa, 'Padaria ABC');
});

test('Critério 6: Nenhuma sugestão ambígua é confirmada automaticamente sem validação', () => {
  const csv = `Cod.,Cliente,Column 17,Column 18\n5,Empresa 1,574,COM`;
  const structure = parseHeaderAndSample(csv);

  const colCod = structure.columns.find(c => c.rawHeader === 'Cod.');
  assert.equal(colCod.needsConfirmation, true);

  const col17 = structure.columns.find(c => c.rawHeader === 'Column 17');
  assert.equal(col17.needsConfirmation, true);

  const profile = createSuggestedProfile('2420', 'file.csv', 'Aba', structure, 'enquete_automacao');
  const profCod = profile.columns.find(c => c.sourceName === 'Cod.');
  assert.equal(profCod.userConfirmed, false);
});

test('Critério 7: Clientes sem CNPJ preenchido são identificados por Cod. (Coluna A / empId) na auditoria e no plano', async () => {
  const { chromium } = await import('playwright');
  const { inspectClient } = await import('../lib/gclick.mjs');
  const path = '/home/piperun/Documentos/temp/G-click/HoraSync - Registro de Horas (2026) - Clientes.csv';
  const content = await fs.readFile(path, 'utf8');
  const table = parseCsvTable(content);

  // Perfil mapeando Cod. -> cod/empId, Cliente -> empresa, Column 18 -> tarefa, Column 17 -> resposta
  const profile = {
    targetModel: 'enquete_automacao',
    columns: [
      { sourceIndex: 0, sourceName: 'Cod.', action: 'map', targetField: 'cod', transform: 'trim_texto' },
      { sourceIndex: 1, sourceName: 'Cliente', action: 'map', targetField: 'empresa', transform: 'trim_texto' },
      { sourceIndex: 5, sourceName: 'Column 17', action: 'map', targetField: 'resposta', transform: 'trim_texto' },
      { sourceIndex: 7, sourceName: 'Column 18', action: 'map', targetField: 'tarefa', transform: 'trim_texto' }
    ]
  };

  const norm = normalizeTable(table, profile);
  assert.equal(norm.audit.isEligibleForEnquete, true);
  assert.equal(norm.normalizedRows[0]._norm.empId, '5');
  assert.equal(norm.normalizedRows[0]._norm.cod, '5');
  assert.equal(norm.normalizedRows[0]._norm.empresa, 'FLORIR COSMETICOS E PERFUMES LTDA');
  assert.equal(norm.normalizedRows[0]._norm.tarefa, 'COM X SINCOMERCIO');

  // Gera escopo e plano para tarefa COM X SINCOMERCIO
  const { scope, invalid } = scopeFromEligible(norm.normalizedRows, { allowedTasks: ['COM X SINCOMERCIO'] });
  assert.ok(scope.includes('id:5'));
  assert.ok(scope.includes('id:22'));
  assert.ok(scope.includes('id:85'));

  const plan = makePlan(norm.normalizedRows, scope, { allowedTasks: ['COM X SINCOMERCIO'], excludedTasks: [] });
  assert.ok(plan.length >= 3);
  const item5 = plan.find(p => p.empId === '5');
  assert.ok(item5);
  assert.equal(item5.status, 'pronto');
  assert.equal(item5.empresa, 'FLORIR COSMETICOS E PERFUMES LTDA');
  assert.equal(item5.cnpj, 'ID 5');

  // Testa inspeção no Playwright onde G-Click renderiza o link com o ID 5
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<table><tbody><tr><td><a>FLORIR COSMETICOS 5</a></td><td><input type="radio" name="999-04.06" value="574"></td></tr></tbody></table>');
    const rules = { questionRef: '04.06', answerValue: '574', inputType: 'radio' };
    const inspected = await inspectClient(page, item5, rules);
    assert.equal(inspected.uiStatus, 'vazio');
    assert.equal(inspected.internalId, '999');
  } finally {
    await browser.close();
  }
});

test('Critério 8: Cliente VORDELLI (ID 173, CNPJ 67.022.855/0001-94) com resposta marcada aparece como ja_correto na auditoria', async () => {
  const { chromium } = await import('playwright');
  const { inspectClient } = await import('../lib/gclick.mjs');
  const path = '/home/piperun/Documentos/temp/G-click/HoraSync - Registro de Horas (2026) - Clientes.csv';
  const content = await fs.readFile(path, 'utf8');
  const table = parseCsvTable(content);

  const profile = {
    targetModel: 'enquete_automacao',
    columns: [
      { sourceIndex: 0, sourceName: 'Cod.', action: 'map', targetField: 'cod', transform: 'trim_texto' },
      { sourceIndex: 1, sourceName: 'Cliente', action: 'map', targetField: 'empresa', transform: 'trim_texto' },
      { sourceIndex: 5, sourceName: 'Column 17', action: 'map', targetField: 'resposta', transform: 'trim_texto' },
      { sourceIndex: 7, sourceName: 'Column 18', action: 'map', targetField: 'tarefa', transform: 'trim_texto' }
    ]
  };

  const norm = normalizeTable(table, profile);
  const vordelliRow = norm.normalizedRows.find(r => r._norm.cod === '173' || r._norm.empresa?.includes('VORDELLI'));
  assert.ok(vordelliRow, 'Linha do VORDELLI deve existir na planilha');
  assert.equal(vordelliRow._norm.tarefa, 'COMERCIÁRIOS X SINCOPEÇAS');
  assert.equal(vordelliRow._norm.resposta, '590');
  assert.equal(vordelliRow._norm.cod, '173');

  const { scope } = scopeFromEligible(norm.normalizedRows, { allowedTasks: ['COMERCIÁRIOS X SINCOPEÇAS'] });
  assert.ok(scope.includes('id:173'));

  const plan = makePlan(norm.normalizedRows, scope, { allowedTasks: ['COMERCIÁRIOS X SINCOPEÇAS'], excludedTasks: [] });
  const itemVordelli = plan.find(p => p.empId === '173' || p.cod === '173');
  assert.ok(itemVordelli);
  assert.equal(itemVordelli.status, 'pronto');
  assert.equal(itemVordelli.cnpj, 'ID 173');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    // HTML simulando linha do G-Click com o checkbox marcado (como na imagem enviada pelo usuário)
    await page.setContent(`
      <table>
        <tbody>
          <tr>
            <td><a>VORDELLI CENTRO AUTOMOTIVO LTDA 173</a></td>
            <td>67.022.855/0001-94</td>
            <td>
              <input type="checkbox" id="cb.4455-590" value="590" checked>
            </td>
          </tr>
        </tbody>
      </table>
    `);
    const rules = {
      accountId: '2420',
      questionRef: '04.06',
      answerRef: '04.06.13',
      answerValue: '590',
      inputType: 'checkbox'
    };
    const inspected = await inspectClient(page, itemVordelli, rules);
    assert.equal(inspected.uiStatus, 'ja_correto');
    assert.equal(inspected.internalId, '4455');
    assert.equal(inspected.currentValue, '590');
    assert.equal(inspected.cnpj, '67.022.855/0001-94');
  } finally {
    await browser.close();
  }
});

