/**
 * tax-engine.mjs
 * Motor de diagnóstico fiscal, tributário, pessoal e contábil para implantação de clientes.
 * Analisa CNAEs, UF, Município e Regime para gerar o Raio-X completo com prazos fatais.
 */

// Prefixos e divisões de CNAE sujeitos ao Fator R (Art. 18, § 5º-J e 5º-M da LC 123/2006)
const FATOR_R_CNAES = [
  '6201', '6202', '6203', '6204', '6209', // Desenvolvimento de programas e TI
  '6311', '6319',                         // Tratamento de dados, portais
  '6619',                                 // Atividades auxiliares dos serviços financeiros
  '6911', '6920',                         // Jurídica e Contabilidade (jurídica é Anexo IV, mas contabilidade é Anexo III)
  '7020',                                 // Consultoria em gestão empresarial
  '7111', '7112', '7119',                 // Arquitetura, Engenharia, Perícia
  '7120',                                 // Ensaios de materiais
  '7311', '7319',                         // Publicidade e agenciamento
  '7410', '7490',                         // Design, tradução, consultoria técnica
  '7500',                                 // Atividades veterinárias
  '8599',                                 // Treinamento e desenvolvimento profissional
  '8610', '8621', '8622', '8630', '8640', // Medicina, odontologia, enfermagem, exames
  '8650', '8690',                         // Fisioterapia, psicologia, fonoaudiologia
  '9001', '9002', '9003',                 // Atividades artísticas e culturais
  '9313'                                  // Academias de ginástica
];

// Divisões CNAE por segmento
const DIVISAO_COMERCIO = [45, 46, 47];
const DIVISAO_INDUSTRIA = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];
const DIVISAO_SERVICOS = [49, 50, 51, 52, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78, 79, 80, 81, 82, 85, 86, 87, 88, 90, 91, 92, 93, 94, 95, 96];

export function cleanCnae(cnae) {
  return String(cnae ?? '').replace(/\D/g, '');
}

export function classifySegment(cnaes) {
  const list = (Array.isArray(cnaes) ? cnaes : [cnaes]).map(cleanCnae).filter(Boolean);
  let hasComercio = false, hasIndustria = false, hasServicos = false;
  for (const c of list) {
    const div = parseInt(c.slice(0, 2), 10);
    if (DIVISAO_COMERCIO.includes(div)) hasComercio = true;
    if (DIVISAO_INDUSTRIA.includes(div)) hasIndustria = true;
    if (DIVISAO_SERVICOS.includes(div)) hasServicos = true;
  }
  const tags = [];
  if (hasServicos) tags.push('Serviço');
  if (hasComercio) tags.push('Comércio');
  if (hasIndustria) tags.push('Indústria');
  if (!tags.length) tags.push('Geral');
  return {
    isServico: hasServicos,
    isComercio: hasComercio,
    isIndustria: hasIndustria,
    segmento: tags.join(' e ')
  };
}

export function checkFatorR(cnaes) {
  const list = (Array.isArray(cnaes) ? cnaes : [cnaes]).map(cleanCnae).filter(Boolean);
  for (const c of list) {
    const prefix4 = c.slice(0, 4);
    if (FATOR_R_CNAES.includes(prefix4)) {
      return {
        sujeitoFatorR: true,
        cnaeGatilho: c,
        mensagem: 'Atividade sujeita ao Fator R (Art. 18, § 5º-J/M da LC 123/2006). Folha/Pró-labore deve ser >= 28% do faturamento para tributar no Anexo III (alíquota a partir de 6%) em vez do Anexo V (alíquota a partir de 15,5%).'
      };
    }
  }
  return { sujeitoFatorR: false, cnaeGatilho: null, mensagem: 'Não sujeito ao Fator R.' };
}

