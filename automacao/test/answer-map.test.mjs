import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswerMapping } from '../lib/answer-map.mjs';

const rules = {
  questionRef: '01.02', question: 'Qual é o atual Regime Tributário desta empresa?',
  answerRef: '01.02.04', answerValue: '9', answerLabel: '04 - Simples'
};
const question = { type: 'P', ref: '01.02', label: 'Qual é o atual Regime Tributário desta empresa?' };
const answer = { type: 'R', ref: '01.02.04', label: '9 - Simples' };

test('aceita referência, valor e texto reais sem confundir ordinal com valor', () => {
  assert.equal(validateAnswerMapping(question, answer, rules), true);
});
test('bloqueia referência de outra resposta', () => {
  assert.throws(() => validateAnswerMapping(question, answer, { ...rules, answerRef: '01.02.05' }), /Resposta e referência/);
});
test('bloqueia valor interno incorreto', () => {
  assert.throws(() => validateAnswerMapping(question, answer, { ...rules, answerValue: '10' }), /Valor interno/);
});
test('bloqueia texto incorreto', () => {
  assert.throws(() => validateAnswerMapping(question, answer, { ...rules, answerLabel: '04 - Imune' }), /Texto da resposta/);
});
