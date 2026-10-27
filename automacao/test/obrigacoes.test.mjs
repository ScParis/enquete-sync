import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyObrigacaoParidade,
  formatTemplateMessage,
  auditObrigacoesList
} from '../lib/obrigacoes.mjs';

test('obrigacoes: classifyObrigacaoParidade classifica corretamente os estados de paridade', () => {
  // 1. Sem atividades ou lista vazia
  assert.equal(classifyObrigacaoParidade([]).status, 'sem_disparo');
  assert.equal(classifyObrigacaoParidade(null).status, 'sem_disparo');

  // 2. Apenas atividades operacionais (checklist, validação) sem disparo
  const operacionais = [
    { ordem: 1, tipo: 'C', texto: 'Conferir extratos' },
    { ordem: 2, tipo: 'P', texto: 'Validar apuração' }
  ];
  const auditOp = classifyObrigacaoParidade(operacionais);
  assert.equal(auditOp.status, 'sem_disparo');
  assert.equal(auditOp.hasEmail, false);
  assert.equal(auditOp.hasWhatsapp, false);

  // 3. Contém E-mail com passos operacionais, mas NÃO contém WhatsApp -> pendente_whatsapp
  const comEmailEOperacional = [
    { ordem: 1, tipo: 'C', texto: 'Gerar guia' },
    { ordem: 2, tipo: 'E', texto: 'Enviar e-mail com guia' }
  ];
  const auditEmail = classifyObrigacaoParidade(comEmailEOperacional);
  assert.equal(auditEmail.status, 'pendente_whatsapp');
  assert.equal(auditEmail.hasEmail, true);
  assert.equal(auditEmail.hasWhatsapp, false);
  assert.equal(auditEmail.canalExclusivoEmail, false);
  assert.equal(auditEmail.sugerirOrdemWhatsapp, 3); // logo após a ordem 2

  // 3.1 REGRA NOVA: Se em uma obrigação houver apenas o passo/atividade de e-mail,
  // NÃO deve ter o passo de whatsapp e deve ser considerada CONFORME (canal exclusivo de e-mail)
  const apenasEmail = [
    { ordem: 1, tipo: 'E', texto: 'Solicitação de documentos' }
  ];
  const auditApenasEmail = classifyObrigacaoParidade(apenasEmail);
  assert.equal(auditApenasEmail.status, 'conforme');
  assert.equal(auditApenasEmail.hasEmail, true);
  assert.equal(auditApenasEmail.hasWhatsapp, false);
  assert.equal(auditApenasEmail.canalExclusivoEmail, true);
  assert.equal(auditApenasEmail.sugerirOrdemWhatsapp, null);

  // 3.2 REGRA NOVA: Obrigação #146 (Solicitação de Documentos Contábeis - E-mail Programado)
  const obrigacao146Atividades = [
    { ordem: 1, tipo: 'E', texto: 'Solicitação de documentos\nEnvio programado na data de ação da tarefa', tipoCancelamento: 'Com justificativa' }
  ];
  const audit146 = classifyObrigacaoParidade(obrigacao146Atividades, {
    id: 146,
    nome: 'Solicitação de Documentos Contábeis - E-mail Programado'
  });
  assert.equal(audit146.status, 'conforme');
  assert.equal(audit146.canalExclusivoEmail, true);
  assert.equal(audit146.sugerirOrdemWhatsapp, null);

  // 4. Contém WhatsApp mas NÃO contém E-mail -> pendente_email
  const comWhatsapp = [
    { ordem: 1, tipo: '16', texto: 'Disparar WhatsApp' }
  ];
  const auditWhats = classifyObrigacaoParidade(comWhatsapp);
  assert.equal(auditWhats.status, 'pendente_email');
  assert.equal(auditWhats.hasEmail, false);
  assert.equal(auditWhats.hasWhatsapp, true);

  // 5. REGRA 1:1: Contém 1 E-mail e 1 WhatsApp -> conforme (paridade 1:1 atendida, NÃO cria outro)
  const completo = [
    { ordem: 1, tipo: 'C', texto: 'Gerar guia' },
    { ordem: 2, tipo: 'E', texto: 'Enviar e-mail com guia' },
    { ordem: 3, tipo: '16', texto: 'Avisar no WhatsApp' }
  ];
  const auditCompleto = classifyObrigacaoParidade(completo);
  assert.equal(auditCompleto.status, 'conforme');
  assert.equal(auditCompleto.hasEmail, true);
  assert.equal(auditCompleto.hasWhatsapp, true);
  assert.equal(auditCompleto.canalExclusivoEmail, false);
  assert.equal(auditCompleto.emailCount, 1);
  assert.equal(auditCompleto.whatsappCount, 1);
  assert.equal(auditCompleto.faltamWhatsapp, 0);
  assert.equal(auditCompleto.sugerirOrdemWhatsapp, null, 'Não deve sugerir nem criar outro WhatsApp se já existe 1:1');
  assert.equal(auditCompleto.totalAtividades, 3);

  // 5.1 REGRA 1:1: Contém 2 E-mails e apenas 1 WhatsApp -> pendente_whatsapp (falta 1)
  const doisEmailsUmWhats = [
    { ordem: 1, tipo: 'C', texto: 'Gerar guia' },
    { ordem: 2, tipo: 'E', texto: 'Enviar e-mail parcial' },
    { ordem: 3, tipo: '16', texto: 'WhatsApp parcial' },
    { ordem: 4, tipo: 'E', texto: 'Enviar e-mail final' }
  ];
  const auditDoisUm = classifyObrigacaoParidade(doisEmailsUmWhats);
  assert.equal(auditDoisUm.status, 'pendente_whatsapp');
  assert.equal(auditDoisUm.emailCount, 2);
  assert.equal(auditDoisUm.whatsappCount, 1);
  assert.equal(auditDoisUm.faltamWhatsapp, 1, 'Deve indicar que falta exatamente 1 WhatsApp para manter 1:1');
  assert.equal(auditDoisUm.sugerirOrdemWhatsapp, 5);

  // 5.2 REGRA 1:1: Contém 2 E-mails e 2 WhatsApps -> conforme (paridade 1:1 atendida)
  const doisEmailsDoisWhats = [
    ...doisEmailsUmWhats,
    { ordem: 5, tipo: '16', texto: 'WhatsApp final' }
  ];
  const auditDoisDois = classifyObrigacaoParidade(doisEmailsDoisWhats);
  assert.equal(auditDoisDois.status, 'conforme');
  assert.equal(auditDoisDois.emailCount, 2);
  assert.equal(auditDoisDois.whatsappCount, 2);
  assert.equal(auditDoisDois.faltamWhatsapp, 0);
  assert.equal(auditDoisDois.sugerirOrdemWhatsapp, null);
});

