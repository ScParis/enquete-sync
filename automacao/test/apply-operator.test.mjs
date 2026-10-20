import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { applyQuestionWithOperator } from '../lib/gclick.mjs';

const question = 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)';
const clients = [
  { id: '1177', empId: '894', name: 'CDB ALBERICO GUAIANA', cnpj: '68.699.407/0001-92' },
  { id: '1178', empId: '895', name: 'CDB ALBERICO GUAIANAZES 2', cnpj: '68.699.448/0001-89' },
  { id: '1200', empId: '900', name: 'OUTRO CLIENTE', cnpj: '19.402.991/0001-67' }
];
// Simulação da Enquete do G-Click: aba de configuração, lista de perguntas, grade, Alterar e diálogo de confirmação.
function enquete(saved, { extraInDialog = false, unmarkOther = false } = {}) {
  const config = [['P', '02.03', question], ['R', '02.03.08', '450 - GIA ST'], ['R', '02.03.10', '454 - GIA ICMS']]
    .map(([t, r, l], i) => `<tr><td>${i}</td><td>${t}</td><td>${r}</td><td>${l}</td></tr>`).join('');
  const rows = clients.map(c => `<tr><td><a>${c.name} ${c.empId}</a> <small>${c.cnpj}</small></td>
    ${['450', '454'].map(v => `<td id="td${c.id}-${v}"><input type="checkbox" id="cb.${c.id}-${v}" value="${v}" onclick="marcarEnqueteCliente('${c.id}','${v}')" ${saved.has(`${c.id}-${v}`) ? 'checked' : ''}></td>`).join('')}</tr>`).join('');
  // Como no G-Click real, o diálogo traz TODOS os clientes; os que não mudam ficam com visibility: hidden.
  return `<!doctype html><html><body>
    <input type="hidden" id="marcados" value=";"><input type="hidden" id="desmarcados" value=";"><input type="hidden" id="csalterar" value=",">
    <div id="DataTables_Table_0_filter"><input></div>
    <table id="DataTables_Table_0"><tbody>${config}</tbody></table><a id="DataTables_Table_0_next" class="disabled">›</a>
    <a href="#tabenqconfiglist" onclick="document.getElementById('tabenqconfiglist').style.display='block'">Respondendo Enquete</a>
    <div id="tabenqconfiglist" style="display:none"><a href="javascript:abrirFixo('','enqconfigclientes','02.03')" onclick="document.getElementById('grade').style.display='block';return false">${question}</a></div>
    <div id="grade" style="display:none">
      <table><thead><tr><th>Clientes</th><th>08 GIA ST</th><th>10 GIA ICMS</th></tr></thead><tbody>${rows}</tbody></table>
      <button type="button" id="alterar">Alterar</button>
    </div>
    <div id="dialogoEnqueteClientesAlterarPerfil" style="display:none">
      ${clients.map(c => `<div id="cliente${c.id}" style="background-color:white">${c.name}</div>`).join('')}
      <button id="botaoConfirmar">Confirmar</button><div id="progressConfirmar" style="display:none">Gravando…</div>
      <div class="modal-footer"><button data-dismiss="modal" onclick="document.getElementById('dialogoEnqueteClientesAlterarPerfil').style.display='none'">Fechar</button></div>
    </div>
    <script>
      const $v = id => document.getElementById(id);
      function marcarEnqueteCliente(c, r) {
        const cb = $v('cb.' + c + '-' + r);
        if (cb.checked) $v('marcados').value += c + '-' + r + '-X;'; else $v('desmarcados').value += c + '-' + r + ':02.03;';
      }
      $v('alterar').onclick = () => {
        ${unmarkOther ? "$v('desmarcados').value += '1200-450:02.03;';" : ''}
        const ids = new Set([...$v('marcados').value.split(';'), ...$v('desmarcados').value.split(';')].filter(Boolean).map(x => x.split('-')[0]));
        ${extraInDialog ? "ids.add('1200');" : ''}
        $v('csalterar').value = ',' + [...ids].join(',') + (ids.size ? ',' : '');
        for (const el of document.querySelectorAll('#dialogoEnqueteClientesAlterarPerfil div[id^=cliente]')) {
          const on = ids.has(el.id.replace('cliente', ''));
          el.style.visibility = on ? 'visible' : 'hidden'; el.style.position = on ? 'relative' : 'absolute';
        }
        $v('dialogoEnqueteClientesAlterarPerfil').style.display = 'block';
      };
      $v('botaoConfirmar').onclick = async () => {
        $v('progressConfirmar').style.display = 'block';
        for (const id of $v('csalterar').value.split(',').filter(Boolean)) {
          const mine = $v('marcados').value.split(';').filter(x => x.startsWith(id + '-')).map(x => x.split('-').slice(0, 2).join('-'));
          await fetch('/salvar', { method: 'POST', body: mine.join(',') });
          $v('cliente' + id).style.backgroundColor = 'mediumaquamarine';
          $v('csalterar').value = $v('csalterar').value.replace(',' + id + ',', ',');
        }
        $v('progressConfirmar').style.display = 'none'; $v('marcados').value = ';'; $v('desmarcados').value = ';';
      };
    </script></body></html>`;
}
const rules = answerRef => ({ accountId: '6581', category: 'Dpto. Fiscal/Tributário', question, questionRef: '02.03', answerRef,
  answerValue: answerRef === '02.03.08' ? '450' : '454', answerLabel: answerRef === '02.03.08' ? '08 - GIA ST' : '10 - GIA ICMS', inputType: 'checkbox' });
