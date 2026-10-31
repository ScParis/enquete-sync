import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const link = 'https://docs.google.com/spreadsheets/d/abc123/edit?gid=42';
const table = { columns: ['Obrigação / Tarefa', 'CNPJ'].map((name, index) => ({ name, index, filled: 1, distinct: 1 })), rows: [['DeSTDA', '19.402.991/0001-67']] };
const structure = { columnCount: 2, headerRow: 1, columns: [
  { index: 0, position: 1, name: 'Obrigação / Tarefa', suggestedField: 'tarefa', samples: ['DeSTDA'] },
  { index: 1, position: 2, name: 'CNPJ', suggestedField: 'cnpj', samples: ['19.402.991/0001-67'] }] };

async function openWith(savedProfiles, profile) {
  const server = http.createServer(async (req, res) => {
    const file = req.url === '/' ? 'ui/index.html' : req.url === '/ui/app.js' ? 'ui/app.js' : 'ui/style.css';
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await fs.readFile(path.join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const calls = { tasks: [], inspect: 0 };
  await page.route('**/api/config', route => route.fulfill({ json: { token: 'test', accounts: [], savedMappings: [], savedProfiles } }));
  await page.route('**/api/downloads', route => route.fulfill({ json: { files: [] } }));
  await page.route('**/api/tasks', route => { calls.tasks.push(route.request().postDataJSON()); route.fulfill({ json: {
    source: link, rowCount: 1, tasks: [{ name: 'DeSTDA', count: 1, clients: 1, invalidCnpjs: 0 }], table, profile } }); });
  await page.route('**/api/source/inspect', route => { calls.inspect++; route.fulfill({ json: { source: link, structure, existingProfile: null, suggestedProfile: profile } }); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  return { page, calls, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('link público do Google Sheets é a fonte padrão e é lido sem credencial', async () => {
  const saved = { id: 'p1', version: 2, targetModel: 'enquete_automacao', columns: [] };
  const { page, calls, close } = await openWith([saved], saved);
  try {
    assert.equal(await page.getByRole('radio', { name: 'Link do Google Sheets' }).isChecked(), true);
    await page.locator('#sourceUrl').fill(link);
    await page.locator('#loadSourceBtn').click();
    await page.waitForFunction(() => document.querySelector('#sourcePreviewInfo')?.textContent.includes('DE/PARA salvo (v2)'));
    assert.equal(calls.tasks[0].sourceType, 'url');
    assert.equal(calls.tasks[0].sourceUrl, link);
    assert.equal(calls.tasks[0].serviceKeyBase64, undefined);
    assert.equal(calls.inspect, 0, 'DE/PARA salvo não precisa de conferência');
    assert.equal(await page.locator('#mappingEditorSection').isHidden(), true);
  } finally { await close(); }
});

test('sem DE/PARA salvo, a leitura abre o DE/PARA sugerido para conferir e salvar', async () => {
  const suggested = { id: 'sug', version: 1, targetModel: 'enquete_automacao', columns: [] };
  const { page, calls, close } = await openWith([], suggested);
  try {
    await page.locator('#sourceUrl').fill(link);
    await page.locator('#loadSourceBtn').click();
    await page.waitForFunction(() => !document.querySelector('#mappingEditorSection').hidden);
    assert.match(await page.locator('#sourcePreviewInfo').innerText(), /DE\/PARA sugerido, ainda não salvo/);
    assert.match(await page.locator('#sourceStatus').innerText(), /Confira o DE\/PARA abaixo e salve/);
    assert.equal(calls.inspect, 1);
    assert.equal(await page.locator('#mappingColumnsBody tr').count(), 2);
  } finally { await close(); }
});
