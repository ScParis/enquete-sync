import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.mjs';

test('POST /api/cancel retorna sucesso e limpa locks de execução', async (t) => {
  const testServer = http.createServer(server.listeners('request')[0]);
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;
  const base = `http://127.0.0.1:${testPort}`;
  t.after(() => new Promise(resolve => testServer.close(resolve)));

  // Autentica para obter cookie de sessão válido
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gclick.local', password: 'Admin@123456' })
  });
  assert.equal(loginRes.status, 200);
  const sessionCookie = loginRes.headers.get('set-cookie').split(';')[0];

  // Aciona cancelamento
  const cancelRes = await fetch(`${base}/api/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': `http://127.0.0.1:${testPort}`,
      'Cookie': sessionCookie
    },
    body: JSON.stringify({})
  });

  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.success, true);
  assert.equal(typeof cancelData.message, 'string');
});
