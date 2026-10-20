import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePlan, parseCsv, scopeFromEligible } from '../lib/data.mjs';
import { validateAnswerMapping } from '../lib/answer-map.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rules = JSON.parse(fs.readFileSync(path.join(root, 'regras-destda.json'), 'utf8'));

test('DeSTDA usa a resposta 02.02.01 e checkbox interno 409', () => {
  assert.equal(rules.inputType, 'checkbox');
  assert.equal(validateAnswerMapping(
    { type: 'P', ref: '02.02', label: rules.question },
    { type: 'R', ref: '02.02.01', label: '409 - DeSTDA' }, rules), true);
});

test('somente as duas tarefas DeSTDA explícitas entram no plano', () => {
  const rows = parseCsv('Obrigação / Tarefa,Empresa,EmpID,CNPJ\nDeSTDA - Declaração mensal,A,1,19.402.991/0001-67\nDeSTDA,B,2,63.665.522/0001-22\nDeSTDA - Outro,C,3,58.291.475/0001-64\n');
  assert.equal(scopeFromEligible(rows, rules).scope.length, 2);
  assert.equal(makePlan(rows, ['58291475000164'], rules)[0].status, 'bloqueado');
});
