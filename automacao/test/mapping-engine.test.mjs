import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHeaderAndSample } from '../lib/source-inspector.mjs';
import { parseCsvTable } from '../lib/data.mjs';
import {
  TARGET_MODELS,
  createSuggestedProfile,
  validateProfileAgainstStructure,
  normalizeTable
} from '../lib/mapping-engine.mjs';

test('mapping-engine: sugere perfil inicial e valida correspondência com estrutura', () => {
  const csv = `Empresa,Obrigação / Tarefa,CNPJ\nPadaria 1,DAS - Mensal,12.345.678/0001-90`;
  const structure = parseHeaderAndSample(csv);
  const profile = createSuggestedProfile('6581', 'planilha.csv', 'Aba1', structure, 'enquete_automacao');

  assert.equal(profile.accountId, '6581');
  assert.equal(profile.columns.length, 3);
  assert.equal(profile.columns[0].targetField, 'empresa');
  assert.equal(profile.columns[1].targetField, 'tarefa');
  assert.equal(profile.columns[2].targetField, 'cnpj');

  const val = validateProfileAgainstStructure(profile, structure);
  assert.equal(val.valid, true);
  assert.equal(val.errors.length, 0);
});

test('mapping-engine: rejeita perfil para automação da enquete se faltar campo obrigatório', () => {
  const csv = `Empresa,Valor\nPadaria 1,100`;
  const structure = parseHeaderAndSample(csv);
  const profile = createSuggestedProfile('6581', 'planilha.csv', 'Aba1', structure, 'enquete_automacao');

  const val = validateProfileAgainstStructure(profile, structure);
  assert.equal(val.valid, false);
  assert.ok(val.errors.some(e => e.includes('tarefa')));
  assert.ok(val.errors.some(e => e.toLowerCase().includes('cnpj') || e.includes('identificador')));
});

test('mapping-engine: aceita perfil sem tarefa se o modelo for generico_consulta', () => {
  const csv = `Empresa,Valor\nPadaria 1,100`;
  const structure = parseHeaderAndSample(csv);
  const profile = createSuggestedProfile('6581', 'planilha.csv', 'Aba1', structure, 'generico_consulta');

  const val = validateProfileAgainstStructure(profile, structure);
  assert.equal(val.valid, true);
});

test('mapping-engine: normaliza tabela Clientes.csv preservando dados brutos e gerando auditoria', async () => {
  const path = '/home/piperun/Documentos/temp/G-click/HoraSync - Registro de Horas (2026) - Clientes.csv';
  const content = await fs.readFile(path, 'utf8');
  const structure = parseHeaderAndSample(content);
  const table = parseCsvTable(content);

  // Perfil para clientes (generico_consulta)
  const profile = createSuggestedProfile('2420', 'Clientes.csv', 'Clientes', structure, 'generico_consulta');

  const result = normalizeTable(table, profile);
  assert.equal(result.totalRows, 50);
  assert.equal(result.audit.totalRows, 50);
  assert.equal(result.audit.isEligibleForEnquete, false);

  // Checa primeira linha
  const first = result.normalizedRows[0];
  assert.equal(first._norm.empresa, 'FLORIR COSMETICOS E PERFUMES LTDA');
  assert.equal(first._norm.cod, '5');
  assert.equal(first._raw['Cliente'], 'FLORIR COSMETICOS E PERFUMES LTDA');
});

test('mapping-engine: aceita planilha com apenas CNPJ e Obrigação (sem coluna Empresa) para enquete_automacao', () => {
  const csv = `CNPJ,Obrigação\n62.671.979/0001-87,DIPAM\n53.635.272/0001-24,DIPAM`;
  const structure = parseHeaderAndSample(csv);
  const profile = createSuggestedProfile('4556', 'dipam.csv', 'Aba1', structure, 'enquete_automacao');

  assert.equal(profile.columns.length, 2);
  assert.equal(profile.columns[0].targetField, 'cnpj');
  assert.equal(profile.columns[1].targetField, 'tarefa');

  const val = validateProfileAgainstStructure(profile, structure);
  assert.equal(val.valid, true);
  assert.equal(val.errors.length, 0);

  const table = parseCsvTable(csv);
  const result = normalizeTable(table, profile);
  assert.equal(result.totalRows, 2);
  assert.equal(result.audit.isEligibleForEnquete, true);
  assert.equal(result.normalizedRows[0]._norm.tarefa, 'DIPAM');
  assert.equal(result.normalizedRows[0]._norm.cnpj, '62671979000187');
});

