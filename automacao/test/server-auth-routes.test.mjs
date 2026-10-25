import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AuthService } from '../lib/auth-service.mjs';
import { getDatabase } from '../lib/db.mjs';

test('Rotas HTTP de Autenticação e RBAC: login, me, logout, gestão de usuários e overrides', async (t) => {
  // Faz requisições HTTP locais no servidor ativo (porta 8766)
  const base = 'http://127.0.0.1:8766';

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

  // 8. Checar /api/auth/me após logout
  const meAfterLogout = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: sessionCookie }
  });
  assert.equal((await meAfterLogout.json()).authenticated, false);
});
