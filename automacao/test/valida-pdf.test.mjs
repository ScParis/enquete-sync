import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

import {
  cleanCnpj,
  extractPdfText,
  extractClientIdentifiers,
  normalizeCompetencia,
  extractCompetencia,
  extractDocumentName,
  validatePdfFile,
  parseAnexoPorNome,
  parseGclickValidationHtml,
  generateValidationDiagnosticReport,
  autoDetectPdfMapping,
  createAndMapPdfLayoutOnGclick
} from '../lib/valida-pdf.mjs';

import { handleValidaPdfRoutes } from '../routes/valida-pdf.routes.mjs';

const SAMPLE_BASE = '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum';

test('cleanCnpj limpa caracteres não numéricos', () => {
  assert.equal(cleanCnpj('17.308.338/0001-08'), '17308338000108');
  assert.equal(cleanCnpj('17.308.338'), '17308338');
  assert.equal(cleanCnpj(''), '');
});

test('normalizeCompetencia normaliza formatos variados para MM/AAAA e AAAA', () => {
  assert.equal(normalizeCompetencia('09/2026'), '09/2026');
  assert.equal(normalizeCompetencia('9/2026'), '09/2026');
  assert.equal(normalizeCompetencia('setembro/2026'), '09/2026');
  assert.equal(normalizeCompetencia('Setembro/2026'), '09/2026');
  assert.equal(normalizeCompetencia('Dezembro/2025'), '12/2025');
  assert.equal(normalizeCompetencia('2025'), '2025');
  assert.equal(normalizeCompetencia('13º salário 2025'), '13/2025');
});

test('Validação de DARF DCTFWeb (Folha sem variável)', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/GUIA DCTF WEB.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  assert.equal(result.regras.extracaoTexto.ok, true);
  assert.ok(result.regras.identificacaoCliente.cnpjs.includes('17.308.338/0001-08'));
  assert.equal(result.regras.competencia.ok, true);
  assert.equal(result.regras.competencia.competenciaDetectada, '09/2026');
  assert.equal(result.regras.nomeDocumento.ok, true);
});

test('Validação de FGTS Digital com CNPJ Raiz (Folha sem variável)', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/FGTS.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  assert.equal(result.regras.extracaoTexto.ok, true);
  // No FGTS Digital o CNPJ vem como raiz "17.308.338"
  assert.ok(result.regras.identificacaoCliente.cnpjsBase.includes('17308338'));
  assert.equal(result.regras.competencia.ok, true);
  assert.equal(result.regras.competencia.competenciaDetectada, '09/2026');
  assert.equal(result.regras.nomeDocumento.ok, true);
  assert.equal(result.regras.nomeDocumento.identificado, 'GFD - Guia do FGTS Digital');
});

test('Validação de Recibo de Pagamento / Holerite (Folha sem variável)', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/Recibo de Pagamento.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  assert.ok(result.regras.identificacaoCliente.cnpjs.includes('17.308.338/0001-08'));
  assert.equal(result.regras.competencia.competenciaDetectada, '09/2026');
  assert.equal(result.regras.nomeDocumento.identificado, 'Recibo de Pagamento (Holerite)');
});

test('Validação de Recibo de Pró-Labore', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/Pro Labore.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  assert.ok(result.regras.identificacaoCliente.cnpjs.includes('17.308.338/0001-08'));
  assert.equal(result.regras.competencia.competenciaDetectada, '09/2026');
  assert.equal(result.regras.nomeDocumento.identificado, 'Recibo de Pró-Labore');
});

