import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeaderAndSample } from '../lib/source-inspector.mjs';
import { createSuggestedProfile, validateProfileAgainstStructure, normalizeTable } from '../lib/mapping-engine.mjs';

test('server-mapping-flow: fluxo completo de inspeção, geração de perfil, validação e carga', () => {
  const csv = `Cod.,Cliente,Pagto.,Cidade/UF,CNAE principal,Column 17,Data-base 2026\n5,FLORIR COSMETICOS,5,São Bernardo/SP,,574,`;
  const structure = parseHeaderAndSample(csv);

  assert.equal(structure.columnCount, 7);
  assert.equal(structure.columns[0].rawHeader, 'Cod.');
  assert.equal(structure.columns[1].rawHeader, 'Cliente');
  assert.equal(structure.columns[5].rawHeader, 'Column 17');
  assert.equal(structure.columns[5].needsConfirmation, true);

  // 1. Criar perfil sugerido para modelo genérico (consulta)
  const profileGeneric = createSuggestedProfile('2420', 'clientes.csv', 'Clientes', structure, 'generico_consulta');
  const valGeneric = validateProfileAgainstStructure(profileGeneric, structure);
  assert.equal(valGeneric.valid, true);

  // 2. Criar perfil para automação da enquete: deve acusar ausência de tarefa e cnpj
  const profileEnquete = createSuggestedProfile('2420', 'clientes.csv', 'Clientes', structure, 'enquete_automacao');
  const valEnquete = validateProfileAgainstStructure(profileEnquete, structure);
  assert.equal(valEnquete.valid, false);
  assert.ok(valEnquete.errors.some(e => e.includes('tarefa')));

  // 3. Normalizar dados usando perfil genérico
  const table = {
    columns: structure.columns.map(c => c.name),
    rows: [['5', 'FLORIR COSMETICOS', '5', 'São Bernardo/SP', '', '574', '']]
  };
  const normResult = normalizeTable(table, profileGeneric);
  assert.equal(normResult.totalRows, 1);
  assert.equal(normResult.normalizedRows[0]._norm.empresa, 'FLORIR COSMETICOS');
  assert.equal(normResult.audit.isEligibleForEnquete, false);
});

test('server-mapping-flow: perfil com Cod. (empId) e tarefa é válido para enquete_automacao sem exigir CNPJ', () => {
  const csv = `Cod.,Cliente,Descrição da enquete,Cód. Enquete\n5,FLORIR COSMETICOS,COM X SINCOMERCIO,574`;
  const structure = parseHeaderAndSample(csv);
  const profileEnquete = createSuggestedProfile('2420', 'clientes.csv', 'Clientes', structure, 'enquete_automacao');
  const val = validateProfileAgainstStructure(profileEnquete, structure);
  assert.equal(val.valid, true);

  const table = {
    columns: structure.columns.map(c => c.name),
    rows: [['5', 'FLORIR COSMETICOS', 'COM X SINCOMERCIO', '574']]
  };
  const normResult = normalizeTable(table, profileEnquete);
  assert.equal(normResult.audit.isEligibleForEnquete, true);
  assert.equal(normResult.normalizedRows[0]._norm.empId, '5');
  assert.equal(normResult.normalizedRows[0]._norm.cod, '5');
  assert.equal(normResult.normalizedRows[0]._norm.tarefa, 'COM X SINCOMERCIO');
  assert.equal(normResult.normalizedRows[0]._norm.resposta, '574');
});

test('server-mapping-flow: auto-matching associa respostas por código interno e nome exato', async () => {
  const catalog = {
    questions: [
      {
        ref: '04.06',
        answers: [
          { ref: '04.06.01', label: 'COM X SINCOMERCIO', display: 'COM X SINCOMERCIO', value: '580' },
          { ref: '04.06.13', label: 'COMERCIÁRIOS X SINCOPEÇAS', display: 'COMERCIÁRIOS X SINCOPEÇAS', value: '590' }
        ]
      }
    ]
  };

  // Simula findAutoMatch
  const normTask = value => String(value ?? '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  function findAutoMatch(task, taskRows, cat) {
    const codeVal = taskRows.find(r => r._norm?.resposta)?._norm?.resposta;
    if (codeVal) {
      for (const q of cat.questions) {
        for (const a of q.answers) {
          if (String(a.value ?? '').trim() === String(codeVal).trim()) return { question: q, answer: a, matchBy: 'code' };
        }
      }
    }
    const nt = normTask(task);
    const matches = [];
    for (const q of cat.questions) {
      for (const a of q.answers) {
        if (normTask(a.label) === nt || normTask(a.display) === nt) matches.push({ question: q, answer: a });
      }
    }
    if (matches.length === 1) return { question: matches[0].question, answer: matches[0].answer, matchBy: 'exact_name' };
    return null;
  }

  // 1. Match por código interno (ex: 590 -> COMERCIÁRIOS X SINCOPEÇAS)
  const matchByCode = findAutoMatch('Qualquer Nome', [{ _norm: { resposta: '590' } }], catalog);
  assert.ok(matchByCode);
  assert.equal(matchByCode.answer.ref, '04.06.13');
  assert.equal(matchByCode.answer.value, '590');
  assert.equal(matchByCode.matchBy, 'code');

  // 2. Match por nome exato (ex: COM X SINCOMERCIO -> 04.06.01)
  const matchByName = findAutoMatch('COM X SINCOMERCIO', [], catalog);
  assert.ok(matchByName);
  assert.equal(matchByName.answer.ref, '04.06.01');
  assert.equal(matchByName.matchBy, 'exact_name');
});

