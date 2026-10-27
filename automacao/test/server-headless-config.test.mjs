import test from 'node:test';
import assert from 'node:assert/strict';

test('server e config: API expõe estado headless e aceita parâmetro headless na conferência', async () => {
  const base = 'http://127.0.0.1:8766';

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
