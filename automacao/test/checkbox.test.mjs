import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { inspectClient } from '../lib/gclick.mjs';

const item = { cnpj: '19.402.991/0001-67', empId: '887', status: 'pronto' };
const rules = { questionRef: '02.02', answerValue: '409', inputType: 'checkbox' };

test('DeSTDA depende somente da caixa 409, mesmo com outra obrigação marcada', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<table><tbody><tr><td><a>CASA RODRIGUEZ & CO LTDA 887</a> 19.402.991/0001-67</td><td><input type="checkbox" id="cb.1263-409" value="409"></td><td><input type="checkbox" id="cb.1263-379" value="379" checked></td></tr></tbody></table>');
    const before = await inspectClient(page, item, rules);
    assert.equal(before.uiStatus, 'vazio');
    assert.equal(before.internalId, '1263');
    await page.locator('[id="cb.1263-409"]').check();
    const after = await inspectClient(page, item, rules);
    assert.equal(after.uiStatus, 'ja_correto');
    assert.equal(after.currentValue, '409');
  } finally { await browser.close(); }
});
