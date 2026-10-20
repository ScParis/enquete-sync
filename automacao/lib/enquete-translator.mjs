/**
 * enquete-translator.mjs
 * Traduz o diagnóstico do Raio-X Tributário em respostas exatas da Enquete do G-Click.
 * Utiliza as referências e códigos internos catalogados em enquete-catalogo.json.
 */

export function translateDiagnosisToEnquete(diagnosis, options = {}) {
  const { dadosGerais, departamentos } = diagnosis;
  const isMatriz = options.tipoEmpresa !== 'filial';
  const fechamentoContabil = options.fechamentoContabil ?? 'mensal'; // 'mensal' | 'trimestral' | 'anual'

  const answers = [];

  // 1. Grupo 01 - Qualificação Geral
  // 01.01: Que tipo de cliente é este? Fixo ou Eventual?
  answers.push({
    category: 'Qualificação Geral do Cliente',
    questionRef: '01.01',
    question: 'Que tipo de cliente é este? Fixo ou Eventual?',
    answerRef: '01.01.01',
    answerValue: '1',
    answerLabel: '01 - Fixo',
    inputType: 'radio'
  });

  // 01.01.01.01: Qual o tipo dessa empresa ? (Matriz ou Filial)
  answers.push({
    category: 'Qualificação Geral do Cliente',
    questionRef: '01.01.01.01',
    question: 'Qual o tipo dessa empresa ?',
    answerRef: isMatriz ? '01.01.01.01.01' : '01.01.01.01.02',
    answerValue: isMatriz ? '13' : '14',
    answerLabel: isMatriz ? '01 - Matriz' : '02 - Filial',
    inputType: 'radio'
  });

  // 01.02: Qual é o atual Regime Tributário desta empresa?
  let regimeAnswer = { ref: '01.02.04', value: '9', label: '04 - Simples' };
  if (dadosGerais.regime === 'presumido') {
    regimeAnswer = { ref: '01.02.03', value: '8', label: '03 - Lucro Presumido' };
  } else if (dadosGerais.regime === 'real') {
    regimeAnswer = { ref: '01.02.02', value: '7', label: '02 - Lucro Real' };
  } else if (dadosGerais.regime === 'mei') {
    regimeAnswer = { ref: '01.02.07', value: '12', label: '07 - MEI' };
  }
  answers.push({
    category: 'Qualificação Geral do Cliente',
    questionRef: '01.02',
    question: 'Qual é o atual Regime Tributário desta empresa?',
    answerRef: regimeAnswer.ref,
    answerValue: regimeAnswer.value,
    answerLabel: regimeAnswer.label,
    inputType: 'radio'
  });

  // 2. Grupo 02 - Dpto. Fiscal/Tributário
  // 02.01: Obrigações Federais
  if (dadosGerais.regime !== 'simples') {
    // EFD Reinf Ativo (441)
    answers.push({
      category: 'Dpto. Fiscal/Tributário',
      questionRef: '02.01',
      question: 'Qual dessas Obrigações Federais são entregues para esse cliente ?',
      answerRef: '02.01.05',
      answerValue: '441',
      answerLabel: '05 - EFD Reinf (Ativo)',
      inputType: 'checkbox'
    });
    // Se Comércio/Indústria no Presumido/Real: EFD ICMS/IPI (434)
    if (departamentos.fiscal.estaduais.some(e => e.nome.includes('EFD ICMS/IPI'))) {
      answers.push({
        category: 'Dpto. Fiscal/Tributário',
        questionRef: '02.01',
        question: 'Qual dessas Obrigações Federais são entregues para esse cliente ?',
        answerRef: '02.01.04',
        answerValue: '434',
        answerLabel: '04 - EFD ICMS/IPI',
        inputType: 'checkbox'
      });
    }
  }

  // 02.02: Obrigações Estaduais (Part 1)
  // DeSTDA (409) para Simples com Inscrição Estadual
  if (departamentos.fiscal.estaduais.some(e => e.nome.includes('DeSTDA'))) {
    answers.push({
      category: 'Dpto. Fiscal/Tributário',
      questionRef: '02.02',
      question: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 1)',
      answerRef: '02.02.01',
      answerValue: '409',
      answerLabel: '01 - DeSTDA',
      inputType: 'checkbox'
    });
  }

  // DECLAN-IPM - RJ (401)
  if (departamentos.fiscal.estaduais.some(e => e.nome.includes('DECLAN-IPM'))) {
    answers.push({
      category: 'Dpto. Fiscal/Tributário',
      questionRef: '02.02',
      question: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 1)',
      answerRef: '02.02.08',
      answerValue: '401',
      answerLabel: '08 - DECLAN-IPM - RJ',
      inputType: 'checkbox'
    });
  }

  // DAMEF-VAF - MG (388)
  if (departamentos.fiscal.estaduais.some(e => e.nome.includes('DAMEF-VAF'))) {
    answers.push({
      category: 'Dpto. Fiscal/Tributário',
      questionRef: '02.02',
      question: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 1)',
      answerRef: '02.02.04',
      answerValue: '388',
      answerLabel: '04 - DAMEF-VAF',
      inputType: 'checkbox'
    });
  }

  // 3. Grupo 04 - Dpto. Pessoal/Trabalhista
  // 04.01: Tipo de Folha de Pagamento
  let folhaAnswer = { ref: '04.01.05', value: '94', label: '05 - Folha Sem Movimento' };
  if (dadosGerais.folhaTipo === 'Folha Mensal (Funcionários e Sócios)') {
    folhaAnswer = { ref: '04.01.01', value: '90', label: '01 - Folha Mensal (Funcionários e Sócios)' };
  } else if (dadosGerais.folhaTipo === 'Folha Somente Pró-Labore') {
    folhaAnswer = { ref: '04.01.04', value: '93', label: '04 - Folha Somente Pró-Labore (Apenas Sócios)' };
  }
  answers.push({
    category: 'Dpto. Pessoal/Trabalhista',
    questionRef: '04.01',
    question: 'Tipo de Folha de Pagamento',
    answerRef: folhaAnswer.ref,
    answerValue: folhaAnswer.value,
    answerLabel: folhaAnswer.label,
    inputType: 'radio'
  });

  // 4. Grupo 03 - Dpto. Contábil
  // 03.01: Frequência do Fechamento Contábil
  let fechamentoAnswer = { ref: '03.01.01', value: '364', label: '01 - Fechamento Contábil Mensal' };
  if (fechamentoContabil === 'trimestral') {
    fechamentoAnswer = { ref: '03.01.02', value: '365', label: '02 - Fechamento Contábil Trimestral' };
  } else if (fechamentoContabil === 'anual') {
    fechamentoAnswer = { ref: '03.01.04', value: '363', label: '04 - Fechamento Contábil Anual' };
  }
  answers.push({
    category: 'Dpto. Contábil',
    questionRef: '03.01',
    question: 'Frequência do Fechamento Contábil',
    answerRef: fechamentoAnswer.ref,
    answerValue: fechamentoAnswer.value,
    answerLabel: fechamentoAnswer.label,
    inputType: 'radio'
  });

  return answers;
}
