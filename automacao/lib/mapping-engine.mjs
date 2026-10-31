/**
 * Motor de mapeamento, contratos de destino e normalização de dados.
 */

import { validCnpj, normalizeCnpj } from './data.mjs';

export const TARGET_MODELS = {
  enquete_automacao: {
    id: 'enquete_automacao',
    label: 'Automação da Enquete G-Click',
    description: 'Exige tarefa e ao menos um identificador (CNPJ, EmpID ou Cod.) para validação e gravação na Enquete.',
    requiredFields: ['tarefa']
  },
  cliente_identificacao: {
    id: 'cliente_identificacao',
    label: 'Cadastro & Identificação de Clientes',
    description: 'Mapeia dados cadastrais sem exigir obrigações ou tarefas.',
    requiredFields: []
  },
  carteira_responsaveis: {
    id: 'carteira_responsaveis',
    label: 'Carteira por Usuário',
    description: 'Responsável × empresa: exige o responsável e o CNPJ de cada empresa para conferir e vincular a Carteira no G-Click.',
    requiredFields: ['responsavel', 'cnpj']
  },
  generico_consulta: {
    id: 'generico_consulta',
    label: 'Importação Geral (Consulta / Tabela)',
    description: 'Preserva todas as colunas sem requisitos mandatórios de automação.',
    requiredFields: []
  }
};

export const AVAILABLE_FIELDS = [
  { id: 'cnpj', label: 'CNPJ', description: 'CNPJ da empresa (usado para localizar no G-Click)' },
  { id: 'empresa', label: 'Empresa / Razão Social', description: 'Nome da empresa/cliente' },
  { id: 'empId', label: 'EmpID (ID G-Click)', description: 'ID numérico interno do escritório no G-Click' },
  { id: 'cod', label: 'Código Interno (Cod.)', description: 'Código do cliente no sistema de origem' },
  { id: 'responsavel', label: 'Responsável (usuário G-Click)', description: 'Apelido ou nome do usuário responsável pela empresa na Carteira' },
  { id: 'tarefa', label: 'Obrigação / Tarefa', description: 'Nome da tarefa que se relaciona às perguntas da Enquete' },
  { id: 'resposta', label: 'Resposta / Opção', description: 'Resposta esperada na Enquete' },
  { id: 'data_base', label: 'Data-base', description: 'Mês/Ano de referência da data-base' },
  { id: 'competencia', label: 'Competência', description: 'Competência contábil/fiscal' }
];

export const TRANSFORMS = {
  limpar_cnpj: (v) => normalizeCnpj(v),
  trim_texto: (v) => String(v ?? '').trim(),
  maiusculo: (v) => String(v ?? '').trim().toUpperCase(),
  minusculo: (v) => String(v ?? '').trim().toLowerCase(),
  preservar: (v) => (v === null || v === undefined) ? '' : String(v).trim()
};

/**
 * Valida se um perfil de mapeamento é compatível com a estrutura inspecionada da planilha
 */
export function validateProfileAgainstStructure(profile, structure) {
  const errors = [];
  const warnings = [];

  if (!profile || typeof profile !== 'object') {
    return { valid: false, errors: ['Perfil de mapeamento inválido ou ausente'] };
  }

  const model = TARGET_MODELS[profile.targetModel] ?? TARGET_MODELS.generico_consulta;

  // 1. Checagem de colunas
  if (Array.isArray(profile.columns)) {
    const mappedTargets = new Set();

    for (const col of profile.columns) {
      const structCol = structure.columns?.find(c => c.index === col.sourceIndex);
      if (!structCol) {
        warnings.push(`Coluna índice ${col.sourceIndex} (${col.sourceName}) não existe na planilha atual.`);
        continue;
      }

      // Verifica se o cabeçalho mudou
      if (structCol.rawHeader && col.sourceName && structCol.rawHeader !== col.sourceName) {
        warnings.push(`Cabeçalho na coluna ${col.sourceIndex + 1} mudou: esperava "${col.sourceName}", encontrou "${structCol.rawHeader}".`);
      }

      if (col.action === 'map' && col.targetField) {
        if (mappedTargets.has(col.targetField)) {
          errors.push(`Campo de destino "${col.targetField}" foi mapeado para mais de uma coluna.`);
        }
        mappedTargets.add(col.targetField);
      }
    }

    // 2. Checagem de campos obrigatórios do modelo selecionado
    for (const req of model.requiredFields) {
      if (!mappedTargets.has(req)) {
        errors.push(`Campo obrigatório "${req}" não está mapeado no perfil para o modelo "${model.label}".`);
      }
    }

    if (model.id === 'enquete_automacao') {
      const hasIdentifier = mappedTargets.has('cnpj') || mappedTargets.has('empId') || mappedTargets.has('cod');
      if (!hasIdentifier) {
        errors.push('É necessário mapear ao menos um identificador de cliente (CNPJ, EmpID ou Cod.) para automação da Enquete.');
      }
    }
  } else {
    errors.push('Perfil não possui mapeamento de colunas definido');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    targetModel: model.id
  };
}

/**
 * Normaliza linhas da tabela baseado no perfil de mapeamento
 */
