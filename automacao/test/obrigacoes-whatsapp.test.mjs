import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyObrigacaoParidade,
  formatTemplateMessage
} from '../lib/obrigacoes.mjs';

test('obrigacoes-whatsapp: obrigação pendente (1 e-mail e 0 whatsapp) é elegível para criação de WhatsApp', () => {
  const atividades = [
    { ordem: 1, tipo: 'Operacional', texto: '$ Anexar relatório' },
    { ordem: 2, tipo: 'E', texto: 'AUTO Enviar ao Cliente' }
  ];

  const paridade = classifyObrigacaoParidade(atividades);
  assert.equal(paridade.status, 'pendente_whatsapp');
  assert.equal(paridade.hasEmail, true);
  assert.equal(paridade.hasWhatsapp, false);
  assert.equal(paridade.emailCount, 1);
  assert.equal(paridade.whatsappCount, 0);
  assert.equal(paridade.faltamWhatsapp, 1);
  assert.equal(paridade.canalExclusivoEmail, false);
});

test('obrigacoes-whatsapp: obrigação em paridade 1:1 não permite novo WhatsApp', () => {
  const atividades = [
    { ordem: 1, tipo: 'Operacional', texto: '$ Anexar relatório' },
    { ordem: 2, tipo: 'E', texto: 'AUTO Enviar ao Cliente' },
    { ordem: 3, tipo: '16', texto: 'AUTO Enviar Cliente' }
  ];

  const paridade = classifyObrigacaoParidade(atividades);
  assert.equal(paridade.status, 'conforme');
  assert.equal(paridade.emailCount, 1);
  assert.equal(paridade.whatsappCount, 1);
  assert.equal(paridade.faltamWhatsapp, 0);
  assert.equal(paridade.whatsappCount >= paridade.emailCount, true);
});

test('obrigacoes-whatsapp: obrigação com canal exclusivo de e-mail não deve criar WhatsApp', () => {
  const atividades = [
    { ordem: 1, tipo: 'E', texto: 'Envio programado na data de ação da tarefa' }
  ];
  const obrigacao = {
    nome: 'Solicitação de Documentos Contábeis - E-mail Programado'
  };

  const paridade = classifyObrigacaoParidade(atividades, obrigacao);
  assert.equal(paridade.status, 'conforme');
  assert.equal(paridade.canalExclusivoEmail, true);
  assert.equal(paridade.faltamWhatsapp, 0);
});

test('obrigacoes-whatsapp: formata mensagem com substituição de tags dinâmicas', () => {
  const template = 'Olá [cliente.apelido], segue [obrigacao.nome] de [tarefa.competencia] com vencimento em [tarefa.vencimento].';
  const formatted = formatTemplateMessage(template, {
    '[cliente.apelido]': 'Empresa Teste',
    '[obrigacao.nome]': 'Livro Caixa',
    '[tarefa.competencia]': '09/2026',
    '[tarefa.vencimento]': '15/10/2026'
  });

  assert.equal(
    formatted,
    'Olá Empresa Teste, segue Livro Caixa de 09/2026 com vencimento em 15/10/2026.'
  );
});

test('obrigacoes-whatsapp: obrigação com múltiplos passos (2 e-mails e 1 whatsapp) detecta que falta 1 whatsapp e precisa reordenação', () => {
  // Simula o caso real de Fechamento Contábil - Anual
  const atividades = [
    { ordem: 1, tipo: 'Operacional', texto: 'Consolidação das informações' },
    { ordem: 7, tipo: 'E', texto: 'AUTO Enviar pendências ao Cliente' },
    { ordem: 8, tipo: 'Operacional', texto: 'Finalizar Lançamentos' },
    { ordem: 9, tipo: 'Operacional', texto: 'Arquivar Documentação' },
    { ordem: 10, tipo: 'E', texto: 'Enviar documentações ao cliente' },
    { ordem: 11, tipo: '16', texto: 'Enviar Cliente' }
  ];

  const paridade = classifyObrigacaoParidade(atividades);
  assert.equal(paridade.status, 'pendente_whatsapp');
  assert.equal(paridade.emailCount, 2);
  assert.equal(paridade.whatsappCount, 1);
  assert.equal(paridade.faltamWhatsapp, 1);
  assert.equal(paridade.precisaReordenacao, true); // WhatsApp 11 não está antes do E-mail 7 nem do 10
});

test('obrigacoes-whatsapp: múltiplos passos 1:1 perfeitamente ordenados (WhatsApp antes de E-mail) estão conformes', () => {
  // Estado final desejado
  const atividades = [
    { ordem: 1, tipo: 'Operacional', texto: 'Consolidação das informações' },
    { ordem: 7, tipo: '16', texto: 'Enviar Cliente' },
    { ordem: 8, tipo: 'E', texto: 'AUTO Enviar pendências ao Cliente' },
    { ordem: 9, tipo: 'Operacional', texto: 'Finalizar Lançamentos' },
    { ordem: 10, tipo: 'Operacional', texto: 'Arquivar Documentação' },
    { ordem: 11, tipo: '16', texto: 'AUTO Enviar Cliente' },
    { ordem: 12, tipo: 'E', texto: 'AUTO Enviar documentações ao cliente' }
  ];

  const paridade = classifyObrigacaoParidade(atividades);
  assert.equal(paridade.status, 'conforme');
  assert.equal(paridade.emailCount, 2);
  assert.equal(paridade.whatsappCount, 2);
  assert.equal(paridade.faltamWhatsapp, 0);
  assert.equal(paridade.precisaReordenacao, false); // Ambos os whatsapps estão imediatamente antes dos respectivos e-mails
});
