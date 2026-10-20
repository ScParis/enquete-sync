import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, findByLabels } from '../lib/catalog.mjs';

test('catálogo indica respostas sem código interno e localiza a mesma resposta em outro escritório pelo texto', () => {
  const rows = [
    { type: 'G', ref: '02', label: 'Dpto. Fiscal' },
    { type: 'P', ref: '02.03', label: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)' },
    { type: 'R', ref: '02.03.07', label: '445 - LFE - DF' },
    { type: 'P', ref: '02.03.08', label: 'GIA ST' }
  ];
  const office = buildCatalog(rows, '7000');
  const [lfe, gia] = office.questions[0].answers;
  assert.equal(lfe.valueKnown, true);
  assert.equal(gia.valueKnown, false);
  // Outro escritório com outra numeração: a pergunta e a resposta são reconhecidas pelo texto.
  const other = buildCatalog([{ type: 'G', ref: '03', label: 'Fiscal' }, { type: 'P', ref: '03.01', label: 'Qual dessas obrigações estaduais são entregues para esse cliente ? (Part 2)' },
    { type: 'R', ref: '03.01.02', label: '812 - GIA ST' }], '8000');
  const found = findByLabels(other, 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)', 'GIA ST');
  assert.equal(found.length, 1);
  assert.equal(found[0].answer.ref, '03.01.02');
  assert.deepEqual(findByLabels(other, 'Outra pergunta', 'GIA ST'), []);
});
