import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize,
  tokenSimilarity,
  parseSpreadsheetEnquete,
  suggestCategoria,
  compareEnqueteModelWithCatalog
} from '../lib/enquete-similarity.mjs';

test('normalize: remove acentos, pontuações e converte para minúsculas', () => {
  assert.equal(normalize('É realizado a emissão de NF?'), 'e realizado a emissao de nf');
  assert.equal(normalize('Qual mês da data-base?'), 'qual mes da data base');
});

test('tokenSimilarity: detecta similaridade fonética e ortográfica de respostas', () => {
  // Similaridade alta mesmo com typo ("Whatssap" vs "Via Whatsapp")
  const simWhats = tokenSimilarity('Whatssap', 'Via Whatsapp');
  assert.ok(simWhats >= 0.6, `Esperado >= 0.6, obteve ${simWhats}`);

  // Mesma palavra com acentuação
  const simDissidio = tokenSimilarity(
    'Qual mês da data base do acordo da convenção coletiva para dissidio ?',
    'Qual mes da data base do acordo da convenção coletiva para dissidio ?'
  );
  assert.equal(simDissidio, 1.0);

  // Perguntas diferentes devem ter baixa similaridade
  const simDiff = tokenSimilarity('Possui ISS?', 'Qual é o tipo de Folha de Pagamento deste cliente?');
  assert.ok(simDiff < 0.3, `Esperado < 0.3, obteve ${simDiff}`);
});

test('parseSpreadsheetEnquete: converte CSV em árvore hierárquica', () => {
  const csv = `
#,Tipo,Classificação,Nome
,,G,1,Cadastro Inicial
,,P,01.01,Quais os serviços prestados?
,,R,01.01.01,Contabil
,,R,01.01.02,Fiscal
,,G,2,Fiscal
,,P,02.01,Possui ISS?
,,R,02.01.01,ISS Próprio
`;

  const groups = parseSpreadsheetEnquete(csv);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].nome, 'Cadastro Inicial');
  assert.equal(groups[0].questions.length, 1);
  assert.equal(groups[0].questions[0].answers.length, 2);
  assert.equal(groups[0].questions[0].answers[0].nome, 'Contabil');
  assert.equal(groups[1].nome, 'Fiscal');
  assert.equal(groups[1].questions[0].answers[0].nome, 'ISS Próprio');
});

test('suggestCategoria: sugere categoria adequada pelo contexto', () => {
  const available = ['Fiscal', 'Fiscal - Ramo', 'Dpto. Pessoal', 'Financeiro'];

  assert.equal(suggestCategoria('Qual o Ramo de atividade do Cliente?', 'Cadastro Inicial', available), 'Fiscal - Ramo');
  assert.equal(suggestCategoria('Possui ISS?', 'Fiscal', available), 'Fiscal');
  assert.equal(suggestCategoria('Convenção coletiva para dissidio', 'Dpto. Pessoal/Trabalhista', available), 'Dpto. Pessoal');
  assert.equal(suggestCategoria('Qual a forma de pagamento?', 'Financeiro', available), 'Financeiro');
});

test('compareEnqueteModelWithCatalog: classifica corretamente itens existentes e faltantes', () => {
  const groups = [
    {
      classif: '1',
      nome: 'Cadastro Inicial',
      questions: [
        {
          classif: '01.01',
          nome: 'Qual o Ramo de atividade do Cliente?',
          answers: [
            { classif: '01.01.01', nome: 'Comércio' },
            { classif: '01.01.02', nome: 'Contábil' }
          ]
        }
      ]
    }
  ];

  const mockCatalog = {
    accountId: '3032',
    questions: [
      {
        ref: '01.05',
        label: 'Qual o Ramo de atividade do Cliente?',
        category: 'Cadastro Inicial',
        answers: [
          { ref: '01.05.01', value: '54', label: 'Comércio' }
        ]
      }
    ]
  };

  const comparison = compareEnqueteModelWithCatalog(groups, mockCatalog, ['Fiscal - Ramo']);
  assert.equal(comparison.totalPerguntas, 1);
  assert.equal(comparison.totalRespostasPlanilha, 2);
  assert.equal(comparison.respostasExistentesCount, 1);
  assert.equal(comparison.respostasFaltantesCount, 1);

  const answers = comparison.items[0].answers;
  assert.equal(answers[0].status, 'ja_existe');
  assert.equal(answers[0].matchedGclickAnswer.label, 'Comércio');
  assert.equal(answers[1].status, 'faltante');
  assert.equal(answers[1].suggestedCategoria, 'Fiscal - Ramo');
});
