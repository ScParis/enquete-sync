// Roteador Modular do Valida PDF (G-Click PDF Layout)
// Responsabilidade Única: endpoints /api/valida-pdf/*

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  extractPdfText,
  validatePdfFile,
  syncGclickPdfModels,
  extractClientIdentifiers,
  extractCompetencia,
  extractDocumentName,
  inspectGclickValidaPdfScreen,
  validatePdfOnGclickScreen,
  generateValidationDiagnosticReport,
  autoDetectPdfMapping,
  createAndMapPdfLayoutOnGclick,
  correlateModelsWithObrigacoes,
  normalizeModelObject,
  classifyModelStatus,
  inspectGclickPdfModelDetails,
  detectPdfDuplicatesAndConflicts,
  reconcileFolderWithGclick,
  validatePdfViaGclickUploadScreen
} from '../lib/valida-pdf.mjs';

const modelsCache = new Map();

export async function handleValidaPdfRoutes(req, res, {
  url,
  payload,
  currentUser,
  authService,
  requireAccount,
  loginContext,
  hasGclickActiveSession,
  catalogsDir,
  exclusive,
  jobManager,
  send
}) {
  const runExclusive = typeof exclusive === 'function' ? exclusive : (fn) => fn();

  // 1. Listagem de Modelos de PDF (suporta GET e POST com enriquecimento, cache mtime e estatísticas)
  if (url.pathname === '/api/valida-pdf/models') {
    const accountId = payload?.accountId || url.searchParams?.get('accountId') || '6019';
    const targetFile = path.join(catalogsDir, `pdf-models-${accountId}.json`);
    const defaultFile = path.join(catalogsDir, `pdf-models-6019.json`);
    const obFile = path.join(catalogsDir, `obrigacoes-${accountId}.json`);
    const obDefault = path.join(catalogsDir, 'obrigacoes-6019.json');

    // Checa cache de mtime
    let fileToCheck = targetFile;
    let fileMtime = 0;
    try {
      const st = await fs.stat(targetFile);
      fileMtime = st.mtimeMs;
    } catch {
      try {
        const st = await fs.stat(defaultFile);
        fileMtime = st.mtimeMs;
        fileToCheck = defaultFile;
      } catch {}
    }

    let obMtime = 0;
    try {
      const st = await fs.stat(obFile);
      obMtime = st.mtimeMs;
    } catch {
      try {
        const st = await fs.stat(obDefault);
        obMtime = st.mtimeMs;
      } catch {}
    }

    const cached = modelsCache.get(accountId);
    if (cached && cached.fileMtime === fileMtime && cached.obMtime === obMtime) {
      return send(res, 200, cached.data);
    }

    let rawModels = [];
    try {
      rawModels = JSON.parse(await fs.readFile(targetFile, 'utf8'));
    } catch {
      try {
        rawModels = JSON.parse(await fs.readFile(defaultFile, 'utf8'));
      } catch {
        rawModels = [];
      }
    }

    // Carrega obrigações para cruzar vínculos
    let obrigacoes = [];
    try {
      obrigacoes = JSON.parse(await fs.readFile(obFile, 'utf8'));
    } catch {
      try {
        obrigacoes = JSON.parse(await fs.readFile(obDefault, 'utf8'));
      } catch {}
    }

    const models = correlateModelsWithObrigacoes(rawModels, obrigacoes);

    const configurados = models.filter(m => m.statusCode === 'configurado').length;
    const pendentesCampos = models.filter(m => m.statusCode === 'pendente_campos').length;
    const semArquivo = models.filter(m => m.statusCode === 'sem_arquivo').length;
    const comObrigacao = models.filter(m => Boolean(m.obrigacao)).length;

    const responsePayload = {
      accountId,
      total: models.length,
      stats: {
        total: models.length,
        configurados,
        pendentesCampos,
        semArquivo,
        comObrigacao
      },
      models
    };

    modelsCache.set(accountId, {
      fileMtime,
      obMtime,
      data: responsePayload
    });

    return send(res, 200, responsePayload);
  }

  // 1.1 Detalhes de um Modelo Específico (3 Pilares e Configurações)
  if (url.pathname === '/api/valida-pdf/model-details') {
    const accountId = payload?.accountId || url.searchParams?.get('accountId') || '6019';
    const modelId = payload?.modelId || url.searchParams?.get('modelId');
    if (!modelId) {
      return send(res, 400, { error: 'O parâmetro modelId é obrigatório.' });
    }

    if (loginContext && hasGclickActiveSession(loginContext)) {
      try {
        const details = await runExclusive(() => inspectGclickPdfModelDetails(loginContext, accountId, modelId));
        return send(res, 200, { ok: true, details });
      } catch (err) {
        console.warn(`[valida-pdf] Falha ao inspecionar modelo ${modelId} no G-Click:`, err.message);
      }
    }

    const targetFile = path.join(catalogsDir, `pdf-models-${accountId}.json`);
    const defaultFile = path.join(catalogsDir, `pdf-models-6019.json`);
    let rawList = [];
    try { rawList = JSON.parse(await fs.readFile(targetFile, 'utf8')); }
    catch { try { rawList = JSON.parse(await fs.readFile(defaultFile, 'utf8')); } catch {} }

    const model = rawList.find(m => String(m.modelId || m.id) === String(modelId));
    if (!model) return send(res, 404, { error: `Modelo ${modelId} não encontrado.` });

    const norm = normalizeModelObject(model, accountId);
    return send(res, 200, { ok: true, details: norm });
  }

  // 2. Sincronização ao vivo de Modelos com o G-Click
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/sync-models') {
    const accountId = requireAccount(payload?.accountId || '6019');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      throw new Error('Sessão no G-Click não conectada. Conecte a sessão na seção "Conexão G-Click" antes de sincronizar modelos.');
    }

    modelsCache.delete(accountId);
    const models = await runExclusive(() => syncGclickPdfModels(loginContext, accountId, catalogsDir));
    return send(res, 200, {
      ok: true,
      accountId,
      total: models.length,
      models,
      message: `${models.length} modelos sincronizados com sucesso do G-Click.`
    });
  }

  // 2.1 Inspeção da tela do G-Click (Dashboard / PDF Layouts / Dropzones)
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/inspect-screen') {
    const accountId = requireAccount(payload?.accountId || '6019');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      throw new Error('Sessão no G-Click não conectada. Conecte a sessão na seção "Conexão G-Click".');
    }

    const screenData = await runExclusive(() => inspectGclickValidaPdfScreen(loginContext, accountId));
    return send(res, 200, {
      ok: true,
      accountId,
      screens: screenData
    });
  }

  // 2.2 Validação direta no motor oficial do G-Click em tela
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/validate-on-gclick') {
    const accountId = requireAccount(payload?.accountId || '6019');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        ok: false,
        error: 'Sessão no G-Click não conectada. Conecte a sessão na seção "Conexão G-Click" antes de validar no sistema da Omie/G-Click.'
      });
    }

    let filePath = payload?.filePath;
    let tempCreated = false;

    if (!filePath && payload?.fileBase64) {
      const fileName = (payload?.fileName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join('/tmp', `valida_gclick_${Date.now()}_${fileName}`);
      const buffer = Buffer.from(payload.fileBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      await fs.writeFile(filePath, buffer);
      tempCreated = true;
    }

    if (!filePath) {
      return send(res, 400, { error: 'O caminho do arquivo (filePath) ou o conteúdo (fileBase64) é obrigatório.' });
    }

    try {
      const result = await runExclusive(() => validatePdfOnGclickScreen(loginContext, accountId, {
        filePath,
        modelId: payload?.modelId || null
      }));

      return send(res, 200, result);
    } finally {
      if (tempCreated) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  // 2.3 Teste Oficial de Validador na tela de Upload do G-Click (/upload)
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/test-upload-gclick') {
    const accountId = requireAccount(payload?.accountId || '6019');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        ok: false,
        error: 'Sessão no G-Click não conectada. Conecte a sessão na seção "Conexão G-Click" antes de validar no sistema da Omie/G-Click.'
      });
    }

    let filePath = payload?.filePath;
    let tempCreated = false;

    if (!filePath && payload?.fileBase64) {
      const fileName = (payload?.fileName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join('/tmp', `test_upload_${Date.now()}_${fileName}`);
      const buffer = Buffer.from(payload.fileBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      await fs.writeFile(filePath, buffer);
      tempCreated = true;
    }

    if (!filePath) {
      return send(res, 400, { error: 'O caminho do arquivo (filePath) ou o conteúdo (fileBase64) é obrigatório.' });
    }

    try {
      const result = await runExclusive(() => validatePdfViaGclickUploadScreen(loginContext, accountId, {
        filePath,
        reloadAfter: payload?.reloadAfter !== false,
        keepPageOpen: Boolean(payload?.keepPageOpen)
      }));
      return send(res, 200, result);
    } catch (err) {
      return send(res, 500, { ok: false, error: err.message });
    } finally {
      if (tempCreated) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  // 3. Validação de Arquivo Único
  // 3. Validação de Arquivo Único (Caminho ou Upload Base64)
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/validate-file') {
    let filePath = payload?.filePath;
    let tempCreated = false;

    if (!filePath && payload?.fileBase64) {
      const fileName = (payload?.fileName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join('/tmp', `valida_pdf_${Date.now()}_${fileName}`);
      const buffer = Buffer.from(payload.fileBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      await fs.writeFile(filePath, buffer);
      tempCreated = true;
    }

    if (!filePath) {
      return send(res, 400, { error: 'O caminho do arquivo (filePath) ou o conteúdo (fileBase64) é obrigatório.' });
    }

    const accountId = payload?.accountId || '6019';
    let models = [];
    try {
      models = JSON.parse(await fs.readFile(path.join(catalogsDir, `pdf-models-${accountId}.json`), 'utf8'));
    } catch {
      try {
        models = JSON.parse(await fs.readFile(path.join(catalogsDir, 'pdf-models-6019.json'), 'utf8'));
      } catch {}
    }

    try {
      const result = await validatePdfFile(filePath, {
        models,
        expectedCnpj: payload?.expectedCnpj,
        expectedCpf: payload?.expectedCpf,
        expectedCompetencia: payload?.expectedCompetencia
      });
      if (payload?.fileName) {
        result.fileName = payload.fileName;
      }
      return send(res, 200, result);
    } finally {
      if (tempCreated) {
        try { await fs.unlink(filePath); } catch {}
      }
    }
  }

  // 4. Validação em Lote (Diretório)
  // 4. Sugestão de Diretórios Conhecidos
  if (req.method === 'GET' && url.pathname === '/api/valida-pdf/suggest-directories') {
    const defaultPaths = [
      { label: '🏢 Escritório Magnum', path: '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum' },
      { label: '📁 Pasta Geral PDF Layout', path: '/home/piperun/Documentos/temp/G-click/PDF_Layout' },
      { label: '📁 Amostras Gclick', path: '/home/piperun/Documentos/temp/G-click/PDF_Layout/Gclick' }
    ];

    const available = [];
    for (const item of defaultPaths) {
      try {
        const stat = await fs.stat(item.path);
        if (stat.isDirectory()) {
          available.push({ ...item, exists: true });
        }
      } catch {
        available.push({ ...item, exists: false });
      }
    }

    return send(res, 200, { ok: true, directories: available });
  }

  // 4.1 Validação em Lote (Diretório Informado pelo Usuário)
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/validate-batch') {
    const targetDir = (payload?.dirPath || '/home/piperun/Documentos/temp/G-click/PDF_Layout/Magnum').trim();
    const accountId = payload?.accountId || '6019';

    // Valida se o diretório existe
    try {
      const stat = await fs.stat(targetDir);
      if (!stat.isDirectory()) {
        return send(res, 400, { error: `O caminho informado "${targetDir}" não é um diretório válido.` });
      }
    } catch (err) {
      return send(res, 400, { error: `Diretório não encontrado ou inacessível: "${targetDir}" (${err.message})` });
    }

    let models = [];
    try {
      models = JSON.parse(await fs.readFile(path.join(catalogsDir, `pdf-models-${accountId}.json`), 'utf8'));
    } catch {
      try {
        models = JSON.parse(await fs.readFile(path.join(catalogsDir, 'pdf-models-6019.json'), 'utf8'));
      } catch {}
    }

    let clientes = [];
    try {
      clientes = JSON.parse(await fs.readFile(path.join(catalogsDir, `clientes-${accountId}.json`), 'utf8'));
    } catch {
      try {
        clientes = JSON.parse(await fs.readFile(path.join(catalogsDir, 'clientes-6019.json'), 'utf8'));
      } catch {}
    }

    let obrigacoes = [];
    try {
      obrigacoes = JSON.parse(await fs.readFile(path.join(catalogsDir, `obrigacoes-${accountId}.json`), 'utf8'));
    } catch {
      try {
        obrigacoes = JSON.parse(await fs.readFile(path.join(catalogsDir, 'obrigacoes-6019.json'), 'utf8'));
      } catch {}
    }

    // Busca recursiva de arquivos PDF
    async function getPdfFiles(dir) {
      let results = [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(await getPdfFiles(fullPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    let files = [];
    try {
      files = await getPdfFiles(targetDir);
    } catch (err) {
      return send(res, 400, { error: `Erro ao varrer diretório: ${err.message}` });
    }

    // Processamento em lotes concorrentes (chunks de 8) para alta velocidade
    const chunkSize = 8;
    const validations = [];
    const subpastasSet = new Set();

    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (f) => {
          const v = await validatePdfFile(f, { models });
          const relPath = path.relative(targetDir, f);
          const dir = path.dirname(relPath);
          const subpasta = dir === '.' ? '' : dir;
          if (subpasta) subpastasSet.add(subpasta);

          return {
            ...v,
            relPath,
            subpasta
          };
        })
      );
      validations.push(...chunkResults);
    }

    // 1. Detecção profunda de duplicidades e retificações por conteúdo
    const duplicidades = detectPdfDuplicatesAndConflicts(validations);

    // 2. Conciliação com o G-Click (Clientes, Modelos e Obrigações)
    const { resumo: resumoConciliacao } = reconcileFolderWithGclick(validations, { models, clientes, obrigacoes });

    const resumo = {
      total: validations.length,
      validos: validations.filter(v => v.valido).length,
      inconsistentes: validations.filter(v => !v.valido).length,
      prontosParaEnvio: resumoConciliacao.prontosParaEnvio || 0,
      jaNoGclick: resumoConciliacao.jaNoGclick ?? resumoConciliacao.prontosParaEnvio ?? 0,
      faltaMapear: resumoConciliacao.faltaMapear ?? resumoConciliacao.pendentesModelo ?? 0,
      duplicatasIdenticas: duplicidades.totalArquivosDuplicados,
      conflitosRetificacao: duplicidades.totalRetificacoes,
      gruposDuplicidades: duplicidades.totalGrupos,
      pendentesModelo: resumoConciliacao.pendentesModelo || 0,
      clientesNaoCadastrados: resumoConciliacao.clientesNaoCadastrados || 0,
      semTextoOcr: validations.filter(v => v.status === 'erro_extracao').length,
      clienteInvalido: validations.filter(v => v.status === 'cliente_invalido').length,
      competenciaInvalida: validations.filter(v => v.status === 'competencia_invalida').length,
      documentoDesconhecido: validations.filter(v => v.status === 'documento_desconhecido').length,
      comCliente: validations.filter(v => v.regras.identificacaoCliente.ok).length,
      comCompetencia: validations.filter(v => v.regras.competencia.ok).length,
      comDocumento: validations.filter(v => v.regras.nomeDocumento.ok).length,
      totalSubpastas: subpastasSet.size
    };

    return send(res, 200, {
      ok: true,
      targetDir,
      resumo,
      duplicidades,
      conciliacao: resumoConciliacao,
      subpastas: Array.from(subpastasSet).sort(),
      arquivos: validations
    });
  }

  // 5. Extração e Inspeção de Texto
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/extract-text') {
    const filePath = payload?.filePath;
    if (!filePath) {
      return send(res, 400, { error: 'O caminho do arquivo (filePath) é obrigatório.' });
    }

    const { rawText, lines, totalLines } = await extractPdfText(filePath);
    const cliente = extractClientIdentifiers(rawText, lines);
    const comp = extractCompetencia(rawText, lines);
    const doc = extractDocumentName(rawText, lines);

    return send(res, 200, {
      filePath,
      fileName: path.basename(filePath),
      totalLines,
      rawText,
      lines: lines.slice(0, 100),
      cliente,
      competencia: comp,
      documento: doc
    });
  }

  // 6. Geração de Relatório de Diagnóstico de Validação (HTML / Markdown / JSON)
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/report') {
    const validations = payload?.files || payload?.validations || payload?.arquivos || [];
    const targetDir = payload?.dirPath || 'Arquivos Selecionados';
    const accountId = payload?.accountId || '6019';
    const accountName = payload?.accountName || 'CONTABILIDADE MAGNUM LTDA';
    const format = payload?.format || 'html';

    if (!Array.isArray(validations) || validations.length === 0) {
      return send(res, 400, { error: 'Nenhum resultado de validação fornecido para gerar o relatório.' });
    }

    const report = generateValidationDiagnosticReport(validations, {
      targetDir,
      accountId,
      accountName,
      format
    });

    if (format === 'html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(report);
    }

    if (format === 'markdown') {
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(report);
    }

    return send(res, 200, report);
  }

  // 7. Autodetecção de Mapeamento dos 3 Pilares em PDF
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/auto-map') {
    let filePath = payload?.filePath;
    let tempCreated = false;

    if (!filePath && payload?.fileBase64) {
      const fileName = (payload?.fileName || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join('/tmp', `automap_${Date.now()}_${fileName}`);
      const buffer = Buffer.from(payload.fileBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      await fs.writeFile(filePath, buffer);
      tempCreated = true;
    }

    if (!filePath) {
      return send(res, 400, { error: 'O caminho do arquivo (filePath) ou o conteúdo (fileBase64) é obrigatório.' });
    }

    try {
      const result = await autoDetectPdfMapping(filePath);
      if (payload?.fileName) {
        result.fileName = payload.fileName;
      }
      return send(res, 200, {
        ok: true,
        ...result
      });
    } catch (err) {
      return send(res, 500, { ok: false, error: `Falha ao autodetectar mapeamento: ${err.message}` });
    } finally {
      if (tempCreated) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  // 8. Criação e Mapeamento de Modelo diretamente no G-Click
  if (req.method === 'POST' && url.pathname === '/api/valida-pdf/create-model-gclick') {
    const accountId = requireAccount(payload?.accountId || '6019');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        ok: false,
        error: 'Sessão no G-Click não conectada. Conecte a sessão na seção "Conexão G-Click" antes de criar o modelo no sistema.'
      });
    }

    let filePath = payload?.filePath;
    let tempCreated = false;

    if (!filePath && payload?.fileBase64) {
      const fileName = (payload?.fileName || 'modelo.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      filePath = path.join('/tmp', `create_model_${Date.now()}_${fileName}`);
      const buffer = Buffer.from(payload.fileBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
      await fs.writeFile(filePath, buffer);
      tempCreated = true;
    }

    if (!filePath) {
      return send(res, 400, { error: 'O arquivo PDF de modelo (filePath ou fileBase64) é obrigatório.' });
    }

    try {
      modelsCache.delete(accountId);
      const result = await runExclusive(() => createAndMapPdfLayoutOnGclick(loginContext, accountId, {
        nomeModelo: payload?.nomeModelo,
        departamentoNome: payload?.departamentoNome || 'Departamento Pessoal',
        filePath,
        pilar1: payload?.pilar1,
        pilar2: payload?.pilar2,
        pilar3: payload?.pilar3,
        multiLinhas: payload?.multiLinhas !== false,
        obrigacaoNome: payload?.obrigacaoNome || null
      }));

      return send(res, 200, result);
    } catch (err) {
      return send(res, 500, { ok: false, error: `Erro ao criar modelo no G-Click: ${err.message}` });
    } finally {
      if (tempCreated) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  }

  return false;
}

