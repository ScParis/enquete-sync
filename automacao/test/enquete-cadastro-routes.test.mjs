import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEnqueteCadastroRoutes } from '../routes/enquete-cadastro.routes.mjs';

function mockContext(overrides = {}) {
  const sent = [];
  return {
    ctx: {
      url: new URL('http://127.0.0.1:8766/api/enquete/conferencia?accountId=3032'),
      payload: {},
      currentUser: { id: 1, name: 'Admin', email: 'admin@gclick.local' },
      authService: {
        hasPermission: () => true
      },
      requireAccount: (id) => id || '3032',
      loginContext: null,
      loginReady: false,
      readStoredCatalog: async () => ({
        accountId: '3032',
        questions: [
          {
            ref: '01.05',
            label: 'Qual o Ramo de atividade do Cliente?',
            answers: [{ ref: '01.05.01', label: 'Comércio' }]
          }
        ]
      }),
      readQuestionCatalog: async () => {},
      send: (res, code, data) => {
        sent.push({ code, data });
        return { code, data };
      },
      ...overrides
    },
    sent
  };
}

test('enquete-cadastro routes: GET /api/enquete/conferencia bloqueia sem permissão', async () => {
  const { ctx, sent } = mockContext({
    authService: { hasPermission: () => false }
  });

  await handleEnqueteCadastroRoutes({ method: 'GET' }, {}, ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, 403);
  assert.match(sent[0].data.error, /Acesso negado/);
});

test('enquete-cadastro routes: GET /api/enquete/progresso retorna estado inicial', async () => {
  const { ctx, sent } = mockContext({
    url: new URL('http://127.0.0.1:8766/api/enquete/progresso')
  });

  await handleEnqueteCadastroRoutes({ method: 'GET' }, {}, ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, 200);
  assert.equal(sent[0].data.progress.running, false);
});

test('enquete-cadastro routes: POST /api/enquete/cadastrar bloqueia se G-Click fechado', async () => {
  const { ctx, sent } = mockContext({
    url: new URL('http://127.0.0.1:8766/api/enquete/cadastrar')
  });

  const req = {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ accountId: '3032', items: [{ answerName: 'Contabil' }] }));
    }
  };

  await handleEnqueteCadastroRoutes(req, {}, ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, 400);
  assert.match(sent[0].data.error, /A janela do G-Click precisa estar aberta/);
});
