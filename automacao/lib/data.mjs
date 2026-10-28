import fs from 'node:fs/promises';

export function parseCsvTable(input) {
  const s = input.replace(/^\uFEFF/, '');
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
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('CSV com aspas não fechadas');
  row.push(field.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error('CSV vazio');
  const headers = rows.shift().map(x => x.trim());
  const width = rows.reduce((current, cells) => Math.max(current, cells.length), headers.length);
  const columns = Array.from({ length: width }, (_, i) => headers[i] || `Coluna ${i + 1}`);
  return { columns, rows: rows.map(cells => Array.from({ length: width }, (_, i) => cells[i] ?? '')) };
}

export function parseCsv(input) {
  const table = parseCsvTable(input);
  return table.rows.map((cells, i) => ({ ...Object.fromEntries(table.columns.map((h, j) => [h, cells[j]])), _row: i + 2 }));
}

export function normalizeCnpj(v) { return String(v ?? '').replace(/\D/g, ''); }
export function validCnpj(v) {
  const d = normalizeCnpj(v);
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  for (let n = 12; n <= 13; n++) {
    const weights = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const rem = d.slice(0, n).split('').reduce((sum, x, i) => sum + Number(x) * weights[i], 0) % 11;
    if (Number(d[n]) !== (rem < 2 ? 0 : 11 - rem)) return false;
  }
  return true;
}
export function formatCnpj(v) {
  const d = normalizeCnpj(v);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export async function readScope(path) {
  const items = (await fs.readFile(path, 'utf8')).split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
  if (!items.length) throw new Error('Arquivo de CNPJs vazio');
  const ids = items.map(normalizeCnpj);
  for (const id of ids) if (!validCnpj(id)) throw new Error(`CNPJ inválido no escopo: ${id}`);
  if (new Set(ids).size !== ids.length) throw new Error('CNPJ duplicado no escopo');
  return ids;
}

function rowField(r, field) {
  if (r._norm && (field in r._norm)) {
    if (field === 'empId' && (!r._norm.empId || r._norm.empId === '') && r._norm.cod) return r._norm.cod;
    return r._norm[field];
  }
  if (field === 'tarefa') return r['Obrigação / Tarefa'] ?? r['Obrigação'] ?? r['Tarefa'] ?? r.tarefa;
  if (field === 'empresa') return r.Empresa ?? r.empresa ?? '';
  if (field === 'empId') return r.EmpID ?? r.empId ?? r['Cod.'] ?? r.cod;
  if (field === 'cod') return r['Cod.'] ?? r.cod ?? r.EmpID ?? r.empId;
  if (field === 'cnpj') return r.CNPJ ?? r.cnpj;
  return r[field];
}

export function scopeFromEligible(rows, rules) {
  const matching = rows.filter(r => rules.allowedTasks.includes(rowField(r, 'tarefa')));
  const invalid = [];
  const scopeKeys = [];
  for (const r of matching) {
    const cnpj = rowField(r, 'cnpj');
    const empId = rowField(r, 'empId');
    const hasCnpj = validCnpj(cnpj);
    const hasId = Boolean(empId && String(empId).trim() && String(empId).trim() !== '-');
    if (!hasCnpj && !hasId) {
      invalid.push({ row: r._row, cnpj: cnpj || '-', empresa: rowField(r, 'empresa') || (validCnpj(cnpj) ? formatCnpj(cnpj) : (hasId ? `ID ${empId}` : '-')), reason: 'CNPJ e ID do cliente (Cod.) ausentes' });
    } else {
      scopeKeys.push(hasCnpj ? normalizeCnpj(cnpj) : `id:${String(empId).trim()}`);
    }
  }
  const scope = [...new Set(scopeKeys)];
  return { scope, invalid };
}

export function makePlan(rows, scope, rules) {
  const isNormalized = Boolean(rows[0]?._norm);
  if (!rows.length) throw new Error('Planilha vazia');
  if (isNormalized) {
    if (!('tarefa' in rows[0]._norm)) throw new Error('Planilha sem colunas obrigatórias: tarefa');
  } else {
    const hasTaskCol = ['Obrigação / Tarefa', 'Obrigação', 'Tarefa', 'tarefa'].some(k => k in rows[0]);
    if (!hasTaskCol) throw new Error('Planilha sem colunas obrigatórias: Obrigação / Tarefa');
  }
  if (!Array.isArray(rules.allowedTasks) || !rules.allowedTasks.length || !Array.isArray(rules.excludedTasks)) throw new Error('Regras sem listas de tarefas válidas');
  if (rules.allowedTasks.some(t => rules.excludedTasks.includes(t))) throw new Error('Regras permitidas e excluídas se sobrepõem');
  return scope.map(key => {
    const isId = key.startsWith('id:');
    const rawId = isId ? key.slice(3) : null;
    const found = rows.filter(r => isId
      ? String(rowField(r, 'empId') ?? rowField(r, 'cod') ?? '').trim() === rawId
      : normalizeCnpj(rowField(r, 'cnpj')) === key
    );
    const allowed = found.filter(r => rules.allowedTasks.includes(rowField(r, 'tarefa')));
    const identities = new Set(found.map(r => String(rowField(r, 'empId') ?? rowField(r, 'cod') ?? '').trim()).filter(x => x && x !== '-'));
    let status = 'pronto', reason = '';
    if (!found.length) { status = 'bloqueado'; reason = 'Cliente ausente na planilha'; }
    else if (!allowed.length) { status = 'bloqueado'; reason = 'Nenhuma Obrigação/Tarefa corresponde exatamente à regra'; }
    else if (identities.size > 1) { status = 'bloqueado'; reason = 'ID/EmpID divergente nas tarefas elegíveis'; }

    const first = found[0];
    const cnpjRaw = first ? rowField(first, 'cnpj') : null;
    const cnpjFormatted = validCnpj(cnpjRaw) ? formatCnpj(cnpjRaw) : (rawId ? `ID ${rawId}` : (first?.empId ? `ID ${first.empId}` : ''));
    const empIdVal = identities.size ? [...identities][0] : (rowField(first, 'empId') || rowField(first, 'cod') || null);
    const empresaVal = rowField(first, 'empresa') || cnpjFormatted || (empIdVal ? `ID ${empIdVal}` : '-');

    return {
      cnpj: cnpjFormatted,
      empId: empIdVal,
      cod: rowField(first, 'cod') ?? empIdVal,
      empresa: empresaVal,
      status, reason,
      tasks: [...new Set(found.map(r => rowField(r, 'tarefa')))],
      matchingRows: allowed.map(r => r._row),
      target: rules.answerRef
    };
  });
}
