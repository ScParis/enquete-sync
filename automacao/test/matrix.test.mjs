import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { applyByColumnMatrix } from '../lib/gclick.mjs';

test('applyByColumnMatrix seleciona clientes por CNPJ na coluna da obrigação e abre modal aguardando OK', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();

    const html = `
      <!doctype html>
      <html>
      <head><title>G-Click Enquete Mock</title></head>
      <body>
        <a href="#">Respondendo Enquete</a>
        <div id="tabenqconfiglist">
          <a href="javascript:enviar('enqconfigclientes','02.03')">02.03 - Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)</a>
        </div>

        <table id="DataTables_Table_0">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>01 DOT</th>
              <th>07 LFE - DF</th>
              <th>08 GIA ST</th>
              <th>09 GIA - PE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><a>153- CDB ALBERICO DE CAMARGOS GUAIANA 894</a> 68.699.407/0001-92 - Fixo</td>
              <td><input type="checkbox" id="cb.894-428" value="428"></td>
              <td><input type="checkbox" id="cb.894-445" value="445"></td>
              <td><input type="checkbox" id="cb.894-450" value="450"></td>
              <td><input type="checkbox" id="cb.894-460" value="460"></td>
            </tr>
            <tr>
              <td><a>154- CDB ALBERICO DE CAMARGOS GUAIANAZES 2 LTDA 895</a> 68.699.448/0001-89 - Fixo</td>
              <td><input type="checkbox" id="cb.895-428" value="428"></td>
              <td><input type="checkbox" id="cb.895-445" value="445"></td>
              <td><input type="checkbox" id="cb.895-450" value="450"></td>
              <td><input type="checkbox" id="cb.895-460" value="460"></td>
            </tr>
          </tbody>
        </table>

        <button type="button" class="btn btn-success">Alterar</button>

        <div id="dialogoEnqueteClientesAlterarPerfil" style="display:none">
          <div id="cliente894">153- CDB ALBERICO DE CAMARGOS GUAIANA 894</div>
          <div id="cliente895">154- CDB ALBERICO DE CAMARGOS GUAIANAZES 2 LTDA 895</div>
          <button id="botaoConfirmar" type="button">Confirmar</button>
          <div id="progressConfirmar" style="display:none">Gravando...</div>
          <div class="modal-footer">
            <button data-dismiss="modal" type="button">Fechar</button>
          </div>
        </div>

        <script>
          document.querySelector('button.btn-success').addEventListener('click', () => {
            document.getElementById('dialogoEnqueteClientesAlterarPerfil').style.display = 'block';
          });
          document.getElementById('botaoConfirmar').addEventListener('click', () => {
            const prog = document.getElementById('progressConfirmar');
            prog.style.display = 'block';
            setTimeout(() => {
              prog.style.display = 'none';
              document.getElementById('cliente894').style.backgroundColor = 'rgb(102, 205, 170)';
              document.getElementById('cliente895').style.backgroundColor = 'rgb(102, 205, 170)';
            }, 50);
          });
        </script>
      </body>
      </html>
    `;

    await page.route('**/Listar.do?obj=enqueteopen*', route => {
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    });

    let operatorPromptCalled = false;
    const result = await applyByColumnMatrix(page, {
      accountId: '6581',
      questionRef: '02.03',
      question: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)',
      columnName: '08 GIA ST',
      cnpjs: ['68.699.407/0001-92', '68.699.448/0001-89'],
      onModalReady: async ({ modal, column, clientsToMark, confirm }) => {
        operatorPromptCalled = true;
        assert.equal(column, '08 GIA ST');
        assert.equal(clientsToMark.length, 2);
        await confirm();
      }
    });

    assert.equal(operatorPromptCalled, true, 'Callback do operador deve ser acionado para aguardar OK');
    assert.equal(result.success, true);
    assert.equal(result.column, '08 GIA ST');
    assert.deepEqual(result.changed, ['68.699.407/0001-92', '68.699.448/0001-89']);
    assert.equal(result.confirmedColors.length, 2);
    assert.equal(result.confirmedColors[0], 'rgb(102, 205, 170)');
    assert.equal(result.confirmedColors[1], 'rgb(102, 205, 170)');
  } finally {
    await browser.close();
  }
});
