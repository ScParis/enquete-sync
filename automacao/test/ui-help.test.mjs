import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('UI: Central de Ajuda está estruturada no HTML com abas e atalhos', () => {
  const htmlPath = path.join(projectRoot, 'ui', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  // Topbar e Sidebar
  assert.ok(html.includes('id="btnTopHelp"'), 'Botão de Ajuda na Topbar deve existir');
  assert.ok(html.includes('id="navHelp"'), 'Botão Central de Ajuda no Sidebar deve existir');
  assert.ok(html.includes('data-section="help"'), 'Elemento deve navegar para a seção help');

  // Seção principal e Abas
  assert.ok(html.includes('id="section-help"'), 'Seção de ajuda deve existir no DOM');
  assert.ok(html.includes('id="helpSearchInput"'), 'Campo de busca no tutorial deve existir');
  assert.ok(html.includes('data-help-tab="valida-pdf"'), 'Aba Valida PDF deve existir');
  assert.ok(html.includes('data-help-tab="enquete"'), 'Aba Enquete deve existir');
  assert.ok(html.includes('data-help-tab="obrigacoes"'), 'Aba Obrigações deve existir');
  assert.ok(html.includes('data-help-tab="carteira"'), 'Aba Carteira deve existir');
  assert.ok(html.includes('data-help-tab="faq"'), 'Aba FAQ deve existir');

  // Containers de Conteúdo
  assert.ok(html.includes('id="helpTabContent-valida-pdf"'), 'Conteúdo Valida PDF deve existir');
  assert.ok(html.includes('id="helpTabContent-enquete"'), 'Conteúdo Enquete deve existir');
  assert.ok(html.includes('id="helpTabContent-obrigacoes"'), 'Conteúdo Obrigações deve existir');
  assert.ok(html.includes('id="helpTabContent-carteira"'), 'Conteúdo Carteira deve existir');
  assert.ok(html.includes('id="helpTabContent-faq"'), 'Conteúdo FAQ deve existir');
});

test('UI: app.js contém suporte, alternância de abas e busca para a Central de Ajuda', () => {
  const jsPath = path.join(projectRoot, 'ui', 'app.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  assert.ok(js.includes('btnTopHelp'), 'Listener do btnTopHelp deve existir');
  assert.ok(js.includes('initHelpSection'), 'initHelpSection deve estar implementada');
  assert.ok(js.includes('switchHelpTab'), 'switchHelpTab deve estar implementada');
  assert.ok(js.includes('filterHelpCards'), 'filterHelpCards deve estar implementada');
  assert.ok(js.includes("id: 'nav-help'"), 'Central de Ajuda deve constar no COMMANDS_REGISTRY');
});
