import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseHeaderAndSample } from '../lib/source-inspector.mjs';

test('source-inspector: inspeciona CSV simples com vírgula e amostras', () => {
  const csv = `Nome,CNPJ,Valor\nEmpresa A,12.345.678/0001-90,100\nEmpresa B,98.765.432/0001-10,200`;
  const info = parseHeaderAndSample(csv);

  assert.equal(info.headerRow, 1);
  assert.equal(info.delimiter, ',');
  assert.equal(info.columnCount, 3);
  assert.equal(info.totalRows, 2);
  assert.equal(info.columns[0].name, 'Nome');
  assert.equal(info.columns[1].suggestedField, 'cnpj');
  assert.equal(info.columns[1].confidence, 'high');
  assert.equal(info.columns[1].needsConfirmation, false);
  assert.deepEqual(info.columns[1].samples, ['12.345.678/0001-90', '98.765.432/0001-10']);
});

test('source-inspector: suporta cabeçalho em linha arbitrária (ex.: linha 2)', () => {
  const csv = `Relatório Gerencial 2026;;\nEmpresa;Obrigação / Tarefa;CNPJ\nPadaria ABC;DAS - Mensal;12.345.678/0001-90`;
  const info = parseHeaderAndSample(csv, { headerRow: 2 });

  assert.equal(info.headerRow, 2);
  assert.equal(info.delimiter, ';');
  assert.equal(info.columnCount, 3);
  assert.equal(info.columns[0].name, 'Empresa');
  assert.equal(info.columns[0].suggestedField, 'empresa');
  assert.equal(info.columns[1].name, 'Obrigação / Tarefa');
  assert.equal(info.columns[1].suggestedField, 'tarefa');
  assert.equal(info.columns[2].name, 'CNPJ');
  assert.equal(info.columns[2].suggestedField, 'cnpj');
  assert.equal(info.totalRows, 1);
});

test('source-inspector: lida com cabeçalhos vazios, repetidos e genéricos', () => {
  const csv = `ID,Status,,Status,Column 17\n1,Ativo,obs,OK,574`;
  const info = parseHeaderAndSample(csv);

  assert.equal(info.columnCount, 5);
  assert.equal(info.columns[0].name, 'ID');
  assert.equal(info.columns[1].name, 'Status');
  assert.equal(info.columns[1].isDuplicate, false);
  assert.equal(info.columns[2].name, 'Coluna 3');
  assert.equal(info.columns[2].isUnnamed, true);
  assert.equal(info.columns[3].name, 'Status');
  assert.equal(info.columns[3].isDuplicate, true);
  assert.equal(info.columns[4].name, 'Column 17');
  assert.equal(info.columns[4].needsConfirmation, true);
});

test('source-inspector: inspeciona CSV real da aba Clientes (20 colunas, 50 registros)', async () => {
  const path = '/home/piperun/Documentos/temp/G-click/HoraSync - Registro de Horas (2026) - Clientes.csv';
  const content = await fs.readFile(path, 'utf8');
  const info = parseHeaderAndSample(content);

  assert.equal(info.columnCount, 20);
  assert.equal(info.totalRows, 50);

  // Coluna 0: Cod.
  assert.equal(info.columns[0].rawHeader, 'Cod.');
  assert.equal(info.columns[0].suggestedField, 'cod');
  assert.equal(info.columns[0].needsConfirmation, true);

  // Coluna 1: Cliente
  assert.equal(info.columns[1].rawHeader, 'Cliente');
  assert.equal(info.columns[1].suggestedField, 'empresa');
  assert.equal(info.columns[1].needsConfirmation, false);

  // Coluna 5: Column 17
  assert.equal(info.columns[5].rawHeader, 'Column 17');
  assert.equal(info.columns[5].needsConfirmation, true);

  // Coluna 7: Column 18
  assert.equal(info.columns[7].rawHeader, 'Column 18');
  assert.equal(info.columns[7].needsConfirmation, true);

  // Colunas 8 e 9: Data-base 2026 e Competência
  assert.equal(info.columns[8].rawHeader, 'Data-base 2026');
  assert.equal(info.columns[8].suggestedField, 'data_base');
  assert.equal(info.columns[9].rawHeader, 'Competência');
  assert.equal(info.columns[9].suggestedField, 'competencia');
});
