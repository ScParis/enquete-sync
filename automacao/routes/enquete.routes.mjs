// Roteador Modular da Enquete (Tarefas, Planilhas, Mapeamentos e Relatórios)
// Responsabilidade Única: rotas /api/tasks, /api/mappings/plan, /api/mappings/save*, /api/report*, /api/marcacoes*, /api/downloads, /api/accounts/save

import path from 'node:path';
import { resolveNormalizedSource } from '../lib/source-resolver.mjs';
import { makePlan, scopeFromEligible, validCnpj, normalizeCnpj } from '../lib/data.mjs';
import { TARGET_MODELS } from '../lib/mapping-engine.mjs';
import { listCsvDownloads } from '../lib/downloads.mjs';
import { buildAuditLogRows, auditLogCsv } from '../lib/audit-logger.mjs';

export async function handleEnqueteRoutes(req, res, ctx) {
  const {
    url,
    payload,
    currentUser,
    authService,
    requireAccount,
    loadSource,
    savedProfiles,
    savedMappingsRef,
    saveMappings,
    accountSettings,
    saveAccountSettings,
    listStoredAccounts,
    validSheetUrl,
    readLedger,
    ledgerCsv,
    catalogState,
    readStoredCatalog,
    loginReady,
    lastReportRef,
    getLatestReport,
    auditProgressRef,
    applyProgressRef,
    downloadsDir,
    previewStateRef,
    send
  } = ctx;

  // 1. GET /api/report.json
  if (req.method === 'GET' && url.pathname === '/api/report.json') {
    const lastReport = lastReportRef?.value;
    const accountId = url.searchParams.get('account') || lastReport?.accountId || '2420';
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: sem permissão para esta conta' });
    }
    const rep = (await getLatestReport(accountId)) || lastReport;
    return rep ? send(res, 200, rep) : send(res, 404, { error: 'Nenhum relatório gerado' });
  }

  // 2. GET /api/report.csv ou /api/audit/log.csv
  if (req.method === 'GET' && (url.pathname === '/api/report.csv' || url.pathname === '/api/audit/log.csv')) {
    const lastReport = lastReportRef?.value;
    const accountId = url.searchParams.get('account') || lastReport?.accountId || '2420';
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.exportar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: sem permissão para esta conta' });
    }
    const rep = (await getLatestReport(accountId)) || lastReport;
    if (!rep) return send(res, 404, { error: 'Nenhum relatório de auditoria gerado' });
    const catalog = catalogState?.accountId === rep.accountId ? catalogState : (await readStoredCatalog(rep.accountId));
    const ledger = await readLedger(rep.accountId);
    const rows = buildAuditLogRows(rep, catalog, savedMappingsRef.value, ledger);
    return send(res, 200, auditLogCsv(rows), 'text/csv; charset=utf-8');
  }

  // 3. GET /api/marcacoes.csv
  if (req.method === 'GET' && url.pathname === '/api/marcacoes.csv') {
    const accountId = requireAccount(url.searchParams.get('account'));
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.exportar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: sem permissão para esta conta' });
    }
    const type = url.searchParams.get('type');
    if (type === 'ledger_only') {
      return send(res, 200, ledgerCsv(await readLedger(accountId)), 'text/csv; charset=utf-8');
    }
    const rep = (await getLatestReport(accountId)) || lastReportRef?.value;
    if (!rep) {
      if (type === 'ledger') return send(res, 200, ledgerCsv(await readLedger(accountId)), 'text/csv; charset=utf-8');
      return send(res, 404, { error: 'Nenhum relatório de auditoria gerado' });
    }
    const catalog = catalogState?.accountId === accountId ? catalogState : (await readStoredCatalog(accountId));
    const ledger = await readLedger(accountId);
    const rows = buildAuditLogRows(rep, catalog, savedMappingsRef.value, ledger);
    return send(res, 200, auditLogCsv(rows), 'text/csv; charset=utf-8');
  }

  // 4. GET /api/audit/progress
  if (url.pathname === '/api/audit/progress') {
    return send(res, 200, auditProgressRef.value);
  }

  // 5. GET /api/apply/progress
  if (url.pathname === '/api/apply/progress') {
    return send(res, 200, applyProgressRef.value);
  }

  // 6. GET /api/downloads
  if (url.pathname === '/api/downloads') {
    return send(res, 200, { files: await listCsvDownloads(downloadsDir) });
  }

  // 7. POST /api/accounts/save
  if (req.method === 'POST' && url.pathname === '/api/accounts/save') {
    const accountId = requireAccount(payload.accountId);
    const changes = {};
    if ('sheetUrl' in payload) changes.sheetUrl = validSheetUrl(payload.sheetUrl);
    if ('carteiraSheetUrl' in payload) changes.carteiraSheetUrl = validSheetUrl(payload.carteiraSheetUrl);
    accountSettings[accountId] = { ...accountSettings[accountId], ...changes, updatedAt: new Date().toISOString() };
    await saveAccountSettings();
    return send(res, 200, { accounts: await listStoredAccounts() });
  }

  // 8. POST /api/mappings/save
  if (req.method === 'POST' && url.pathname === '/api/mappings/save') {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'mapeamentos.gerenciar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "mapeamentos.gerenciar" necessária' });
    }
    const task = String(payload.task ?? '').trim();
    const answerRef = String(payload.answerRef ?? '');
    const excluded = payload.excluded === true;
    const availableCatalog = catalogState?.accountId === accountId && loginReady ? catalogState : null;
    if (!task || task.length > 250) throw new Error('Tarefa inválida');
    if (answerRef && excluded) throw new Error('Uma tarefa excluída não pode ter resposta associada');
    let found = null;
    if (answerRef) {
      if (!availableCatalog) throw new Error('Conecte a Enquete desta conta: as perguntas e respostas são lidas dela antes de mapear.');
      for (const question of availableCatalog.questions) {
        const answer = question.answers.find(a => a.ref === answerRef);
        if (answer) found = { question, answer };
      }
      if (!found) throw new Error('Resposta não encontrada no catálogo desta conta');
    }
    const current = savedMappingsRef.value.find(x => x.accountId === accountId && x.task === task);
    if (current && ((found && !current.excluded && current.answerRef === answerRef) || (excluded && current.excluded))) {
      return send(res, 200, { savedMappings: savedMappingsRef.value, unchanged: true });
    }
    savedMappingsRef.value = savedMappingsRef.value.filter(x => !(x.accountId === accountId && x.task === task));
    if (found) {
      savedMappingsRef.value.push({
        accountId, task, answerRef,
        questionLabel: found.question.label,
        answerLabel: found.answer.label,
        catalogSource: 'live',
        updatedAt: new Date().toISOString()
      });
    } else if (excluded) {
      savedMappingsRef.value.push({
        accountId, task, excluded: true,
        updatedAt: new Date().toISOString()
      });
    }
    await saveMappings();
    previewStateRef.value = null;
    return send(res, 200, { savedMappings: savedMappingsRef.value });
  }

  // 9. POST /api/mappings/save-batch
  if (req.method === 'POST' && url.pathname === '/api/mappings/save-batch') {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'mapeamentos.gerenciar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "mapeamentos.gerenciar" necessária' });
    }
    const mappingsToSave = Array.isArray(payload.mappings) ? payload.mappings : [];
    const availableCatalog = catalogState?.accountId === accountId && loginReady ? catalogState : null;
    if (!availableCatalog) throw new Error('Conecte a Enquete desta conta antes de salvar lote de mapeamentos.');
    let updatedCount = 0;
    for (const item of mappingsToSave) {
      const task = String(item.task ?? '').trim();
      const answerRef = String(item.answerRef ?? '').trim();
      if (!task || !answerRef) continue;
      let found = null;
      for (const question of availableCatalog.questions) {
        const answer = question.answers.find(a => a.ref === answerRef);
        if (answer) { found = { question, answer }; break; }
      }
      if (!found) continue;
      savedMappingsRef.value = savedMappingsRef.value.filter(x => !(x.accountId === accountId && x.task === task));
      savedMappingsRef.value.push({
        accountId, task, answerRef,
        questionLabel: found.question.label,
        answerLabel: found.answer.label,
        catalogSource: 'live',
        updatedAt: new Date().toISOString()
      });
      updatedCount++;
    }
    if (updatedCount > 0) {
      await saveMappings();
      previewStateRef.value = null;
    }
    return send(res, 200, { savedMappings: savedMappingsRef.value, updatedCount });
  }

  // 10. POST /api/mappings/plan
  if (req.method === 'POST' && url.pathname === '/api/mappings/plan') {
    const accountId = requireAccount(payload.accountId);
    const task = String(payload.task ?? '').trim();
    const saved = savedMappingsRef.value.find(x => x.accountId === accountId && x.task === task);
    if (!saved) throw new Error('Tarefa sem mapeamento salvo nesta conta');

    const { rows } = await resolveNormalizedSource(payload, {
      loadSource,
      savedProfiles,
      defaultModel: 'enquete_automacao'
    });

    const derived = scopeFromEligible(rows, { allowedTasks: [task], excludedTasks: [] });
    const plan = derived.scope.length ? makePlan(rows, derived.scope, { allowedTasks: [task], excludedTasks: [] }) : [];
    const ledger = await readLedger(accountId);

    return send(res, 200, {
      task,
      excluded: Boolean(saved.excluded),
      answerRef: saved.answerRef ?? null,
      invalid: derived.invalid,
      rows: plan.map(item => {
        const marked = ledger.filter(e => e.cnpj === item.cnpj && e.task === task).pop();
        return {
          cnpj: item.cnpj,
          empId: item.empId,
          empresa: item.empresa,
          status: item.status,
          reason: item.reason,
          marcadoEm: marked?.at ?? null
        };
      })
    });
  }

  // 11. POST /api/tasks
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const {
      source,
      structure,
      profile,
      table,
      rows,
      audit
    } = await resolveNormalizedSource(payload, {
      loadSource,
      savedProfiles,
      defaultModel: 'enquete_automacao'
    });

    let isEligible = true;
    let missingForAutomation = [];

    if (profile) {
      if (profile.targetModel !== 'enquete_automacao') {
        isEligible = false;
        missingForAutomation = ['Obrigações/Tarefas (perfil: ' + (TARGET_MODELS[profile.targetModel]?.label || profile.targetModel) + ')'];
      } else {
        const mappedFields = new Set(profile.columns?.filter(c => c.action === 'map').map(c => c.targetField));
        const missing = [];
        if (!mappedFields.has('tarefa')) missing.push('Obrigação / Tarefa');
        if (!mappedFields.has('cnpj') && !mappedFields.has('empId') && !mappedFields.has('cod')) {
          missing.push('Identificador do Cliente (CNPJ ou Cod./EmpID)');
        }
        missingForAutomation = missing;
        if (missingForAutomation.length) isEligible = false;
      }
    } else {
      const hasTask = ['Obrigação / Tarefa', 'Obrigação', 'Tarefa', 'tarefa'].some(col => table.columns.includes(col));
      const hasId = ['CNPJ', 'EmpID', 'Cod.', 'Código', 'cnpj', 'empId', 'cod'].some(col => table.columns.includes(col));
      const missing = [];
      if (!hasTask) missing.push('Obrigação / Tarefa');
      if (!hasId) missing.push('Identificador do Cliente (CNPJ ou Cod./EmpID)');
      missingForAutomation = missing;
      if (missingForAutomation.length) isEligible = false;
    }

    const columns = table.columns.map((name, index) => {
      const values = table.rows.map(row => row[index].trim()).filter(Boolean);
      return { name, index, filled: values.length, distinct: new Set(values).size };
    });
    const tableResult = { columns, rows: table.rows, profile: profile ?? null, audit };
    if (!isEligible || missingForAutomation.length) {
      return send(res, 200, {
        source: source.label,
        stale: source.stale,
        rowCount: table.rows.length,
        kind: 'table',
        missingForAutomation,
        tasks: [],
        table: tableResult,
        profile: profile ?? null,
        audit
      });
    }

    const accountId = payload.accountId ? String(payload.accountId).trim() : '';
    const availableCatalog = catalogState?.accountId === accountId && loginReady ? catalogState : null;
    const taskColumn = rows[0] && ('_norm' in rows[0] ? '_norm.tarefa' : ['Obrigação / Tarefa', 'Obrigação', 'Tarefa', 'tarefa'].find(c => c in rows[0]));

    const counts = new Map();
    for (const row of rows) {
      const name = String(row._norm?.tarefa ?? row['Obrigação / Tarefa'] ?? row['Obrigação'] ?? row['Tarefa'] ?? '').trim();
      if (!name) continue;
      const item = counts.get(name) ?? { name, count: 0, clients: new Set(), invalidCnpjs: 0 };
      item.count++;
      const cnpjVal = row._norm?.cnpj ?? row.CNPJ ?? row.cnpj;
      const idVal = row._norm?.empId ?? row._norm?.cod ?? row.EmpID ?? row['Cod.'] ?? row.cod ?? row.empId;
      if (validCnpj(cnpjVal)) item.clients.add(normalizeCnpj(cnpjVal));
      else if (idVal && String(idVal).trim() && String(idVal).trim() !== '-') item.clients.add(`id:${String(idVal).trim()}`);
      else item.invalidCnpjs++;
      counts.set(name, item);
    }

    return send(res, 200, {
      source: source.label,
      stale: source.stale,
      rowCount: rows.length,
      kind: 'tasks',
      table: tableResult,
      profile: profile ?? null,
      audit,
      tasks: [...counts.values()].map(({ name, count, clients, invalidCnpjs }) => ({
        name,
        count,
        clients: clients.size,
        invalidCnpjs
      })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    });
  }

  return false;
}
