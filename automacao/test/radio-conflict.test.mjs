import test from 'node:test';
import assert from 'node:assert/strict';

test('detecta e bloqueia cliente com tarefas conflitantes em pergunta de escolha única', () => {
  const mappings = [
    { task: 'ISS Retido', rules: { questionRef: '02.07', answerRef: '02.07.01', inputType: 'radio' } },
    { task: 'ISS Próprio', rules: { questionRef: '02.07', answerRef: '02.07.03', inputType: 'radio' } },
    { task: 'GIA-ST', rules: { questionRef: '02.03', answerRef: '02.03.08', inputType: 'checkbox' } }
  ];

  const inspected = [
    { cnpj: '19.402.991/0001-67', mappingTask: 'ISS Retido', uiStatus: 'vazio' },
    { cnpj: '19.402.991/0001-67', mappingTask: 'ISS Próprio', uiStatus: 'vazio' },
    { cnpj: '63.665.522/0001-22', mappingTask: 'ISS Retido', uiStatus: 'vazio' },
    { cnpj: '19.402.991/0001-67', mappingTask: 'GIA-ST', uiStatus: 'vazio' }
  ];

  const radioQuestions = new Set(mappings.filter(m => m.rules.inputType === 'radio').map(m => m.rules.questionRef));
  assert.equal(radioQuestions.size, 1);

  const byCnpjQuestion = new Map();
  for (const item of inspected) {
    const rules = mappings.find(m => m.task === item.mappingTask)?.rules;
    if (!rules || rules.inputType !== 'radio') continue;
    const key = `${item.cnpj}|${rules.questionRef}`;
    const list = byCnpjQuestion.get(key) ?? [];
    list.push({ item, rules });
    byCnpjQuestion.set(key, list);
  }

  for (const [, entries] of byCnpjQuestion) {
    const distinctAnswers = new Set(entries.map(e => e.rules.answerRef));
    if (distinctAnswers.size > 1) {
      const taskNames = [...new Set(entries.map(e => `“${e.item.mappingTask}”`))].join(' e ');
      for (const { item, rules } of entries) {
        item.uiStatus = 'bloqueado';
        item.uiReason = `Conflito: ${taskNames} exigem respostas diferentes na pergunta ${rules.questionRef} (escolha única)`;
      }
    }
  }

  // Cliente 19.402.991/0001-67 tem duas tarefas de ISS (radio) diferentes: deve ser bloqueado
  const c1IssRetido = inspected.find(x => x.cnpj === '19.402.991/0001-67' && x.mappingTask === 'ISS Retido');
  const c1IssProprio = inspected.find(x => x.cnpj === '19.402.991/0001-67' && x.mappingTask === 'ISS Próprio');
  assert.equal(c1IssRetido.uiStatus, 'bloqueado');
  assert.match(c1IssRetido.uiReason, /Conflito: “ISS Retido” e “ISS Próprio” exigem respostas diferentes/);
  assert.equal(c1IssProprio.uiStatus, 'bloqueado');

  // Mesma empresa para GIA-ST (checkbox) não é afetada
  const c1Gia = inspected.find(x => x.cnpj === '19.402.991/0001-67' && x.mappingTask === 'GIA-ST');
  assert.equal(c1Gia.uiStatus, 'vazio');

  // Outro cliente com apenas uma tarefa de ISS continua vazio (a marcar)
  const c2IssRetido = inspected.find(x => x.cnpj === '63.665.522/0001-22' && x.mappingTask === 'ISS Retido');
  assert.equal(c2IssRetido.uiStatus, 'vazio');
});