test('Validação de DAE Doméstica por CPF', async () => {
  const file = path.join(SAMPLE_BASE, 'Domestica/GuiaPagamento_60008989672_250920261427279019.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  assert.ok(result.regras.identificacaoCliente.cpfs.includes('600.089.896-72'));
  assert.equal(result.regras.competencia.competenciaDetectada, '09/2026');
  assert.equal(result.regras.nomeDocumento.ok, true);
});

test('Validação de Relatório de Líquidos (Adiantamento)', async () => {
  const file = path.join(SAMPLE_BASE, 'Adiantamento/4-RelatóriodeLíquidos-092026.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  assert.ok(result.regras.identificacaoCliente.cnpjs.includes('17.252.008/0001-48'));
  assert.equal(result.regras.competencia.competenciaDetectada, '09/2026');
  assert.equal(result.regras.nomeDocumento.ok, true);
});

test('Validação com CNPJ ou Competência esperada (sucesso e divergência)', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/GUIA DCTF WEB.pdf');
  
  // Sucesso com CNPJ e Competência corretos
  const matchOk = await validatePdfFile(file, {
    expectedCnpj: '17.308.338/0001-08',
    expectedCompetencia: '09/2026'
  });
  assert.equal(matchOk.valido, true);
  assert.equal(matchOk.status, 'valido');

  // Divergência de CNPJ
  const cnpjErr = await validatePdfFile(file, {
    expectedCnpj: '00.000.000/0001-99'
  });
  assert.equal(cnpjErr.valido, false);
  assert.equal(cnpjErr.status, 'cliente_invalido');
  assert.ok(cnpjErr.mensagem.includes('não corresponde à este cliente'));

  // Divergência de Competência
  const compErr = await validatePdfFile(file, {
    expectedCompetencia: '01/2024'
  });
  assert.equal(compErr.valido, false);
  assert.equal(compErr.status, 'competencia_invalida');
  assert.ok(compErr.mensagem.includes('não corresponde à está competência'));
});

test('Rota /api/valida-pdf/models retorna catálogo com 184 modelos', async () => {
  const catalogsDir = path.join(ROOT_DIR, 'catalogos');
  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'GET' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/models?accountId=6019'),
      payload: null,
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir,
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.ok(responseData.total >= 184, `Deveria ter pelo menos 184 modelos, obteve ${responseData.total}`);
  assert.ok(Array.isArray(responseData.models));
});

test('Rota /api/valida-pdf/validate-batch analisa lote de PDFs', async () => {
  const catalogsDir = path.join(ROOT_DIR, 'catalogos');
  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/validate-batch'),
      payload: {
        dirPath: path.join(SAMPLE_BASE, 'Pro abore'),
        accountId: '6019'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir,
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.equal(responseData.resumo.total, 2);
  assert.equal(responseData.resumo.validos, 2);
  assert.equal(responseData.arquivos.length, 2);
});

test('Rota /api/valida-pdf/validate-file aceita payload fileBase64', async () => {
  const catalogsDir = path.join(ROOT_DIR, 'catalogos');
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/GUIA DCTF WEB.pdf');
  const buffer = await fs.readFile(file);
  const base64 = buffer.toString('base64');

  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/validate-file'),
      payload: {
        fileName: 'GUIA DCTF WEB.pdf',
        fileBase64: base64,
        accountId: '6019'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir,
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.equal(responseData.valido, true);
  assert.equal(responseData.fileName, 'GUIA DCTF WEB.pdf');
  assert.equal(responseData.regras.nomeDocumento.identificado, 'DARF DCTFWeb');
  assert.equal(responseData.regras.competencia.competenciaDetectada, '09/2026');
});

test('UI: Estrutura HTML e scripts contêm elementos e controladores do Valida PDF', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT_DIR, 'ui/index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT_DIR, 'ui/app.js'), 'utf8');

  // Sidebar e Submódulo
  assert.ok(indexHtml.includes('id="submoduleValidaPdf"'));
  assert.ok(indexHtml.includes('id="navValidaPdf"'));
  assert.ok(indexHtml.includes('id="navValidaPdfModels"'));

  // Seção principal e abas
  assert.ok(indexHtml.includes('id="section-valida-pdf"'));
  assert.ok(indexHtml.includes('id="tabValidaFilesContent"'));
  assert.ok(indexHtml.includes('id="tabValidaModelsContent"'));
  assert.ok(indexHtml.includes('id="validaResultsTable"'));
  assert.ok(indexHtml.includes('id="validaModelsTable"'));
  assert.ok(indexHtml.includes('id="btnScanDirectory"'));

  // Modal de inspeção
  assert.ok(indexHtml.includes('id="modalValidaPdfInspect"'));
  assert.ok(indexHtml.includes('id="modalValidaPdfRawText"'));

  // Controladores no app.js
  assert.ok(appJs.includes("loadValidaPdfSection"));
  assert.ok(appJs.includes("renderValidaPdfModelsTable"));
  assert.ok(appJs.includes("renderValidaPdfResultsTable"));
  assert.ok(appJs.includes("openValidaPdfInspectModal"));
  assert.ok(appJs.includes("submodule_valida_pdf_collapsed"));

  // Novos elementos do treinamento #vocepode
  assert.ok(indexHtml.includes('id="modalValidaPdfDiagnosticoWrap"'));
  assert.ok(indexHtml.includes('id="ruleLineCliente"'));
  assert.ok(indexHtml.includes('id="ruleLineDoc"'));
  assert.ok(indexHtml.includes('id="ruleLineComp"'));
  assert.ok(indexHtml.includes('Guia Rápido de Destravamento: Os 3 Erros do ValidaPDF'));
});

test('parseAnexoPorNome reconhece padrão do G-Click [Obrigação] - [CNPJ] - [Competência]', () => {
  const parsed1 = parseAnexoPorNome('Folha de Pagamento - 17.308.338/0001-08 - 09.2026.pdf');
  assert.equal(parsed1.valido, true);
  assert.equal(parsed1.obrigacao, 'Folha de Pagamento');
  assert.equal(parsed1.cnpj, '17.308.338/0001-08');
  assert.equal(parsed1.competencia, '09/2026');

  const parsed2 = parseAnexoPorNome('Holerites - 17308338000108 - 09-2026.pdf');
  assert.equal(parsed2.valido, true);
  assert.equal(parsed2.obrigacao, 'Holerites');
  assert.equal(parsed2.competencia, '09/2026');

  const invalid = parseAnexoPorNome('relatorio_geral.pdf');
  assert.equal(invalid.valido, false);
});

test('Validação inclui linhas detectadas e diagnóstico G-Click alinhado ao treinamento #vocepode', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/GUIA DCTF WEB.pdf');
  const result = await validatePdfFile(file);

  assert.equal(result.valido, true);
  // Linhas identificadas
  assert.ok(result.regras.identificacaoCliente.linhaCliente > 0);
  assert.ok(result.regras.competencia.linhaCompetencia > 0);
  assert.ok(result.regras.nomeDocumento.linhaIdentificada > 0);

  // Diagnóstico
  assert.ok(result.diagnosticoGclick);
  assert.equal(result.diagnosticoGclick.tipo, 'ok');
  assert.equal(result.diagnosticoGclick.checklist3Perguntas.length, 3);
  assert.ok(result.diagnosticoGclick.checklist3Perguntas.every(item => item.ok === true));
});

test('Diagnóstico sugere Anexo por Nome para documentos de folha de pagamento e holerites', async () => {
  const file = path.join(SAMPLE_BASE, 'Folha sem variavel/Recibo de Pagamento.pdf');
  const result = await validatePdfFile(file);

  assert.ok(result.diagnosticoGclick);
  assert.ok(result.diagnosticoGclick.sugestaoAnexoPorNome);
  assert.ok(result.diagnosticoGclick.sugestaoAnexoPorNome.exemploNome.includes('Recibo de Pagamento'));
  assert.ok(result.diagnosticoGclick.sugestaoAnexoPorNome.exemploNome.includes('17.308.338/0001-08'));
});

test('Rota /api/valida-pdf/validate-on-gclick bloqueia com 400 amigável quando sessão desconectada', async () => {
  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/validate-on-gclick'),
      payload: {
        accountId: '6019',
        filePath: '/tmp/test.pdf'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      loginContext: null, // sem sessão
      hasGclickActiveSession: () => false,
      catalogsDir: '/tmp',
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 400);
  assert.equal(responseData.ok, false);
  assert.ok(responseData.error.includes('Sessão no G-Click não conectada'));
});

test('UI: Contém botão, seletor de modelos e container estruturado do G-Click', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT_DIR, 'ui/index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT_DIR, 'ui/app.js'), 'utf8');

  assert.ok(indexHtml.includes('id="btnValidateOnGclick"'));
  assert.ok(indexHtml.includes('id="modalGclickModelSelect"'));
  assert.ok(indexHtml.includes('id="btnOpenGclickModelLink"'));
  assert.ok(indexHtml.includes('id="modalValidaPdfGclickWrap"'));
  assert.ok(indexHtml.includes('id="gclickValidaItems"'));
  assert.ok(indexHtml.includes('id="gclickValidaDica"'));
  assert.ok(indexHtml.includes('id="gclickValidaMessage"'));
  assert.ok(appJs.includes('/api/valida-pdf/validate-on-gclick'));
});

