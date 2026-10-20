import fs from 'node:fs/promises';

export function parseCsv(input) {
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
  return rows.map((cells, i) => ({ ...Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? ''])), _row: i + 2 }));
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

export function scopeFromEligible(rows, rules) {
  const matching = rows.filter(r => rules.allowedTasks.includes(r['Obrigação / Tarefa']));
  const invalid = matching.filter(r => !validCnpj(r.CNPJ)).map(r => ({ row: r._row, cnpj: r.CNPJ, empresa: r.Empresa, reason: 'CNPJ inválido ou ausente' }));
  const scope = [...new Set(matching.filter(r => validCnpj(r.CNPJ)).map(r => normalizeCnpj(r.CNPJ)))];
  return { scope, invalid };
}

export function makePlan(rows, scope, rules) {
  const required = ['Obrigação / Tarefa', 'Empresa', 'EmpID', 'CNPJ'];
  if (!rows.length || required.some(k => !(k in rows[0]))) throw new Error(`CSV sem colunas obrigatórias: ${required.join(', ')}`);
  if (!Array.isArray(rules.allowedTasks) || !rules.allowedTasks.length || !Array.isArray(rules.excludedTasks)) throw new Error('Regras sem listas de tarefas válidas');
  if (rules.allowedTasks.some(t => rules.excludedTasks.includes(t))) throw new Error('Regras permitidas e excluídas se sobrepõem');
  return scope.map(cnpj => {
    const found = rows.filter(r => normalizeCnpj(r.CNPJ) === cnpj);
    const allowed = found.filter(r => rules.allowedTasks.includes(r['Obrigação / Tarefa']));
    const identities = new Set(found.map(r => String(r.EmpID).trim()));
    let status = 'pronto', reason = '';
    if (!found.length) { status = 'bloqueado'; reason = 'CNPJ ausente na planilha'; }
    else if (identities.size !== 1 || [...identities][0] === '') { status = 'bloqueado'; reason = 'EmpID ausente ou divergente'; }
    else if (!allowed.length) { status = 'bloqueado'; reason = 'Nenhuma Obrigação/Tarefa corresponde exatamente à regra'; }
    else if (new Set(allowed.map(r => String(r.EmpID).trim())).size !== 1) { status = 'bloqueado'; reason = 'EmpID divergente nas tarefas elegíveis'; }
    return { cnpj: formatCnpj(cnpj), empId: found[0]?.EmpID ?? null, empresa: found[0]?.Empresa ?? null,
      status, reason, tasks: [...new Set(found.map(r => r['Obrigação / Tarefa']))],
      matchingRows: allowed.map(r => r._row), target: rules.answerRef };
  });
}
