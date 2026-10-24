import test from 'node:test';
import assert from 'node:assert/strict';
import { hasGclickSession } from '../lib/gclick.mjs';

function fakeContext({ visible = true, existing = false } = {}) {
  const pages = [];
  let created = 0;
  const makePage = (initialUrl = 'about:blank') => {
    let url = initialUrl;
    let closed = false;
    const page = {
      url: () => url,
      isClosed: () => closed,
      goto: async target => { url = target; },
      getByText: () => ({ first: () => ({ waitFor: async () => { if (!visible) throw new Error('not visible'); } }) }),
      close: async () => { closed = true; }
    };
    pages.push(page);
    return page;
  };
  if (existing) makePage('https://app.gclick.com.br/Listar.do?obj=enqueteopen&tipo=0&empId=6581');
  return { pages: () => pages, newPage: async () => { created++; return makePage(); }, get created() { return created; } };
}

test('sessão válida mantém a aba da Enquete e a reutiliza', async () => {
  const context = fakeContext();
  assert.equal(await hasGclickSession(context, '6581'), true);
  assert.equal(context.created, 1);
  assert.equal(context.pages()[0].isClosed(), false);
  assert.equal(await hasGclickSession(context, '6581'), true);
  assert.equal(context.created, 1);
});

test('falha de validação fecha apenas a aba criada pela checagem', async () => {
  const context = fakeContext({ visible: false });
  assert.equal(await hasGclickSession(context, '6581'), false);
  assert.equal(context.pages()[0].isClosed(), true);
});

test('não fecha a aba já aberta pelo usuário se a validação falhar', async () => {
  const context = fakeContext({ visible: false, existing: true });
  assert.equal(await hasGclickSession(context, '6581'), false);
  assert.equal(context.created, 0);
  assert.equal(context.pages()[0].isClosed(), false);
});