test('obrigacoes: formatTemplateMessage substitui variáveis dinâmicas do G-Click', () => {
  const template = 'Olá [contato.nome], a obrigação [obrigacao.nome] da competência [tarefa.competencia] vence em [tarefa.vencimento] para [cliente.apelido].';
  
  const variaveis = {
    '[contato.nome]': 'Mariana',
    '[obrigacao.nome]': 'DAS SIMPLES',
    '[tarefa.competencia]': '10/2026',
    '[tarefa.vencimento]': '20/11/2026',
    '[cliente.apelido]': 'Alpha Comercio'
  };

  const formatted = formatTemplateMessage(template, variaveis);
  assert.equal(
    formatted,
    'Olá Mariana, a obrigação DAS SIMPLES da competência 10/2026 vence em 20/11/2026 para Alpha Comercio.'
  );

  // Chaves não fornecidas devem ser preservadas sem quebrar a string
  const parcial = formatTemplateMessage('Aviso para [cliente.apelido] com chave [chave.desconhecida]', {
    '[cliente.apelido]': 'Beta Servicos'
  });
  assert.equal(parcial, 'Aviso para Beta Servicos com chave [chave.desconhecida]');
});

test('obrigacoes: auditObrigacoesList consolida estatísticas e classifica lote de obrigações', () => {
  const lista = [
    { id: 1, nome: 'Obrigacao 1', atividades: [{ ordem: 1, tipo: 'E' }, { ordem: 2, tipo: '16' }] }, // conforme (alinhados)
    { id: 2, nome: 'Obrigacao 2', atividades: [{ ordem: 1, tipo: 'C' }, { ordem: 2, tipo: 'E' }] }, // pendente_whatsapp (operacional + email)
    { id: 3, nome: 'Obrigacao 3', atividades: [{ ordem: 1, tipo: '16' }] }, // pendente_email
    { id: 4, nome: 'Obrigacao 4', atividades: [{ ordem: 1, tipo: 'C' }] },  // sem_disparo
    { id: 5, nome: 'Solicitação de Documentos', atividades: [{ ordem: 1, tipo: 'E', texto: 'Envio programado' }] } // conforme (canal exclusivo de e-mail)
  ];

  const resumo = auditObrigacoesList(lista);
  assert.equal(resumo.total, 5);
  assert.equal(resumo.conforme, 2); // Obrigacao 1 + Obrigacao 5
  assert.equal(resumo.pendenteWhatsapp, 1); // Obrigacao 2
  assert.equal(resumo.pendenteEmail, 1);
  assert.equal(resumo.semDisparo, 1);
  assert.equal(resumo.items.length, 5);
  assert.equal(resumo.items[1].paridade.status, 'pendente_whatsapp');
  assert.equal(resumo.items[4].paridade.status, 'conforme');
  assert.equal(resumo.items[4].paridade.canalExclusivoEmail, true);
});

test('obrigacoes: filtro de importação mantém apenas obrigações com passos de E-mail e/ou WhatsApp', () => {
  const todasObrigacoes = [
    { id: 1, nome: 'CSLL e IRPJ', atividades: [{ ordem: 1, tipo: 'C' }, { ordem: 2, tipo: 'E' }, { ordem: 3, tipo: '16' }] },
    { id: 2, nome: 'DAS SIMPLES', atividades: [{ ordem: 1, tipo: 'C' }, { ordem: 2, tipo: 'E' }] },
    { id: 3, nome: 'Recibo Pro-labore', atividades: [{ ordem: 1, tipo: '16' }] },
    { id: 4, nome: 'Conferência Contábil Interna', atividades: [{ ordem: 1, tipo: 'C' }, { ordem: 2, tipo: 'P' }] },
    { id: 5, nome: 'Fechamento Fiscal', atividades: [] }
  ];

  const filtradas = todasObrigacoes.filter(item => {
    const paridade = classifyObrigacaoParidade(item.atividades);
    return paridade.hasEmail || paridade.hasWhatsapp;
  });

  assert.equal(filtradas.length, 3);
  assert.deepEqual(filtradas.map(f => f.id), [1, 2, 3]);
  assert.equal(filtradas.some(f => f.id === 4), false, 'Obrigação 4 (apenas checklist/validação) deve ser descartada');
  assert.equal(filtradas.some(f => f.id === 5), false, 'Obrigação 5 (sem atividades) deve ser descartada');
});