export function diagnoseClient(data) {
  const cnpj = String(data.cnpj ?? '').replace(/\D/g, '');
  const uf = String(data.uf ?? '').toUpperCase().trim();
  const municipio = String(data.municipio ?? '').trim();
  const regimeRaw = String(data.regime ?? 'simples').toLowerCase().trim();
  const regime = regimeRaw.includes('presumido') ? 'presumido' :
                 regimeRaw.includes('real') ? 'real' :
                 regimeRaw.includes('mei') ? 'mei' : 'simples';
  const cnaes = [data.cnaePrincipal, ...(data.cnaesSecundarios ?? [])].map(cleanCnae).filter(Boolean);
  const segment = classifySegment(cnaes);
  const fatorR = regime === 'simples' && segment.isServico ? checkFatorR(cnaes) : { sujeitoFatorR: false };
  const operacoes = {
    temProlabore: data.operacoes?.temProlabore !== false,
    temFuncionarios: Boolean(data.operacoes?.temFuncionarios),
    vendaInterestadual: Boolean(data.operacoes?.vendaInterestadual),
    emiteNfse: segment.isServico,
    emiteNfe: segment.isComercio || segment.isIndustria,
    ...data.operacoes
  };

  // 1. Prazos Críticos Fatais (Primeiros 30 Dias para evitar multas)
  const prazosFatais = [];
  if (regime === 'simples') {
    prazosFatais.push({
      obrigacao: 'Opção pelo Simples Nacional (Abertura)',
      prazo: '30 dias do deferimento da última inscrição (máx. 60 dias da abertura do CNPJ)',
      orgao: 'Federal (Portal do Simples Nacional)',
      departamento: 'Legalização / Fiscal',
      risco: 'CRÍTICO: Perda da opção força a empresa a tributar pelo Lucro Presumido até o fim do ano-calendário.',
      acao: 'Verificar deferimento municipal e estadual e solicitar o enquadramento no Portal do Simples.'
    });
  }
  prazosFatais.push({
    obrigacao: 'eSocial - Cadastro Inicial (Evento S-1000)',
    prazo: 'Até o dia 15 do mês seguinte ao início das atividades ou antes de enviar folha/pró-labore',
    orgao: 'Federal (eSocial)',
    departamento: 'Pessoal/DP',
    risco: 'Multa automática por falta de envio das informações cadastrais do empregador.',
    acao: 'Cadastrar os dados da empresa, responsável legal e classificação tributária no eSocial.'
  });
  prazosFatais.push({
    obrigacao: 'Inscrição Municipal / CCM / Alvará',
    prazo: 'Imediato após registro no órgão de classe / junta',
    orgao: `Prefeitura Municipal de ${municipio || 'Sede'} (${uf})`,
    departamento: 'Legalização',
    risco: 'Impossibilidade de emissão de NFS-e e incidência de multas municipais de funcionamento.',
    acao: 'Efetuar cadastro de contribuinte mobiliário e solicitar senha web para emissão de notas de serviço.'
  });
  if (segment.isComercio || segment.isIndustria) {
    prazosFatais.push({
      obrigacao: 'Inscrição Estadual (SEFAZ) e DTE',
      prazo: 'Imediato após liberação da Junta Comercial',
      orgao: `SEFAZ / Estado de ${uf}`,
      departamento: 'Fiscal / Legalização',
      risco: 'Bloqueio de emissão de NF-e e restrição de compras interestaduais.',
      acao: `Cadastrar Domicílio Tributário Eletrônico (DTE) na SEFAZ-${uf} e credenciar empresa para emissão de NF-e.`
    });
  }

  // 2. Obrigações do Departamento Fiscal
  const fiscalFederais = [];
  const fiscalEstaduais = [];
  const fiscalMunicipais = [];

  if (regime === 'simples') {
    fiscalFederais.push({
      nome: 'DAS - Mensal',
      frequencia: 'Mensal',
      vencimento: 'Dia 20 do mês subsequente',
      descricao: 'Guia única de recolhimento dos tributos do Simples Nacional gerada no PGDAS-D.'
    });
    fiscalFederais.push({
      nome: 'PGDAS-D Declaração',
      frequencia: 'Mensal',
      vencimento: 'Dia 20 do mês subsequente',
      descricao: 'Transmissão da apuração mensal das receitas por anexo do Simples Nacional.'
    });
    fiscalFederais.push({
      nome: 'DEFIS',
      frequencia: 'Anual',
      vencimento: 'Último dia útil de Março',
      descricao: 'Declaração de Informações Socioeconômicas e Fiscais.'
    });
  } else {
    // Lucro Presumido ou Real
    fiscalFederais.push({
      nome: 'DCTF Mensal / DCTFWeb',
      frequencia: 'Mensal',
      vencimento: 'Dia 15 do segundo mês subsequente (DCTF) / Dia 15 do mês seguinte (DCTFWeb)',
      descricao: 'Declaração de Débitos e Créditos Tributários Federais.'
    });
    fiscalFederais.push({
      nome: 'EFD Contribuições',
      frequencia: 'Mensal',
      vencimento: '10º dia útil do segundo mês subsequente',
      descricao: 'Escrituração Fiscal Digital do PIS/Pasep e da COFINS.'
    });
    fiscalFederais.push({
      nome: 'EFD Reinf',
      frequencia: 'Mensal',
      vencimento: 'Dia 15 do mês subsequente',
      descricao: 'Escrituração de retenções de impostos federais (IRRF, CSRF) e contribuição previdenciária.'
    });
    fiscalFederais.push({
      nome: `CSLL e IRPJ - ${regime === 'real' ? 'Lucro Real' : 'Lucro Presumido'}`,
      frequencia: 'Trimestral',
      vencimento: 'Último dia útil do mês subsequente ao trimestre (Abril, Julho, Outubro, Janeiro)',
      descricao: 'Apuração e guias DARF de IRPJ e Contribuição Social sobre o Lucro Líquido.'
    });
  }

  // Obrigações Estaduais (ICMS)
  if (segment.isComercio || segment.isIndustria) {
    if (regime === 'simples') {
      fiscalEstaduais.push({
        nome: 'DeSTDA - Declaração mensal',
        frequencia: 'Mensal',
        vencimento: 'Dia 28 do mês subsequente',
        descricao: `Declaração de Substituição Tributária, Diferencial de Alíquota e Antecipação (obrigatória para Simples com IE em ${uf}).`
      });
      if (operacoes.vendaInterestadual) {
        fiscalEstaduais.push({
          nome: 'DIFAL / ICMS Antecipação',
          frequencia: 'Mensal / Por Operação',
          vencimento: 'Conforme calendário da SEFAZ de destino/origem',
          descricao: 'Cálculo e recolhimento do diferencial de alíquota em compras/vendas interestaduais.'
        });
      }
    } else {
      fiscalEstaduais.push({
        nome: 'EFD ICMS/IPI (SPED Fiscal)',
        frequencia: 'Mensal',
        vencimento: 'Varia por UF (normalmente entre dia 15 e 20)',
        descricao: `Escrituração digital de entradas, saídas, apuração de ICMS e IPI para SEFAZ-${uf}.`
      });
      if (uf === 'SP') {
        fiscalEstaduais.push({
          nome: 'GIA - SP',
          frequencia: 'Mensal',
          vencimento: 'Entre dias 16 e 19 conforme dígito final da IE',
          descricao: 'Guia de Informação e Apuração do ICMS de São Paulo.'
        });
      } else if (uf === 'RJ') {
        fiscalEstaduais.push({
          nome: 'DECLAN-IPM - RJ',
          frequencia: 'Anual',
          vencimento: 'Conforme calendário SEFAZ-RJ',
          descricao: 'Declaração Anual para o Índice de Participação dos Municípios.'
        });
      } else if (uf === 'MG') {
        fiscalEstaduais.push({
          nome: 'DAMEF-VAF - MG',
          frequencia: 'Anual',
          vencimento: 'Conforme calendário SEFAZ-MG',
          descricao: 'Declaração de Apuração e Movimento Econômico Fiscal de Minas Gerais.'
        });
      }
    }
  }

  // Obrigações Municipais (ISS)
  if (segment.isServico) {
    fiscalMunicipais.push({
      nome: 'Emissão de NFS-e e Livro Fiscal de ISS',
      frequencia: 'Mensal',
      vencimento: 'Conforme calendário municipal de ' + (municipio || uf),
      descricao: 'Emissão das notas fiscais de serviço e fechamento do livro fiscal eletrônico municipal.'
    });
    fiscalMunicipais.push({
      nome: 'Taxas Municipais (TFE / TFL / Alvará)',
      frequencia: 'Anual',
      vencimento: 'Conforme cronograma da Prefeitura de ' + (municipio || uf),
      descricao: 'Taxa de Fiscalização de Estabelecimento ou taxa anual de licença.'
    });
  }

  // 3. Obrigações do Departamento Pessoal / DP
  const dpObrigacoes = [];
  let folhaTipo = 'Folha Sem Movimento';
  if (operacoes.temFuncionarios) {
    folhaTipo = 'Folha Mensal (Funcionários e Sócios)';
  } else if (operacoes.temProlabore) {
    folhaTipo = 'Folha Somente Pró-Labore';
  }

  dpObrigacoes.push({
    nome: folhaTipo,
    frequencia: 'Mensal',
    vencimento: 'Até o 5º dia útil para salários / Dia 20 para INSS (DARF DCTFWeb)',
    descricao: operacoes.temFuncionarios ? 'Fechamento de folha de pagamento de empregados e pró-labore de sócios.' :
               operacoes.temProlabore ? 'Retirada de pró-labore dos sócios com recolhimento de INSS e IRRF se houver.' :
               'Envio de competência sem movimento no eSocial/DCTFWeb.'
  });
  dpObrigacoes.push({
    nome: 'DCTFWeb (Folha / Previdenciária)',
    frequencia: 'Mensal',
    vencimento: 'Dia 15 do mês subsequente',
    descricao: 'Transmissão da DCTFWeb decorrente do fechamento dos eventos de folha do eSocial.'
  });
  if (operacoes.temFuncionarios) {
    dpObrigacoes.push({
      nome: 'FGTS Digital',
      frequencia: 'Mensal',
      vencimento: 'Dia 20 do mês subsequente',
      descricao: 'Emissão e recolhimento da guia de FGTS via plataforma FGTS Digital.'
    });
  }

  // 4. Obrigações do Departamento Contábil
  const contabilObrigacoes = [
    {
      nome: 'Fechamento Contábil Mensal / Balancete',
      frequencia: 'Mensal',
      vencimento: 'Conforme cronograma de fechamento do escritório',
      descricao: 'Conciliação bancária, lançamentos contábeis de receitas, despesas e emissão de balancete.'
    },
    {
      nome: 'Livro Diário e Balanço Patrimonial Anual',
      frequencia: 'Anual',
      vencimento: 'Até 31 de Maio / 30 de Junho',
      descricao: 'Demonstrações contábeis formais, DRE e registro no órgão competente.'
    }
  ];
  if (regime !== 'simples') {
    contabilObrigacoes.push({
      nome: 'ECD (SPED Contábil)',
      frequencia: 'Anual',
      vencimento: 'Último dia útil de Junho',
      descricao: 'Escrituração Contábil Digital obrigatória para Lucro Real e Presumido (acima do limite normativo).'
    });
    contabilObrigacoes.push({
      nome: 'ECF (Escrituração Contábil Fiscal)',
      frequencia: 'Anual',
      vencimento: 'Último dia útil de Julho',
      descricao: 'Apuração da base de cálculo e recolhimento de IRPJ/CSLL integrada à contabilidade.'
    });
  }

  return {
    dadosGerais: {
      cnpj,
      razaoSocial: data.razaoSocial ?? '',
      uf,
      municipio,
      regime,
      regimeLabel: regime === 'simples' ? 'Simples Nacional' : regime === 'presumido' ? 'Lucro Presumido' : regime === 'real' ? 'Lucro Real' : 'MEI',
      cnaes,
      segmento: segment.segmento,
      folhaTipo
    },
    fatorR,
    prazosFatais,
    departamentos: {
      fiscal: {
        federais: fiscalFederais,
        estaduais: fiscalEstaduais,
        municipais: fiscalMunicipais
      },
      pessoal: dpObrigacoes,
      contabil: contabilObrigacoes
    }
  };
}
