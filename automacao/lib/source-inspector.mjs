/**
 * Leitor estrutural de fontes de dados (CSV, XLSX, Google Sheets).
 * Inspeciona apenas cabeçalhos, posições e amostras para configuração do mapeamento,
 * sem carregar toda a base em memória.
 */

export function parseHeaderAndSample(input, options = {}) {
  const headerRowIndex = Math.max(1, parseInt(options.headerRow ?? 1, 10)); // 1-indexed
  const sampleLimit = Math.max(1, parseInt(options.sampleLimit ?? 3, 10));

  const s = String(input ?? '').replace(/^\uFEFF/, '');
  if (!s.trim()) throw new Error('Fonte de dados vazia');

  // Detecta delimitador pela primeira linha de dados
  let firstLine = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQ = !inQ;
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (firstLine.trim()) break;
    } else if (!inQ) {
      firstLine += ch;
    }
  }
  const delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';

  // Parser incremental de linhas
  const rawRows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(c => String(c).trim() !== '')) rawRows.push(row);
      row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('CSV com aspas não fechadas');
  row.push(field.replace(/\r$/, ''));
  if (row.some(c => String(c).trim() !== '')) rawRows.push(row);

  if (!rawRows.length) throw new Error('Nenhuma linha preenchida encontrada na fonte');
  if (headerRowIndex > rawRows.length) {
    throw new Error(`Linha de cabeçalho ${headerRowIndex} excede o total de linhas encontradas (${rawRows.length})`);
  }

  const rawHeaders = rawRows[headerRowIndex - 1].map(x => String(x ?? '').trim());
  const dataRows = rawRows.slice(headerRowIndex);
  const sampleRows = dataRows.slice(0, sampleLimit);

  // Calcula largura máxima considerando cabeçalho e amostras
  const width = Math.max(
    rawHeaders.length,
    ...sampleRows.map(r => r.length),
    ...dataRows.slice(0, 20).map(r => r.length)
  );

  const seenNames = new Map();
  const columns = [];

  for (let i = 0; i < width; i++) {
    const rawName = rawHeaders[i] || '';
    const position = i + 1; // 1-indexed
    let displayName = rawName || `Coluna ${position}`;

    const count = (seenNames.get(rawName) || 0) + 1;
    seenNames.set(rawName, count);

    const isDuplicate = rawName !== '' && count > 1;
    const isUnnamed = rawName === '';

    // Amostra de valores desta coluna
    const samples = sampleRows.map(r => String(r[i] ?? '').trim()).filter(Boolean);

    // Sugestão de mapeamento interno
    const suggestion = suggestTargetField(rawName, samples, position);

    columns.push({
      index: i,
      position,
      rawHeader: rawName,
      name: displayName,
      isDuplicate,
      isUnnamed,
      samples,
      suggestedField: suggestion.field,
      confidence: suggestion.confidence,
      needsConfirmation: suggestion.needsConfirmation
    });
  }

  return {
    headerRow: headerRowIndex,
    delimiter,
    totalRows: dataRows.length,
    columnCount: columns.length,
    columns,
    sampleRows: sampleRows.map(r => Array.from({ length: width }, (_, i) => String(r[i] ?? '')))
  };
}

/**
 * Sugere correspondência inteligente entre o cabeçalho original e campos internos
 */
function suggestTargetField(header, samples, position) {
  const norm = String(header ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // CNPJ
  if (/^cnpj(\b|_|\s|$)/i.test(norm) || samples.some(s => /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(s))) {
    return { field: 'cnpj', confidence: 'high', needsConfirmation: false };
  }

  // Empresa / Razão Social / Cliente
  if (['cliente', 'empresa', 'razao social', 'nome empresa'].includes(norm)) {
    return { field: 'empresa', confidence: 'high', needsConfirmation: false };
  }

  // EmpID (identificador interno G-Click)
  if (['empid', 'id empresa', 'id_empresa', 'gclick id', 'id gclick'].includes(norm)) {
    return { field: 'empId', confidence: 'high', needsConfirmation: false };
  }

  // Cod. ou Código (candidato a identificador de cliente, mas ambíguo)
  if (['cod.', 'cod', 'codigo', 'cod cliente'].includes(norm)) {
    return { field: 'cod', confidence: 'medium', needsConfirmation: true };
  }

  // Cód. Enquete
  if (['cod. enquete', 'cod enquete', 'codigo enquete', 'cod_enquete'].includes(norm)) {
    return { field: 'resposta', confidence: 'high', needsConfirmation: false };
  }

  // Descrição da enquete
  if (['descricao da enquete', 'descricao enquete'].includes(norm)) {
    return { field: 'tarefa', confidence: 'high', needsConfirmation: false };
  }

  // Obrigação / Tarefa
  if (['obrigacao / tarefa', 'obrigacao', 'tarefa', 'obrigacoes'].includes(norm)) {
    return { field: 'tarefa', confidence: 'high', needsConfirmation: false };
  }

  // Resposta / Opção Enquete
  if (['resposta', 'opcao', 'enquete', 'enquete g-click'].includes(norm)) {
    return { field: 'resposta', confidence: 'medium', needsConfirmation: true };
  }

  // Data-base
  if (norm.startsWith('data-base') || norm.startsWith('database')) {
    return { field: 'data_base', confidence: 'high', needsConfirmation: false };
  }

  // Competência
  if (norm.startsWith('competencia')) {
    return { field: 'competencia', confidence: 'high', needsConfirmation: false };
  }

  // Colunas genéricas exportadas do Sheets (ex.: Column 17, Column 18)
  if (/^column\s*\d+$/i.test(norm)) {
    return { field: null, confidence: 'low', needsConfirmation: true };
  }

  return { field: null, confidence: 'none', needsConfirmation: false };
}
