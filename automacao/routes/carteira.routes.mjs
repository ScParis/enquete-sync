// Roteador Modular de Carteira de Clientes por Usuário
// Responsabilidade Única: rotas /api/carteira/*

import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureEmpresaActive } from '../lib/gclick.mjs';
import { registrarCarteiraOperacao, listarCarteiraOperacoes } from '../lib/carteira-log.mjs';

export async function handleCarteiraRoutes(req, res, {
  url,
  payload,
  currentUser,
  authService,
  requireAccount,
  loginContext,
  hasGclickActiveSession,
  exclusive,
  catalogsDir,
  runsDir,
  carteiraLib,
  send
}) {
  const {
    formatCnpjMask,
    parseCarteiraSpreadsheet,
    buildCarteiraFromRows,
    resolveUser,
    fetchGclickUsers,
    getCachedUsers,
    syncMinhaCarteira,
    getCachedMinhaCarteira,
    updateCachedMinhaCarteiraUser,
    assertCarteiraOrigem,
    retirarClientesCarteira,
    findExistingCarteiraPage,
    ensureCarteiraPage,
    inspectUserCarteira,
    auditUserCarteira,
    vincularClientesCarteira,
    buildCarteiraAuditCsv
  } = carteiraLib;

  // 1. GET /api/carteira/users - Retorna catálogo de usuários em cache da conta
  if (url.pathname === '/api/carteira/users') {
    const accountId = requireAccount(payload?.accountId || url.searchParams.get('accountId'));
    if (!authService.hasPermission(currentUser.id, 'carteira.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.visualizar" necessária' });
    }
    const users = await getCachedUsers(catalogsDir, accountId);
    const minhaCarteira = await getCachedMinhaCarteira(catalogsDir, accountId);
    return send(res, 200, { accountId, count: users.length, users, minhaCarteira });
  }

  // 2. POST /api/carteira/users/sync - Sincroniza usuários do G-Click e o que está em "Minha Carteira" de cada um
  if (url.pathname === '/api/carteira/users/sync') {
    const accountId = requireAccount(payload?.accountId);
    if (!authService.hasPermission(currentUser.id, 'carteira.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.visualizar" necessária' });
    }
    if (!loginContext) {
      throw new Error('A janela do G-Click precisa estar aberta. Abra a janela na seção "Conexão & Sessão" e realize o login antes de sincronizar usuários.');
    }

    const hasSession = await hasGclickActiveSession(loginContext);
    if (!hasSession) {
      throw new Error('Sessão no G-Click não detectada. Abra a conexão na seção "Conexão & Sessão" e realize o login no G-Click antes de sincronizar os usuários.');
    }

    const activeCheck = await ensureEmpresaActive(loginContext, accountId);
    if (!activeCheck.active) {
      throw new Error(`Sessão no G-Click conectada em outra empresa (${activeCheck.currentEmpresaNome || activeCheck.currentAccountId || 'desconhecida'}). Alterne para a conta ${accountId} em "Conexão & Conta G-Click".`);
    }

    return send(res, 200, await exclusive(async () => {
      const users = await fetchGclickUsers(loginContext, accountId, { saveCache: true, catalogsDir });
      const { page, isNew } = await ensureCarteiraPage(loginContext, accountId);
      try {
        const minhaCarteira = await syncMinhaCarteira(page, accountId, { catalogsDir });
        return { success: true, accountId, count: users.length, users, minhaCarteira };
      } finally {
        if (isNew) await page.close().catch(() => {});
      }
    }, true));
  }

  // 3. POST /api/carteira/sheet/parse - Processa planilha informada (URL ou CSV)
  if (url.pathname === '/api/carteira/sheet/parse') {
    const accountId = requireAccount(payload?.accountId);
    if (!authService.hasPermission(currentUser.id, 'carteira.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.visualizar" necessária' });
    }

    // A planilha chega já lida e convertida pelo DE/PARA em Planilhas (uso "Carteira por Usuário").
    // csvContent segue aceito para chamadas antigas, com detecção das colunas pelo nome.
    let parsed;
    if (Array.isArray(payload?.rows)) {
      if (!payload.rows.length) throw new Error('A planilha da Carteira não tem linhas.');
      parsed = buildCarteiraFromRows(payload.rows);
    } else if (typeof payload?.csvContent === 'string' && payload.csvContent) {
      parsed = parseCarteiraSpreadsheet(payload.csvContent);
    } else {
      throw new Error('Leia a planilha da Carteira em Planilhas antes de conferir.');
    }
    const cachedUsers = await getCachedUsers(catalogsDir, accountId);

    // Enriquece os usuários identificados na planilha com os dados do catálogo
    const enrichedUsers = parsed.users.map(u => {
      const match = resolveUser(u.responsavel, cachedUsers);
      return {
        ...u,
        resolvido: Boolean(match),
        usuarioGclick: match || null
      };
    });

    return send(res, 200, {
      success: true,
      accountId,
      totalRows: parsed.totalRows,
      validCnpjs: parsed.validCnpjs,
      invalidCnpjs: parsed.invalidCnpjs,
      detectedColumns: parsed.detectedColumns,
      users: enrichedUsers
    });
  }

  // 4. POST /api/carteira/audit - Executa conferência somente-leitura na Carteira do G-Click
  if (url.pathname === '/api/carteira/audit') {
    const accountId = requireAccount(payload?.accountId);
    if (!authService.hasPermission(currentUser.id, 'carteira.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.visualizar" necessária' });
    }
    if (!loginContext) {
      throw new Error('A janela do G-Click precisa estar aberta. Abra a conexão na seção "Conexão & Sessão" e realize o login antes de auditar a Carteira.');
    }

    const hasSession = await hasGclickActiveSession(loginContext);
    if (!hasSession) {
      throw new Error('Sessão no G-Click não detectada. Abra a conexão na seção "Conexão & Sessão" e realize o login no G-Click antes de auditar a Carteira.');
    }

    const activeCheckAudit = await ensureEmpresaActive(loginContext, accountId);
    if (!activeCheckAudit.active) {
      throw new Error(`Sessão no G-Click conectada em outra empresa (${activeCheckAudit.currentEmpresaNome || activeCheckAudit.currentAccountId || 'desconhecida'}). Alterne para a conta ${accountId} em "Conexão & Conta G-Click".`);
    }

    const targetUser = payload?.responsavel ? String(payload.responsavel).trim() : '';
    const userEmpresas = Array.isArray(payload?.empresas) ? payload.empresas : [];

    if (!targetUser) {
      throw new Error('Responsável / Usuário não informado para auditoria.');
    }
    if (!userEmpresas.length) {
      throw new Error('Nenhuma empresa/CNPJ fornecida para conferência.');
    }

    return send(res, 200, await exclusive(async () => {
      const cachedUsers = await getCachedUsers(catalogsDir, accountId);
      const { page, isNew } = typeof ensureCarteiraPage === 'function'
        ? await ensureCarteiraPage(loginContext, accountId)
        : { page: await loginContext.newPage(), isNew: true };
      try {
        const inspection = await inspectUserCarteira(page, accountId, targetUser, cachedUsers);
        const audit = auditUserCarteira(userEmpresas, inspection);
        return { success: true, audit };
      } finally {
        if (isNew) {
          await page.close().catch(() => {});
        }
      }
    }, true));
  }

  // 5. POST /api/carteira/vincular - Executa a vinculação física dos clientes disponíveis
  if (url.pathname === '/api/carteira/vincular') {
    const accountId = requireAccount(payload?.accountId);
    if (!authService.hasPermission(currentUser.id, 'carteira.vincular', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.vincular" necessária' });
    }
    if (!loginContext) {
      throw new Error('A janela do G-Click precisa estar aberta para executar a vinculação.');
    }

    const hasSession = await hasGclickActiveSession(loginContext);
    if (!hasSession) {
      throw new Error('Sessão no G-Click não detectada. Abra a conexão na seção "Conexão & Sessão" e realize o login no G-Click antes de vincular clientes.');
    }

    const activeCheckVinc = await ensureEmpresaActive(loginContext, accountId);
    if (!activeCheckVinc.active) {
      throw new Error(`Sessão no G-Click conectada em outra empresa (${activeCheckVinc.currentEmpresaNome || activeCheckVinc.currentAccountId || 'desconhecida'}). Alterne para a conta ${accountId} em "Conexão & Conta G-Click".`);
    }

    const targetUser = payload?.responsavel ? String(payload.responsavel).trim() : '';
    const cnpjsToLink = Array.isArray(payload?.cnpjs) ? payload.cnpjs : [];
    const origem = String(payload?.origem || '');
    assertCarteiraOrigem(origem);

    if (!targetUser) {
      throw new Error('Responsável / Usuário não informado para vinculação.');
    }
    if (!cnpjsToLink.length) {
      throw new Error('Nenhum CNPJ informado para vincular.');
    }

    return send(res, 200, await exclusive(async () => {
      const cachedUsers = await getCachedUsers(catalogsDir, accountId);
      const { page, isNew } = typeof ensureCarteiraPage === 'function'
        ? await ensureCarteiraPage(loginContext, accountId)
        : { page: await loginContext.newPage(), isNew: true };
      const registro = { accountId, operador: currentUser?.email, acao: 'vincular', origem, usuario: targetUser, solicitados: cnpjsToLink };
      try {
        let result;
        try {
          result = await vincularClientesCarteira(page, accountId, targetUser, cnpjsToLink, cachedUsers, { origem });
        } catch (error) {
          registrarCarteiraOperacao({ ...registro, erro: error.message });
          throw error;
        }
        result.registro = registrarCarteiraOperacao({ ...registro, concluidos: result.transferredCnpjs || [],
          erro: result.markedCount === 0 ? result.message : null });

        // Registra log da execução em runs/
        if (runsDir) {
          try {
            await fs.mkdir(runsDir, { recursive: true });
            const logName = `carteira-${accountId}-${Date.now()}.json`;
            await fs.writeFile(path.join(runsDir, logName), JSON.stringify({
              timestamp: new Date().toISOString(),
              accountId,
              user: targetUser,
              origem,
              operator: currentUser?.email,
              result
            }, null, 2), 'utf8');
          } catch (e) {
            console.warn('Falha ao gravar log da carteira:', e);
          }
        }

        return result;
      } finally {
        if (isNew) {
          await page.close().catch(() => {});
        }
      }
    }, true));
  }

  // 5b. POST /api/carteira/retirar - Retira clientes de "Minha Carteira" de um usuário; todo resultado vai para o histórico
  if (url.pathname === '/api/carteira/retirar') {
    const accountId = requireAccount(payload?.accountId);
    if (!authService.hasPermission(currentUser.id, 'carteira.vincular', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.vincular" necessária' });
    }
    const usuario = payload?.usuario ? String(payload.usuario).trim() : '';
    const valor = payload?.valor !== undefined && payload?.valor !== null ? String(payload.valor) : null;
    const cnpjs = Array.isArray(payload?.cnpjs) ? payload.cnpjs.map(String) : [];
    if (!usuario) throw new Error('Usuário do G-Click não informado para retirar.');
    if (!cnpjs.length) throw new Error('Nenhum CNPJ informado para retirar.');

    const registro = { accountId, operador: currentUser?.email, acao: 'retirar', usuario, solicitados: cnpjs };
    try {
      if (!loginContext) throw new Error('A janela do G-Click precisa estar aberta para retirar clientes. Abra a conexão em "Conexão G-Click".');
      if (!await hasGclickActiveSession(loginContext)) {
        throw new Error('Sessão no G-Click não detectada. Faça o login em "Conexão G-Click" antes de retirar clientes.');
      }
      const activeCheck = await ensureEmpresaActive(loginContext, accountId);
      if (!activeCheck.active) {
        throw new Error(`Sessão no G-Click conectada em outra empresa (${activeCheck.currentEmpresaNome || activeCheck.currentAccountId || 'desconhecida'}). Alterne para a conta ${accountId} em "Conexão G-Click".`);
      }

      return send(res, 200, await exclusive(async () => {
        const cachedUsers = await getCachedUsers(catalogsDir, accountId);
        const { page, isNew } = await ensureCarteiraPage(loginContext, accountId);
        try {
          const result = await retirarClientesCarteira(page, accountId, usuario, cnpjs, cachedUsers, { optionValue: valor });
          const pendencias = [
            result.naoRemovidos.length ? `${result.naoRemovidos.length} CNPJ(s) continuaram em Minha Carteira depois do "Retirar": ${result.naoRemovidos.join(', ')}` : '',
            result.naoEncontrados.length ? `${result.naoEncontrados.length} CNPJ(s) não estavam em Minha Carteira: ${result.naoEncontrados.join(', ')}` : '',
            result.avisos.length ? `Mensagem do G-Click: ${result.avisos.join(' | ')}` : ''
          ].filter(Boolean).join('. ');
          result.registro = registrarCarteiraOperacao({ ...registro, concluidos: result.removidos,
            erro: result.removidos.length === cnpjs.length ? null : pendencias || 'Nenhum CNPJ foi retirado.' });
          result.usuarioSincronizado = valor ? await updateCachedMinhaCarteiraUser(catalogsDir, accountId, valor, result.minhaCarteira).catch(() => null) : null;
          return result;
        } finally {
          if (isNew) await page.close().catch(() => {});
        }
      }, true));
    } catch (error) {
      registrarCarteiraOperacao({ ...registro, erro: error.message });
      throw error;
    }
  }

  // 5c. GET /api/carteira/operacoes - Histórico de vínculos e retiradas da conta
  if (url.pathname === '/api/carteira/operacoes') {
    const accountId = requireAccount(payload?.accountId || url.searchParams.get('accountId'));
    if (!authService.hasPermission(currentUser.id, 'carteira.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.visualizar" necessária' });
    }
    return send(res, 200, { accountId, operacoes: listarCarteiraOperacoes(accountId, { limit: url.searchParams.get('limit') || 30 }) });
  }

  // 6. POST /api/carteira/audit/export - Exporta relatório de auditoria em CSV
  if (url.pathname === '/api/carteira/audit/export') {
    const accountId = requireAccount(payload?.accountId);
    if (!authService.hasPermission(currentUser.id, 'carteira.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado: permissão "carteira.visualizar" necessária' });
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const csv = buildCarteiraAuditCsv(items);
    return send(res, 200, {
      csv,
      filename: `auditoria-carteira-${accountId}-${Date.now()}.csv`
    });
  }

  return false;
}
