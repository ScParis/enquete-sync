import fs from 'node:fs/promises';
import path from 'node:path';

const required = ['Obrigação / Tarefa', 'EmpID', 'CNPJ'];
export async function listCsvDownloads(directory, now = Date.now()) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.csv')) continue;
    const full = path.join(directory, entry.name);
    const stat = await fs.stat(full);
    if (now - stat.mtimeMs > 7 * 86400_000 || stat.size === 0 || stat.size > 25 * 1024 * 1024) continue;
    const file = await fs.open(full, 'r');
    let header;
    try { const buffer = Buffer.alloc(4096); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); header = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 1)[0].replace(/^\uFEFF/, ''); }
    finally { await file.close(); }
    if (!required.every(x => header.includes(x))) continue;
    matches.push({ name: entry.name, modifiedAt: new Date(stat.mtimeMs).toISOString(), size: stat.size, stale: now - stat.mtimeMs > 86400_000 });
  }
  return matches.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 30);
}
export async function readCsvDownload(directory, name) {
  if (typeof name !== 'string' || name !== path.basename(name) || !name.toLowerCase().endsWith('.csv')) throw new Error('Nome de download inválido');
  const found = (await listCsvDownloads(directory)).find(x => x.name === name);
  if (!found) throw new Error('CSV baixado não encontrado ou sem as colunas obrigatórias');
  return { csv: await fs.readFile(path.join(directory, name), 'utf8'), label: `Downloads/${name} (${found.modifiedAt})`, stale: found.stale };
}