const item = c => ({ cnpj: c.cnpj, empId: c.empId, status: 'pronto' });

async function setup(options) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const saved = new Set(['1200-450']);
  await page.route('**/Listar.do?obj=enqueteopen*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: enquete(saved, options) }));
  await page.route('**/salvar', async route => { for (const id of route.request().postData().split(',').filter(Boolean)) saved.add(id); await route.fulfill({ body: 'ok' }); });
  return { browser, page, saved };
}

test('marca várias respostas de uma pergunta, espera o Confirmar do operador e confere após recarregar', async () => {
  const { browser, page, saved } = await setup();
  try {
    const stages = [];
    const operator = page.waitForSelector('#gclick-robo-aviso').then(() => page.click('#botaoConfirmar'));
    const result = await applyQuestionWithOperator(page, [
      { rules: rules('02.03.08'), items: [item(clients[0]), item(clients[1]), item(clients[2])] },
      { rules: rules('02.03.10'), items: [item(clients[0])] }
    ], { onStage: stage => stages.push(stage) });
    await operator;
    assert.deepEqual(stages, ['abrindo', 'marcando', 'aguardando_confirmacao', 'conferindo']);
    assert.equal(result.cancelled, false);
    assert.deepEqual(result.changed.map(x => `${x.cnpj} ${x.answerRef}`).sort(), ['68.699.407/0001-92 02.03.08', '68.699.407/0001-92 02.03.10', '68.699.448/0001-89 02.03.08']);
    assert.deepEqual(result.skipped.map(x => [x.cnpj, x.uiStatus]), [['19.402.991/0001-67', 'ja_correto']], 'quem já estava marcado não é tocado');
    assert.deepEqual([...saved].sort(), ['1177-450', '1177-454', '1178-450', '1200-450']);
  } finally { await browser.close(); }
});

test('operador fecha o diálogo: nada é gravado e a pergunta fica como cancelada', async () => {
  const { browser, page, saved } = await setup();
  try {
    const operator = page.waitForSelector('#gclick-robo-aviso').then(() => page.click('[data-dismiss="modal"]'));
    const result = await applyQuestionWithOperator(page, [{ rules: rules('02.03.08'), items: [item(clients[0])] }]);
    await operator;
    assert.equal(result.cancelled, true);
    assert.deepEqual([...saved], ['1200-450']);
  } finally { await browser.close(); }
});

test('diálogo com cliente inesperado: robô fecha sem gravar e não pede confirmação', async () => {
  const { browser, page, saved } = await setup({ extraInDialog: true });
  try {
    let asked = false;
    await assert.rejects(applyQuestionWithOperator(page, [{ rules: rules('02.03.08'), items: [item(clients[0])] }], { onStage: s => { if (s === 'aguardando_confirmacao') asked = true; } }), /alteraria 2 cliente\(s\), esperados 1/);
    assert.equal(asked, false);
    assert.deepEqual([...saved], ['1200-450']);
  } finally { await browser.close(); }
});

test('se o G-Click fosse desmarcar qualquer resposta, o robô fecha sem gravar', async () => {
  const { browser, page, saved } = await setup({ unmarkOther: true });
  try {
    await assert.rejects(applyQuestionWithOperator(page, [{ rules: rules('02.03.08'), items: [item(clients[0])] }]), /desmarcaria 1 resposta/);
    assert.deepEqual([...saved], ['1200-450']);
  } finally { await browser.close(); }
});
