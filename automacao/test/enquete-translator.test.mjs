import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseClient } from '../lib/tax-engine.mjs';
import { translateDiagnosisToEnquete } from '../lib/enquete-translator.mjs';

test('tradução para empresa Simples Nacional com comércio e pró-labore', () => {
  const diag = diagnoseClient({
    cnpj: '19.402.991/0001-67',
    razaoSocial: 'Comércio Simples',
    uf: 'SP',
    regime: 'simples',
    cnaePrincipal: '4711-3/02',
    operacoes: {
      temProlabore: true,
      temFuncionarios: false
    }
  });

  const answers = translateDiagnosisToEnquete(diag);

  // 01.01: Fixo
  const q0101 = answers.find(a => a.questionRef === '01.01');
  assert.equal(q0101.answerRef, '01.01.01');
  assert.equal(q0101.answerValue, '1');

  // 01.02: Simples
  const q0102 = answers.find(a => a.questionRef === '01.02');
  assert.equal(q0102.answerRef, '01.02.04');
  assert.equal(q0102.answerValue, '9');

  // 02.02: DeSTDA (409)
  const q0202 = answers.find(a => a.questionRef === '02.02' && a.answerValue === '409');
  assert.ok(q0202);
  assert.equal(q0202.answerRef, '02.02.01');

  // 04.01: Folha Somente Pró-Labore (93)
  const q0401 = answers.find(a => a.questionRef === '04.01');
  assert.equal(q0401.answerRef, '04.01.04');
  assert.equal(q0401.answerValue, '93');

  // 03.01: Fechamento Contábil Mensal (364)
  const q0301 = answers.find(a => a.questionRef === '03.01');
  assert.equal(q0301.answerRef, '03.01.01');
  assert.equal(q0301.answerValue, '364');
});

test('tradução para empresa Lucro Presumido com funcionários', () => {
  const diag = diagnoseClient({
    cnpj: '58.291.475/0001-64',
    razaoSocial: 'Consultoria Presumido',
    uf: 'RJ',
    regime: 'presumido',
    cnaePrincipal: '7020-4/00',
    operacoes: {
      temProlabore: true,
      temFuncionarios: true
    }
  });

  const answers = translateDiagnosisToEnquete(diag);

  // 01.02: Lucro Presumido (8)
  const q0102 = answers.find(a => a.questionRef === '01.02');
  assert.equal(q0102.answerRef, '01.02.03');
  assert.equal(q0102.answerValue, '8');

  // 02.01: EFD Reinf Ativo (441)
  const q0201 = answers.find(a => a.questionRef === '02.01' && a.answerValue === '441');
  assert.ok(q0201);

  // 04.01: Folha Mensal (Funcionários e Sócios) (90)
  const q0401 = answers.find(a => a.questionRef === '04.01');
  assert.equal(q0401.answerRef, '04.01.01');
  assert.equal(q0401.answerValue, '90');
});
