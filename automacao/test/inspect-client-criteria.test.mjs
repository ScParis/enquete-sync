import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { inspectClient, rowFor } from '../lib/gclick.mjs';
import { findAutoMatch } from '../server.mjs';

test('inspectClient: localiza cliente FLORIR com link contendo ícone ↗ e sufixo - Fixo', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table>
        <tbody>
          <tr>
            <td>
              <a href="/v3/cadastros/empresas/abrirEmpresa?empId=5" target="_blank">
                FLORIR COSMETICOS E PERFUMES LTDA 5 ↗
              </a>
              <span class="badge">- Fixo</span>
            </td>
            <td>28.590.241/0001-57</td>
            <td>
              <input type="checkbox" id="cb.5-574" value="574" checked>
            </td>
          </tr>
        </tbody>
      </table>
    `);

    const rules = {
      accountId: '2420',
      questionRef: '04.06',
      answerRef: '04.06.01',
      answerValue: '574',
      inputType: 'checkbox'
    };

    // Caso 1: Item com CNPJ formatado
    const itemFormatted = {
      empresa: 'FLORIR COSMETICOS E PERFUMES LTDA',
      cnpj: '28.590.241/0001-57',
      empId: '5'
    };
    const res1 = await inspectClient(page, itemFormatted, rules);
    assert.equal(res1.uiStatus, 'ja_correto');
    assert.equal(res1.internalId, '5');
    assert.equal(res1.currentValue, '574');

    // Caso 2: Item com CNPJ limpo (apenas números)
    const itemClean = {
      empresa: 'FLORIR COSMETICOS E PERFUMES LTDA',
      cnpj: '28590241000157',
      empId: '5'
    };
    const res2 = await inspectClient(page, itemClean, rules);
    assert.equal(res2.uiStatus, 'ja_correto');
    assert.equal(res2.internalId, '5');

    // Caso 3: Item sem CNPJ, identificado apenas por empId / Cod.
    const itemIdOnly = {
      empresa: 'FLORIR COSMETICOS E PERFUMES LTDA',
      cod: '5',
      empId: '5'
    };
    const res3 = await inspectClient(page, itemIdOnly, rules);
    assert.equal(res3.uiStatus, 'ja_correto');
    assert.equal(res3.internalId, '5');

    // Caso 4: Variação textual na razão social (& vs E)
    const itemAmpersand = {
      empresa: 'FLORIR COSMETICOS & PERFUMES LTDA',
      cnpj: '28.590.241/0001-57',
      empId: '5'
    };
    const res4 = await inspectClient(page, itemAmpersand, rules);
    assert.equal(res4.uiStatus, 'ja_correto');
    assert.equal(res4.internalId, '5');
  } finally {
    await browser.close();
  }
});

test('rowFor: encontra linha de cliente por empId mesmo com caracteres especiais de fim de linha', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table>
        <tbody>
          <tr id="row-florir">
            <td><a>FLORIR COSMETICOS E PERFUMES LTDA 5 ↗</a></td>
            <td>28.590.241/0001-57</td>
          </tr>
          <tr id="row-other">
            <td><a>OUTRA EMPRESA 50 ↗</a></td>
            <td>11.222.333/0001-44</td>
          </tr>
        </tbody>
      </table>
    `);

    // Busca pelo ID 5 não deve confundir com 50
    const row = await rowFor(page, { empId: '5' });
    assert.ok(row);
    const text = await row.innerText();
    assert.ok(text.includes('FLORIR'));
    assert.ok(!text.includes('OUTRA EMPRESA'));
  } finally {
    await browser.close();
  }
});

test('findAutoMatch: prioriza correspondência de nome exato e previne falso match por código numérico em perguntas distintas', () => {
  const catalog = {
    questions: [
      {
        ref: '04.06',
        text: 'Qual o sindicato desse cliente ? Parte 1',
        answers: [
          { ref: '04.06.01', value: '574', label: '01 COM X SINCOMERCIO', display: '01 COM X SINCOMERCIO' },
          { ref: '04.06.02', value: '575', label: '02 COM X SINCOVAGA', display: '02 COM X SINCOVAGA' }
        ]
      },
      {
        ref: '08.01',
        text: '08.01 - ALVARA DE FUNCIONAMENTO (MES DO VENCIMENTO)',
        answers: [
          { ref: '08.01.01', value: '573', label: '01 - Janeiro', display: '01 - Janeiro' },
          { ref: '08.01.02', value: '574', label: '02 - Fevereiro', display: '02 - Fevereiro' }
        ]
      }
    ]
  };

  const taskRows = [{ _norm: { resposta: '574' } }];

  // Tarefa de sindicato: COM X SINCOMERCIO (deve casar por nome exato na pergunta 04.06)
  const matchSindicato = findAutoMatch('COM X SINCOMERCIO', taskRows, catalog);
  assert.ok(matchSindicato);
  assert.equal(matchSindicato.question.ref, '04.06');
  assert.equal(matchSindicato.answer.ref, '04.06.01');
  assert.equal(matchSindicato.answer.value, '574');
  assert.equal(matchSindicato.matchBy, 'exact_name');

  // Proteção contra match espúrio em meses de Alvará:
  // Se o catálogo só tem a pergunta de Alvará com a opção Fevereiro (código 574),
  // uma tarefa de Sindicato NÃO deve casar por código com Fevereiro de Alvará.
  const catalogAlvaraOnly = {
    questions: [catalog.questions[1]] // Apenas 08.01 ALVARA
  };
  const matchAlvaraSpurious = findAutoMatch('COM X SINCOMERCIO', taskRows, catalogAlvaraOnly);
  assert.equal(matchAlvaraSpurious, null, 'Não deve casar tarefa de sindicato com mês de Alvará');
});
