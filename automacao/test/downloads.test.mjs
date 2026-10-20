import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listCsvDownloads, readCsvDownload } from '../lib/downloads.mjs';
test('lista somente CSV de obrigação e impede caminho arbitrário', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gclick-download-test-'));
  try {
    await fs.writeFile(path.join(dir, 'correto.csv'), 'Obrigação / Tarefa,Empresa,EmpID,CNPJ\nDAS - Mensal,A,1,19.402.991/0001-67\n');
    await fs.writeFile(path.join(dir, 'outro.csv'), 'Nome,Id\nA,1\n');
    const listed = await listCsvDownloads(dir);
    assert.deepEqual(listed.map(x => x.name), ['correto.csv']);
    assert.match((await readCsvDownload(dir, 'correto.csv')).csv, /DAS - Mensal/);
    await assert.rejects(() => readCsvDownload(dir, '../outro.csv'), /inválido/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
