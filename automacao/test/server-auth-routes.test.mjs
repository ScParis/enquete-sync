import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AuthService } from '../lib/auth-service.mjs';
import { getDatabase } from '../lib/db.mjs';

import { server } from '../server.mjs';

test('Rotas HTTP de Autenticação e RBAC: login, me, logout, gestão de usuários e overrides', async (t) => {
  // Inicia servidor em porta dinâmica para teste isolado sem colidir com ambiente local
  const testServer = http.createServer(server.listeners('request')[0]);
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;
  const base = `http://127.0.0.1:${testPort}`;
  t.after(() => new Promise(resolve => testServer.close(resolve)));

  // 1. Falha de Login
  const failRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gclick.local', password: 'senha_errada' })
  });
  assert.equal(failRes.status, 401);
  const failData = await failRes.json();
  assert.match(failData.error, /incorretos/i);

  // 2. Login com sucesso
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gclick.local', password: 'Admin@123456' })
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.equal(loginData.ok, true);
  assert.equal(loginData.user.email, 'admin@gclick.local');

  const setCookie = loginRes.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('gclick_session='), 'Deve retornar cookie gclick_session');
  const sessionCookie = setCookie.split(';')[0];

  // 3. GET /api/auth/me autenticado
  const meRes = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: sessionCookie }
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.authenticated, true);
  assert.equal(meData.user.email, 'admin@gclick.local');

  // 4. GET /api/users (requer permissão usuarios.administrar)
  const usersRes = await fetch(`${base}/api/users`, {
    headers: { Cookie: sessionCookie }
  });
  assert.equal(usersRes.status, 200);
  const usersData = await usersRes.json();
  assert.ok(Array.isArray(usersData.users));
  assert.ok(Array.isArray(usersData.roles));
  assert.ok(Array.isArray(usersData.permissions));

  // 5. POST /api/users/create (criar usuário de teste)
  const createRes = await fetch(`${base}/api/users/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({
      name: 'Teste RBAC Operador',
      email: 'teste.operador@empresa.com.br',
      password: 'Senha@123456',
      roleSlugs: ['operador'],
      accountIds: ['2420']
    })
  });
  assert.equal(createRes.status, 200);
  const createdUser = (await createRes.json()).user;
  assert.equal(createdUser.email, 'teste.operador@empresa.com.br');

  // 6. POST /api/users/override (conceder override de permissão)
  const overrideRes = await fetch(`${base}/api/users/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({
      userId: createdUser.id,
      permissionSlug: 'planilha.escrever',
      allowed: true
    })
  });
  assert.equal(overrideRes.status, 200);
  const updatedUser = (await overrideRes.json()).user;
  const pEscrever = updatedUser.permissions.find(p => p.slug === 'planilha.escrever');
  assert.equal(pEscrever.allowed, true);
  assert.equal(pEscrever.source, 'override_allowed');

  // Limpeza: remover usuário de teste
  await fetch(`${base}/api/users/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ id: createdUser.id })
  });

  // 7. Logout
  const logoutRes = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: sessionCookie }
  });
  assert.equal(logoutRes.status, 200);

  // 8. Checar /api/auth/me após logout (não deve conter campo token)
  const meAfterLogout = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: sessionCookie }
  });
  const meAfterData = await meAfterLogout.json();
  assert.equal(meAfterData.authenticated, false);
  assert.equal(meAfterData.token, undefined, 'Anônimo nunca deve receber token');

  // 9. /api/config deve recusar anônimo
  const configAnon = await fetch(`${base}/api/config`);
  assert.equal(configAnon.status, 401);

  // 10. GET /api/gclick/session autenticado
  const loginAgain = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gclick.local', password: 'Admin@123456' })
  });
  const newCookie = loginAgain.headers.get('set-cookie').split(';')[0];
  const sessionRes = await fetch(`${base}/api/gclick/session?accountId=2420`, {
    headers: { Cookie: newCookie }
  });
  assert.equal(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.ok(sessionData.browserStatus, 'Deve retornar browserStatus');
  assert.ok(sessionData.gclickAuthStatus, 'Deve retornar gclickAuthStatus');
  assert.equal(sessionData.activeAccountId, '2420');

  // 11. /api/obrigacoes/inspect sem autenticação recusa 401
  const obrigacoesAnon = await fetch(`${base}/api/obrigacoes/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: '2420' })
  });
  assert.equal(obrigacoesAnon.status, 401);

  // 12. /api/obrigacoes/inspect autenticado mas sem janela aberta recusa com erro amigável sem abrir browser headless
  const obrigacoesAuth = await fetch(`${base}/api/obrigacoes/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: newCookie },
    body: JSON.stringify({ accountId: '2420' })
  });
  assert.equal(obrigacoesAuth.status, 400);
  const obrigacoesData = await obrigacoesAuth.json();
  assert.match(obrigacoesData.error, /janela do G-Click precisa estar aberta/);
});