export function normalizeTable(table, profile) {
  if (!table || !Array.isArray(table.rows)) {
    throw new Error('Tabela vazia ou formato inválido');
  }

  const targetModel = profile?.targetModel ?? 'generico_consulta';
  const columnsMapping = profile?.columns ?? [];
  const colMapByIndex = new Map(columnsMapping.map((c, i) => [Number(c.sourceIndex ?? i), c]));
  const colMapByName = new Map(columnsMapping.filter(c => c.sourceName).map(c => [String(c.sourceName).trim().toLowerCase(), c]));

  const normalizedRows = [];
  const filledCounts = {};
  let invalidCnpjs = 0;
  const cnpjSet = new Set();
  const duplicateCnpjs = new Set();

  table.rows.forEach((rowCells, rowIndex) => {
    const rowNum = rowIndex + (profile?.headerRow ? profile.headerRow + 1 : 2);
    const rawObj = {};
    const normObj = {};

    // Popula rawObj
    table.columns.forEach((colName, idx) => {
      rawObj[colName] = rowCells[idx] ?? '';
    });

    // Popula normObj via mapeamento
    rowCells.forEach((cellVal, colIdx) => {
      const mapping = colMapByIndex.get(Number(colIdx)) ?? colMapByName.get(String(table.columns[colIdx] || '').trim().toLowerCase());
      if (!mapping) {
        // Coluna sem mapeamento explícito: preserva se não foi ignorada
        return;
      }

      if (mapping.action === 'ignore') return;

      const transformFn = TRANSFORMS[mapping.transform] ?? TRANSFORMS.preservar;
      const transformedVal = transformFn(cellVal);

      if (mapping.action === 'map' && mapping.targetField) {
        normObj[mapping.targetField] = transformedVal;
        if (transformedVal !== '') {
          filledCounts[mapping.targetField] = (filledCounts[mapping.targetField] || 0) + 1;
        }

        // Validação de CNPJ se aplicável
        if (mapping.targetField === 'cnpj' && transformedVal) {
          if (!validCnpj(transformedVal)) {
            invalidCnpjs++;
          } else {
            if (cnpjSet.has(transformedVal)) duplicateCnpjs.add(transformedVal);
            cnpjSet.add(transformedVal);
          }
        }
      }
    });

    // Fallbacks inteligentes de auto-identificação caso a coluna bruta já possua identificadores ou tarefas
    if (!normObj.cnpj && !normObj.empId && !normObj.cod) {
      for (const [colName, val] of Object.entries(rawObj)) {
        if (/^cnpj(\b|_|\s|$)/i.test(colName.toLowerCase())) {
          const cleaned = normalizeCnpj(val);
          if (validCnpj(cleaned)) {
            normObj.cnpj = cleaned;
            if (cnpjSet.has(cleaned)) duplicateCnpjs.add(cleaned);
            cnpjSet.add(cleaned);
            filledCounts['cnpj'] = (filledCounts['cnpj'] || 0) + 1;
            break;
          }
        }
      }
    }
    if (!normObj.tarefa) {
      for (const [colName, val] of Object.entries(rawObj)) {
        if (['obrigação', 'obrigacao', 'tarefa', 'obrigação / tarefa', 'obrigacoes', 'obrigações'].includes(colName.toLowerCase().trim())) {
          normObj.tarefa = String(val ?? '').trim();
          if (normObj.tarefa) {
            filledCounts['tarefa'] = (filledCounts['tarefa'] || 0) + 1;
            break;
          }
        }
      }
    }

    if (normObj.cod && !normObj.empId) normObj.empId = normObj.cod;
    if (normObj.empId && !normObj.cod) normObj.cod = normObj.empId;

    normalizedRows.push({
      _row: rowNum,
      _raw: rawObj,
      _norm: normObj
    });
  });

  const isEligibleForEnquete = targetModel === 'enquete_automacao' &&
    normalizedRows.some(r => Boolean(r._norm.tarefa) && (Boolean(r._norm.cnpj) || Boolean(r._norm.empId) || Boolean(r._norm.cod)));

  return {
    targetModel,
    totalRows: normalizedRows.length,
    normalizedRows,
    audit: {
      totalRows: normalizedRows.length,
      filledCounts,
      invalidCnpjs,
      uniqueCnpjs: cnpjSet.size,
      duplicateCnpjs: Array.from(duplicateCnpjs),
      isEligibleForEnquete
    }
  };
}

/**
 * Gera um perfil de mapeamento padrão (proposta inicial) a partir da estrutura
 */
export function createSuggestedProfile(accountId, sourceFingerprint, sheetIdentifier, structure, targetModel = 'enquete_automacao') {
  const columns = structure.columns.map(col => {
    let action = 'preserve';
    let targetField = null;
    let transform = 'trim_texto';
    let userConfirmed = false;

    if (col.suggestedField) {
      action = 'map';
      targetField = col.suggestedField;
      if (col.suggestedField === 'cnpj') transform = 'limpar_cnpj';
      userConfirmed = !col.needsConfirmation;
    }

    return {
      sourceIndex: col.index,
      position: col.position,
      sourceName: col.rawHeader || col.name,
      targetField,
      action,
      transform,
      userConfirmed
    };
  });

  return {
    id: `prof-${accountId}-${Date.now().toString(36)}`,
    accountId: String(accountId),
    sourceFingerprint: String(sourceFingerprint),
    sheetIdentifier: String(sheetIdentifier),
    headerRow: structure.headerRow ?? 1,
    targetModel,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    columns
  };
}

// Planilha da Carteira e planilha da Enquete têm DE/PARA próprios: um perfil só serve ao uso para o qual foi salvo.
export function profileFitsUse(profile, targetModel) {
  return (profile?.targetModel === 'carteira_responsaveis') === (targetModel === 'carteira_responsaveis');
}

// Campos obrigatórios do modelo que o DE/PARA ainda não mapeia.
export function missingRequiredFields(profile) {
  const model = TARGET_MODELS[profile?.targetModel];
  if (!model) return [];
  const mapped = new Set((profile.columns ?? []).filter(c => c.action === 'map').map(c => c.targetField));
  return model.requiredFields.filter(field => !mapped.has(field));
}
