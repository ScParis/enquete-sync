import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { enterEmpresa, ensureEmpresaActive, gotoWithRetry, EmpresaSessionError, saveEmpresaFoto, findSavedEmpresaFoto } from '../lib/gclick.mjs';

// Reproduz o G-Click real (diagnóstico de 2026-10-30): com empresa ativa, /empresas pela URL volta ao /dashboard;
// o seletor só abre pelo botão "Minhas Empresas".
function fakeAppp() {
  const dashboard = `<!doctype html><body><h1>Dashboard</h1>
    <i title="Minhas Empresas" onclick="location.href='/empresas?via=botao'">x</i></body>`;
  const empresas = `<!doctype html><body>
    <div class="empresa-card" id="c4966"><img src="https://s3/gclick/empresa/4966/foto.jpg"><span>EXITO CONTABILIDADE</span></div>
    <div class="empresa-card disabled" id="c6461"><img src="https://s3/gclick/empresa/6461/foto.jpg"><span>ASSERT CONTABILIDADE</span></div>
    <div class="empresa-card" id="c7128"><img src="https://s3/gclick/empresa/7128/foto.jpg"><span>AUDCON ASSESSORIA CONTABIL LTDA</span></div>
    <script>
      for (const c of document.querySelectorAll('.empresa-card:not(.disabled)')) c.addEventListener('click', () => {
        const id = Number(c.id.slice(1));
        localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id, nome: c.innerText.trim() }));
        location.href = '/dashboard';
      });
    </script></body>`;
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/empresas' && u.searchParams.get('via') !== 'botao') { res.writeHead(302, { Location: '/dashboard' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(u.pathname === '/empresas' ? empresas : dashboard);
  });
}

test('enterEmpresa abre o seletor pelo botão "Minhas Empresas" quando /empresas redireciona ao painel', async () => {
  const server = fakeAppp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/dashboard`);
    await page.evaluate(() => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 4966, nome: 'EXITO CONTABILIDADE' }));
      localStorage.setItem('g3AccessEmpresas', JSON.stringify([{ id: 4966, nome: 'EXITO CONTABILIDADE' }, { id: 7128, nome: 'AUDCON ASSESSORIA CONTABIL LTDA' }]));
    });
    const result = await ensureEmpresaActive(page, '7128');
    assert.equal(result.active, true);
    assert.equal(result.currentAccountId, '7128');
    assert.equal(result.switchedFrom, '4966');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('enterEmpresa não clica em card desabilitado e não declara troca que não aconteceu', async () => {
  const server = fakeAppp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/dashboard`);
    await page.evaluate(() => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 4966, nome: 'EXITO CONTABILIDADE' }));
      localStorage.setItem('g3AccessEmpresas', JSON.stringify([{ id: 4966, nome: 'EXITO CONTABILIDADE' }, { id: 6461, nome: 'ASSERT CONTABILIDADE' }]));
    });
    const result = await enterEmpresa(page, '6461');
    assert.equal(result.entered, false);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('gotoWithRetry acusa sessão do legado presa em outra empresa', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://app.gclick.com.br/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8',
      body: '<html><body>Esta sessão não esta mais ativa pois ocorreu mudança de empresa, favor se logar novamente. Obrigado</body></html>' }));
    await assert.rejects(
      gotoWithRetry(page, 'https://app.gclick.com.br/Listar.do?obj=enqueteopen&tipo=0&empId=7128'),
      error => error instanceof EmpresaSessionError && error.accountId === '7128' && /Alterne para a conta 7128/.test(error.message)
    );
  } finally {
    await browser.close();
  }
});

test('a foto da empresa vista no cartão de "Minhas Empresas" é guardada em disco após a troca', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/s3/gclick/empresa/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png); }
    if (u.pathname === '/empresas' && u.searchParams.get('via') !== 'botao') { res.writeHead(302, { Location: '/dashboard' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(u.pathname === '/empresas'
      ? `<!doctype html><body><div class="empresa-card" id="c7128"><img src="/s3/gclick/empresa/7128/foto.jpg?X-Amz-Security-Token=abc"><span>AUDCON</span></div>
         <script>document.getElementById('c7128').addEventListener('click', () => { localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 7128, nome: 'AUDCON' })); location.href = '/dashboard'; });</script></body>`
      : `<!doctype html><body><i title="Minhas Empresas" onclick="location.href='/empresas?via=botao'">x</i></body>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fotos-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/dashboard`);
    await page.evaluate(() => {
      localStorage.setItem('g3CurrentEmpresa', JSON.stringify({ id: 4966, nome: 'EXITO' }));
      localStorage.setItem('g3AccessEmpresas', JSON.stringify([{ id: 4966, nome: 'EXITO' }, { id: 7128, nome: 'AUDCON' }]));
    });
    assert.equal((await ensureEmpresaActive(page, '7128')).active, true);
    const file = await saveEmpresaFoto(page.context(), '7128', dir);
    assert.equal(file, path.join(dir, '7128.png'));
    assert.deepEqual(await fs.readFile(file), png);
    assert.deepEqual(await findSavedEmpresaFoto(dir, '7128'), { file, ext: 'png' });
    assert.equal(await findSavedEmpresaFoto(dir, '../7128'), null, 'conta fora do padrão não vira caminho de arquivo');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
