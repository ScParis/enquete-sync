import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { inspectUserCarteira, vincularClientesCarteira, syncMinhaCarteira, getCachedMinhaCarteira, retirarClientesCarteira } from '../lib/carteira.mjs';

// Réplica da tela Cadastros > Usuários > Carteira (legacy): três colunas lado a lado, com cabeçalho e lista
// em tabelas separadas, e os botões "Retirar" / "<- Vincular" / "<- Vincular" numa linha abaixo.
const FIXTURE = `<!doctype html><html><body>
<div class="alert">Aqui você inclui os clientes que aparecerão no Painel de Controle.<br><b>Minha Carteira</b> = clientes que são de minha responsabilidade</div>
<label>Por Usuário:</label>
<select id="usuario" onchange="render()">
  <option value="">Selecione...</option>
  <option value="11">Andreane Rocha - Fis,Cont - Oper</option>
  <option value="12">Ana Luiza - Aux. Fiscal</option>
</select>
<div class="row" id="cols"></div>
<div class="row">
  <div class="col" style="display:inline-block;width:300px"><button id="retirar" onclick="retirar()">Retirar →</button></div>
  <div class="col" style="display:inline-block;width:300px"><button id="vincCargo" onclick="vincular('cargo')">← Vincular</button></div>
  <div class="col" style="display:inline-block;width:300px"><button id="vincRest" onclick="vincular('rest')">← Vincular</button></div>
</div>
<div class="modal inmodal" id="modalVincular" style="display:none;position:fixed;top:50px;left:50px;width:320px;height:200px;background:#fff;z-index:9999;">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header"><h4 class="modal-title">Vinculando Usuário</h4></div>
      <div class="modal-body"><p>Realmente deseja vincular o usuário nos clientes selecionados?</p></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-white" onclick="document.getElementById('modalVincular').style.display='none'">Fechar</button>
        <button type="button" class="btn btn-primary" id="btnConfirmar" onclick="confirmarVincular()">Confirmar</button>
      </div>
    </div>
  </div>
</div>
<script>
  window.clicks = [];
  window.modalConfirmedCount = 0;
  window.pendingVincular = null;
  const data = {
    11: { minha: [], cargo: [['54.557.014/0001-30', 'CHECK-OUT AUTOMOTIVO LTDA 256'], ['62.671.979/0001-87', 'COSTA AGUIAR EMBALAGENS PLASTICA 3'], ['048.849.338-26', 'DEBORA KROLIKOWSKI 18']],
          rest: [['29.212.197/0001-04', 'ENGBOR COMERCIO DE BORRACHAS LTDA'], ['67.871.031/0001-99', 'ALENTO HOLDING FAMILIAR LTDA'], [null, 'ASN HOLDING -ANDRES']] },
    12: { minha: [['04.204.281/0001-55', 'ALLIANCE PARTICIPACOES S/S LTDA 222']], cargo: [], rest: [] }
  };
  function column(key, title, list) {
    const rows = list.length ? list.map(([doc, nome], i) => '<tr><td>' + (i + 1) + '</td><td><input type="checkbox" value="' + key + i + '"></td><td>' + (doc ? '<small>' + doc + '</small><br>' : '') + '<a href="#">' + nome + '</a></td></tr>').join('')
      : '<tr><td colspan="3">carteira vazia</td></tr>';
    return '<div class="col" style="display:inline-block;width:300px;vertical-align:top"><table><thead><tr><th>#</th><th><input type="checkbox"></th><th>' + title + '</th></tr></thead></table>'
      + '<div style="height:120px;overflow:auto"><table data-col="' + key + '"><tbody>' + rows + '</tbody></table></div></div>';
  }
  function render() {
    const d = data[document.getElementById('usuario').value] || { minha: [], cargo: [], rest: [] };
    document.getElementById('cols').innerHTML = column('minha', 'Minha Carteira', d.minha)
      + column('cargo', 'Clientes Disponí\\u00adveis com o mesmo Cargo', d.cargo)
      + column('rest', 'Clientes Restantes Disponíveis', d.rest);
  }
  function vincular(key) {
    window.clicks.push(key);
    window.pendingVincular = key;
    // Abre o modal de confirmação do G-Click
    document.getElementById('modalVincular').style.display = 'block';
  }
  function confirmarVincular() {
    window.modalConfirmedCount++;
    const key = window.pendingVincular;
    if (key) {
      const d = data[document.getElementById('usuario').value];
      const boxes = Array.from(document.querySelectorAll('table[data-col="' + key + '"] input[type=checkbox]'));
      const moved = boxes.map((cb, i) => cb.checked ? d[key][i] : null).filter(Boolean);
      d[key] = d[key].filter(item => !moved.includes(item));
      d.minha.push(...moved);
      window.pendingVincular = null;
    }
    document.getElementById('modalVincular').style.display = 'none';
    render();
  }
  // window.bloquearRetirada simula o G-Click recusando a retirada com um alerta.
  function retirar() {
    window.clicks.push('retirar');
    if (window.bloquearRetirada) { alert('Não é possível retirar: cliente com tarefas em aberto.'); return; }
    const d = data[document.getElementById('usuario').value];
    const boxes = Array.from(document.querySelectorAll('table[data-col="minha"] input[type=checkbox]'));
    const moved = boxes.map((cb, i) => cb.checked ? d.minha[i] : null).filter(Boolean);
    d.minha = d.minha.filter(item => !moved.includes(item));
    d.rest.push(...moved);
    render();
  }
  render();
</script></body></html>`;

