const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const directChild = (parent, child) => child.startsWith(`${parent}.`) && child.split('.').length === parent.split('.').length + 1;

export function buildCatalog(rows, accountId, capturedAt = new Date().toISOString()) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('A aba Enquete não retornou perguntas');
  const seen = new Set();
  const entries = rows.map(row => ({ type: compact(row.type), ref: compact(row.ref), label: compact(row.label) }));
  for (const row of entries) {
    if (!['G', 'P', 'R'].includes(row.type) || !/^\d+(?:\.\d+)*$/.test(row.ref) || !row.label)
      throw new Error(`Linha inválida no catálogo da Enquete: ${JSON.stringify(row)}`);
    if (seen.has(row.ref)) throw new Error(`Referência duplicada na Enquete: ${row.ref}`);
    seen.add(row.ref);
  }
  const groups = new Map(entries.filter(row => row.type === 'G').map(row => [row.ref, row.label]));
  const isSubQuestion = label => /^(?:Qual|Quando|Como|Informe|Selecione)\b|\?$/i.test(label);
  const questions = entries.filter(row => row.type === 'P').map(row => {
    const children = entries.filter(child => directChild(row.ref, child.ref) && (child.type === 'R' || (child.type === 'P' && !isSubQuestion(child.label))));
    const answers = children.map((child, index) => {
      const match = child.label.match(/^(\d+)\s*-\s*(.+)$/);
      const val = match ? match[1] : child.ref.split('.').pop();
      const lab = match ? match[2] : child.label;
      const displayOrdinal = String(index + 1).padStart(2, '0');
      return { ref: child.ref, value: val, label: lab, display: `${displayOrdinal} - ${lab}`, type: child.type };
    });
    return { ref: row.ref, label: row.label, category: groups.get(row.ref.split('.')[0]) ?? 'Sem categoria', answers };
  }).filter(question => question.answers.length);
  if (!questions.length) throw new Error('Nenhuma pergunta com respostas encontrada na Enquete');
  return { accountId: String(accountId), capturedAt, rowCount: entries.length, questionCount: questions.length,
    answerCount: questions.reduce((sum, q) => sum + q.answers.length, 0), questions };
}

export function suggestTasks(tasks, answerLabel) {
  const normalize = value => compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const target = normalize(answerLabel);
  if (!target) return [];
  return tasks.filter(task => {
    const name = normalize(task.name);
    return name === target || name.startsWith(`${target} - `);
  });
}
