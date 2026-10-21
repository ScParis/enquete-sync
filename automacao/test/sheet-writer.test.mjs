import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appsScriptSource, validScriptUrl, writeMarks, testSheetWriter } from '../lib/sheet-writer.mjs';

const TOKEN = 'a'.repeat(48);
// Planilha simulada com a API mínima do Apps Script usada pelo script gerado.
function fakeSpreadsheet(rows, gid = 150007372) {
  const grid = rows.map(r => [...r]);
  const sheet = {
    getSheetId: () => gid, getName: () => 'Enquete - fiscal',
    getDataRange: () => ({ getValues: () => grid.map(r => [...r]) }),
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      setValue: v => { while (grid.length < row) grid.push([]); const line = grid[row - 1]; while (line.length < col) line.push(''); line[col - 1] = v; },
      setValues: matrix => {
        matrix.forEach((rVals, rIdx) => {
          const r = row + rIdx;
          while (grid.length < r) grid.push([]);
          const line = grid[r - 1];
          rVals.forEach((cVal, cIdx) => {
            const c = col + cIdx;
            while (line.length < c) line.push('');
            line[c - 1] = cVal;
          });
        });
      }
    })
  };
  return { grid, sandbox: {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }) },
    LockService: { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) }
  } };
}
function run(rows, body) {
  const { grid, sandbox } = fakeSpreadsheet(rows);
  vm.runInNewContext(appsScriptSource(TOKEN), sandbox);
  return { result: sandbox.doPost({ postData: { contents: JSON.stringify(body) } }), grid };
}

test('script grava na coluna "Enquete G-Click" só as linhas do CNPJ e da tarefa marcados', () => {
  const rows = [['Obrigação / Tarefa', 'Empresa', 'EmpID', 'CNPJ'],
    ['GIA-ST', 'CDB 1', '894', '68.699.407/0001-92'],
    ['DAS - Mensal', 'CDB 1', '894', '68.699.407/0001-92'],
    ['GIA-ST', 'CDB 2', '895', '68.699.448/0001-89']];
  const { result, grid } = run(rows, { chave: TOKEN, gid: 150007372, marcacoes: [
    { cnpj: '68699407000192', tarefa: 'GIA-ST', texto: 'Marcado na Enquete: 02.03 → GIA ST' },
    { cnpj: '68.699.448/0001-89', tarefa: 'GIA-ST', texto: 'Marcado na Enquete: 02.03 → GIA ST' },
    { cnpj: '11.222.333/0001-81', tarefa: 'GIA-ST', texto: 'x' }] });
  assert.equal(result.ok, true);
  assert.equal(result.linhas, 2);
  assert.deepEqual(result.naoEncontrados, ['11222333000181|GIA-ST']);
  assert.equal(grid[0][4], 'Enquete G-Click');
  assert.equal(grid[1][4], 'Marcado na Enquete: 02.03 → GIA ST');
  assert.equal(grid[2][4] ?? '', '', 'outra tarefa do mesmo CNPJ não é tocada');
  assert.equal(grid[3][4], 'Marcado na Enquete: 02.03 → GIA ST');
});

test('script recusa chave errada e informa aba no teste', () => {
  const rows = [['Obrigação / Tarefa', 'CNPJ']];
  assert.deepEqual(run(rows, { chave: 'b'.repeat(48), gid: 150007372, teste: true }).result, { ok: false, erro: 'Chave inválida' });
  assert.deepEqual(run(rows, { chave: TOKEN, gid: 150007372, teste: true }).result, { ok: true, aba: 'Enquete - fiscal' });
  assert.match(run(rows, { chave: TOKEN, gid: 1, teste: true }).result.erro, /Aba não encontrada/);
});

test('endereço precisa ser app da web do Apps Script; erro do script vira mensagem clara', async () => {
  assert.equal(validScriptUrl('https://script.google.com/macros/s/AKfy_abc-1/exec'), 'https://script.google.com/macros/s/AKfy_abc-1/exec');
  assert.throws(() => validScriptUrl('https://example.com/exec'), /app da web/);
  const ok = async (url, init) => ({ status: 200, text: async () => JSON.stringify({ ok: true, linhas: 1, naoEncontrados: [], echo: JSON.parse(init.body) }) });
  const r = await writeMarks({ url: 'u', token: TOKEN, gid: 1 }, [{ cnpj: '1', task: 'T', texto: 'X' }], ok);
  assert.deepEqual(r.echo, { chave: TOKEN, gid: 1, marcacoes: [{ cnpj: '1', tarefa: 'T', texto: 'X' }] });
  const html = async () => ({ status: 200, text: async () => '<html>login</html>' });
  await assert.rejects(testSheetWriter({ url: 'u', token: TOKEN, gid: 1 }, html), /Qualquer pessoa/);
});
