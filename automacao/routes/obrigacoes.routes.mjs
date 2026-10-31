// Roteador Modular de Obrigações e Automação de E-mail / WhatsApp
// Responsabilidade Única: rotas /api/obrigacoes/*

import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureEmpresaActive } from '../lib/gclick.mjs';

export async function handleObrigacoesRoutes(req, res, {
  url,
  payload,
  currentUser,
  authService,
  requireAccount,
  loginContext,
  hasGclickActiveSession,
  exclusive,
  catalogsDir,
  savedObrigacoesTemplates,
  getDefaultTemplates,
  saveObrigacoesTemplates,
  obrigacoesProgressRef,
  obrigacoesLib,
  send
}) {
  const {
    inspectObrigacoesPage,
    syncObrigacoesComCanais,
    auditObrigacoesList,
    classifyObrigacaoParidade,
    inspectEmailConfig,
    configureEmailActivity,
    configureBatchEmailActivities,
    inspectWhatsappConfig,
    createAndConfigureWhatsappActivity,
    configureBatchWhatsappActivities,
    mapWhatsappFlow
  } = obrigacoesLib;

  if (url.pathname === '/api/obrigacoes/inspect') {
    const accountId = requireAccount(payload.accountId ?? '6581');
    if (!authService.hasPermission(currentUser.id, 'obrigacoes.visualizar', accountId)) {
      return send(res, 403, { error: 'Acesso negado para a conta informada' });
    }
    if (!loginContext) {
      throw new Error('A janela do G-Click precisa estar aberta para inspecionar Obrigações. Abra a janela em Conexão & Conta e realize o login.');
    }
    return send(res, 200, await exclusive(async () => {
      const pages = loginContext.pages().filter(p => !p.isClosed());
      const loggedIn = pages.some(p => {
        try {
          const u = new URL(p.url());
          return /(^|\.)gclick\.com\.br$/.test(u.hostname) && !u.pathname.startsWith('/autenticacao');
        } catch { return false; }
      });
      if (!loggedIn) {
        throw new Error('Sessão no G-Click não detectada. Faça o login na janela do navegador antes de inspecionar Obrigações.');
      }

      const targetUrl = payload.url ?? `https://app.gclick.com.br/configuracaoListar.do?obj=coobrigacaoopen&tipo=0&status=1&empId=${encodeURIComponent(accountId)}`;
      const page = await loginContext.newPage();
      try {
        const analysis = await inspectObrigacoesPage(page, { url: targetUrl });
        if (analysis?.currentUrl && (analysis.currentUrl.includes('/autenticacao') || analysis.currentUrl.includes('/login'))) {
          throw new Error('Acesso à página de Obrigações redirecionado para login. Verifique as credenciais ou permissões no G-Click.');
        }
        return analysis;
      } finally {
        await page.close();
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/catalog') {
    let accountId = payload.accountId ? String(payload.accountId).trim() : '';
    if (!accountId && loginContext) {
      try {
        const pages = loginContext.pages().filter(p => !p.isClosed());
        for (const p of pages) {
          const u = new URL(p.url());
          if (/(^|\.)gclick\.com\.br$/.test(u.hostname) && !u.pathname.startsWith('/autenticacao')) {
            const empId = await p.evaluate(() => {
              try {
                const cur = localStorage.getItem('g3CurrentEmpresa');
                return cur ? JSON.parse(cur)?.id : null;
              } catch { return null; }
            }).catch(() => null);
            if (empId) { accountId = String(empId); break; }
          }
        }
      } catch {}
    }
    if (!accountId) accountId = '6581';
    const catalogPath = path.join(catalogsDir, `obrigacoes-${accountId}.json`);
    let items = [];
    let source = 'none';
    try {
      items = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
      source = 'file';
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Erro ao ler catálogo de obrigações:', e);
    }
    const isLive = Boolean(loginContext && hasGclickActiveSession(loginContext));
    return send(res, 200, {
      accountId,
      items,
      total: items.length,
      source,
      live: isLive
    });
  }

  if (url.pathname === '/api/obrigacoes/progress') {
    return send(res, 200, obrigacoesProgressRef.value);
  }

  if (url.pathname === '/api/obrigacoes/sync-catalog') {
    const accountId = requireAccount(payload.accountId ?? '6581');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de sincronizar as obrigações.'
      });
    }
    const empresaCheck = await ensureEmpresaActive(loginContext, accountId);
    if (!empresaCheck.active) {
      return send(res, 400, {
        error: `Sessão do G-Click conectada em outra empresa (${empresaCheck.currentEmpresaNome || empresaCheck.currentAccountId || 'desconhecida'}). Alterne para a conta ${accountId} em "Conexão & Conta G-Click".`
      });
    }
    return send(res, 200, await exclusive(async () => {
      console.log(`[OBRIGACOES] Iniciando sincronização filtrada para a conta ${accountId}…`);
      obrigacoesProgressRef.value = {
        running: true,
        action: 'sync',
        stage: `Iniciando sincronização das obrigações da conta ${accountId}...`,
        current: 0,
        total: 0,
        percent: 0,
        nome: '',
        id: null,
        matched: 0,
        updatedAt: Date.now()
      };
      const page = await loginContext.newPage();
      try {
        const result = await syncObrigacoesComCanais(page, {
          accountId,
          onProgress: (p) => {
            const current = p.current || 0;
            const total = p.total || 0;
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            obrigacoesProgressRef.value = {
              running: true,
              action: 'sync',
              stage: `Sincronizando ${current}/${total}: ${p.nome || ''}`,
              current,
              total,
              percent,
              nome: p.nome || '',
              matched: p.matched || 0,
              updatedAt: Date.now()
            };
            if (p.status === 'inspecting_item') {
              console.log(`[OBRIGACOES] Analisando ${p.current}/${p.total}: ${p.nome} (encontradas com canais: ${p.matched})`);
            }
          }
        });
        const catalogPath = path.join(catalogsDir, `obrigacoes-${accountId}.json`);
        await fs.writeFile(catalogPath, JSON.stringify(result.items, null, 2), 'utf8');
        console.log(`[OBRIGACOES] Sincronização concluída: ${result.totalImported} de ${result.totalScanned} importadas.`);
        return {
          success: true,
          accountId,
          items: result.items,
          total: result.totalImported,
          totalScanned: result.totalScanned,
          source: 'live'
        };
      } finally {
        obrigacoesProgressRef.value = {
          ...obrigacoesProgressRef.value,
          running: false,
          percent: 100,
          updatedAt: Date.now()
        };
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/templates') {
    const accountId = payload.accountId ? String(payload.accountId).trim() : '6581';
    const templates = savedObrigacoesTemplates[accountId] || getDefaultTemplates();
    return send(res, 200, { accountId, templates });
  }

  if (url.pathname === '/api/obrigacoes/templates/save') {
    const accountId = requireAccount(payload.accountId ?? '6581');
    if (!payload.templates || typeof payload.templates !== 'object') {
      throw new Error('Templates inválidos');
    }
    savedObrigacoesTemplates[accountId] = payload.templates;
    await saveObrigacoesTemplates();
    return send(res, 200, { success: true, accountId, templates: savedObrigacoesTemplates[accountId] });
  }

  if (url.pathname === '/api/obrigacoes/audit') {
    const accountId = payload.accountId ? String(payload.accountId).trim() : '6581';
    let items = payload.items;
    if (!Array.isArray(items) || items.length === 0) {
      const catalogPath = path.join(catalogsDir, `obrigacoes-${accountId}.json`);
      try {
        items = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
      } catch {
        items = [];
      }
    }
    const auditResult = auditObrigacoesList(items);
    return send(res, 200, { accountId, ...auditResult });
  }

  if (url.pathname === '/api/obrigacoes/email-inspect') {
    const accountId = requireAccount(payload.accountId ?? '6581');
    const id = payload.id;
    const coid = payload.coid;
    if (!id || !coid) throw new Error('Parâmetros id e coid são obrigatórios');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de inspecionar a obrigação.'
      });
    }
    return send(res, 200, await exclusive(async () => {
      const page = await loginContext.newPage();
      try {
        const config = await inspectEmailConfig(page, {
          id,
          coid,
          empId: accountId
        });
        return {
          success: true,
          accountId,
          id,
          coid,
          ...config
        };
      } finally {
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/fix-email') {
    const accountId = requireAccount(payload.accountId ?? '6581');
    const id = payload.id;
    const coid = payload.coid;
    if (!id || !coid) throw new Error('Parâmetros id e coid são obrigatórios');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de ajustar a obrigação.'
      });
    }
    return send(res, 200, await exclusive(async () => {
      obrigacoesProgressRef.value = {
        running: true,
        action: 'single_email',
        stage: `Configurando E-mail da obrigação #${id}...`,
        current: 1,
        total: 1,
        percent: 30,
        id,
        nome: '',
        updatedAt: Date.now()
      };
      const page = await loginContext.newPage();
      try {
        const resConfig = await configureEmailActivity(page, {
          id,
          coid,
          empId: accountId,
          categorias: payload.categorias ?? [],
          assunto: payload.assunto ?? '',
          corpoTexto: payload.corpoTexto ?? '',
          automacao: payload.automacao ?? '1',
          anexarTodos: payload.anexarTodos !== false,
          tipoCancelamento: payload.tipoCancelamento ?? '1',
          particularidadeCliente: payload.particularidadeCliente ?? null
        });
        return {
          success: true,
          accountId,
          ...resConfig
        };
      } finally {
        obrigacoesProgressRef.value = {
          ...obrigacoesProgressRef.value,
          running: false,
          percent: 100,
          updatedAt: Date.now()
        };
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/fix-email-batch') {
    const accountId = requireAccount(payload.accountId ?? '6581');
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) throw new Error('Selecione pelo menos uma obrigação para configurar em lote.');
    const departamento = String(payload.departamento ?? '').trim();
    if (!departamento) throw new Error('Para a ação em massa, o departamento deve estar obrigatoriamente selecionado no filtro.');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de ajustar as obrigações em lote.'
      });
    }
    return send(res, 200, await exclusive(async (signal) => {
      obrigacoesProgressRef.value = {
        running: true,
        action: 'batch_email',
        stage: `Iniciando configuração de e-mail em massa para ${items.length} obrigação(ões)...`,
        current: 0,
        total: items.length,
        percent: 0,
        id: null,
        nome: '',
        updatedAt: Date.now()
      };
      const page = await loginContext.newPage();
      try {
        const batchRes = await configureBatchEmailActivities(page, {
          items,
          empId: accountId,
          config: {
            categorias: payload.categorias ?? [],
            assunto: payload.assunto ?? '',
            corpoTexto: payload.corpoTexto ?? '',
            automacao: payload.automacao ?? '1',
            anexarTodos: payload.anexarTodos !== false,
            tipoCancelamento: payload.tipoCancelamento ?? '1',
            particularidadeCliente: payload.particularidadeCliente ?? null
          },
          onProgress: (p) => {
            const current = p.current || 0;
            const total = p.total || items.length;
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            obrigacoesProgressRef.value = {
              running: true,
              action: 'batch_email',
              stage: `Configurando E-mail ${current}/${total}: ${p.item?.nome || ''}`,
              current,
              total,
              percent,
              nome: p.item?.nome || '',
              id: p.item?.id,
              updatedAt: Date.now()
            };
          }
        });
        return {
          success: true,
          accountId,
          departamento,
          ...batchRes
        };
      } finally {
        obrigacoesProgressRef.value = {
          ...obrigacoesProgressRef.value,
          running: false,
          percent: 100,
          updatedAt: Date.now()
        };
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/whatsapp-inspect') {
    const accountId = requireAccount(payload.accountId ?? '6019');
    const id = payload.id;
    const coid = payload.coid;
    if (!id || !coid) throw new Error('Parâmetros id e coid são obrigatórios');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de inspecionar o WhatsApp.'
      });
    }
    return send(res, 200, await exclusive(async () => {
      const page = await loginContext.newPage();
      try {
        const inspectRes = await inspectWhatsappConfig(page, {
          id,
          coid,
          empId: accountId
        });
        return {
          accountId,
          ...inspectRes
        };
      } finally {
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/create-whatsapp') {
    const accountId = requireAccount(payload.accountId ?? '6019');
    const id = payload.id;
    const coid = payload.coid;
    if (!id || !coid) throw new Error('Parâmetros id e coid são obrigatórios');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de criar o passo de WhatsApp.'
      });
    }
    return send(res, 200, await exclusive(async () => {
      obrigacoesProgressRef.value = {
        running: true,
        action: 'single_whatsapp',
        stage: `Criando passo de WhatsApp para obrigação #${id}...`,
        current: 1,
        total: 1,
        percent: 30,
        id,
        nome: '',
        updatedAt: Date.now()
      };
      const page = await loginContext.newPage();
      try {
        const resConfig = await createAndConfigureWhatsappActivity(page, {
          id,
          coid,
          empId: accountId,
          tipoDesejado: payload.tipoDesejado ?? 'Atendimento: DIGISAC',
          textoDesejado: payload.textoDesejado ?? 'Enviar Cliente',
          categorias: Array.isArray(payload.categorias) ? payload.categorias : [],
          canal: payload.canal ?? 'WHATSAPP - Atendimento',
          mensagemTexto: payload.mensagemTexto ?? '',
          automacao: payload.automacao ?? '1',
          anexarTodos: payload.anexarTodos !== false,
          tipoCancelamento: payload.tipoCancelamento ?? '1',
          particularidadeCliente: payload.particularidadeCliente ?? '542'
        });

        // Atualiza a obrigação no catálogo local salvo se existir
        const catalogPath = path.join(catalogsDir, `obrigacoes-${accountId}.json`);
        try {
          const raw = await fs.readFile(catalogPath, 'utf8');
          const list = JSON.parse(raw);
          const item = list.find(o => String(o.id) === String(id));
          if (item && !resConfig.skipped && Array.isArray(resConfig.atividadesFinais)) {
            item.atividades = resConfig.atividadesFinais;
            item.paridade = classifyObrigacaoParidade(item.atividades, item);
            await fs.writeFile(catalogPath, JSON.stringify(list, null, 2), 'utf8');
          }
        } catch (e) {
          console.warn('Catálogo local não pôde ser atualizado após criação de WhatsApp:', e.message);
        }

        return {
          accountId,
          ...resConfig
        };
      } finally {
        obrigacoesProgressRef.value = {
          ...obrigacoesProgressRef.value,
          running: false,
          percent: 100,
          updatedAt: Date.now()
        };
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/create-whatsapp-batch') {
    const accountId = requireAccount(payload.accountId ?? '6019');
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) throw new Error('Selecione pelo menos uma obrigação para configurar WhatsApp em lote.');
    const departamento = String(payload.departamento ?? '').trim();
    if (!departamento) throw new Error('Para a ação em massa, o departamento deve estar obrigatoriamente selecionado no filtro.');
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de ajustar as obrigações em lote.'
      });
    }
    return send(res, 200, await exclusive(async (signal) => {
      obrigacoesProgressRef.value = {
        running: true,
        action: 'batch_whatsapp',
        stage: `Iniciando criação de WhatsApp em massa para ${items.length} obrigação(ões)...`,
        current: 0,
        total: items.length,
        percent: 0,
        id: null,
        nome: '',
        updatedAt: Date.now()
      };
      const page = await loginContext.newPage();
      try {
        const batchRes = await configureBatchWhatsappActivities(page, {
          items,
          empId: accountId,
          config: {
            tipoDesejado: payload.tipoDesejado ?? 'Atendimento: DIGISAC',
            textoDesejado: payload.textoDesejado ?? 'Enviar Cliente',
            categorias: Array.isArray(payload.categorias) ? payload.categorias : [],
            canal: payload.canal ?? 'WHATSAPP - Atendimento',
            mensagemTexto: payload.mensagemTexto ?? '',
            automacao: payload.automacao ?? '1',
            anexarTodos: payload.anexarTodos !== false,
            tipoCancelamento: payload.tipoCancelamento ?? '1',
            particularidadeCliente: payload.particularidadeCliente ?? '542'
          },
          onProgress: (p) => {
            const current = p.current || 0;
            const total = p.total || items.length;
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            obrigacoesProgressRef.value = {
              running: true,
              action: 'batch_whatsapp',
              stage: `Criando WhatsApp ${current}/${total}: ${p.item?.nome || ''}`,
              current,
              total,
              percent,
              nome: p.item?.nome || '',
              id: p.item?.id,
              updatedAt: Date.now()
            };
          }
        });

        // Atualiza o catálogo local
        const catalogPath = path.join(catalogsDir, `obrigacoes-${accountId}.json`);
        try {
          const raw = await fs.readFile(catalogPath, 'utf8');
          const list = JSON.parse(raw);
          const finaisPorId = new Map(
            batchRes.results
              .filter(r => r.success && !r.skipped && Array.isArray(r.details?.atividadesFinais))
              .map(r => [String(r.id), r.details.atividadesFinais])
          );
          for (const item of list) {
            const finais = finaisPorId.get(String(item.id));
            if (finais) {
              item.atividades = finais;
              item.paridade = classifyObrigacaoParidade(item.atividades, item);
            }
          }
          await fs.writeFile(catalogPath, JSON.stringify(list, null, 2), 'utf8');
        } catch (e) {
          console.warn('Catálogo local não pôde ser atualizado após criação em lote de WhatsApp:', e.message);
        }

        return {
          success: true,
          accountId,
          departamento,
          ...batchRes
        };
      } finally {
        obrigacoesProgressRef.value = {
          ...obrigacoesProgressRef.value,
          running: false,
          percent: 100,
          updatedAt: Date.now()
        };
        await page.close().catch(() => {});
      }
    }, true));
  }

  if (url.pathname === '/api/obrigacoes/whatsapp-map') {
    const accountId = requireAccount(payload.accountId ?? '6019');
    const id = payload.id ?? 9;
    const coid = payload.coid ?? 4;
    const tipoDesejado = payload.tipoDesejado ?? 'Atendimento: DIGISAC';
    const textoDesejado = payload.textoDesejado ?? 'Enviar Cliente';
    if (!loginContext || !hasGclickActiveSession(loginContext)) {
      return send(res, 400, {
        error: 'Sessão do G-Click não conectada. Conecte sua conta no menu "Conexão & Conta G-Click" antes de mapear o WhatsApp.'
      });
    }
    return send(res, 200, await exclusive(async () => {
      const page = await loginContext.newPage();
      try {
        const mapResult = await mapWhatsappFlow(page, {
          id,
          coid,
          empId: accountId,
          tipoDesejado,
          textoDesejado
        });
        return {
          success: true,
          accountId,
          ...mapResult
        };
      } finally {
        await page.close().catch(() => {});
      }
    }, true));
  }

  return false;
}
