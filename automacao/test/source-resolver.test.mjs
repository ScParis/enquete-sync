import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNormalizedSource } from '../lib/source-resolver.mjs';

test('resolveNormalizedSource: normaliza CSV plano sem perfil pré-definido', async () => {
  const mockCsv = 'CNPJ,Obrigação / Tarefa\n12.345.678/0001-90,DIFAL\n';
  const payload = {
    sourceType: 'test',
    accountId: '6019'
  };

  const resolved = await resolveNormalizedSource(payload, {
    loadSource: async () => ({ csv: mockCsv, label: 'teste.csv', stale: false }),
    savedProfiles: []
  });

  assert.equal(resolved.source.label, 'teste.csv');
  assert.equal(resolved.rows.length, 1);
  const task = resolved.rows[0]._norm?.tarefa ?? resolved.rows[0]['Obrigação / Tarefa'];
  assert.equal(task, 'DIFAL');
});

test('resolveNormalizedSource: aplica perfil sugerido quando aplicável', async () => {
  const mockCsv = 'Codigo,Obrigacao,Documento\n101,Folha Mensal,12345678000190\n';
  const payload = {
    sourceType: 'test',
    accountId: '6019'
  };

  const resolved = await resolveNormalizedSource(payload, {
    loadSource: async () => ({ csv: mockCsv, label: 'teste_perfil.csv', stale: false }),
    savedProfiles: []
  });

  assert.equal(resolved.rows.length, 1);
  assert.ok(resolved.profile !== null);
  assert.equal(resolved.profile.targetModel, 'enquete_automacao');
});