test('Carteira no G-Click: lê as três colunas, sincroniza Minha Carteira e vincula pela coluna escolhida', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://app.gclick.com.br/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE }));

  // Leitura das três colunas para o usuário da planilha
  const inspection = await inspectUserCarteira(page, '4966', 'andreane', []);
  assert.equal(inspection.user.nomeSelecionado, 'Andreane Rocha - Fis,Cont - Oper');
  assert.deepEqual(inspection.minhaCarteira, []);
  assert.deepEqual(inspection.mesmoCargo.map(i => i.cnpj), ['54557014000130', '62671979000187', '00004884933826']);
  assert.equal(inspection.mesmoCargo[1].empresa, 'COSTA AGUIAR EMBALAGENS PLASTICA 3');
  assert.deepEqual(inspection.restantes.map(i => i.cnpj), ['29212197000104', '67871031000199', '']);
  assert.equal(inspection.restantes[2].empresa, 'ASN HOLDING -ANDRES');

  // Sincronização: Minha Carteira de cada usuário, só leitura
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carteira-sync-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const snapshot = await syncMinhaCarteira(page, '4966', { catalogsDir: dir });
  assert.deepEqual(snapshot.usuarios.map(u => [u.nome, u.total]), [['Andreane Rocha - Fis,Cont - Oper', 0], ['Ana Luiza - Aux. Fiscal', 1]]);
  assert.equal(snapshot.usuarios[1].empresas[0].cnpjFormatado, '04.204.281/0001-55');
  assert.equal((await getCachedMinhaCarteira(dir, '4966')).totalEmpresas, 1);
  assert.deepEqual(await page.evaluate(() => window.clicks), []);

  // Vínculo a partir de "mesmo Cargo": usa o "Vincular" dessa coluna, não o primeiro da tela
  const fromCargo = await vincularClientesCarteira(page, '4966', 'andreane', ['62671979000187'], [], { origem: 'mesmo_cargo' });
  assert.deepEqual(await page.evaluate(() => window.clicks), ['cargo']);
  assert.equal(await page.evaluate(() => window.modalConfirmedCount), 1);
  assert.deepEqual(fromCargo.transferredCnpjs, ['62671979000187']);

  // Vínculo a partir de "Restantes": CNPJ que só existe em Restantes
  const fromRest = await vincularClientesCarteira(page, '4966', 'andreane', ['67871031000199'], [], { origem: 'restantes' });
  assert.deepEqual(await page.evaluate(() => window.clicks), ['cargo', 'rest']);
  assert.equal(await page.evaluate(() => window.modalConfirmedCount), 2);
  assert.deepEqual(fromRest.transferredCnpjs, ['67871031000199']);

  // CNPJ que não está na coluna escolhida não é marcado nem clicado
  const wrongColumn = await vincularClientesCarteira(page, '4966', 'andreane', ['29212197000104'], [], { origem: 'mesmo_cargo' });
  assert.equal(wrongColumn.linkedCount, 0);
  assert.deepEqual(await page.evaluate(() => window.clicks), ['cargo', 'rest']);

  await assert.rejects(() => vincularClientesCarteira(page, '4966', 'andreane', ['29212197000104'], [], {}), /Escolha de onde vincular/);

  // Retirada: pelo valor da opção (vindo da sincronização), só na coluna Minha Carteira, pelo botão "Retirar"
  const retirada = await retirarClientesCarteira(page, '4966', 'Andreane Rocha - Fis,Cont - Oper', ['62.671.979/0001-87', '11.222.333/0001-99'], [], { optionValue: '11' });
  assert.deepEqual(retirada.removidos, ['62671979000187']);
  assert.deepEqual(retirada.naoEncontrados, ['11222333000199']);
  assert.equal(await page.evaluate(() => window.clicks.at(-1)), 'retirar');
  assert.ok(!retirada.minhaCarteira.some(item => item.cnpj === '62671979000187'));

  // G-Click recusa: a mensagem do alerta volta e o CNPJ aparece como não removido
  await page.evaluate(() => { window.bloquearRetirada = true; });
  const recusada = await retirarClientesCarteira(page, '4966', 'Andreane Rocha - Fis,Cont - Oper', ['67871031000199'], [], { optionValue: '11' });
  assert.deepEqual(recusada.removidos, []);
  assert.deepEqual(recusada.naoRemovidos, ['67871031000199']);
  assert.deepEqual(recusada.avisos, ['Não é possível retirar: cliente com tarefas em aberto.']);
});