test('parseGclickValidationHtml analisa retorno com divergência oficial do G-Click', () => {
  const htmlDivergencia = `
    <div class="row">
      <table class="table table-bordered white-bg">
        <tbody>
          <tr>
            <td width="5%">1</td>
            <td>
              <i class="fa fa-file-pdf-o"></i> Recibo de Pagamento.pdf
              <br><br>
              <div class="alert alert-danger">
                <div><i class="fa fa-times" style="color:red"></i> <b>Dados fixos inválidos:</b> Folha Mensal</div>
                <div><i class="fa fa-times" style="color:red"></i> <b>Inscrição inválida: linha não encontrada</b></div>
                <div><i class="fa fa-times" style="color:red"></i> <b>Competência inválida: linha não encontrada</b></div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  const parsed = parseGclickValidationHtml(htmlDivergencia);
  assert.ok(parsed);
  assert.equal(parsed.valido, false);
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0].status, 'erro');
  assert.equal(parsed.items[1].status, 'erro');
  assert.equal(parsed.items[2].status, 'erro');
  assert.ok(parsed.diagnostico.includes('palavra-chave/obrigação'));
});

test('parseGclickValidationHtml analisa retorno 100% conforme do G-Click', () => {
  const htmlSucesso = `
    <div class="alert alert-success">
      <div><i class="fa fa-check" style="color:green"></i> <b>Dados fixos válidos:</b> COFINS</div>
      <div><i class="fa fa-check" style="color:green"></i> <b>Inscrição válida:</b> 05.492.182/0001-89</div>
      <div><i class="fa fa-check" style="color:green"></i> <b>Competência válida:</b> 09/2026</div>
    </div>
  `;

  const parsed = parseGclickValidationHtml(htmlSucesso);
  assert.ok(parsed);
  assert.equal(parsed.valido, true);
  assert.equal(parsed.items.length, 3);
  assert.ok(parsed.items.every(i => i.status === 'ok'));
  assert.ok(parsed.diagnostico.includes('100% conforme'));
});

test('Rota /api/valida-pdf/suggest-directories retorna sugestões de diretórios existentes', async () => {
  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'GET' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/suggest-directories'),
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir: '/tmp',
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.ok(responseData.ok);
  assert.ok(Array.isArray(responseData.directories));
  assert.ok(responseData.directories.some(d => d.path.includes('Magnum')));
});

test('Rota /api/valida-pdf/validate-batch realiza varredura recursiva na pasta Magnum com subpastas', async () => {
  const catalogsDir = path.join(ROOT_DIR, 'catalogos');
  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/validate-batch'),
      payload: {
        dirPath: '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum',
        accountId: '6019'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir,
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.ok(responseData.ok);
  assert.equal(responseData.resumo.total, 46);
  assert.ok(responseData.resumo.validos >= 40);
  assert.ok(responseData.resumo.totalSubpastas > 0);
  assert.ok(responseData.arquivos.length === 46);
  assert.ok(responseData.arquivos.every(a => typeof a.relPath === 'string'));
  assert.ok(responseData.subpastas.includes('folha com variável/Ponto'));
});

test('Rota /api/valida-pdf/validate-batch rejeita diretório inexistente com mensagem amigável', async () => {
  let responseData = null;
  let statusCode = null;

  const mockSend = (res, code, data) => {
    statusCode = code;
    responseData = data;
    return data;
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {},
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/validate-batch'),
      payload: {
        dirPath: '/caminho/completamente/inexistente/pdf_test'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir: '/tmp',
      send: mockSend
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 400);
  assert.ok(responseData.error.includes('não encontrado ou inacessível'));
});

test('UI: Contém input de caminho de pasta, botão de varredura, atalhos e cards de estatísticas', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT_DIR, 'ui/index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT_DIR, 'ui/app.js'), 'utf8');

  assert.ok(indexHtml.includes('id="validaScanDirPath"'));
  assert.ok(indexHtml.includes('id="btnScanDirectory"'));
  assert.ok(indexHtml.includes('id="validaFolderPicker"'));
  assert.ok(indexHtml.includes('class="btn-dir-shortcut'));
  assert.ok(indexHtml.includes('id="validaBatchStatsWrap"'));
  assert.ok(indexHtml.includes('id="statTotalPdfs"'));
  assert.ok(indexHtml.includes('id="statValidosPdfs"'));
  assert.ok(indexHtml.includes('id="statInconsistentesPdfs"'));
  assert.ok(indexHtml.includes('id="statSubpastasCount"'));

  assert.ok(appJs.includes('executeDirectoryScan'));
  assert.ok(appJs.includes('validaScanDirPath'));
  assert.ok(appJs.includes('validaFolderPicker'));
});

test('generateValidationDiagnosticReport gera diagnóstico detalhado com falhas, documento e localização física', async () => {
  const catalogsDir = path.join(ROOT_DIR, 'catalogos');
  let models = [];
  try {
    models = JSON.parse(await fs.readFile(path.join(catalogsDir, 'pdf-models-6019.json'), 'utf8'));
  } catch {}

  // Varre a pasta Magnum
  async function getPdfs(dir) {
    let list = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) list = list.concat(await getPdfs(full));
      else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) list.push(full);
    }
    return list;
  }

  const files = await getPdfs(SAMPLE_BASE);
  const validations = [];
  for (const f of files) {
    const v = await validatePdfFile(f, { models });
    const relPath = path.relative(SAMPLE_BASE, f);
    validations.push({
      ...v,
      relPath,
      subpasta: path.dirname(relPath) === '.' ? 'Raiz' : path.dirname(relPath)
    });
  }

  // 1. Gera relatório HTML
  const reportHtml = generateValidationDiagnosticReport(validations, {
    targetDir: SAMPLE_BASE,
    accountId: '6019',
    accountName: 'CONTABILIDADE MAGNUM LTDA',
    format: 'html'
  });

  assert.ok(typeof reportHtml === 'string');
  assert.ok(reportHtml.includes('Diagnóstico & Auditoria de Validação de PDFs'));
  assert.ok(reportHtml.includes('CONTABILIDADE MAGNUM LTDA'));
  assert.ok(reportHtml.includes(SAMPLE_BASE));
  assert.ok(reportHtml.includes('Taxa de Conformidade'));

  // Verifica se as falhas conhecidas estão detalhadas com caminho e ação
  assert.ok(reportHtml.includes('Demonstrativo.pdf'));
  assert.ok(reportHtml.includes('Pedido BHbus.pdf'));
  assert.ok(reportHtml.includes('Pedido Otimo.pdf'));
  assert.ok(reportHtml.includes('folha (5).pdf'));
  assert.ok(reportHtml.includes('Relatorio 14-08-2026 a 13-09-26.pdf'));
  assert.ok(reportHtml.includes('Onde ele está:'));
  assert.ok(reportHtml.includes('Motivo da Falha:'));
  assert.ok(reportHtml.includes('Ação Recomendada (#VOCEPODE Omie):'));

  // 2. Gera relatório JSON
  const reportJson = generateValidationDiagnosticReport(validations, {
    targetDir: SAMPLE_BASE,
    format: 'json'
  });

  assert.equal(reportJson.metadados.resumo.total, 46);
  assert.equal(reportJson.metadados.resumo.inconsistentes, 5);
  assert.equal(reportJson.falhas.length, 5);
  assert.ok(reportJson.falhas[0].filePath.startsWith('/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum'));
  assert.ok(reportJson.falhas[0].subpasta);
  assert.ok(reportJson.falhas[0].acaoRecomendada);

  // 3. Gera relatório Markdown
  const reportMd = generateValidationDiagnosticReport(validations, {
    targetDir: SAMPLE_BASE,
    format: 'markdown'
  });

  assert.ok(reportMd.includes('# Relatório de Diagnóstico e Auditoria de PDF Layout'));
  assert.ok(reportMd.includes('Onde está (Caminho Físico):'));
});

test('Rota /api/valida-pdf/report retorna HTML formatado para impressão/PDF', async () => {
  let responseData = null;
  let statusCode = null;

  const sampleValidations = [
    {
      fileName: 'Pedido Otimo.pdf',
      filePath: '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum/folha com variável/Ponto/Pedido Otimo.pdf',
      relPath: 'folha com variável/Ponto/Pedido Otimo.pdf',
      subpasta: 'folha com variável/Ponto',
      valido: false,
      status: 'cliente_invalido',
      mensagem: 'Nenhum CNPJ, CNPJ Base ou CPF foi identificado no documento.',
      diagnosticoGclick: {
        tipo: 'erro_2_cliente',
        titulo: 'Erro 2 (G-Click): Cliente não encontrado na base',
        acaoRecomendada: 'Cadastre o cliente ou use Campo Adicional.'
      },
      regras: {
        extracaoTexto: { ok: true, linhas: 15 },
        identificacaoCliente: { ok: false },
        competencia: { ok: true, competenciaDetectada: '09/2026' },
        nomeDocumento: { ok: true, identificado: 'Folha de Ponto' }
      }
    }
  ];

  let resHeaders = {};
  let resEndedData = '';
  const mockRes = {
    writeHead: (code, headers) => {
      statusCode = code;
      resHeaders = headers;
    },
    end: (data) => {
      resEndedData = data;
    }
  };

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    mockRes,
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/report'),
      payload: {
        files: sampleValidations,
        dirPath: '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum',
        format: 'html'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir: '/tmp',
      send: (res, code, data) => data
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.ok(resHeaders['Content-Type'].includes('text/html'));
  assert.ok(resEndedData.includes('Diagnóstico & Auditoria de Validação de PDFs'));
  assert.ok(resEndedData.includes('Pedido Otimo.pdf'));
  assert.ok(resEndedData.includes('/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum/folha com variável/Ponto/Pedido Otimo.pdf'));
});

test('UI: Contém modal de relatório de diagnóstico, botão de impressão e iframe', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT_DIR, 'ui/index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT_DIR, 'ui/app.js'), 'utf8');

  assert.ok(indexHtml.includes('id="btnGenerateDiagnosticReport"'));
  assert.ok(indexHtml.includes('id="modalDiagnosticReport"'));
  assert.ok(indexHtml.includes('id="diagnosticReportIframe"'));
  assert.ok(indexHtml.includes('id="btnPrintDiagnosticReport"'));

  assert.ok(appJs.includes('btnGenerateDiagnosticReport'));
  assert.ok(appJs.includes('/api/valida-pdf/report'));
  assert.ok(appJs.includes('diagnosticReportIframe'));
});

test('autoDetectPdfMapping autodetecta os 3 pilares no Recibo de Pagamento (Magnum)', async () => {
  const sample = path.join(SAMPLE_BASE, '1ª parcela 13º salario/Folha com Variável/Recibo de Pagamento.pdf');
  const res = await autoDetectPdfMapping(sample);

  assert.ok(res.prontoParaMapear);
  assert.equal(res.fileName, 'Recibo de Pagamento.pdf');
  assert.equal(res.multiLinhas, true);

  // Pilar 1: Obrigação (13 SALARIO ADIANTADO ou RECIBO DE PAGAMENTO)
  assert.ok(res.pilares.pilar1_obrigacao);
  assert.ok(res.pilares.pilar1_obrigacao.linha > 0);
  assert.ok(/13\s+SALARIO\s+ADIANTADO|RECIBO\s+DE\s+PAGAMENTO/i.test(res.pilares.pilar1_obrigacao.termoMapeado));

  // Pilar 2: Cliente CNPJ
  assert.ok(res.pilares.pilar2_cliente);
  assert.equal(res.pilares.pilar2_cliente.tipo, 'CNPJ');
  assert.equal(res.pilares.pilar2_cliente.valor, '12.237.587/0001-36');
  assert.ok(res.pilares.pilar2_cliente.linha > 0);

  // Pilar 3: Competência (trecho exato do documento)
  assert.ok(res.pilares.pilar3_competencia);
  assert.equal(res.pilares.pilar3_competencia.competenciaDetectada, 'Novembro/2025');
  assert.equal(res.pilares.pilar3_competencia.competenciaNormalizada, '11/2025');
  assert.equal(res.pilares.pilar3_competencia.formato, 'mes_ano');
});

test('autoDetectPdfMapping autodetecta os 3 pilares na DARF DCTFWeb (Magnum)', async () => {
  const sample = path.join(SAMPLE_BASE, 'Folha sem variavel/GUIA DCTF WEB.pdf');
  const res = await autoDetectPdfMapping(sample);

  assert.ok(res.prontoParaMapear);
  assert.ok(res.pilares.pilar1_obrigacao);
  assert.ok(res.pilares.pilar2_cliente);
  assert.ok(res.pilares.pilar3_competencia);
});

test('Rota /api/valida-pdf/auto-map processa arquivo e retorna mapeamento dos 3 pilares', async () => {
  const sample = path.join(SAMPLE_BASE, 'Folha sem variavel/Recibo de Pagamento.pdf');
  let statusCode = null;
  let responseData = null;

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {
      writeHead: (code) => { statusCode = code; },
      end: (data) => { responseData = JSON.parse(data); }
    },
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/auto-map'),
      payload: { filePath: sample },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      catalogsDir: '/tmp',
      send: (res, code, data) => { statusCode = code; responseData = data; return data; }
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 200);
  assert.ok(responseData.ok);
  assert.ok(responseData.prontoParaMapear);
  assert.ok(responseData.pilares.pilar1_obrigacao);
  assert.ok(responseData.pilares.pilar2_cliente);
  assert.ok(responseData.pilares.pilar3_competencia);
});

test('Rota /api/valida-pdf/create-model-gclick rejeita com 400 amigável quando sessão desconectada', async () => {
  let statusCode = null;
  let responseData = null;

  const handled = await handleValidaPdfRoutes(
    { method: 'POST' },
    {
      writeHead: (code) => { statusCode = code; },
      end: (data) => { responseData = JSON.parse(data); }
    },
    {
      url: new URL('http://127.0.0.1:8766/api/valida-pdf/create-model-gclick'),
      payload: {
        nomeModelo: 'Teste Modelo Automatizado',
        filePath: '/tmp/teste.pdf'
      },
      currentUser: { id: 1 },
      authService: {},
      requireAccount: (id) => id,
      loginContext: null,
      hasGclickActiveSession: () => false,
      catalogsDir: '/tmp',
      send: (res, code, data) => { statusCode = code; responseData = data; return data; }
    }
  );

  assert.notEqual(handled, false);
  assert.equal(statusCode, 400);
  assert.equal(responseData.ok, false);
  assert.ok(responseData.error.includes('Sessão no G-Click não conectada'));
});

test('UI: Integração entre Validador de Arquivos e Mapeamento no G-Click', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT_DIR, 'ui/index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT_DIR, 'ui/app.js'), 'utf8');

  // Elementos HTML de integração
  assert.ok(indexHtml.includes('id="btnGoToMappingFromFiles"'));
  assert.ok(indexHtml.includes('id="validaCountForMapping"'));
  assert.ok(indexHtml.includes('id="mapValidatedSourceBanner"'));
  assert.ok(indexHtml.includes('id="mapValidatedFilesSelect"'));
  assert.ok(indexHtml.includes('id="btnLoadSelectedValidatedFile"'));
  assert.ok(indexHtml.includes('id="btnReturnToFilesTab"'));

  // Funções no app.js
  assert.ok(appJs.includes('updateMappingValidatedFilesDropdown'));
  assert.ok(appJs.includes('loadValidatedFileIntoMapping'));
  assert.ok(appJs.includes('btn-map-pdf'));
  assert.ok(appJs.includes('btnGoToMappingFromFiles'));
});

test('createAndMapPdfLayoutOnGclick executa fluxo completo com seletores corretos do G-Click', async () => {
  const actionsLog = [];

  function createMockLocator(name) {
    return {
      first: () => createMockLocator(`${name}.first()`),
      waitFor: async () => { actionsLog.push(`waitFor:${name}`); },
      click: async () => { actionsLog.push(`click:${name}`); },
      fill: async (val) => { actionsLog.push(`fill:${name}:${val}`); },
      count: async () => 1,
      selectOption: async (opt) => { actionsLog.push(`selectOption:${name}:${JSON.stringify(opt)}`); },
      setInputFiles: async (p) => { actionsLog.push(`setInputFiles:${name}:${p}`); },
      isVisible: async () => true
    };
  }

  const mockModelPage = {
    url: () => 'https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=667&paramaba=3&empId=6019',
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    locator: (selector) => createMockLocator(selector),
    evaluate: async (fn, arg) => {
      actionsLog.push(`evaluateModelPage:${typeof fn}`);
      return true;
    },
    close: async () => { actionsLog.push('close:modelPage'); }
  };

  const mockPage = {
    url: () => 'https://app.gclick.com.br/configuracaoListar.do?obj=pdflayoutopen&tipo=0&empId=6019',
    goto: async (url) => { actionsLog.push(`goto:${url}`); },
    waitForTimeout: async () => {},
    locator: (selector) => createMockLocator(selector),
    context: () => ({
      waitForEvent: async () => mockModelPage,
      pages: () => [mockPage, mockModelPage]
    }),
    evaluate: async () => '667',
    close: async () => { actionsLog.push('close:page'); }
  };

  const mockLoginContext = {
    newPage: async () => mockPage
  };

  const result = await createAndMapPdfLayoutOnGclick(mockLoginContext, '6019', {
    nomeModelo: 'Recibo Pagamento 2',
    departamentoNome: 'Departamento Pessoal',
    filePath: '/tmp/modelo.pdf',
    pilar1: { linha: 10, texto: '13 SALARIO ADIANTADO' },
    pilar2: { linha: 15, texto: '12.237.587/0001-36' },
    pilar3: { linha: 65, texto: 'Novembro/2025', formato: 'mes_ano' },
    multiLinhas: true
  });

  assert.ok(result.ok);
  assert.equal(result.nomeModelo, 'Recibo Pagamento 2');
  assert.equal(result.departamentoNome, 'Departamento Pessoal');
  assert.ok(actionsLog.some(a => a.includes('novopdflnome') && a.includes('Recibo Pagamento 2')));
  assert.ok(actionsLog.some(a => a.includes('anexararquivoa')));
  assert.ok(actionsLog.some(a => a.includes('close:page')));
  assert.ok(actionsLog.some(a => a.includes('evaluateModelPage')));
});

test('autoDetectPdfMapping detecta CPF do Empregador e Competência Ano no eSocial 13º Salário', async () => {
  const file13 = '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum/2ª parcela 13º Salario/Domestica/eSocial_Demonstrativo_Recibo_Décimo Terceiro.pdf';
  try { await fs.access(file13); } catch { return; }

  const mapping = await autoDetectPdfMapping(file13);
  assert.ok(mapping);
  assert.equal(mapping.pilares.pilar2_cliente?.tipo, 'CPF');
  assert.equal(mapping.pilares.pilar2_cliente?.linha, 7);
  assert.equal(mapping.pilares.pilar2_cliente?.valor, '60008989672');
  assert.equal(mapping.pilares.pilar3_competencia?.linha, 2);
  assert.equal(mapping.pilares.pilar3_competencia?.formato, 'ano');
  assert.equal(mapping.pilares.pilar3_competencia?.trechoExato, '2025');
  assert.equal(mapping.pilares.pilar1_obrigacao?.linha, 15);
  assert.equal(mapping.pilares.pilar1_obrigacao?.termoMapeado, 'Demonstrativo dos Valores Devidos');
});

test('autoDetectPdfMapping detecta CPF do Empregador e Competência Mês/Ano no eSocial Mensal', async () => {
  const fileSet = '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum/Domestica/eSocial_Demonstrativo_Recibo_Setembro_2026.pdf';
  try { await fs.access(fileSet); } catch { return; }

  const mapping = await autoDetectPdfMapping(fileSet);
  assert.ok(mapping);
  assert.equal(mapping.pilares.pilar2_cliente?.tipo, 'CPF');
  assert.equal(mapping.pilares.pilar2_cliente?.linha, 7);
  assert.equal(mapping.pilares.pilar2_cliente?.valor, '60008989672');
  assert.equal(mapping.pilares.pilar3_competencia?.linha, 2);
  assert.equal(mapping.pilares.pilar3_competencia?.formato, 'mes_ano');
  assert.equal(mapping.pilares.pilar3_competencia?.trechoExato, 'Setembro/2026');
});






