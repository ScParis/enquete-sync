import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditLogRows, auditLogCsv } from '../lib/audit-logger.mjs';

test('buildAuditLogRows gera todas as linhas de auditoria com detalhes completos de status, perguntas e motivos', () => {
  const catalog = {
    questions: [
      {
        ref: '04.06',
        label: 'Qual o sindicato desse cliente ? Parte 1',
        category: 'Dpto. Pessoal/Trabalhista',
        answers: [
          { ref: '04.06.01', value: '574', label: 'COM X SINCOMERCIO', display: '01 - COM X SINCOMERCIO' },
          { ref: '04.06.13', value: '590', label: 'COMERCIÁRIOS X SINCOPEÇAS', display: '13 - COMERCIÁRIOS X SINCOPEÇAS' }
        ]
      },
      {
        ref: '05.01',
        label: 'Vencimento do boleto',
        category: 'Dpto. Financeiro',
        answers: [
          { ref: '05.01.01', value: '389', label: 'Boleto - Dia 01', display: '01 - Boleto - Dia 01' }
        ]
      }
    ]
  };

  const savedMappings = [
    { accountId: '2420', task: 'COM X SINCOMERCIO', answerRef: '04.06.01' },
    { accountId: '2420', task: 'COMERCIÁRIOS X SINCOPEÇAS', answerRef: '04.06.13' },
    { accountId: '2420', task: 'Boleto - Dia 01', answerRef: '05.01.01' }
  ];

  const report = {
    accountId: '2420',
    createdAt: '2026-10-24T16:00:00.000Z',
    inspected: [
      {
        cnpj: '28.590.241/0001-57',
        empId: '5',
        cod: '5',
        empresa: 'FLORIR COSMETICOS',
        mappingTask: 'COM X SINCOMERCIO',
        matchingRows: [2],
        uiStatus: 'ja_correto',
        currentValue: '574',
        mappingAnswer: '04.06.01'
      },
      // Mesmo cliente com outra obrigação e pergunta diferente: gera linha própria
      {
        cnpj: '28.590.241/0001-57',
        empId: '5',
        cod: '5',
        empresa: 'FLORIR COSMETICOS',
        mappingTask: 'Boleto - Dia 01',
        matchingRows: [15],
        uiStatus: 'vazio',
        currentValue: null,
        mappingAnswer: '05.01.01'
      },
      {
        cnpj: '67.022.855/0001-94',
        empId: '173',
        cod: '173',
        empresa: 'VORDELLI CENTRO AUTOMOTIVO',
        mappingTask: 'COMERCIÁRIOS X SINCOPEÇAS',
        matchingRows: [30],
        uiStatus: 'ja_correto',
        currentValue: '590',
        mappingAnswer: '04.06.13'
      },
      {
        cnpj: '45.949.229/0001-05',
        empId: '7',
        cod: '7',
        empresa: 'ALMA CLINICA',
        mappingTask: 'COM X SINCOMERCIO',
        matchingRows: [3],
        uiStatus: 'nao_encontrado',
        mappingAnswer: '04.06.01'
      },
      // Linha sem obrigação/tarefa na planilha (ex.: SPINOLA linha 35)
      {
        cnpj: '55.938.438/0001-07',
        empId: '196',
        cod: '196',
        empresa: 'SPINOLA',
        mappingTask: 'SECCOR COTIA x FECOMERCIO SP – COMÉRCIO GERAL (sem enquete)',
        task: 'SECCOR COTIA x FECOMERCIO SP – COMÉRCIO GERAL',
        matchingRows: [35],
        uiStatus: 'sem_tarefa',
        uiReason: 'Coluna "Descrição da enquete" vazia na planilha (enquadramento informado: "SECCOR COTIA x FECOMERCIO SP – COMÉRCIO GERAL")'
      }
    ],
    invalidSource: [
      {
        row: 51,
        cnpj: '-',
        empresa: 'DOMESTICAS',
        task: 'SEDESP',
        reason: 'CNPJ e ID do cliente (Cod.) ausentes'
      }
    ]
  };

  const rows = buildAuditLogRows(report, catalog, savedMappings);
  assert.equal(rows.length, 6, 'Deve conter 6 linhas no total (5 inspecionadas incluindo sem_tarefa + 1 inválida da fonte)');

  // Linha 1 (ordem por linha da planilha: 2)
  assert.equal(rows[0].linhaPlanilha, '2');
  assert.equal(rows[0].codCliente, '5');
  assert.equal(rows[0].cnpj, '28.590.241/0001-57');
  assert.equal(rows[0].tarefa, 'COM X SINCOMERCIO');
  assert.equal(rows[0].codPergunta, '04.06');
  assert.equal(rows[0].pergunta, 'Qual o sindicato desse cliente ? Parte 1');
  assert.equal(rows[0].categoria, 'Dpto. Pessoal/Trabalhista');
  assert.equal(rows[0].codResposta, '04.06.01');
  assert.equal(rows[0].respostaEsperada, '01 - COM X SINCOMERCIO');
  assert.equal(rows[0].valorInterno, '574');
  assert.equal(rows[0].statusCodigo, 'ja_correto');
  assert.equal(rows[0].statusTexto, 'Já respondido / correto');
  assert.match(rows[0].motivo, /Já respondido na Enquete/);
  assert.equal(rows[0].acaoRobo, 'Nenhuma alteração necessária (já correto)');

  // Linha 2 (ordem por linha da planilha: 3 - ALMA CLINICA)
  assert.equal(rows[1].linhaPlanilha, '3');
  assert.equal(rows[1].statusCodigo, 'nao_encontrado');
  assert.equal(rows[1].statusTexto, 'Não localizado no G-Click');
  assert.match(rows[1].motivo, /não localizado/i);
  assert.equal(rows[1].acaoRobo, 'Não alterado: cliente não localizado no G-Click');

  // Linha 3 (ordem por linha da planilha: 15 - Mesmo cliente com pergunta de Boleto)
  assert.equal(rows[2].linhaPlanilha, '15');
  assert.equal(rows[2].codCliente, '5');
  assert.equal(rows[2].codPergunta, '05.01');
  assert.equal(rows[2].statusCodigo, 'vazio');
  assert.equal(rows[2].statusTexto, 'Não respondido / vazio');
  assert.equal(rows[2].acaoRobo, 'Pendente de gravação pelo robô');

  // Linha 4 (ordem por linha da planilha: 30 - VORDELLI)
  assert.equal(rows[3].linhaPlanilha, '30');
  assert.equal(rows[3].codCliente, '173');
  assert.equal(rows[3].cnpj, '67.022.855/0001-94');
  assert.equal(rows[3].statusCodigo, 'ja_correto');
  assert.equal(rows[3].codResposta, '04.06.13');

  // Linha 5 (ordem por linha da planilha: 35 - SPINOLA com sem_tarefa)
  assert.equal(rows[4].linhaPlanilha, '35');
  assert.equal(rows[4].codCliente, '196');
  assert.equal(rows[4].cnpj, '55.938.438/0001-07');
  assert.equal(rows[4].empresa, 'SPINOLA');
  assert.equal(rows[4].statusCodigo, 'sem_tarefa');
  assert.equal(rows[4].statusTexto, 'Sem obrigação / tarefa na planilha');
  assert.match(rows[4].motivo, /Coluna "Descrição da enquete" vazia na planilha/);
  assert.equal(rows[4].acaoRobo, 'Não alterado: nenhuma obrigação informada na planilha');

  // Linha 6 (ordem por linha da planilha: 51 - DOMESTICAS)
  assert.equal(rows[5].linhaPlanilha, 51);
  assert.equal(rows[5].empresa, 'DOMESTICAS');
  assert.equal(rows[5].statusCodigo, 'invalido');
  assert.equal(rows[5].statusTexto, 'Dados incompletos na planilha');
  assert.equal(rows[5].motivo, 'CNPJ e ID do cliente (Cod.) ausentes');

  // Validação do CSV gerado
  const csv = auditLogCsv(rows);
  assert.ok(csv.startsWith('\uFEFF'), 'CSV deve iniciar com UTF-8 BOM para abertura perfeita no Excel/Google Sheets');
  const lines = csv.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 7, '1 linha de cabeçalho + 6 linhas de dados');

  assert.match(lines[0], /"Conta","Linha Planilha","Cod\. \/ ID Cliente","CNPJ","Razão Social \/ Empresa"/);
  assert.match(lines[0], /"Status da Auditoria","Código do Status","Resposta Atual no G-Click","Motivo \/ Detalhes da Validação","Ação do Robô"/);
  assert.match(lines[4], /"VORDELLI CENTRO AUTOMOTIVO","","COMERCIÁRIOS X SINCOPEÇAS"/);
  assert.match(lines[5], /"SPINOLA","","SECCOR COTIA x FECOMERCIO SP – COMÉRCIO GERAL \(sem enquete\)"/);
  assert.match(lines[6], /"DOMESTICAS","","SEDESP"/);
});
