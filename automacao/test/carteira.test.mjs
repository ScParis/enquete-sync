import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCnpjMask,
  parseCarteiraSpreadsheet,
  resolveUser,
  auditUserCarteira,
  buildCarteiraAuditCsv,
  fetchGclickUsers
} from '../lib/carteira.mjs';

test('formatCnpjMask: formata CNPJ de 14 dígitos e preenche 13 dígitos com zero à esquerda', () => {
  // 14 dígitos sem formatação
  const c1 = formatCnpjMask('59994000000105');
  assert.equal(c1.digits, '59994000000105');
  assert.equal(c1.formatted, '59.994.000/0001-05');
  assert.equal(c1.valid, true);

  // 13 dígitos (zero inicial removido por planilha, caso real de ASA - COMERCIO)
  const c2 = formatCnpjMask('5396572000155');
  assert.equal(c2.digits, '05396572000155');
  assert.equal(c2.formatted, '05.396.572/0001-55');
  assert.equal(c2.valid, true);

  // Outro caso real de 13 dígitos (DITOY)
  const c3 = formatCnpjMask('3385780000123');
  assert.equal(c3.digits, '03385780000123');
  assert.equal(c3.formatted, '03.385.780/0001-23');
  assert.equal(c3.valid, true);

  // Já formatado com pontos e barra
  const c4 = formatCnpjMask('59.994.000/0001-05');
  assert.equal(c4.digits, '59994000000105');
  assert.equal(c4.formatted, '59.994.000/0001-05');
  assert.equal(c4.valid, true);

  // Inválido / vazio
  const cEmpty = formatCnpjMask('');
  assert.equal(cEmpty.digits, '');
  assert.equal(cEmpty.valid, false);
});

test('parseCarteiraSpreadsheet: agrupa empresas por responsável e aplica máscara nos CNPJs', () => {
  const csv = `Pessoa responsável,Empresa,CNPJ
ana.exito,AGUIAR PACK,59994000000105
ana.exito,ASA - COMERCIO DE EQUIPAMENTOS,5396572000155
raquel.exito,EXITO CONTABILIDADE,6926989000145
raquel.exito,FAST RUBBER LTDA,59198236000127`;

  const parsed = parseCarteiraSpreadsheet(csv);
  assert.equal(parsed.totalRows, 4);
  assert.equal(parsed.validCnpjs, 4);
  assert.equal(parsed.users.length, 2);

  const ana = parsed.users.find(u => u.responsavel === 'ana.exito');
  assert.ok(ana);
  assert.equal(ana.totalEmpresas, 2);
  assert.equal(ana.empresas[0].cnpjFormatado, '59.994.000/0001-05');
  assert.equal(ana.empresas[1].cnpjFormatado, '05.396.572/0001-55'); // zero à esquerda preservado!

  const raquel = parsed.users.find(u => u.responsavel === 'raquel.exito');
  assert.ok(raquel);
  assert.equal(raquel.totalEmpresas, 2);
});

test('resolveUser: localiza usuário no catálogo por apelido ou nome', () => {
  const usersList = [
    { id: '101', apelido: 'ana.exito', nome: 'Ana Paula Silva', email: 'ana@exito.com.br' },
    { id: '102', apelido: 'raquel.exito', nome: 'Raquel Ferreira Lima', email: 'raquel@exito.com.br' }
  ];

  // Busca por apelido da planilha
  const u1 = resolveUser('ana.exito', usersList);
  assert.ok(u1);
  assert.equal(u1.id, '101');
  assert.equal(u1.nome, 'Ana Paula Silva');

  // Busca por apelido raquel.exito
  const uRaquel = resolveUser('raquel.exito', usersList);
  assert.ok(uRaquel);
  assert.equal(uRaquel.id, '102');

  // Busca quando usuário na lista só tem nome Raquel Boccuzzi sem apelido explícito
  const usersSemApelido = [
    { id: '103', apelido: '', nome: 'Raquel Boccuzzi', email: 'raquel@consultoriaexito.com.br' }
  ];
  const uRaquelToken = resolveUser('raquel.exito', usersSemApelido);
  assert.ok(uRaquelToken);
  assert.equal(uRaquelToken.nome, 'Raquel Boccuzzi');

  // Busca por nome completo
  const u2 = resolveUser('Raquel Ferreira Lima', usersList);
  assert.ok(u2);
  assert.equal(u2.id, '102');

  // Inexistente
  const uNone = resolveUser('desconhecido.exito', usersList);
  assert.equal(uNone, null);
});

