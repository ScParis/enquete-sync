import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('UI: Seção de Cadastro de Respostas da Enquete está estruturada no HTML', () => {
  const htmlPath = path.join(projectRoot, 'ui', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  // Verifica elementos principais da tela
  assert.ok(html.includes('id="section-enquete-cadastro"'), 'Seção de cadastro deve existir no DOM');
  assert.ok(html.includes('id="navEnqueteCadastro"'), 'Botão de navegação deve existir');
  assert.ok(html.includes('id="enqueteModelSheetUrl"'), 'Campo de URL da planilha modelo deve existir');
  assert.ok(html.includes('id="btnEnqueteConferir"'), 'Botão conferir deve existir');
  assert.ok(html.includes('id="selectAllEnqueteFaltantes"'), 'Checkbox de selecionar todas as faltantes deve existir');
  assert.ok(html.includes('id="btnCadastrarRespostasSelecionadas"'), 'Botão de cadastro em lote deve existir');
  assert.ok(html.includes('id="enqueteProgressPanel"'), 'Painel de progresso deve existir');
  assert.ok(html.includes('id="enqueteProgressBar"'), 'Barra de progresso deve existir');
  assert.ok(html.includes('id="enqueteProgressLogs"'), 'Área de logs deve existir');
});

test('UI: app.js contém suporte ao módulo enquete-cadastro e validação de pré-condições', () => {
  const jsPath = path.join(projectRoot, 'ui', 'app.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  // Verifica inclusão em operationalModules para proteção de mismatch
  assert.ok(js.includes("'enquete-cadastro'"), 'enquete-cadastro deve estar em operationalModules');
  assert.ok(js.includes('loadEnqueteCadastroSection'), 'loadEnqueteCadastroSection deve estar implementada');
  assert.ok(js.includes('renderEnqueteCadastroTable'), 'renderEnqueteCadastroTable deve estar implementada');
  assert.ok(js.includes('executeCadastrarRespostas'), 'executeCadastrarRespostas deve estar implementada');
  assert.ok(js.includes('/api/enquete/conferencia'), 'Deve chamar o endpoint de conferência');
  assert.ok(js.includes('/api/enquete/cadastrar'), 'Deve chamar o endpoint de cadastro');
  assert.ok(js.includes('/api/enquete/progresso'), 'Deve fazer polling de progresso');
});

test('UI: style.css contém classes para badges e tabela de cadastro da enquete', () => {
  const cssPath = path.join(projectRoot, 'ui', 'style.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  assert.ok(css.includes('.badge-cad-existente'), 'Classe badge-cad-existente deve existir');
  assert.ok(css.includes('.badge-cad-faltante'), 'Classe badge-cad-faltante deve existir');
  assert.ok(css.includes('.badge-cad-sim'), 'Classe badge-cad-sim deve existir');
  assert.ok(css.includes('.cat-select-cell'), 'Classe cat-select-cell deve existir');
});
