import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, suggestTasks } from '../lib/catalog.mjs';
import { validateAnswerMapping } from '../lib/answer-map.mjs';

const rows = [
  { type: 'G', ref: '02', label: 'Dpto. Fiscal/Tributário' },
  { type: 'P', ref: '02.02', label: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 1)' },
  { type: 'R', ref: '02.02.01', label: '409 - DeSTDA' },
  { type: 'P', ref: '02.02.03', label: '383 - DAM' },
  { type: 'P', ref: '02.02.03.01', label: 'Qual a data de entrega desta obrigação: DAM?' },
  { type: 'R', ref: '02.02.03.01.01', label: '385 - DAM (Dia 5)' }
];

test('catálogo cria perguntas e respostas com categoria e código interno', () => {
  const catalog = buildCatalog(rows, '6581', '2026-10-18T12:00:00Z');
  assert.equal(catalog.accountId, '6581');
  assert.equal(catalog.questionCount, 2);
  assert.deepEqual(catalog.questions[0].answers.map(a => [a.ref, a.value, a.display]), [
    ['02.02.01', '409', '01 - DeSTDA'], ['02.02.03', '383', '02 - DAM']
  ]);
  assert.equal(catalog.questions[0].category, 'Dpto. Fiscal/Tributário');
  assert.equal(validateAnswerMapping(rows[1], rows[3], {
    questionRef: '02.02', question: rows[1].label, answerRef: '02.02.03', answerValue: '383', answerLabel: '02 - DAM'
  }), true);
});

test('sugestão de tarefa exige nome exato ou sufixo separado', () => {
  const tasks = ['DeSTDA', 'DeSTDA - Declaração mensal', 'DeSTDA Extra', 'DAS - Mensal'].map(name => ({ name, count: 1 }));
  assert.deepEqual(suggestTasks(tasks, 'DeSTDA').map(t => t.name), ['DeSTDA', 'DeSTDA - Declaração mensal']);
  assert.deepEqual(suggestTasks(tasks, 'Simples'), []);
});

test('catálogo bloqueia referência repetida', () => {
  assert.throws(() => buildCatalog([...rows, rows[2]], '6581'), /duplicada/);
});
