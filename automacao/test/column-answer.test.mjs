import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolveColumnValue } from '../lib/gclick.mjs';

const grid = headers => `<table><thead><tr><th>Cliente</th>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
  <tr><td>68.699.407/0001-92</td>${headers.map((_, i) => `<td><input type="checkbox" id="cb.894-${450 + i}" value="${450 + i}"></td>`).join('')}</tr>
  <tr><td>68.699.448/0001-89</td>${headers.map((_, i) => `<td><input type="checkbox" id="cb.895-${450 + i}" value="${450 + i}"></td>`).join('')}</tr>
</tbody></table>`;
const rules = { questionRef: '02.03', answerRef: '02.03.08', answerLabel: '08 - GIA ST' };

test('resposta sem código no catálogo usa a coluna de cabeçalho idêntico e lê o código da tela', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(grid(['07 LFE - DF', '08 GIA ST', '09 GIA - PE']));
    assert.equal(await resolveColumnValue(page, rules), '451');
    await page.setContent(grid(['07 LFE - DF', '08 GIA ST - Anual', '09 GIA - PE']));
    await assert.rejects(resolveColumnValue(page, rules), /não encontrada/, 'semelhança parcial não pode escolher coluna');
    await page.setContent(grid(['08 GIA ST', 'GIA ST']));
    await assert.rejects(resolveColumnValue(page, rules), /mais de uma vez/);
    await page.setContent(grid(['08 GIA ST']).replace('id="cb.895-450" value="450"', 'id="cb.895-999" value="999"'));
    await assert.rejects(resolveColumnValue(page, rules), /sem código interno único/);
  } finally { await browser.close(); }
});

test('navegação repete em oscilação de rede e desiste em erro definitivo', async () => {
  const { gotoWithRetry } = await import('../lib/gclick.mjs');
  let calls = 0;
  const flaky = { isClosed: () => false, goto: async () => { if (++calls < 3) throw new Error('page.goto: net::ERR_NETWORK_CHANGED at https://app.gclick.com.br/'); return 'ok'; } };
  assert.equal(await gotoWithRetry(flaky, 'x', { delayMs: 1 }), 'ok');
  assert.equal(calls, 3);
  let hard = 0;
  const broken = { isClosed: () => false, goto: async () => { hard++; throw new Error('page.goto: net::ERR_CERT_INVALID'); } };
  await assert.rejects(gotoWithRetry(broken, 'x', { delayMs: 1 }), /CERT_INVALID/);
  assert.equal(hard, 1);
});
