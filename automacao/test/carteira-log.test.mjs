import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getDatabase } from '../lib/db.mjs';
import { registrarCarteiraOperacao, listarCarteiraOperacoes, statusCarteiraOperacao } from '../lib/carteira-log.mjs';

test('carteira-log: grava sucesso, parcial e erro por conta, do mais recente ao mais antigo', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carteira-log-'));
  const db = getDatabase(path.join(dir, 'test.db'));
  t.after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });

  assert.equal(statusCarteiraOperacao(['a', 'b'], ['a', 'b']), 'ok');
  assert.equal(statusCarteiraOperacao(['a', 'b'], ['a']), 'parcial');
  assert.equal(statusCarteiraOperacao(['a'], []), 'erro');
  assert.equal(statusCarteiraOperacao(['a'], ['a'], 'aviso do G-Click'), 'parcial');
  assert.equal(statusCarteiraOperacao(['a'], [], 'falhou'), 'erro');

  registrarCarteiraOperacao({ accountId: '4966', operador: 'op@x', acao: 'vincular', origem: 'restantes', usuario: 'Ana', solicitados: ['1'], concluidos: ['1'] }, db);
  registrarCarteiraOperacao({ accountId: '4966', operador: 'op@x', acao: 'retirar', usuario: 'Andreane', solicitados: ['1', '2'], concluidos: ['1'], erro: '1 CNPJ(s) continuaram em Minha Carteira' }, db);
  registrarCarteiraOperacao({ accountId: '4966', acao: 'retirar', usuario: 'Andreane', solicitados: ['3'], erro: 'Sessão no G-Click não detectada.' }, db);
  registrarCarteiraOperacao({ accountId: '7128', acao: 'retirar', usuario: 'Outro', solicitados: ['9'], concluidos: ['9'] }, db);

  const ops = listarCarteiraOperacoes('4966', {}, db);
  assert.deepEqual(ops.map(op => [op.acao, op.status]), [['retirar', 'erro'], ['retirar', 'parcial'], ['vincular', 'ok']]);
  assert.equal(ops[0].erro, 'Sessão no G-Click não detectada.');
  assert.deepEqual(ops[1].concluidos, ['1']);
  assert.equal(ops[2].origem, 'restantes');
  assert.equal(listarCarteiraOperacoes('7128', {}, db).length, 1);
});
