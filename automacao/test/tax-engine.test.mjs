import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySegment, checkFatorR, diagnoseClient } from '../lib/tax-engine.mjs';

test('classificação de segmento por CNAE', () => {
  const comercio = classifySegment(['4711-3/02']);
  assert.equal(comercio.isComercio, true);
  assert.equal(comercio.isServico, false);
  assert.equal(comercio.segmento, 'Comércio');

  const servico = classifySegment(['6201-5/01']);
  assert.equal(servico.isServico, true);
  assert.equal(servico.isComercio, false);
  assert.equal(servico.segmento, 'Serviço');

  const misto = classifySegment(['4711-3/02', '6201-5/01']);
  assert.equal(misto.isComercio, true);
  assert.equal(misto.isServico, true);
  assert.equal(misto.segmento, 'Serviço e Comércio');
});

test('identificação de Fator R para CNAE de tecnologia e saúde', () => {
  const tech = checkFatorR(['6201-5/01']);
  assert.equal(tech.sujeitoFatorR, true);
  assert.match(tech.mensagem, /Fator R/);

  const med = checkFatorR(['8630-5/03']);
  assert.equal(med.sujeitoFatorR, true);

  const comercio = checkFatorR(['4711-3/02']);
  assert.equal(comercio.sujeitoFatorR, false);
});

test('diagnóstico para empresa Simples Nacional em SP com Comércio e Venda Interestadual', () => {
  const diag = diagnoseClient({
    cnpj: '19.402.991/0001-67',
    razaoSocial: 'Comércio ABC Ltda',
    uf: 'SP',
    municipio: 'São Paulo',
    regime: 'simples',
    cnaePrincipal: '4711-3/02',
    operacoes: {
      vendaInterestadual: true,
      temProlabore: true,
      temFuncionarios: true
    }
  });

  // Prazos fatais
  assert.ok(diag.prazosFatais.some(p => p.obrigacao.includes('Opção pelo Simples Nacional')));
  assert.ok(diag.prazosFatais.some(p => p.obrigacao.includes('Inscrição Estadual')));

  // Fiscal
  const federais = diag.departamentos.fiscal.federais.map(f => f.nome);
  assert.ok(federais.includes('DAS - Mensal'));
  assert.ok(federais.includes('PGDAS-D Declaração'));

  const estaduais = diag.departamentos.fiscal.estaduais.map(e => e.nome);
  assert.ok(estaduais.includes('DeSTDA - Declaração mensal'));
  assert.ok(estaduais.some(e => e.includes('DIFAL')));

  // DP
  assert.equal(diag.dadosGerais.folhaTipo, 'Folha Mensal (Funcionários e Sócios)');
  assert.ok(diag.departamentos.pessoal.some(p => p.nome.includes('FGTS Digital')));
});

test('diagnóstico para empresa de Serviços de TI com Fator R', () => {
  const diag = diagnoseClient({
    cnpj: '63.665.522/0001-22',
    razaoSocial: 'Tech Software Ltda',
    uf: 'MG',
    municipio: 'Belo Horizonte',
    regime: 'simples',
    cnaePrincipal: '6201-5/01',
    operacoes: {
      temProlabore: true,
      temFuncionarios: false
    }
  });

  assert.equal(diag.fatorR.sujeitoFatorR, true);
  assert.equal(diag.dadosGerais.folhaTipo, 'Folha Somente Pró-Labore');
  // Empresa de serviço puro não deve ter obrigações estaduais de ICMS
  assert.equal(diag.departamentos.fiscal.estaduais.length, 0);
  assert.ok(diag.departamentos.fiscal.municipais.some(m => m.nome.includes('NFS-e')));
});

test('diagnóstico para empresa Lucro Presumido', () => {
  const diag = diagnoseClient({
    cnpj: '58.291.475/0001-64',
    razaoSocial: 'Consultoria Presumido SA',
    uf: 'RJ',
    municipio: 'Rio de Janeiro',
    regime: 'presumido',
    cnaePrincipal: '7020-4/00',
    operacoes: {
      temProlabore: true
    }
  });

  const federais = diag.departamentos.fiscal.federais.map(f => f.nome);
  assert.ok(federais.includes('DCTF Mensal / DCTFWeb'));
  assert.ok(federais.includes('EFD Contribuições'));
  assert.ok(federais.includes('EFD Reinf'));
  assert.ok(federais.some(f => f.includes('CSLL e IRPJ')));
  assert.ok(diag.departamentos.contabil.some(c => c.nome.includes('ECD')));
});
