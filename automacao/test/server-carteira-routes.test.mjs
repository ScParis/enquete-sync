import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.mjs';

test('Rotas HTTP de Carteira de Usuários e RBAC', async (t) => {
  const testServer = http.createServer(server.listeners('request')[0]);
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = testServer.address().port;
  const base = `http://127.0.0.1:${testPort}`;
  t.after(() => new Promise(resolve => testServer.close(resolve)));

  // 1. Login como Administrador
  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gclick.local', password: 'Admin@123456' })
  });
  assert.equal(loginRes.status, 200);
  const sessionCookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(sessionCookie);

  // 2. POST /api/carteira/sheet/parse - Processamento de planilha
  const sampleCsv = `Pessoa responsável,Empresa,CNPJ
ana.exito,AGUIAR PACK,59994000000105
ana.exito,ASA COMERCIO,5396572000155`;

  const parseRes = await fetch(`${base}/api/carteira/sheet/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: 'http://127.0.0.1'
    },
    body: JSON.stringify({ accountId: '6581', csvContent: sampleCsv })
  });
  assert.equal(parseRes.status, 200);
  const parseData = await parseRes.json();
  assert.equal(parseData.success, true);
  assert.equal(parseData.totalRows, 2);
  assert.equal(parseData.users.length, 1);
  assert.equal(parseData.users[0].responsavel, 'ana.exito');
  assert.equal(parseData.users[0].empresas[1].cnpjFormatado, '05.396.572/0001-55');

  // 2b. Planilhas lê a aba da Carteira com DE/PARA próprio, mesmo com nomes de coluna fora do padrão
  const headers = { 'Content-Type': 'application/json', Cookie: sessionCookie, Origin: 'http://127.0.0.1' };
  const otherCsv = 'Usuário,Razão Social,CNPJ\nana.exito,AGUIAR PACK,59994000000105\nraquel.exito,ASA COMERCIO,5396572000155\n';
  const loadRes = await fetch(`${base}/api/source/load`, { method: 'POST', headers, body: JSON.stringify({
    accountId: '6581', sourceType: 'file', fileName: 'carteira.csv', fileBase64: Buffer.from(otherCsv).toString('base64'), targetModel: 'carteira_responsaveis' }) });
  assert.equal(loadRes.status, 200);
  const loadData = await loadRes.json();
  assert.equal(loadData.profile.targetModel, 'carteira_responsaveis');
  assert.deepEqual(loadData.missingFields, []);
  assert.equal(loadData.normalized[1]._norm.responsavel, 'raquel.exito');
  assert.equal(loadData.table.columns[0].name, 'Usuário');

  const rowsRes = await fetch(`${base}/api/carteira/sheet/parse`, { method: 'POST', headers, body: JSON.stringify({ accountId: '6581',
    rows: loadData.normalized.map(r => ({ linha: r._row, responsavel: r._norm.responsavel, empresa: r._norm.empresa, cnpj: r._norm.cnpj })) }) });
  assert.equal(rowsRes.status, 200);
  const rowsData = await rowsRes.json();
  assert.equal(rowsData.totalRows, 2);
  assert.deepEqual(rowsData.users.map(u => u.responsavel), ['ana.exito', 'raquel.exito']);
  assert.equal(rowsData.users[1].empresas[0].cnpjFormatado, '05.396.572/0001-55');

  // 3. POST /api/carteira/audit/export - Exportação de CSV
  const exportRes = await fetch(`${base}/api/carteira/audit/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: 'http://127.0.0.1'
    },
    body: JSON.stringify({
      accountId: '6581',
      items: [
        { linha: 2, responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpjFormatado: '59.994.000/0001-05', situacao: 'Já vinculado ao usuário', colunaGclick: 'Minha Carteira' }
      ]
    })
  });
  assert.equal(exportRes.status, 200);
  const exportData = await exportRes.json();
  assert.ok(exportData.csv.includes('AGUIAR PACK'));
  assert.ok(exportData.csv.includes('Minha Carteira'));

  // 4. POST /api/carteira/users/sync - Pré-condição sem sessão G-Click
  const syncRes = await fetch(`${base}/api/carteira/users/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: 'http://127.0.0.1'
    },
    body: JSON.stringify({ accountId: '6581' })
  });
  assert.equal(syncRes.status, 400);
  const syncData = await syncRes.json();
  assert.match(syncData.error, /janela do G-Click|Sessão no G-Click não detectada/i);

  // 5. POST /api/carteira/audit - Pré-condição sem sessão G-Click
  const auditRes = await fetch(`${base}/api/carteira/audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: 'http://127.0.0.1'
    },
    body: JSON.stringify({
      accountId: '6581',
      responsavel: 'ana.exito',
      empresas: [{ linha: 2, responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpj: '59994000000105' }]
    })
  });
  assert.equal(auditRes.status, 400);
  const auditData = await auditRes.json();
  assert.match(auditData.error, /janela do G-Click|Sessão no G-Click não detectada/i);

  // 5b. POST /api/carteira/retirar - sem sessão G-Click: recusa e o erro fica no histórico da conta
  const retirarRes = await fetch(`${base}/api/carteira/retirar`, { method: 'POST', headers, body: JSON.stringify({
    accountId: '6581', usuario: 'Andreane Rocha - Fis,Cont - Oper', valor: '11', cnpjs: ['59994000000105'] }) });
  assert.equal(retirarRes.status, 400);
  assert.match((await retirarRes.json()).error, /janela do G-Click/);
  const opsRes = await fetch(`${base}/api/carteira/operacoes?accountId=6581`, { method: 'POST', headers, body: JSON.stringify({ accountId: '6581' }) });
  assert.equal(opsRes.status, 200);
  const [ultima] = (await opsRes.json()).operacoes;
  assert.equal(ultima.acao, 'retirar');
  assert.equal(ultima.status, 'erro');
  assert.equal(ultima.usuario, 'Andreane Rocha - Fis,Cont - Oper');
  assert.deepEqual(ultima.solicitados, ['59994000000105']);
  assert.match(ultima.erro, /janela do G-Click/);
  assert.equal(ultima.operador, 'admin@gclick.local');

  // Pedido incompleto não toca o G-Click nem o histórico
  const semCnpj = await fetch(`${base}/api/carteira/retirar`, { method: 'POST', headers, body: JSON.stringify({ accountId: '6581', usuario: 'Andreane' }) });
  assert.equal(semCnpj.status, 400);

  // 6. Teste de RBAC: Criar Usuário com papel Auditor (sem permissão carteira.vincular)
  const auditorEmail = `auditor.carteira.${Date.now()}@empresa.com.br`;
  const createAuditorRes = await fetch(`${base}/api/users/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
      Origin: 'http://127.0.0.1'
    },
    body: JSON.stringify({
      name: 'Auditor Teste Carteira',
      email: auditorEmail,
      password: 'Senha@123456',
      roleSlugs: ['auditor'],
      accountIds: ['6581']
    })
  });
  assert.equal(createAuditorRes.status, 200);

  // Login como o auditor
  const auditorLoginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: auditorEmail, password: 'Senha@123456' })
  });
  assert.equal(auditorLoginRes.status, 200);
  const auditorCookie = auditorLoginRes.headers.get('set-cookie')?.split(';')[0];

  const vincularRes = await fetch(`${base}/api/carteira/vincular`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: auditorCookie,
      Origin: 'http://127.0.0.1'
    },
    body: JSON.stringify({
      accountId: '6581',
      responsavel: 'ana.exito',
      cnpjs: ['05396572000155']
    })
  });
  assert.equal(vincularRes.status, 403);
  const vincularData = await vincularRes.json();
  assert.match(vincularData.error, /carteira\.vincular/);

  const retirarAuditor = await fetch(`${base}/api/carteira/retirar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: auditorCookie, Origin: 'http://127.0.0.1' },
    body: JSON.stringify({ accountId: '6581', usuario: 'Andreane', cnpjs: ['05396572000155'] }) });
  assert.equal(retirarAuditor.status, 403);
});
