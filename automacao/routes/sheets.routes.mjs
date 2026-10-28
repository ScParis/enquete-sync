// Roteador Modular de Integração e Sincronização com Google Sheets
// Responsabilidade Única: rotas /api/sheet-writer/* e /api/audit/sync-sheet

import crypto from 'node:crypto';
import { parseSheetUrl } from '../lib/google-service.mjs';

export async function handleSheetsRoutes(req, res, {
  url,
  payload,
  currentUser,
  authService,
  requireAccount,
  readWriters,
  saveWriters,
  writeAuditLog,
  writerFor,
  pushPendingMarks,
  testSheetWriter,
  validScriptUrl,
  appsScriptSource,
  accountSettings,
  readLedger,
  getLatestReport,
  lastReport,
  catalogState,
  readStoredCatalog,
  savedMappings,
  buildAuditLogRows,
  send
}) {
  if (url.pathname === '/api/sheet-writer/status') {
    const accountId = requireAccount(payload.accountId);
    const writer = (await readWriters())[accountId];
    const ledger = await readLedger(accountId);
    return send(res, 200, {
      configured: Boolean(writer?.url),
      url: writer?.url ?? '',
      aba: writer?.aba ?? null,
      testedAt: writer?.testedAt ?? null,
      hasSheetUrl: Boolean(accountSettings[accountId]?.sheetUrl),
      marks: ledger.length,
      pending: ledger.filter(e => e.planilha !== 'gravado').length
    });
  }

  if (url.pathname === '/api/sheet-writer/script') {
    const accountId = requireAccount(payload.accountId);
    const writers = await readWriters();
    if (!writers[accountId]?.token) {
      writers[accountId] = { ...writers[accountId], token: crypto.randomBytes(24).toString('hex') };
      await saveWriters(writers);
    }
    return send(res, 200, { script: appsScriptSource(writers[accountId].token) });
  }

  if (url.pathname === '/api/sheet-writer/save') {
    const accountId = requireAccount(payload.accountId);
    const sheetUrl = accountSettings[accountId]?.sheetUrl;
    if (!sheetUrl) throw new Error('Salve antes o link da aba da planilha desta conta');
    const writers = await readWriters();
    if (!writers[accountId]?.token) {
      writers[accountId] = { ...writers[accountId], token: crypto.randomBytes(24).toString('hex') };
      await saveWriters(writers);
    }
    const scriptUrl = validScriptUrl(payload.url);
    const tested = await testSheetWriter({ url: scriptUrl, token: writers[accountId].token, gid: parseSheetUrl(sheetUrl).gid });
    writers[accountId] = { ...writers[accountId], url: scriptUrl, aba: tested.aba, testedAt: new Date().toISOString() };
    await saveWriters(writers);
    return send(res, 200, { configured: true, aba: tested.aba, sync: await pushPendingMarks(accountId) });
  }

  if (url.pathname === '/api/sheet-writer/resend') {
    return send(res, 200, await pushPendingMarks(requireAccount(payload.accountId)));
  }

  if (url.pathname === '/api/audit/sync-sheet') {
    const accountId = requireAccount(payload.accountId);
    if (!authService.hasPermission(currentUser.id, 'planilha.escrever', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "planilha.escrever" necessária nesta conta' });
    }
    const rep = (await getLatestReport(accountId)) || lastReport;
    if (!rep) throw new Error('Nenhum relatório de auditoria disponível para sincronizar');
    const catalog = catalogState?.accountId === accountId ? catalogState : (await readStoredCatalog(accountId));
    const ledger = await readLedger(accountId);
    const rows = buildAuditLogRows(rep, catalog, savedMappings, ledger);
    const writer = await writerFor(accountId);
    if (!writer) throw new Error('Apps Script não configurado para esta conta');
    const targetGid = payload.gid ? Number(payload.gid) : writer.gid;
    const table2D = [
      ['Conta','Linha Planilha','Cod. / ID Cliente','CNPJ','Razão Social / Empresa','Cliente no G-Click','Obrigação / Tarefa','Cód. Pergunta','Pergunta','Departamento / Categoria','Cód. Resposta Mapeada','Resposta Mapeada','Valor Interno','Status da Auditoria','Código do Status','Resposta Atual no G-Click','Motivo / Detalhes da Validação','Ação do Robô','Auditado em'],
      ...rows.map(r => [r.conta, r.linhaPlanilha, r.codCliente, r.cnpj, r.empresa, r.clienteGClick, r.tarefa, r.codPergunta, r.pergunta, r.categoria, r.codResposta, r.respostaEsperada, r.valorInterno, r.statusTexto, r.statusCodigo, r.respostaAtualGClick, r.motivo, r.acaoRobo, r.auditadoEm])
    ];
    const resWrite = await writeAuditLog({ url: writer.url, token: writer.token, gid: targetGid }, table2D);
    return send(res, 200, resWrite);
  }

  return false;
}