test('auditUserCarteira: classifica clientes em Minha Carteira, nas duas colunas de disponíveis e Não Localizados', () => {
  const spreadsheetEmpresas = [
    { linha: 2, responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpj: '59994000000105', cnpjFormatado: '59.994.000/0001-05' },
    { linha: 3, responsavel: 'ana.exito', empresa: 'ASA COMERCIO', cnpj: '05396572000155', cnpjFormatado: '05.396.572/0001-55' },
    { linha: 4, responsavel: 'ana.exito', empresa: 'COSTA AGUIAR', cnpj: '62671979000187', cnpjFormatado: '62.671.979/0001-87' },
    { linha: 5, responsavel: 'ana.exito', empresa: 'NAS DUAS', cnpj: '29212197000104', cnpjFormatado: '29.212.197/0001-04' },
    { linha: 6, responsavel: 'ana.exito', empresa: 'EMPRESA INEXISTENTE', cnpj: '11222333000199', cnpjFormatado: '11.222.333/0001-99' }
  ];

  const carteiraInspection = {
    user: { nome: 'Ana Paula Silva' },
    minhaCarteira: [{ cnpj: '59994000000105', empresa: 'AGUIAR PACK' }],
    mesmoCargo: [{ cnpj: '62671979000187', empresa: 'COSTA AGUIAR' }, { cnpj: '29212197000104', empresa: 'NAS DUAS' }],
    restantes: [{ cnpj: '05396572000155', empresa: 'ASA COMERCIO' }, { cnpj: '29212197000104', empresa: 'NAS DUAS' }]
  };

  const audit = auditUserCarteira(spreadsheetEmpresas, carteiraInspection);

  assert.equal(audit.total, 5);
  assert.equal(audit.jaVinculados, 1);
  assert.equal(audit.disponiveis, 3);
  assert.equal(audit.disponiveisMesmoCargo, 2);
  assert.equal(audit.disponiveisRestantes, 2);
  assert.equal(audit.naoLocalizados, 1);

  const byCnpj = Object.fromEntries(audit.items.map(i => [i.cnpj, i]));
  assert.equal(byCnpj['59994000000105'].status, 'ja_vinculado');
  assert.equal(byCnpj['59994000000105'].colunaGclick, 'Minha Carteira');
  assert.deepEqual(byCnpj['05396572000155'].origens, ['restantes']);
  assert.equal(byCnpj['05396572000155'].colunaGclick, 'Clientes Restantes Disponíveis');
  assert.deepEqual(byCnpj['62671979000187'].origens, ['mesmo_cargo']);
  assert.equal(byCnpj['62671979000187'].colunaGclick, 'Clientes Disponíveis com o mesmo Cargo');
  assert.equal(byCnpj['62671979000187'].usuarioNome, 'Ana Paula Silva');
  assert.deepEqual(byCnpj['29212197000104'].origens, ['mesmo_cargo', 'restantes']);
  assert.equal(byCnpj['11222333000199'].status, 'nao_localizado');
  assert.equal(byCnpj['11222333000199'].situacao, 'Não localizado na G-Click');
});

test('buildCarteiraAuditCsv: formata relatório CSV corretamente', () => {
  const auditItems = [
    { linha: 2, responsavel: 'ana.exito', empresa: 'AGUIAR PACK', cnpjFormatado: '59.994.000/0001-05', situacao: 'Já vinculado ao usuário', colunaGclick: 'Minha Carteira', detalhe: 'OK' }
  ];
  const csv = buildCarteiraAuditCsv(auditItems);
  assert.ok(csv.includes('"Linha","Responsável","Empresa","CNPJ","Situação","Coluna no G-Click","Detalhes"'));
  assert.ok(csv.includes('"ana.exito"'));
  assert.ok(csv.includes('"59.994.000/0001-05"'));
  assert.ok(csv.includes('"Minha Carteira"'));
});

test('Validação de Pré-condição: fetchGclickUsers recusa execução se sessão G-Click não detectada', async () => {
  const fakeContext = {
    pages: () => []
  };

  await assert.rejects(
    async () => fetchGclickUsers(fakeContext, '6581'),
    /Sessão no G-Click não detectada/
  );
});

test('resolveUser: resolução resiliente com acentos, tokens e sufixos de empresa', () => {
  const usersList = [
    { id: '1', apelido: 'ana.exito', nome: 'Ana Luiza', cargo: 'Aux. Fiscal' },
    { id: '2', apelido: 'camily.exito', nome: 'Camily Vitória Wisniewski de Paula', cargo: 'Assistente' },
    { id: '3', apelido: 'juliana.exito', nome: 'Juliana Oliveira', cargo: 'Oper' },
    { id: '4', apelido: 'juliany.bitencourt', nome: 'Juliany Bitencourt', cargo: 'Admin' }
  ];

  // Caso 1: Ana Luiza pelo apelido da planilha
  const u1 = resolveUser('ana.exito', usersList);
  assert.equal(u1?.nome, 'Ana Luiza');

  // Caso 2: Camily com e sem acento e com sufixo .exito
  const u2 = resolveUser('camily.vitoria', usersList);
  assert.equal(u2?.nome, 'Camily Vitória Wisniewski de Paula');

  // Caso 3: Juliany vs Juliana (não pode haver conflito entre nomes parecidos)
  const uJuliany = resolveUser('juliany.bitencourt', usersList);
  assert.equal(uJuliany?.nome, 'Juliany Bitencourt');

  const uJuliana = resolveUser('juliana.exito', usersList);
  assert.equal(uJuliana?.nome, 'Juliana Oliveira');

  // Caso 4: Usuário que realmente não existe na lista
  const uRaquel = resolveUser('raquel.exito', usersList);
  assert.equal(uRaquel, null);
});

test('auditUserCarteira: lida com usuário ausente no G-Click sem quebrar o lote', () => {
  const spreadsheetEmpresas = [
    { linha: 10, responsavel: 'raquel.exito', empresa: 'EXITO CONTABILIDADE', cnpj: '6926989000145', cnpjFormatado: '69.269.890/0001-45' }
  ];

  const carteiraInspection = {
    encontradoNoGclick: false,
    user: { identificadorOriginal: 'raquel.exito', encontradoNoGclick: false },
    minhaCarteira: [],
    mesmoCargo: [],
    restantes: []
  };

  const audit = auditUserCarteira(spreadsheetEmpresas, carteiraInspection);
  assert.equal(audit.encontradoNoGclick, false);
  assert.equal(audit.total, 1);
  assert.equal(audit.jaVinculados, 0);
  assert.equal(audit.disponiveis, 0);
  assert.equal(audit.naoLocalizados, 1);
  assert.equal(audit.items[0].status, 'usuario_nao_localizado');
  assert.equal(audit.items[0].situacao, 'Usuário não cadastrado no G-Click');
});
