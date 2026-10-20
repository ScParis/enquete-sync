const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

export function validateAnswerMapping(questionRow, answerRow, rules) {
  if (!rules.answerRef?.startsWith(`${rules.questionRef}.`) ||
      rules.answerRef.split('.').length !== rules.questionRef.split('.').length + 1)
    throw new Error('A referência da resposta não pertence à pergunta informada');
  if (!questionRow || questionRow.ref !== rules.questionRef || questionRow.type !== 'P' ||
      normalize(questionRow.label) !== normalize(rules.question))
    throw new Error('Pergunta e referência não conferem na aba Enquete');
  if (!answerRow || answerRow.ref !== rules.answerRef || !['R', 'P'].includes(answerRow.type))
    throw new Error('Resposta e referência não conferem na aba Enquete');
  const configured = String(answerRow.label).trim().match(/^(\d+)\s*-\s*(.+)$/);
  if (configured) {
    if (configured[1] !== String(rules.answerValue))
      throw new Error('Valor interno da resposta não confere com a referência na aba Enquete');
    const expectedLabel = String(rules.answerLabel ?? '').replace(/^\d+\s*-\s*/, '');
    if (!expectedLabel.trim() || normalize(configured[2]) !== normalize(expectedLabel))
      throw new Error('Texto da resposta não confere com a referência na aba Enquete');
  } else {
    const expectedLabel = String(rules.answerLabel ?? '').replace(/^\d+\s*-\s*/, '');
    if (!expectedLabel.trim() || normalize(answerRow.label) !== normalize(expectedLabel))
      throw new Error('Texto da resposta não confere com a referência na aba Enquete');
  }
  return true;
}
