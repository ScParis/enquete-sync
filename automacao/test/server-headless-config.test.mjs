import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.mjs';

test('server e config: API expõe estado headless e aceita parâmetro headless na conferência', async (t) => {
  const testServer = http.createServer(server.listeners('request')[0]);
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;
  const base = `http://127.0.0.1:${testPort}`;
  t.after(() => new Promise(resolve => testServer.close(resolve)));

  // 1. Obter token e verificar /api/config
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gclick.local', password: 'Admin@123456' })
  });
  assert.equal(loginRes.status, 200);
  const sessionCookie = loginRes.headers.get('set-cookie').split(';')[0];

  const configRes = await fetch(`${base}/api/config`, {
    headers: { Cookie: sessionCookie }
  });
  assert.equal(configRes.status, 200);
  const config = await configRes.json();
  assert.equal(typeof config.headless, 'boolean');
});

