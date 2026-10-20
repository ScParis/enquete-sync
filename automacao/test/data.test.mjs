import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, makePlan, validCnpj } from '../lib/data.mjs';
const rules = { allowedTasks: ['DAS - Mensal', 'DAS - Mensal - Sem Movimento'], excludedTasks: ['DAS - Mensal - CDB'], questionRef: '01.02', answerLabel: '04 - Simples' };
test('CSV com aspas, vírgula e quebras de linha', () => {
  const rows = parseCsv('Obrigação / Tarefa,Empresa,EmpID,CNPJ\r\nDAS - Mensal,"Empresa, LTDA",887,19.402.991/0001-67\r\n');
  assert.equal(rows[0].Empresa, 'Empresa, LTDA'); assert.equal(rows[0]._row, 2);
});
test('CSV com ponto e vírgula (formato Excel Brasil)', () => {
  const rows = parseCsv('Obrigação / Tarefa;Empresa;EmpID;CNPJ\r\nDAS - Mensal;Empresa Teste;887;19.402.991/0001-67\r\n');
  assert.equal(rows[0].Empresa, 'Empresa Teste'); assert.equal(rows[0].EmpID, '887');
});
test('somente tarefa exata é elegível', () => {
  const rows = parseCsv('Obrigação / Tarefa,Empresa,EmpID,CNPJ\nDAS - Mensal - CDB,A,1,19.402.991/0001-67\n');
  assert.equal(makePlan(rows, ['19402991000167'], rules)[0].status, 'bloqueado');
  rows.push({ ...rows[0], 'Obrigação / Tarefa': 'DAS - Mensal', _row: 3 });
  assert.equal(makePlan(rows, ['19402991000167'], rules)[0].status, 'pronto');
});
test('CNPJ válido e inválido', () => {
  assert.equal(validCnpj('19.402.991/0001-67'), true);
  assert.equal(validCnpj('19.402.991/0001-68'), false);
});
