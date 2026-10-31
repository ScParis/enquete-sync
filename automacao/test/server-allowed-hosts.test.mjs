import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { route, isAllowedHost } from '../server.mjs';

test('isAllowedHost valida corretamente domínios autorizados e contingência', () => {
  // Hosts autorizados principais
  assert.equal(isAllowedHost('127.0.0.1'), true);
  assert.equal(isAllowedHost('localhost'), true);
  assert.equal(isAllowedHost('app.jb-consultoria.com'), true);
  assert.equal(isAllowedHost('jb-consultoria.com'), true);

  // Subdomínios permitidos
  assert.equal(isAllowedHost('painel.jb-consultoria.com'), true);
  assert.equal(isAllowedHost('sistema.local'), true);

  // Case insensitive
  assert.equal(isAllowedHost('APP.JB-CONSULTORIA.COM'), true);
  assert.equal(isAllowedHost('LocalHost'), true);

  // Domínios não autorizados ou tentativas maliciosas
  assert.equal(isAllowedHost('evil.com'), false);
  assert.equal(isAllowedHost('app.jb-consultoria.com.br'), false); // TLD diferente
  assert.equal(isAllowedHost('attacker-jb-consultoria.com'), false); // Não é subdomínio
  assert.equal(isAllowedHost('notjb-consultoria.com'), false);
  assert.equal(isAllowedHost(''), false);
  assert.equal(isAllowedHost(null), false);
  assert.equal(isAllowedHost(undefined), false);
});

test('Rotas POST aceitam app.jb-consultoria.com e 127.0.0.1, mas bloqueiam origens invasoras', async () => {
  const testServer = http.createServer((req, res) => route(req, res));
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;
  const base = `http://127.0.0.1:${testPort}`;

  try {
    // 1. Requisição com Origin do app corporativo
    const resAppOrigin = await fetch(`${base}/api/cancel`, {
      method: 'POST',
      headers: {
        'Origin': 'http://app.jb-consultoria.com'
      }
    });
    const bodyAppOrigin = await resAppOrigin.json();
    assert.notEqual(resAppOrigin.status, 403, 'app.jb-consultoria.com não pode retornar 403');
    assert.notEqual(bodyAppOrigin.code, 'forbidden_origin');

    // 2. Requisição com Origin de contingência (127.0.0.1)
    const resContingencia = await fetch(`${base}/api/cancel`, {
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${testPort}`
      }
    });
    const bodyContingencia = await resContingencia.json();
    assert.notEqual(resContingencia.status, 403, '127.0.0.1 não pode retornar 403');
    assert.notEqual(bodyContingencia.code, 'forbidden_origin');

    // 3. Requisição com Referer do app corporativo
    const resAppReferer = await fetch(`${base}/api/cancel`, {
      method: 'POST',
      headers: {
        'Referer': 'http://app.jb-consultoria.com/'
      }
    });
    const bodyAppReferer = await resAppReferer.json();
    assert.notEqual(resAppReferer.status, 403, 'Referer app.jb-consultoria.com não pode retornar 403');
    assert.notEqual(bodyAppReferer.code, 'forbidden_origin');

    // 4. Requisição com Origin invasora (deve ser 403)
    const resInvasor = await fetch(`${base}/api/cancel`, {
      method: 'POST',
      headers: {
        'Origin': 'http://site-malicioso.com'
      }
    });
    const bodyInvasor = await resInvasor.json();
    assert.equal(resInvasor.status, 403);
    assert.equal(bodyInvasor.code, 'forbidden_origin');
    assert.equal(bodyInvasor.error, 'Origem não permitida');

    // 5. Requisição com Referer invasor (deve ser 403)
    const resRefMalicioso = await fetch(`${base}/api/cancel`, {
      method: 'POST',
      headers: {
        'Referer': 'http://site-malicioso.com/phishing'
      }
    });
    const bodyRefMalicioso = await resRefMalicioso.json();
    assert.equal(resRefMalicioso.status, 403);
    assert.equal(bodyRefMalicioso.code, 'forbidden_origin');
    assert.equal(bodyRefMalicioso.error, 'Referer não permitido');

  } finally {
    await new Promise(resolve => testServer.close(resolve));
  }
});
