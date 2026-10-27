import test from 'node:test';
import assert from 'node:assert/strict';

function findMatchingCategory(departamento, categoriasDisponiveis) {
  if (!departamento || !Array.isArray(categoriasDisponiveis)) return null;
  const norm = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const depNorm = norm(departamento);

  // Match 1: prefixo de 5+ caracteres (ex: 'contab' casa 'contabil' e 'contabilidade')
  const root = depNorm.length >= 6 ? depNorm.slice(0, 6) : depNorm;
  return categoriasDisponiveis.find(c => {
    const catNorm = norm(c.label);
    return catNorm.includes(depNorm) || depNorm.includes(catNorm) || catNorm.startsWith(root) || depNorm.startsWith(catNorm.slice(0, 6));
  }) || null;
}

test('obrigacoes-email: sugere categoria correspondente ao departamento quando nenhuma estiver selecionada', () => {
  const categoriasDisponiveis = [
    { value: '3', label: 'Contábil' },
    { value: '1', label: 'Departamento Pessoal' },
    { value: '2', label: 'Fiscal' },
    { value: '7', label: 'Financeiro' }
  ];

  // Caso 1: Obrigação de Contabilidade deve sugerir categoria Contábil (value 3)
  const matchContabil = findMatchingCategory('Contabilidade', categoriasDisponiveis);
  assert.ok(matchContabil);
  assert.equal(matchContabil.value, '3');

  // Caso 2: Obrigação Fiscal deve sugerir categoria Fiscal (value 2)
  const matchFiscal = findMatchingCategory('Fiscal', categoriasDisponiveis);
  assert.ok(matchFiscal);
  assert.equal(matchFiscal.value, '2');

  // Caso 3: Obrigação de DP deve sugerir Departamento Pessoal (value 1)
  const matchDP = findMatchingCategory('Departamento Pessoal', categoriasDisponiveis);
  assert.ok(matchDP);
  assert.equal(matchDP.value, '1');
});

test('obrigacoes-email: higieniza corpo de e-mail e preserva variáveis dinâmicas', () => {
  const rawText = 'Olá [cliente.apelido],\nSegue [obrigacao.nome] - [tarefa.competencia].\nVencimento: [tarefa.vencimento]';
  const formattedHtml = rawText.includes('<p>') ? rawText : `<p>${rawText.replace(/\n/g, '<br>')}</p>`;

  assert.ok(formattedHtml.startsWith('<p>'));
  assert.ok(formattedHtml.endsWith('</p>'));
  assert.ok(formattedHtml.includes('[cliente.apelido]'));
  assert.ok(formattedHtml.includes('[obrigacao.nome]'));
  assert.ok(formattedHtml.includes('[tarefa.competencia]'));
  assert.ok(formattedHtml.includes('[tarefa.vencimento]'));
});

test('obrigacoes-email: detecta e contabiliza anexos que precisam ser marcados', () => {
  const mockRows = [
    { nome: 'CSLL', title: 'Clique aqui pra não anexar', isAnexado: true },
    { nome: 'IRPJ', title: 'Clique aqui pra anexar', isAnexado: false }
  ];

  const pendentes = mockRows.filter(r => !r.isAnexado);
  assert.equal(pendentes.length, 1);
  assert.equal(pendentes[0].nome, 'IRPJ');
});

test('obrigacoes-email: valida opções de Tipo de Cancelamento e define "Com justificativa" como padrão', () => {
  const mockCancelamentoOptions = [
    { value: '0', label: 'Sem justificativa' },
    { value: '1', label: 'Com justificativa' },
    { value: '2', label: 'Sem cancelamento' }
  ];

  // Garante que a opção 1 existe e corresponde a "Com justificativa"
  const defaultOption = mockCancelamentoOptions.find(o => o.value === '1');
  assert.ok(defaultOption);
  assert.equal(defaultOption.label, 'Com justificativa');

  // Determina valor alvo padrão se nenhum informado
  const resolveTargetCancel = val => (val !== undefined && val !== null ? String(val) : '1');
  assert.equal(resolveTargetCancel(undefined), '1');
  assert.equal(resolveTargetCancel(null), '1');
  assert.equal(resolveTargetCancel('0'), '0');
  assert.equal(resolveTargetCancel('2'), '2');
});

test('obrigacoes-email: localiza particularidade de e-mail por ID ou nome textual (insensível a maiúsculas)', () => {
  const particularidadesConta6019 = [
    { value: '-1', label: 'Por Cliente' },
    { value: '542', label: 'Qualificação: 542 - Whats' },
    { value: '543', label: 'Qualificação: 543 - E-mail' },
    { value: '544', label: 'Qualificação: 544 - Portal' }
  ];

  function findEmailParticularidade(target, options) {
    if (!target) {
      // Procura qualquer uma que mencione email
      return options.find(o => /e-?mail/i.test(o.label)) || null;
    }
    const targetStr = String(target).trim().toLowerCase();
    return options.find(o => o.value === String(target) || o.label.toLowerCase().includes(targetStr)) || null;
  }

  // Busca automática sem especificar ID
  const autoMatch = findEmailParticularidade(null, particularidadesConta6019);
  assert.ok(autoMatch);
  assert.equal(autoMatch.value, '543');
  assert.equal(autoMatch.label, 'Qualificação: 543 - E-mail');

  // Busca por valor '543'
  const byVal = findEmailParticularidade('543', particularidadesConta6019);
  assert.ok(byVal);
  assert.equal(byVal.value, '543');

  // Busca por texto 'E-mail'
  const byText = findEmailParticularidade('E-mail', particularidadesConta6019);
  assert.ok(byText);
  assert.equal(byText.value, '543');
});

test('obrigacoes-email: ação em massa exige departamento selecionado e lista válida de obrigações', () => {
  function validateBatchParams(payload) {
    const departamento = String(payload.departamento ?? '').trim();
    if (!departamento) throw new Error('Para a ação em massa, o departamento deve estar obrigatoriamente selecionado no filtro.');
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) throw new Error('Selecione pelo menos uma obrigação para configurar em lote.');
    return { departamento, count: items.length };
  }

  // Caso 1: Falha se departamento estiver vazio
  assert.throws(
    () => validateBatchParams({ departamento: '', items: [{ id: 1 }] }),
    /departamento deve estar obrigatoriamente selecionado/
  );

  // Caso 2: Falha se lista de itens estiver vazia
  assert.throws(
    () => validateBatchParams({ departamento: 'Fiscal', items: [] }),
    /Selecione pelo menos uma obrigação/
  );

  // Caso 3: Validação bem sucedida com departamento e itens
  const valid = validateBatchParams({ departamento: 'Contabilidade', items: [{ id: 8, coid: 4 }] });
  assert.equal(valid.departamento, 'Contabilidade');
  assert.equal(valid.count, 1);
});


