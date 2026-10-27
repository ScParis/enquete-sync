import fs from 'node:fs/promises';
import path from 'node:path';
import { gotoWithRetry } from './gclick.mjs';

const DEFAULT_URL = 'https://app.gclick.com.br/configuracaoListar.do?obj=coobrigacaoopen&tipo=0&status=1&empId=6581';

export async function inspectObrigacoesPage(page, { url = DEFAULT_URL, saveArtifacts = true, artifactDir = null } = {}) {
  await gotoWithRetry(page, url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  let analysis = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      analysis = await page.evaluate(() => {
    // 1. Título e cabeçalhos principais
    const title = document.title;
    const currentUrl = window.location.href;
    const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb, .breadcrumb li, .caminho, .caminhoPao, nav[aria-label="breadcrumb"] a, nav[aria-label="breadcrumb"] li'))
      .map(el => el.innerText.trim()).filter(Boolean);

    const headers = Array.from(document.querySelectorAll('h1, h2, h3, .page-title, .tituloPagina, .title, .card-title'))
      .map(el => el.innerText.trim()).filter(Boolean);

    // 2. Formulários e campos hidden
    const forms = Array.from(document.forms).map(f => {
      const hiddens = Array.from(f.querySelectorAll('input[type="hidden"]')).map(h => ({
        name: h.name || h.id,
        value: h.value
      }));
      return {
        id: f.id || null,
        name: f.name || null,
        action: f.action || null,
        method: (f.method || 'GET').toUpperCase(),
        hiddenInputs: hiddens
      };
    });

    // 3. Entradas, Filtros e Controles de Busca
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea')).map(el => {
      const tag = el.tagName.toLowerCase();
      const type = el.type || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'text');
      
      // Tenta achar o label associado
      let label = '';
      if (el.id) {
        const l = document.querySelector(`label[for="${el.id}"]`);
        if (l) label = l.innerText.trim();
      }
      if (!label && el.closest('label')) {
        label = el.closest('label').innerText.trim();
      }
      if (!label && el.parentElement) {
        const prev = el.previousElementSibling;
        if (prev && ['LABEL', 'SPAN', 'STRONG'].includes(prev.tagName)) label = prev.innerText.trim();
        else if (el.parentElement.innerText) {
          const firstLine = el.parentElement.innerText.split('\n')[0].trim();
          if (firstLine && firstLine.length < 50) label = firstLine;
        }
      }

      const info = {
        tag,
        type,
        name: el.name || null,
        id: el.id || null,
        placeholder: el.placeholder || null,
        label: label || null,
        value: el.value ?? null,
        checked: el.checked ?? null,
        disabled: el.disabled || false
      };

      if (tag === 'select') {
        info.options = Array.from(el.options).map(opt => ({
          value: opt.value,
          text: opt.text.trim(),
          selected: opt.selected
        }));
      }

      return info;
    });

    // 4. Tabelas e Colunas (Estrutura e Ordenações)
    const tables = Array.from(document.querySelectorAll('table')).map((table, tIdx) => {
      const ths = Array.from(table.querySelectorAll('th, thead td')).map(th => {
        const sortLink = th.querySelector('a');
        return {
          text: th.innerText.trim().replace(/\s+/g, ' '),
          sortable: !!sortLink || th.classList.contains('sortable') || !!th.getAttribute('onclick') || th.style.cursor === 'pointer',
          sortHref: sortLink ? sortLink.href : null,
          sortOnclick: th.getAttribute('onclick') || (sortLink ? sortLink.getAttribute('onclick') : null),
          className: th.className || null
        };
      });

      // Linhas de dados (amostra de até 15 linhas)
      const rows = Array.from(table.querySelectorAll('tbody tr, tr:not(:first-child)')).slice(0, 15).map(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => {
          const links = Array.from(td.querySelectorAll('a')).map(a => ({
            text: a.innerText.trim(),
            href: a.href,
            onclick: a.getAttribute('onclick') || null,
            title: a.title || null
          }));
          const buttons = Array.from(td.querySelectorAll('button, input[type="button"], input[type="submit"], i, .fa, .glyphicon')).map(b => ({
            tag: b.tagName.toLowerCase(),
            text: b.innerText.trim(),
            title: b.title || b.getAttribute('data-original-title') || null,
            className: b.className || null,
            onclick: b.getAttribute('onclick') || null
          }));
          return {
            text: td.innerText.trim().replace(/\s+/g, ' '),
            links,
            buttons
          };
        });
        return {
          id: tr.id || null,
          cells
        };
      });

      const totalRows = table.querySelectorAll('tbody tr, tr:not(:first-child)').length;

      return {
        tableIndex: tIdx,
        id: table.id || null,
        className: table.className || null,
        columns: ths,
        totalRowsRendered: totalRows,
        sampleRows: rows
      };
    });

    // 5. Botões e Clicáveis Principais
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a.button, .btn, .botao'))
      .map(b => ({
        tag: b.tagName.toLowerCase(),
        text: b.innerText.trim().replace(/\s+/g, ' '),
        id: b.id || null,
        className: b.className || null,
        name: b.name || null,
        type: b.type || null,
        href: b.href || null,
        onclick: b.getAttribute('onclick') || null,
        title: b.title || null,
        ariaLabel: b.getAttribute('aria-label') || null
      })).filter(b => b.text || b.title || b.id || b.href);

    // 6. Modais e Diálogos
    const modals = Array.from(document.querySelectorAll('.modal')).map(m => {
      const modalTitle = m.querySelector('.modal-title, h4, h3')?.innerText.trim() || '';
      const textareas = Array.from(m.querySelectorAll('textarea')).map(t => ({
        id: t.id || null,
        name: t.name || null,
        placeholder: t.placeholder || null,
        value: t.value || null
      }));
      const modalInputs = Array.from(m.querySelectorAll('input:not([type="hidden"]), select')).map(i => ({
        id: i.id || null,
        name: i.name || null,
        type: i.type || null,
        value: i.value || null,
        checked: i.checked ?? null
      }));
      const modalButtons = Array.from(m.querySelectorAll('button, a.btn')).map(b => ({
        text: b.innerText.trim(),
        id: b.id || null,
        onclick: b.getAttribute('onclick') || null
      }));
      return {
        id: m.id || null,
        title: modalTitle,
        textareas,
        inputs: modalInputs,
        buttons: modalButtons
      };
    });

    // 7. Paginação e Contadores
    const pagination = {
      elements: Array.from(document.querySelectorAll('.pagination, .paginacao, .page-navigation, ul.pagination li, .page-item'))
        .map(p => ({
          text: p.innerText.trim(),
          className: p.className || null,
          href: p.querySelector('a')?.href || null,
          onclick: p.querySelector('a')?.getAttribute('onclick') || null
        })),
      counters: Array.from(document.querySelectorAll('.registros, .totalRegistros, .dataTables_info, .total-itens, .page-info, [class*="total"], [class*="count"]'))
        .map(el => el.innerText.trim()).filter(Boolean)
    };

    // 7. Links principais da página
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({
        text: a.innerText.trim().replace(/\s+/g, ' '),
        href: a.href,
        onclick: a.getAttribute('onclick') || null,
        title: a.title || null
      }))
      .filter(a => a.text || a.title);

    return {
      title,
      url: currentUrl,
      breadcrumbs,
      headers,
      forms,
      inputs,
      tables,
      buttons,
      modals,
      pagination,
      totalLinks: links.length,
      sampleLinks: links.slice(0, 30)
    };
      });
      break;
    } catch (e) {
      if (attempt === 2 || !e.message.includes('Execution context was destroyed')) throw e;
      await page.waitForTimeout(2000);
    }
  }

  if (saveArtifacts) {
    const dir = artifactDir || path.resolve(import.meta.dirname, '../exemplos');
    await fs.mkdir(dir, { recursive: true });
    
    // Salva HTML completo
    const html = await page.content();
    await fs.writeFile(path.join(dir, 'obrigacoes-list.html'), html, 'utf8');

    // Salva Screenshot completo
    await page.screenshot({ path: path.join(dir, 'obrigacoes-list.png'), fullPage: true });

    // Salva JSON
    await fs.writeFile(path.join(dir, 'obrigacoes-map.json'), JSON.stringify(analysis, null, 2), 'utf8');
  }

  return analysis;
}

export async function extractObrigacoesList(page, { url = DEFAULT_URL } = {}) {
  await gotoWithRetry(page, url);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Garante exibição da maior quantidade possível por página no DataTables
  await page.evaluate(() => {
    const sel = document.querySelector('select[name*="length"], select[name*="DataTables_Table"]');
    if (sel) {
      const optAll = Array.from(sel.options).find(o => o.value === '-1') || sel.options[sel.options.length - 1];
      if (optAll && sel.value !== optAll.value) {
        sel.value = optAll.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.jQuery === 'function') {
          window.jQuery(sel).trigger('change');
        }
      }
    }
  }).catch(() => {});
  await page.waitForTimeout(1500);

  const allItems = [];
  const visitedIds = new Set();
  let pageIndex = 1;
  const maxPages = 50;

  while (pageIndex <= maxPages) {
    const pageItems = await page.evaluate(() => {
      const table = document.querySelector('#DataTables_Table_0') || document.querySelector('table.dataTable') || document.querySelector('table');
      if (!table) return [];
      const trs = Array.from(table.querySelectorAll('tbody tr'));
      return trs.map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 10) return null;
        const chk = tr.querySelector('input[type="checkbox"]');
        const link = tr.querySelector('td a[href*="configuracaoAbrir.do"]');
        let id = chk ? chk.value : null;
        let coid = null;
        if (link) {
          const u = new URL(link.href, window.location.origin);
          id = id || u.searchParams.get('id');
          coid = u.searchParams.get('coid');
        }
        return {
          indice: Number(tds[0]?.innerText.trim()) || null,
          departamento: tds[1]?.innerText.trim(),
          id: id ? Number(id) : null,
          coid: coid ? Number(coid) : null,
          nome: tds[3]?.innerText.trim().replace(/\s*-->$/, ''),
          urlDetalhes: link ? link.getAttribute('href') : null,
          frequencia: tds[4]?.innerText.trim(),
          acaoQtdDias: tds[5]?.innerText.trim(),
          metaQtdDias: tds[6]?.innerText.trim(),
          diaVencimento: tds[7]?.innerText.trim(),
          fatoGerador: tds[8]?.innerText.trim(),
          orgao: tds[9]?.innerText.trim(),
          reenvio: tds[10]?.innerText.trim(),
          status: tds[11]?.innerText.trim(),
          quadroKanban: tds[12]?.innerText.trim()
        };
      }).filter(Boolean);
    });

    for (const item of pageItems) {
      if (item.id && !visitedIds.has(item.id)) {
        visitedIds.add(item.id);
        allItems.push(item);
      }
    }

    // Tenta avançar para a próxima página do DataTables se houver botão ativo
    const hasNext = await page.evaluate(() => {
      const nextBtn = document.querySelector('.paginate_button.next:not(.disabled), #DataTables_Table_0_next:not(.disabled), a[class*="next"]:not([class*="disabled"])');
      if (nextBtn && nextBtn.offsetParent !== null && !nextBtn.classList.contains('disabled')) {
        nextBtn.click();
        return true;
      }
      return false;
    });

    if (!hasNext) break;
    pageIndex++;
    await page.waitForTimeout(1200);
  }

  return allItems;
}

/**
 * Classifica a conformidade da obrigação com base na paridade entre
 * atividades de E-mail (Tipo E) e atividades de WhatsApp/DIGISAC (Tipo 16).
 *
 * REGRA: Se em uma obrigação houver apenas o passo/atividade de e-mail
 * (ex.: comunicação programada de solicitação de documentos), ela não deve
 * ter o passo de WhatsApp e é considerada conforme em canal exclusivo de e-mail.
 */
export function classifyObrigacaoParidade(atividades = [], obrigacao = null) {
  if (!Array.isArray(atividades)) {
    return {
      status: 'sem_disparo',
      hasEmail: false,
      hasWhatsapp: false,
      canalExclusivoEmail: false,
      emailAtividades: [],
      whatsappAtividades: [],
      sugerirOrdemWhatsapp: null,
      totalAtividades: 0
    };
  }

  const emailAtividades = atividades.filter(a => String(a.tipo).toUpperCase() === 'E');
  const whatsappAtividades = atividades.filter(a => String(a.tipo) === '16');

  const emailCount = emailAtividades.length;
  const whatsappCount = whatsappAtividades.length;
  const hasEmail = emailCount > 0;
  const hasWhatsapp = whatsappCount > 0;

  // Regra de exclusividade de e-mail (ex: Solicitação de Documentos Contábeis - E-mail Programado):
  // Aplicável apenas se o nome indicar explicitamente "E-mail Programado"
  // ou se contiver única e exclusivamente 1 atividade de e-mail com texto de envio programado / solicitação de documentos.
  // Obrigações operacionais tradicionais (como Livro Caixa, CSLL, DAS, etc.) NÃO são exclusivas de e-mail.
  const obrigacaoNome = String(obrigacao?.nome || '').trim();
  const isApenasEmail = hasEmail && !hasWhatsapp && (
    Boolean(obrigacaoNome && /\b(e-?mail programado)\b/i.test(obrigacaoNome)) ||
    (atividades.length === 1 && emailCount === 1 && /\b(envio programado|solicita[çc][aã]o de documentos)\b/i.test(emailAtividades[0]?.texto || ''))
  );

  // REGRA: A ordem das atividades deve ser sempre: Passo WhatsApp imediatamente antes do Passo E-mail
  let ordemIncorreta = false;
  if (!isApenasEmail && emailCount > 0 && whatsappCount > 0) {
    for (const emailAtiv of emailAtividades) {
      const emailIdx = atividades.findIndex(a => a === emailAtiv || (a.aconfigId && a.aconfigId === emailAtiv.aconfigId) || (a.ordem && a.ordem === emailAtiv.ordem && a.tipo === 'E'));
      if (emailIdx <= 0) {
        ordemIncorreta = true;
        break;
      }
      const prevAtiv = atividades[emailIdx - 1];
      if (!prevAtiv || String(prevAtiv.tipo) !== '16') {
        ordemIncorreta = true;
        break;
      }
    }
  }

  let status = 'sem_disparo';
  let faltamWhatsapp = 0;
  let faltamEmail = 0;

  if (isApenasEmail) {
    status = 'conforme';
    faltamWhatsapp = 0;
  } else if (!hasEmail && !hasWhatsapp) {
    status = 'sem_disparo';
  } else if (hasEmail && !hasWhatsapp) {
    status = 'pendente_whatsapp';
    faltamWhatsapp = emailCount;
  } else if (!hasEmail && hasWhatsapp) {
    status = 'pendente_email';
    faltamEmail = whatsappCount;
  } else {
    // REGRA ESTRETA 1:1: um passo de WhatsApp para cada passo de E-mail
    if (whatsappCount >= emailCount) {
      status = 'conforme';
      faltamWhatsapp = 0;
    } else {
      // Menos WhatsApp do que E-mail -> pendente_whatsapp até atingir 1:1
      status = 'pendente_whatsapp';
      faltamWhatsapp = emailCount - whatsappCount;
    }
  }

  let sugerirOrdemWhatsapp = null;
  if (!isApenasEmail && faltamWhatsapp > 0) {
    sugerirOrdemWhatsapp = atividades.length + 1;
    if (hasEmail) {
      const maxEmailOrdem = Math.max(...emailAtividades.map(a => Number(a.ordem) || 0));
      sugerirOrdemWhatsapp = maxEmailOrdem + 1;
    }
  }

  return {
    status,
    hasEmail,
    hasWhatsapp,
    emailCount,
    whatsappCount,
    faltamWhatsapp,
    faltamEmail,
    canalExclusivoEmail: isApenasEmail,
    emailAtividades,
    whatsappAtividades,
    sugerirOrdemWhatsapp,
    precisaReordenacao: ordemIncorreta,
    totalAtividades: atividades.length
  };
}

/**
 * Substitui tags dinâmicas como [cliente.apelido], [obrigacao.nome], etc.
 * por valores informados em variaveis.
 */
export function formatTemplateMessage(template = '', variaveis = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(/\[([a-zA-Z0-9_.-]+)\]/g, (match, key) => {
    return variaveis[match] ?? variaveis[key] ?? match;
  });
}

/**
 * Realiza a auditoria agregada de uma lista de obrigações com atividades.
 */
export function auditObrigacoesList(obrigacoesList = []) {
  const result = {
    total: obrigacoesList.length,
    conforme: 0,
    pendenteWhatsapp: 0,
    pendenteEmail: 0,
    semDisparo: 0,
    items: []
  };

  for (const item of obrigacoesList) {
    const paridade = classifyObrigacaoParidade(item.atividades || [], item);
    if (paridade.status === 'conforme') result.conforme++;
    else if (paridade.status === 'pendente_whatsapp') result.pendenteWhatsapp++;
    else if (paridade.status === 'pendente_email') result.pendenteEmail++;
    else result.semDisparo++;

    result.items.push({
      ...item,
      paridade
    });
  }

  return result;
}

/**
 * Extrai a lista de atividades de uma obrigação específica no G-Click.
 * Inspeciona a aba 4. Atividades (passo 2 de configuração).
 */
export async function extractObrigacaoAtividades(page, { url, id, coid, empId = '6581' } = {}) {
  const targetUrl = url || `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);

  // Navega para a aba de atividades se não estiver nela
  await page.evaluate(() => {
    const tabAtividades = document.querySelector('a[href*="#viewobrigpasso2"], #step2 a, #step2, a[onclick*="proximoPassoObrigacoes(\'2\')"]');
    if (tabAtividades) tabAtividades.click();
    else if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    }
  }).catch(() => {});
  await page.waitForTimeout(1200);

  return await page.evaluate(() => {
    const table = document.querySelector('#viewobrigpasso2 table') ||
                  document.querySelector('#DataTables_Table_1') ||
                  document.querySelector('.tab-pane.active table') ||
                  document.querySelector('table');
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return rows.map((tr, index) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length < 3) return null;

      const ordem = Number(tds[0]?.innerText.trim()) || index + 1;
      const tipoCell = tds[1];
      const textoCell = tds[2];
      const texto = textoCell?.innerText.trim().replace(/\s+/g, ' ') || '';
      
      // 1. Extração estrutural direta da coluna "Tipo" (2ª célula - td[1]):
      // No G-Click:
      // - E-mail é renderizado como <i class="fa fa-envelope"> (ícone de envelope)
      //   ou possui o botão de configuração de e-mail (configurarAtividadeEmail2)
      // - WhatsApp / DIGISAC é renderizado como <img> (logo do WhatsApp / Digisac)
      //   ou possui o botão de configuração de mensagem (configurarAtividadeMensagem)
      const tipoIconEnvelope = tipoCell?.querySelector('i.fa-envelope, i.fa-envelope-o, [class*="envelope"], [class*="email"]');
      const tipoIconImg = tipoCell?.querySelector('img, [class*="whatsapp"], [class*="digisac"]');

      // 2. Extração de gatilhos/links nos botões de configuração da linha
      const linkEmail = tr.querySelector('a[onclick*="configurarAtividadeEmail"], button[onclick*="configurarAtividadeEmail"], [onclick*="coaconfigemail"]');
      const linkMsg = tr.querySelector('a[onclick*="configurarAtividadeMensagem"], button[onclick*="configurarAtividadeMensagem"], [onclick*="coaconfigemailmensagem"]');

      let aconfigId = null;
      let tipo = '';

      // Regra Determinística Direta pela coluna Tipo:
      const isWhatsapp = Boolean(
        tipoIconImg ||
        linkMsg
      );

      const isEmail = Boolean(
        !isWhatsapp && (
          tipoIconEnvelope ||
          linkEmail
        )
      );

      if (isWhatsapp) {
        tipo = '16';
        const match = linkMsg?.getAttribute('onclick')?.match(/\((\d+)/);
        if (match) aconfigId = Number(match[1]);
      } else if (isEmail) {
        tipo = 'E';
        const match = linkEmail?.getAttribute('onclick')?.match(/\((\d+)/);
        if (match) aconfigId = Number(match[1]);
      } else {
        const iconClasses = Array.from(tipoCell?.querySelectorAll('i, span')).map(el => el.className).join(' ');
        tipo = iconClasses || tipoCell?.innerText.trim() || 'Operacional';
      }

      // 3. Extração de particularidades de clientes (apenas para registro/metadados)
      const particularidades = [];
      const partCol = tds[4] || tds[3];
      if (partCol) {
        const partText = partCol.innerText.trim();
        if (partText && partText !== '-' && !partText.includes('Sem particularidade') && partText !== '0') {
          particularidades.push(partText);
        }
      }

      return {
        ordem,
        tipo,
        texto,
        aconfigId,
        particularidades
      };
    }).filter(Boolean);
  });
}

/**
 * Sincroniza o catálogo de obrigações da conta, navegando em cada obrigação ativa
 * e IMPORTANDO APENAS as que possuem passo de E-mail (Tipo E) e/ou WhatsApp (Tipo 16).
 */
export async function syncObrigacoesComCanais(page, { accountId, onProgress = null } = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoListar.do?obj=coobrigacaoopen&tipo=0&status=1&empId=${encodeURIComponent(accountId)}`;
  
  if (onProgress) onProgress({ status: 'fetching_list', message: 'Lendo listagem geral de obrigações…' });
  const baseList = await extractObrigacoesList(page, { url: targetUrl });
  
  const total = baseList.length;
  const filtered = [];

  for (let i = 0; i < total; i++) {
    const item = baseList[i];
    if (onProgress) {
      onProgress({
        status: 'inspecting_item',
        current: i + 1,
        total,
        matched: filtered.length,
        nome: item.nome
      });
    }

    try {
      const atividades = await extractObrigacaoAtividades(page, {
        id: item.id,
        coid: item.coid,
        empId: accountId
      });

      const paridade = classifyObrigacaoParidade(atividades, item);
      // REGRA: Importar APENAS as que possuem passo de envio de E-mail e/ou de WhatsApp
      if (paridade.hasEmail || paridade.hasWhatsapp) {
        filtered.push({
          ...item,
          atividades,
          paridade
        });
      }
    } catch (err) {
      console.warn(`Erro ao inspecionar atividades da obrigação #${item.id} (${item.nome}):`, err.message);
    }
  }

  return {
    totalScanned: total,
    totalImported: filtered.length,
    items: filtered
  };
}

/**
 * Automação assistida para incluir ou configurar o passo de WhatsApp (Tipo 16)
 * na obrigação especificada dentro do G-Click.
 */
export async function applyWhatsappActivity(page, {
  id,
  coid,
  empId = '6581',
  templateText = '',
  particularidadeId = '539',
  textoAtividade = 'Atendimento: DIGISAC / WhatsApp'
} = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // 1. Navega para a aba de atividades (Passo 2 / #step2)
  await page.evaluate(() => {
    if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    } else {
      const step2 = document.querySelector('#step2 a, #step2');
      if (step2) step2.click();
    }
  });
  await page.waitForTimeout(1500);

  // REGRA 1:1 INVIOLÁVEL: Verifica atividades já existentes
  const atividadesAtuais = await page.evaluate(() => {
    const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
      const isWhats = Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'));
      const isEmail = Boolean(tr.querySelector('i.fa-envelope, [class*="envelope"], [onclick*="configurarAtividadeEmail"]'));
      return { tipo: isWhats ? '16' : isEmail ? 'E' : 'O' };
    });
  });

  const paridade = classifyObrigacaoParidade(atividadesAtuais);
  if (paridade.canalExclusivoEmail) {
    return {
      success: true,
      skipped: true,
      reason: 'Obrigação de canal exclusivo de e-mail. Não requer passo de WhatsApp.'
    };
  }

  if (paridade.whatsappCount >= paridade.emailCount) {
    return {
      success: true,
      skipped: true,
      reason: `Paridade 1:1 já atendida (${paridade.whatsappCount} WhatsApp para ${paridade.emailCount} E-mail). Não é permitida a criação de passo extra de WhatsApp.`
    };
  }

  // 2. Aciona o modal de inclusão de atividade (#dialogoAtividade)
  await page.evaluate(() => {
    if (typeof window.iniciarNovaAtividade === 'function') {
      window.iniciarNovaAtividade();
    } else {
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Atividades') || b.getAttribute('onclick')?.includes('iniciarNovaAtividade'));
      if (btn) btn.click();
    }
  });
  await page.waitForTimeout(800);

  // 3. Preenche o tipo 16 (WhatsApp) e o texto da atividade
  await page.evaluate(({ texto }) => {
    const sel = document.querySelector('#dialogoAtividade select#atipo, select#atipo');
    if (sel) {
      sel.value = '16';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const inputTexto = document.querySelector('#dialogoAtividade input#natexto, input#natexto');
    if (inputTexto) {
      inputTexto.value = texto;
      inputTexto.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { texto: textoAtividade });

  // 4. Salva a atividade
  await page.evaluate(() => {
    if (typeof window.salvarAtividadeConfig === 'function') {
      window.salvarAtividadeConfig('aconfig');
    }
  });
  await page.waitForTimeout(2000);

  // 5. Configura o template de mensagem se houver templateText
  if (templateText && templateText.trim()) {
    // Localiza a linha recém-criada de WhatsApp
    const aconfigId = await page.evaluate(() => {
      const btn = document.querySelector('a[onclick*="configurarAtividadeMensagem"], button[onclick*="configurarAtividadeMensagem"]');
      if (!btn) return null;
      const match = btn.getAttribute('onclick')?.match(/\((\d+)/);
      return match ? match[1] : null;
    });

    if (aconfigId) {
      await page.evaluate((acId) => {
        if (typeof window.configurarAtividadeMensagem === 'function') {
          window.configurarAtividadeMensagem(acId, '16', 'coaconfigemailmensagem');
        }
      }, aconfigId);
      await page.waitForTimeout(1000);

      await page.evaluate((msg) => {
        const txtArea = document.querySelector('#dialogoamensagem textarea#daetexto, textarea#daetexto');
        if (txtArea) {
          txtArea.value = msg;
          txtArea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const chk = document.querySelector('#dialogoamensagem input#daemensagem, input#daemensagem');
        if (chk && !chk.checked) {
          chk.checked = true;
          chk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, templateText);

      await page.evaluate(() => {
        const btnSalvar = document.querySelector('#btnsalvaramensagem');
        if (btnSalvar) btnSalvar.click();
        else if (typeof window.salvandoAtividadeMensagem === 'function') {
          window.salvandoAtividadeMensagem('coaconfigemailmensagem');
        }
      });
      await page.waitForTimeout(1500);
    }
  }

  return { success: true, id, coid };
}

/**
 * Mapeia visual e estruturalmente o fluxo de adição e configuração da atividade
 * de WhatsApp/DIGISAC no G-Click, salvando screenshots das etapas.
 */
export async function mapWhatsappFlow(page, {
  id = 9,
  coid = 4,
  empId = '6019',
  tipoDesejado = 'Atendimento: DIGISAC',
  textoDesejado = 'Enviar Cliente',
  screenshotDir = '/home/piperun/.gemini/antigravity/brain/9b3e3939-783b-4d42-9934-b50d52a7abb9'
} = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // 1. Navega para a aba de atividades (Passo 2 / #step2)
  await page.evaluate(() => {
    if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    } else {
      const step2 = document.querySelector('a[href*="#viewobrigpasso2"], #step2 a, #step2');
      if (step2) step2.click();
    }
  });
  await page.waitForTimeout(1500);

  // 2. Aciona o modal de inclusão de atividade (+ Atividades)
  await page.evaluate(() => {
    if (typeof window.iniciarNovaAtividade === 'function') {
      window.iniciarNovaAtividade();
    } else {
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Atividades') || b.getAttribute('onclick')?.includes('iniciarNovaAtividade'));
      if (btn) btn.click();
    }
  });
  await page.waitForTimeout(1000);

  // 3. Inspeciona o modal de inclusão de atividade e tira screenshot 1
  const modalInfo = await page.evaluate(() => {
    const modal = document.querySelector('#dialogoAtividade, .modal.in, .modal.show, div[id*="Atividade"]') || document.querySelector('.modal');
    if (!modal) return { encontrado: false };

    const selects = Array.from(modal.querySelectorAll('select')).map(s => ({
      id: s.id,
      name: s.name,
      options: Array.from(s.options).map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }))
    }));

    const inputs = Array.from(modal.querySelectorAll('input, textarea')).map(i => ({
      id: i.id,
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      value: i.value
    }));

    const buttons = Array.from(modal.querySelectorAll('button, a.btn')).map(b => ({
      id: b.id,
      text: b.innerText.trim(),
      onclick: b.getAttribute('onclick') || '',
      className: b.className
    }));

    return {
      encontrado: true,
      id: modal.id,
      title: modal.querySelector('.modal-title, h4, h3')?.innerText.trim() || '',
      selects,
      inputs,
      buttons
    };
  });

  const shot1 = `${screenshotDir}/whatsapp_01_modal_novo.png`;
  await page.screenshot({ path: shot1, fullPage: false }).catch(() => {});

  // 4. Seleciona o tipo no dropdown (DIGISAC)
  const tipoSelecionado = await page.evaluate(({ tipoDesejado }) => {
    const modal = document.querySelector('#dialogoAtividade, .modal.in, .modal.show') || document.body;
    const tipoSelect = modal.querySelector('select#atipo, select[name*="tipo"], select');
    if (!tipoSelect) return null;

    let targetOption = Array.from(tipoSelect.options).find(o => o.text.toLowerCase().includes('digisac') || o.text.toLowerCase().includes('whatsapp'));
    if (!targetOption) {
      targetOption = Array.from(tipoSelect.options).find(o => o.value === '16' || o.text.toLowerCase().includes(tipoDesejado.toLowerCase()));
    }

    if (targetOption) {
      tipoSelect.value = targetOption.value;
      tipoSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: targetOption.value, text: targetOption.text.trim() };
    }
    return null;
  }, { tipoDesejado });
  await page.waitForTimeout(1000);

  // Inspeciona textos disponíveis após selecionar o tipo e tira screenshot 2
  const textosDisponiveis = await page.evaluate(() => {
    const modal = document.querySelector('#dialogoAtividade, .modal.in, .modal.show') || document.body;
    const selects = Array.from(modal.querySelectorAll('select'));
    const textoSelect = selects[1] || modal.querySelector('select#natexto, select[name*="texto"]');
    return textoSelect ? Array.from(textoSelect.options).map(o => ({ value: o.value, text: o.text.trim() })) : [];
  });

  const shot2 = `${screenshotDir}/whatsapp_02_tipo_selecionado.png`;
  await page.screenshot({ path: shot2, fullPage: false }).catch(() => {});

  // 5. Seleciona ou insere "Enviar Cliente" e clica no botão verde "+"
  const adicaoResult = await page.evaluate(async ({ textoDesejado }) => {
    const modal = document.querySelector('#dialogoAtividade, .modal.in, .modal.show') || document.body;
    const selects = Array.from(modal.querySelectorAll('select'));
    const textoSelect = selects[1] || modal.querySelector('select#natexto, select[name*="texto"]');

    let matched = false;
    if (textoSelect) {
      const opt = Array.from(textoSelect.options).find(o => o.text.toLowerCase().includes(textoDesejado.toLowerCase()));
      if (opt) {
        textoSelect.value = opt.value;
        textoSelect.dispatchEvent(new Event('change', { bubbles: true }));
        matched = true;
      }
    }

    if (!matched) {
      const novoInput = modal.querySelector('input[placeholder*="novo texto" i], input#natexto, input[name*="novoTexto"]');
      if (novoInput) {
        novoInput.value = textoDesejado;
        novoInput.dispatchEvent(new Event('input', { bubbles: true }));
        const btnNovo = Array.from(modal.querySelectorAll('button, a')).find(b => b.innerText.trim().toLowerCase() === 'novo');
        if (btnNovo) btnNovo.click();
        await new Promise(r => setTimeout(r, 600));
      }
    }

    // Clica no botão verde "+" para adicionar a atividade
    const plusBtn = modal.querySelector('button[onclick*="salvarAtividadeConfig"], button.btn-primary, button.btn-success, [onclick*="salvar"]')
      || Array.from(modal.querySelectorAll('button')).find(b => b.innerText.trim() === '+' || b.querySelector('i.fa-plus'));
    if (plusBtn) {
      plusBtn.click();
    } else if (typeof window.salvarAtividadeConfig === 'function') {
      window.salvarAtividadeConfig('aconfig');
    }

    await new Promise(r => setTimeout(r, 1500));

    // Fecha o modal caso continue aberto
    const closeBtn = modal.querySelector('button.close, [data-dismiss="modal"], button[onclick*="close"], button[onclick*="fechar"]');
    if (closeBtn) closeBtn.click();

    return { matched, acionado: true };
  }, { textoDesejado });
  await page.waitForTimeout(2000);

  // Tira screenshot 3 da tabela de atividades após adição
  const shot3 = `${screenshotDir}/whatsapp_03_tabela_pos_adicao.png`;
  await page.screenshot({ path: shot3, fullPage: false }).catch(() => {});

  // 6. Inspeciona a tabela e localiza a atividade de WhatsApp
  const tabelaPos = await page.evaluate(() => {
    const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return rows.map((tr, idx) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const texto = tds[2]?.innerText.trim().replace(/\s+/g, ' ') || '';
      const isWhats = Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'));
      const isEmail = Boolean(tr.querySelector('i.fa-envelope, [class*="envelope"], [onclick*="configurarAtividadeEmail"]'));
      const cfgBtn = tr.querySelector('button[onclick*="configurarAtividadeMensagem"], a[onclick*="configurarAtividadeMensagem"], button[onclick*="configurarAtividadeEmail"], a[onclick*="configurarAtividadeEmail"], button i.fa-wrench, button i.fa-cogs')?.closest('button, a');
      const cancelSelect = tds[3]?.querySelector('select');
      const particularidadeText = tds[4]?.innerText.trim().replace(/\s+/g, ' ') || '';

      return {
        ordem: tds[0]?.innerText.trim() || String(idx + 1),
        tipo: isWhats ? '16 (WhatsApp)' : isEmail ? 'E (E-mail)' : 'Outro',
        texto,
        hasConfigBtn: Boolean(cfgBtn),
        configOnclick: cfgBtn?.getAttribute('onclick') || '',
        tipoCancelamentoAtual: cancelSelect ? cancelSelect.value : '',
        particularidadeAtual: particularidadeText
      };
    });
  });

  // 7. Clica na chave inglesa de configuração da atividade de WhatsApp
  const openedConfig = await page.evaluate(() => {
    const whatsRow = Array.from(document.querySelectorAll('tbody tr')).find(tr => {
      return Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'));
    });
    if (!whatsRow) return { success: false, reason: 'Linha de WhatsApp não encontrada na tabela' };

    const btn = whatsRow.querySelector('button[onclick*="configurarAtividadeMensagem"], a[onclick*="configurarAtividadeMensagem"], button i.fa-wrench, a i.fa-wrench')?.closest('button, a');
    if (btn) {
      btn.click();
      return { success: true, onclick: btn.getAttribute('onclick') };
    }
    return { success: false, reason: 'Botão de configuração não encontrado na linha de WhatsApp' };
  });
  await page.waitForTimeout(2000);

  // Tira screenshot 4 do modal de configuração aberto
  const shot4 = `${screenshotDir}/whatsapp_04_modal_configuracao.png`;
  await page.screenshot({ path: shot4, fullPage: false }).catch(() => {});

  // 8. Inspeciona detalhadamente o modal de configuração de envio de WhatsApp
  const configModalDetails = await page.evaluate(() => {
    const modal = document.querySelector('#dialogoamensagem, .modal.in, .modal.show, div[id*="mensagem"]') || document.querySelector('.modal');
    if (!modal) return { encontrado: false };

    // Abas disponíveis dentro do modal
    const tabs = Array.from(modal.querySelectorAll('.nav-tabs li a, [role="tab"]')).map(t => ({
      text: t.innerText.trim(),
      href: t.getAttribute('href') || '',
      active: t.parentElement?.classList.contains('active') || t.classList.contains('active')
    }));

    // Campos de formulário
    const textareas = Array.from(modal.querySelectorAll('textarea')).map(t => ({
      id: t.id,
      name: t.name,
      value: t.value,
      placeholder: t.placeholder
    }));

    const checkboxes = Array.from(modal.querySelectorAll('input[type="checkbox"], input[type="radio"]')).map(c => ({
      id: c.id,
      name: c.name,
      checked: c.checked,
      label: c.closest('label')?.innerText.trim() || c.nextElementSibling?.innerText?.trim() || ''
    }));

    const selects = Array.from(modal.querySelectorAll('select')).map(s => ({
      id: s.id,
      name: s.name,
      options: Array.from(s.options).map(o => ({ value: o.value, text: o.text.trim(), selected: o.selected }))
    }));

    const botoes = Array.from(modal.querySelectorAll('button, a.btn')).map(b => ({
      id: b.id,
      text: b.innerText.trim(),
      onclick: b.getAttribute('onclick') || ''
    }));

    // Variáveis / tags disponíveis no modal
    const tags = Array.from(modal.querySelectorAll('[onclick*="tag"], [onclick*="variavel"], .tag-item, .badge')).map(t => t.innerText.trim()).filter(Boolean);

    return {
      encontrado: true,
      modalId: modal.id,
      title: modal.querySelector('.modal-title, h4, h3')?.innerText.trim() || '',
      tabs,
      textareas,
      checkboxes,
      selects,
      botoes,
      tags
    };
  });

  // 9. Clica na aba "Anexos" do modal de configuração
  await page.evaluate(() => {
    const tabAnexos = document.querySelector('a[href*="#tabnotatividades"], a[href*="atividades"]');
    if (tabAnexos) tabAnexos.click();
  });
  await page.waitForTimeout(800);

  const shot5 = `${screenshotDir}/whatsapp_05_modal_anexos.png`;
  await page.screenshot({ path: shot5, fullPage: false }).catch(() => {});

  const anexosModalDetails = await page.evaluate(() => {
    const pane = document.querySelector('#tabnotatividades, .tab-pane.active');
    if (!pane) return [];
    return Array.from(pane.querySelectorAll('input[type="checkbox"], input[type="radio"]')).map(c => ({
      id: c.id,
      name: c.name,
      checked: c.checked,
      label: c.closest('label')?.innerText.trim() || c.parentElement?.innerText?.trim() || ''
    }));
  });

  // Fecha o modal de configuração de mensagem
  await page.evaluate(() => {
    const closeBtn = document.querySelector('#dialogoamensagem button.close, #dialogoamensagem [data-dismiss="modal"]');
    if (closeBtn) closeBtn.click();
    else {
      const modal = document.querySelector('#dialogoamensagem');
      if (modal) modal.style.display = 'none';
      document.querySelector('.modal-backdrop')?.remove();
    }
  });
  await page.waitForTimeout(1000);

  // 10. Inspeciona o modal de Particularidade/Clientes da linha de WhatsApp
  const particularidadeDetails = await page.evaluate(async () => {
    const whatsRow = Array.from(document.querySelectorAll('tbody tr')).find(tr => {
      return Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'));
    });
    if (!whatsRow) return { encontrado: false };

    const partBtn = whatsRow.querySelector('button[onclick*="configuracaoEditarParticularidade"], a[onclick*="configuracaoEditarParticularidade"]')
      || whatsRow.querySelector('td:nth-child(5) button, td:nth-child(5) a');
    if (!partBtn) return { encontrado: false, reason: 'Botão de particularidade não encontrado na linha de WhatsApp' };

    partBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    const modalPart = document.querySelector('#dialogoaparticularidade');
    if (!modalPart) return { encontrado: false, reason: 'Modal #dialogoaparticularidade não abriu' };

    const select = modalPart.querySelector('select');
    const options = select ? Array.from(select.options).map(o => ({
      value: o.value,
      text: o.text.trim(),
      selected: o.selected
    })) : [];

    return {
      encontrado: true,
      modalId: modalPart.id,
      title: modalPart.querySelector('.modal-title, h4')?.innerText.trim() || '',
      selectId: select?.id || '',
      options
    };
  });

  const shot6 = `${screenshotDir}/whatsapp_06_modal_particularidade.png`;
  await page.screenshot({ path: shot6, fullPage: false }).catch(() => {});

  // Fecha o modal de particularidade
  await page.evaluate(() => {
    const modalPart = document.querySelector('#dialogoaparticularidade');
    if (modalPart) {
      const closeBtn = modalPart.querySelector('button.close, [data-dismiss="modal"], button.btn-white');
      if (closeBtn) closeBtn.click();
      else {
        modalPart.style.display = 'none';
        document.querySelector('.modal-backdrop')?.remove();
      }
    }
  });

  return {
    success: true,
    targetUrl,
    modalInfo,
    tipoSelecionado,
    textosDisponiveis,
    adicaoResult,
    tabelaPos,
    openedConfig,
    configModalDetails,
    anexosModalDetails,
    particularidadeDetails,
    screenshots: {
      step1ModalNovo: shot1,
      step2TipoSelecionado: shot2,
      step3TabelaPosAdicao: shot3,
      step4ModalConfiguracao: shot4,
      step5ModalAnexos: shot5,
      step6ModalParticularidade: shot6
    }
  };
}

/**
 * Inspeciona as configurações atuais do modal de e-mail (#dialogoaemail2) de uma obrigação.
 */
export async function inspectEmailConfig(page, {
  id,
  coid,
  empId = '6581'
} = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // 1. Navega para a aba de atividades (Passo 2 / #step2)
  await page.evaluate(() => {
    if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    } else {
      const step2 = document.querySelector('a[href*="#viewobrigpasso2"], #step2 a, #step2');
      if (step2) step2.click();
    }
  });
  await page.waitForTimeout(1200);

  // 2. Localiza a linha da atividade de e-mail e extrai dados da linha (tipo de cancelamento e particularidade)
  const activityRowData = await page.evaluate(async () => {
    const emailBtn = document.querySelector('button[onclick*="configurarAtividadeEmail2"], a[onclick*="configurarAtividadeEmail2"], [onclick*="coaconfigemail"]');
    if (!emailBtn) return null;
    const tr = emailBtn.closest('tr');
    if (!tr) return null;

    const tds = Array.from(tr.querySelectorAll('td'));
    // Coluna 4 (index 3): Tipo de cancelamento (select)
    const cancelSelect = tds[3]?.querySelector('select') || tr.querySelector('select[name*="cancelamento"], select[id*="cancelamento"]');
    const tipoCancelamentoAtual = cancelSelect ? cancelSelect.value : '1';
    const tiposCancelamentoDisponiveis = Array.from(cancelSelect?.options || [
      { value: '0', text: 'Sem justificativa' },
      { value: '1', text: 'Com justificativa' },
      { value: '2', text: 'Sem cancelamento' }
    ]).map(o => ({
      value: o.value,
      label: o.text ? o.text.trim() : (o.label || o.value),
      selected: o.selected || (o.value === tipoCancelamentoAtual)
    }));

    // Coluna 5 (index 4): Particularidade / Clientes
    const gearBtn = tds[4]?.querySelector('button[onclick*="configuracaoEditarParticularidade"], a[onclick*="configuracaoEditarParticularidade"]')
      || tr.querySelector('button[onclick*="configuracaoEditarParticularidade"]');
    const currentParticularidadeBadge = tds[4]?.innerText.trim().replace(/\s+/g, ' ') || '';

    let particularidadesDisponiveis = [];
    let particularidadeAtual = '';

    if (gearBtn) {
      gearBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      const modalPart = document.querySelector('#dialogoaparticularidade');
      if (modalPart) {
        const partSelect = modalPart.querySelector('select');
        if (partSelect) {
          particularidadeAtual = partSelect.value;
          particularidadesDisponiveis = Array.from(partSelect.options).map(o => ({
            value: o.value,
            label: o.text.trim(),
            selected: o.selected
          }));
        }
        // Fecha o modal de particularidade
        const closeBtn = modalPart.querySelector('button[data-dismiss="modal"], button.btn-white, button.close, [onclick*="close"], [onclick*="fechar"]');
        if (closeBtn) closeBtn.click();
        else {
          modalPart.style.display = 'none';
          document.querySelector('.modal-backdrop')?.remove();
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return {
      tipoCancelamentoAtual,
      tiposCancelamentoDisponiveis,
      particularidadeAtual,
      particularidadesDisponiveis,
      currentParticularidadeBadge
    };
  });

  // 3. Localiza e aciona o botão de configuração de e-mail (chave inglesa)
  const opened = await page.evaluate(async () => {
    const btn = document.querySelector('button[onclick*="configurarAtividadeEmail2"], a[onclick*="configurarAtividadeEmail2"], [onclick*="coaconfigemail"]');
    if (!btn) return false;
    btn.click();
    return true;
  });

  if (!opened) {
    throw new Error(`Não foi encontrado botão de configuração de e-mail para a obrigação #${id}.`);
  }

  // 4. Aguarda o conteúdo ser injetado em #viewaemail2
  await page.waitForFunction(() => {
    const el = document.querySelector('#viewaemail2');
    return el && el.innerHTML.trim().length > 100;
  }, { timeout: 10000 });

  // 5. Extrai os dados do modal
  const modalData = await page.evaluate(async () => {
    // Categorias
    const catSelect = document.querySelector('select#daecategorias');
    const categoriasDisponiveis = Array.from(catSelect?.options || []).map(o => ({
      value: o.value,
      label: o.text.trim(),
      selected: o.selected
    }));
    const categoriasSelecionadas = categoriasDisponiveis.filter(c => c.selected).map(c => c.value);

    // Assunto
    const assunto = document.querySelector('input#daeassunto')?.value || '';

    // Editor Quill / Rich text
    const editor = document.querySelector('.ql-editor');
    const corpoHtml = editor ? editor.innerHTML : '';
    const corpoTexto = editor ? editor.innerText.trim() : '';

    // Formas de Envio
    const automacaoSelect = document.querySelector('select#automacao');
    const automacao = automacaoSelect ? automacaoSelect.value : '';
    const automacoesDisponiveis = Array.from(automacaoSelect?.options || []).map(o => ({
      value: o.value,
      label: o.text.trim(),
      selected: o.selected
    }));

    // Simula troca temporária para automação "1" para listar os anexos disponíveis
    if (typeof window.mudaAutomacao === 'function' && automacao !== '1') {
      if (automacaoSelect) automacaoSelect.value = '1';
      window.mudaAutomacao();
      await new Promise(r => setTimeout(r, 400));
    }

    // Tabela de arquivos / anexos
    const docsTable = document.querySelector('#tabnotautomacoes table, #viewautomacaoarquivos1 table');
    const anexos = Array.from(docsTable?.querySelectorAll('tbody tr') || [])
      .filter(tr => tr.id !== 'traconfigsemail' && tr.id !== 'traconfigslembrete')
      .map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 4) return null;
        const ordem = tds[0]?.innerText.trim() || '';
        const nome = tds[2]?.innerText.trim().replace(/\s+/g, ' ') || '';
        const btnAnexo = tds[3]?.querySelector('button');
        const onclick = btnAnexo?.getAttribute('onclick') || '';
        const title = btnAnexo?.getAttribute('title') || '';
        const isAnexado = title.includes('não anexar') || Boolean(btnAnexo?.querySelector('.fa-check'));

        // Extrai aid do onclick: emailTextoPadrao('461','1','aconfigemail')
        const match = onclick.match(/emailTextoPadrao\('(\d+)'/);
        const aid = match ? match[1] : null;

        return {
          ordem,
          nome,
          aid,
          anexado: isAnexado,
          onclick
        };
      }).filter(Boolean);

    // Restaura automacao se havia sido alterada
    if (automacaoSelect && automacao !== '1') {
      automacaoSelect.value = automacao;
      if (typeof window.mudaAutomacao === 'function') window.mudaAutomacao();
    }

    return {
      categoriasDisponiveis,
      categoriasSelecionadas,
      assunto,
      corpoHtml,
      corpoTexto,
      automacao,
      automacoesDisponiveis,
      anexos
    };
  });

  return {
    ...modalData,
    tipoCancelamento: activityRowData?.tipoCancelamentoAtual ?? '1',
    tiposCancelamentoDisponiveis: activityRowData?.tiposCancelamentoDisponiveis ?? [
      { value: '0', label: 'Sem justificativa' },
      { value: '1', label: 'Com justificativa', selected: true },
      { value: '2', label: 'Sem cancelamento' }
    ],
    particularidadeAtual: activityRowData?.particularidadeAtual ?? '',
    particularidadesDisponiveis: activityRowData?.particularidadesDisponiveis ?? [],
    currentParticularidadeBadge: activityRowData?.currentParticularidadeBadge ?? ''
  };
}

/**
 * Aplica e salva as configurações de e-mail na obrigação especificada no G-Click.
 */
export async function configureEmailActivity(page, {
  id,
  coid,
  empId = '6581',
  categorias = [],
  assunto = '',
  corpoTexto = '',
  automacao = '1',
  anexarTodos = true,
  tipoCancelamento = '1',
  particularidadeCliente = null
} = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // 1. Navega para a aba de atividades (Passo 2 / #step2)
  await page.evaluate(() => {
    if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    } else {
      const step2 = document.querySelector('a[href*="#viewobrigpasso2"], #step2 a, #step2');
      if (step2) step2.click();
    }
  });
  await page.waitForTimeout(1200);

  // 2. Abre o modal de e-mail (chave inglesa)
  await page.evaluate(() => {
    const btn = document.querySelector('button[onclick*="configurarAtividadeEmail2"], a[onclick*="configurarAtividadeEmail2"], [onclick*="coaconfigemail"]');
    if (btn) btn.click();
  });

  // Aguarda carregamento do modal
  await page.waitForFunction(() => {
    const el = document.querySelector('#viewaemail2');
    return el && el.innerHTML.trim().length > 100;
  }, { timeout: 10000 });

  // 5. Preenche categorias, assunto e corpo
  await page.evaluate(({ categorias, assunto, corpoTexto }) => {
    // 5.1 Categorias
    if (Array.isArray(categorias) && categorias.length > 0) {
      const catSelect = document.querySelector('select#daecategorias');
      if (catSelect) {
        const catStrings = categorias.map(String);
        for (const opt of catSelect.options) {
          opt.selected = catStrings.includes(opt.value);
        }
        catSelect.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.jQuery === 'function' && window.jQuery(catSelect).trigger) {
          window.jQuery(catSelect).trigger('chosen:updated');
        }
      }
    }

    // 5.2 Assunto
    if (assunto && assunto.trim()) {
      const inputAssunto = document.querySelector('input#daeassunto');
      if (inputAssunto) {
        inputAssunto.value = assunto.trim();
        inputAssunto.dispatchEvent(new Event('input', { bubbles: true }));
        inputAssunto.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 5.3 Editor de texto Quill
    if (corpoTexto && corpoTexto.trim()) {
      const editor = document.querySelector('.ql-editor');
      if (editor) {
        // Se texto não vier envelopado em tags HTML, envelopa em parágrafos
        const formatted = corpoTexto.includes('<p>') ? corpoTexto : `<p>${corpoTexto.replace(/\n/g, '<br>')}</p>`;
        editor.innerHTML = formatted;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }, { categorias, assunto, corpoTexto });

  await page.waitForTimeout(600);

  // 6. Alterna para a aba Formas de Envio e define automação
  await page.evaluate(async (targetAutomacao) => {
    const tabEnvio = document.querySelector('a[href*="#tabnotautomacoes"]');
    if (tabEnvio) tabEnvio.click();

    const selAutomacao = document.querySelector('select#automacao');
    if (selAutomacao) {
      selAutomacao.value = targetAutomacao;
      selAutomacao.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof window.mudaAutomacao === 'function') window.mudaAutomacao();
    }
  }, automacao);

  await page.waitForTimeout(800);

  // 7. Se automacao === '1' e anexarTodos === true, garante que todos os botões de anexo estão marcados
  let totalAnexados = 0;
  if (automacao === '1' && anexarTodos) {
    totalAnexados = await page.evaluate(async () => {
      let count = 0;
      const rows = Array.from(document.querySelectorAll('#viewautomacaoarquivos1 tbody tr'))
        .filter(tr => tr.id !== 'traconfigsemail' && tr.id !== 'traconfigslembrete');

      for (const tr of rows) {
        const btn = tr.querySelector('td:last-child button, td[align="center"] button');
        if (!btn) continue;
        const title = btn.getAttribute('title') || '';
        const isAnexado = title.includes('não anexar') || Boolean(btn.querySelector('.fa-check'));

        // Se NÃO está anexado (título "Clique aqui pra anexar"), clica para anexar
        if (!isAnexado) {
          btn.click();
          count++;
          await new Promise(r => setTimeout(r, 400));
        }
      }
      return count;
    });
  }

  await page.waitForTimeout(600);

  // 8. Clica em Salvar no modal de e-mail
  await page.evaluate(() => {
    const btnSalvar = document.querySelector('#btnsalvaraemail2');
    if (btnSalvar) {
      btnSalvar.click();
    } else if (typeof window.salvandoAtividadeEmail === 'function') {
      window.salvandoAtividadeEmail('coaconfigemail');
    }
  });

  // Aguarda o modal fechar ou salvar concluir
  await page.waitForTimeout(2000);

  // 9. Configura Tipo de Cancelamento na linha da atividade de e-mail (após salvar o modal)
  if (tipoCancelamento !== undefined && tipoCancelamento !== null) {
    await page.evaluate((targetCancel) => {
      const emailBtn = document.querySelector('button[onclick*="configurarAtividadeEmail2"], a[onclick*="configurarAtividadeEmail2"], [onclick*="coaconfigemail"]');
      if (!emailBtn) return;
      const tr = emailBtn.closest('tr');
      if (!tr) return;
      const tds = Array.from(tr.querySelectorAll('td'));
      const cancelSelect = tds[3]?.querySelector('select') || tr.querySelector('select[onchange*="alterarAtividadeConfigJustif"], select[name*="cancelamento"], select[id*="cancelamento"]');
      if (cancelSelect) {
        cancelSelect.value = String(targetCancel);
        cancelSelect.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof cancelSelect.onchange === 'function') {
          try { cancelSelect.onchange(); } catch (e) { /* ignore */ }
        }
        if (typeof window.alterarAtividadeConfigJustif === 'function') {
          const onchangeAttr = cancelSelect.getAttribute('onchange') || '';
          const match = onchangeAttr.match(/'([^']+)'\s*,\s*'([^']+)'/);
          const aconfigId = match ? match[2] : null;
          if (aconfigId) {
            try { window.alterarAtividadeConfigJustif(cancelSelect, 'aconfigjustif', aconfigId); } catch (e) { /* ignore */ }
          }
        }
      }
    }, tipoCancelamento);
    await page.waitForTimeout(1200);
  }

  // 10. Configura Particularidade de Clientes na linha de e-mail (após salvar o modal)
  let particularidadeSelecionadaLabel = null;
  if (particularidadeCliente !== undefined && particularidadeCliente !== null && particularidadeCliente !== '') {
    particularidadeSelecionadaLabel = await page.evaluate(async (targetPart) => {
      const emailBtn = document.querySelector('button[onclick*="configurarAtividadeEmail2"], a[onclick*="configurarAtividadeEmail2"], [onclick*="coaconfigemail"]');
      if (!emailBtn) return null;
      const tr = emailBtn.closest('tr');
      if (!tr) return null;
      const tds = Array.from(tr.querySelectorAll('td'));
      const gearBtn = tds[4]?.querySelector('button[onclick*="configuracaoEditarParticularidade"], a[onclick*="configuracaoEditarParticularidade"]')
        || tr.querySelector('button[onclick*="configuracaoEditarParticularidade"]');
      if (!gearBtn) return null;

      gearBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      const modalPart = document.querySelector('#dialogoaparticularidade');
      if (!modalPart) return null;

      const partSelect = modalPart.querySelector('select');
      if (!partSelect) return null;

      let chosenOption = null;
      const targetStr = String(targetPart).trim().toLowerCase();
      for (const opt of partSelect.options) {
        if (opt.value === String(targetPart)) {
          chosenOption = opt;
          break;
        }
      }
      if (!chosenOption) {
        for (const opt of partSelect.options) {
          const optText = opt.text.toLowerCase();
          if (optText.includes(targetStr)) {
            chosenOption = opt;
            break;
          }
        }
      }

      if (chosenOption) {
        partSelect.value = chosenOption.value;
        partSelect.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.jQuery === 'function' && window.jQuery(partSelect).trigger) {
          window.jQuery(partSelect).trigger('chosen:updated');
        }
        await new Promise(r => setTimeout(r, 600));

        const saveBtn = modalPart.querySelector('#btnaparticularidadesalvar, button.btn-primary, button[onclick*="salvar"]');
        if (saveBtn) {
          saveBtn.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      const closeBtn = modalPart.querySelector('button[data-dismiss="modal"], button.btn-white, button.close, [onclick*="close"], [onclick*="fechar"]');
      if (closeBtn) closeBtn.click();
      else {
        modalPart.style.display = 'none';
        document.querySelector('.modal-backdrop')?.remove();
      }
      await new Promise(r => setTimeout(r, 600));

      return chosenOption ? chosenOption.text.trim() : null;
    }, particularidadeCliente);
    await page.waitForTimeout(600);
  }

  return {
    success: true,
    id,
    coid,
    automacao,
    tipoCancelamento,
    particularidadeCliente: particularidadeSelecionadaLabel || particularidadeCliente,
    anexosAjustados: totalAnexados
  };
}

/**
 * Executa a configuração assistida do passo de e-mail em massa para uma lista de obrigações.
 */
export async function configureBatchEmailActivities(page, {
  items = [],
  empId = '6581',
  config = {},
  onProgress = null
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Nenhuma obrigação informada para configuração em lote.');
  }

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof onProgress === 'function') {
      onProgress({
        current: i + 1,
        total: items.length,
        item,
        status: 'processando'
      });
    }

    try {
      const res = await configureEmailActivity(page, {
        id: item.id,
        coid: item.coid,
        empId,
        categorias: config.categorias ?? [],
        assunto: config.assunto ?? '',
        corpoTexto: config.corpoTexto ?? '',
        automacao: config.automacao ?? '1',
        anexarTodos: config.anexarTodos !== false,
        tipoCancelamento: config.tipoCancelamento ?? '1',
        particularidadeCliente: config.particularidadeCliente ?? null
      });

      successCount++;
      results.push({
        id: item.id,
        nome: item.nome,
        success: true,
        ...res
      });

      if (typeof onProgress === 'function') {
        onProgress({
          current: i + 1,
          total: items.length,
          item,
          status: 'concluido',
          success: true
        });
      }
    } catch (err) {
      failureCount++;
      results.push({
        id: item.id,
        nome: item.nome,
        success: false,
        error: err.message
      });

      if (typeof onProgress === 'function') {
        onProgress({
          current: i + 1,
          total: items.length,
          item,
          status: 'erro',
          success: false,
          error: err.message
        });
      }
    }
  }

  return {
    total: items.length,
    successCount,
    failureCount,
    results
  };
}

/**
 * Inspeciona as opções disponíveis para o passo de WhatsApp (particularidades, tipos de cancelamento e canais).
 */
export async function inspectWhatsappConfig(page, {
  id,
  coid,
  empId = '6581'
} = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // 1. Navega para a aba de atividades (Passo 2 / #step2)
  await page.evaluate(() => {
    if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    } else {
      const step2 = document.querySelector('a[href*="#viewobrigpasso2"], #step2 a, #step2');
      if (step2) step2.click();
    }
  });
  await page.waitForTimeout(1200);

  // 2. Extrai tipos de cancelamento e particularidades da conta abrindo o modal de particularidade de qualquer linha
  const optionsData = await page.evaluate(async () => {
    const rows = Array.from(document.querySelectorAll('#viewobrigpasso2 table tbody tr, table tbody tr'));
    const tr = rows[0];
    if (!tr) return null;

    const tds = Array.from(tr.querySelectorAll('td'));
    const cancelSelect = tds[3]?.querySelector('select') || tr.querySelector('select[name*="cancelamento"], select[id*="cancelamento"]');
    const tiposCancelamentoDisponiveis = Array.from(cancelSelect?.options || [
      { value: '0', text: 'Sem justificativa' },
      { value: '1', text: 'Com justificativa' },
      { value: '2', text: 'Sem cancelamento' }
    ]).map(o => ({
      value: o.value,
      label: o.text ? o.text.trim() : (o.label || o.value)
    }));

    // Clica no botão de particularidade da linha (seja da 1ª ou de qualquer linha que tenha o botão)
    const gearBtn = document.querySelector('button[onclick*="configuracaoEditarParticularidade"], a[onclick*="configuracaoEditarParticularidade"]');

    let particularidadesDisponiveis = [];
    if (gearBtn) {
      gearBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      const modalPart = document.querySelector('#dialogoaparticularidade');
      if (modalPart) {
        const partSelect = modalPart.querySelector('select');
        if (partSelect) {
          particularidadesDisponiveis = Array.from(partSelect.options).map(o => ({
            value: o.value,
            label: o.text.trim(),
            selected: o.selected
          }));
        }
        const closeBtn = modalPart.querySelector('button[data-dismiss="modal"], button.btn-white, button.close, [onclick*="close"], [onclick*="fechar"]');
        if (closeBtn) closeBtn.click();
        else {
          modalPart.style.display = 'none';
          document.querySelector('.modal-backdrop')?.remove();
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return {
      tiposCancelamentoDisponiveis,
      particularidadesDisponiveis
    };
  });

  // 3. Extrai Categorias de Destinatário abrindo temporariamente o modal de e-mail (que contém o catálogo de categorias da conta)
  const categoriasDisponiveis = await page.evaluate(async () => {
    const emailBtn = document.querySelector('button[onclick*="configurarAtividadeEmail2"], a[onclick*="configurarAtividadeEmail2"], [onclick*="coaconfigemail"]');
    if (!emailBtn) return [];
    emailBtn.click();
    await new Promise(r => setTimeout(r, 1200));

    const catSelect = document.querySelector('select#daecategorias');
    const cats = Array.from(catSelect?.options || []).map(o => ({
      value: o.value,
      label: o.text.trim()
    }));

    // Fecha o modal de e-mail
    const closeBtn = document.querySelector('#dialogoaemail2 button.close, #dialogoaemail2 [data-dismiss="modal"]');
    if (closeBtn) closeBtn.click();
    else {
      const modal = document.querySelector('#dialogoaemail2');
      if (modal) modal.style.display = 'none';
      document.querySelector('.modal-backdrop')?.remove();
    }
    await new Promise(r => setTimeout(r, 500));
    return cats;
  });

  return {
    success: true,
    id,
    coid,
    empId,
    tiposCancelamentoDisponiveis: optionsData?.tiposCancelamentoDisponiveis || [
      { value: '0', label: 'Sem justificativa' },
      { value: '1', label: 'Com justificativa' },
      { value: '2', label: 'Sem cancelamento' }
    ],
    particularidadesDisponiveis: optionsData?.particularidadesDisponiveis || [],
    categoriasDisponiveis: categoriasDisponiveis || [],
    canaisDisponiveis: [
      { value: 'WHATSAPP - Atendimento', label: 'WHATSAPP - Atendimento' }
    ]
  };
}

/**
 * Cria e configura o passo de WhatsApp (via Digisac) para uma obrigação no G-Click.
 * Respeita a regra 1:1 estrita e canal exclusivo de e-mail.
 */
export async function createAndConfigureWhatsappActivity(page, {
  id,
  coid,
  empId = '6581',
  tipoDesejado = 'Atendimento: DIGISAC',
  textoDesejado = 'Enviar Cliente',
  categorias = [],
  canal = 'WHATSAPP - Atendimento',
  mensagemTexto = '',
  automacao = '1',
  anexarTodos = true,
  tipoCancelamento = '1',
  particularidadeCliente = null
} = {}) {
  const targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=coobrigacaoopen&id=${id}&coid=${coid}&empId=${empId}`;
  await gotoWithRetry(page, targetUrl);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // 1. Navega para a aba de atividades (Passo 2 / #step2)
  await page.evaluate(() => {
    if (typeof window.proximoPassoObrigacoes === 'function') {
      window.proximoPassoObrigacoes('2');
    } else {
      const step2 = document.querySelector('a[href*="#viewobrigpasso2"], #step2 a, #step2');
      if (step2) step2.click();
    }
  });
  await page.waitForTimeout(1500);

  // 2. Validação da regra 1:1 estrita e canal exclusivo
  const auditAtual = await page.evaluate(() => {
    const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
    if (!table) return { atividades: [], emailCount: 0, whatsappCount: 0 };
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    let emailCount = 0;
    let whatsappCount = 0;
    const atividades = rows.map((tr, idx) => {
      const tds = Array.from(tr.querySelectorAll('td'));
      const texto = tds[2]?.innerText.trim().replace(/\s+/g, ' ') || '';
      const isWhats = Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'));
      const isEmail = Boolean(!isWhats && (
        tr.querySelector('i.fa-envelope, i.fa-envelope-o, [class*="envelope"], [class*="email"]') ||
        tr.querySelector('button[onclick*="configurarAtividadeEmail"], a[onclick*="configurarAtividadeEmail"]') ||
        texto.toLowerCase().includes('enviar ao cliente') ||
        texto.toLowerCase().includes('e-mail')
      ));
      if (isWhats) whatsappCount++;
      if (isEmail) emailCount++;
      return {
        ordem: idx + 1,
        tipo: isWhats ? '16' : isEmail ? 'E' : 'Operacional',
        texto
      };
    });
    return { atividades, emailCount, whatsappCount };
  });

  const paridade = classifyObrigacaoParidade(auditAtual.atividades);
  if (paridade.canalExclusivoEmail) {
    return {
      success: true,
      skipped: true,
      reason: 'Obrigação de canal exclusivo de e-mail (não requer WhatsApp).'
    };
  }

  if (paridade.emailCount === 0) {
    return {
      success: true,
      skipped: true,
      reason: 'Obrigação sem atividades de envio de e-mail. Não requer atividade de WhatsApp.'
    };
  }

  const passosFaltantes = Math.max(0, paridade.emailCount - paridade.whatsappCount);

  // 3. Cria a quantidade necessária de passos de WhatsApp para atingir a paridade 1:1
  for (let f = 0; f < passosFaltantes; f++) {
    // 3.1 Abre o modal de nova atividade (+ Atividades)
    await page.evaluate(() => {
      if (typeof window.iniciarNovaAtividade === 'function') {
        window.iniciarNovaAtividade();
      } else {
        const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Atividades') || b.getAttribute('onclick')?.includes('iniciarNovaAtividade'));
        if (btn) btn.click();
      }
    });
    await page.waitForTimeout(1000);

    // 3.2 Seleciona o Tipo: Atendimento: DIGISAC (16)
    await page.evaluate(({ tipoDesejado }) => {
      const modal = document.querySelector('#dialogoAtividade, .modal.in, .modal.show') || document.body;
      const tipoSelect = modal.querySelector('select#atipo, select[name*="tipo"], select');
      if (!tipoSelect) return;

      let targetOption = Array.from(tipoSelect.options).find(o => o.text.toLowerCase().includes('digisac') || o.text.toLowerCase().includes('whatsapp'));
      if (!targetOption) {
        targetOption = Array.from(tipoSelect.options).find(o => o.value === '16' || o.text.toLowerCase().includes(tipoDesejado.toLowerCase()));
      }
      if (targetOption) {
        tipoSelect.value = targetOption.value;
        tipoSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, { tipoDesejado });
    await page.waitForTimeout(1000);

    // 3.3 Seleciona ou cadastra o texto "Enviar Cliente" e salva no botão "+"
    await page.evaluate(async ({ textoDesejado }) => {
      const modal = document.querySelector('#dialogoAtividade, .modal.in, .modal.show') || document.body;
      const selects = Array.from(modal.querySelectorAll('select'));
      const textoSelect = selects[1] || modal.querySelector('select#natexto, select[name*="texto"]');

      let matched = false;
      if (textoSelect) {
        const opt = Array.from(textoSelect.options).find(o => o.text.toLowerCase().includes(textoDesejado.toLowerCase()));
        if (opt) {
          textoSelect.value = opt.value;
          textoSelect.dispatchEvent(new Event('change', { bubbles: true }));
          matched = true;
        }
      }

      if (!matched) {
        const novoInput = modal.querySelector('input[placeholder*="novo texto" i], input#natexto, input[name*="novoTexto"]');
        if (novoInput) {
          novoInput.value = textoDesejado;
          novoInput.dispatchEvent(new Event('input', { bubbles: true }));
          const btnNovo = Array.from(modal.querySelectorAll('button, a')).find(b => b.innerText.trim().toLowerCase() === 'novo');
          if (btnNovo) btnNovo.click();
          await new Promise(r => setTimeout(r, 600));
        }
      }

      const plusBtn = modal.querySelector('button[onclick*="salvarAtividadeConfig"], button.btn-primary, button.btn-success, [onclick*="salvar"]')
        || Array.from(modal.querySelectorAll('button')).find(b => b.innerText.trim() === '+' || b.querySelector('i.fa-plus'));
      if (plusBtn) {
        plusBtn.click();
      } else if (typeof window.salvarAtividadeConfig === 'function') {
        window.salvarAtividadeConfig('aconfig');
      }

      await new Promise(r => setTimeout(r, 1500));
      const closeBtn = modal.querySelector('button.close, [data-dismiss="modal"], button[onclick*="close"], button[onclick*="fechar"]');
      if (closeBtn) closeBtn.click();
    }, { textoDesejado });
    await page.waitForTimeout(2000);
  }

  // 4. Configura TODOS os passos de WhatsApp (novos e existentes desconfigurados)
  const whatsCountTotal = await page.evaluate(() => {
    const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
    const trs = Array.from(table?.querySelectorAll('tbody tr') || []);
    return trs.filter(tr => Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'))).length;
  });

  let particularidadeSelecionadaLabel = null;

  for (let wIdx = 0; wIdx < whatsCountTotal; wIdx++) {
    // 4.1 Abre a chave inglesa do passo de WhatsApp wIdx
    const opened = await page.evaluate((targetIdx) => {
      const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
      const trs = Array.from(table?.querySelectorAll('tbody tr') || []);
      const whatsRows = trs.filter(tr => Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]')));
      const tr = whatsRows[targetIdx];
      if (!tr) return false;
      const btn = tr.querySelector('button[onclick*="configurarAtividadeMensagem"], a[onclick*="configurarAtividadeMensagem"], button i.fa-wrench, a i.fa-wrench')?.closest('button, a');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, wIdx);

    if (opened) {
      await page.waitForTimeout(1500);

      // 4.2 Preenche destinatário, canal, corpo da mensagem e gatilho automático
      await page.evaluate(({ catList, canalAlvo, msg, automacaoAtiva }) => {
        const modal = document.querySelector('#dialogoamensagem, .modal.in, .modal.show, div[id*="mensagem"]') || document.body;

        // Categorias de telefone
        if (Array.isArray(catList) && catList.length > 0) {
          const catSelect = modal.querySelector('select#daecategorias, select[name*="categoria"], select[multiple]');
          if (catSelect) {
            const catStrings = catList.map(String);
            for (const opt of catSelect.options) {
              opt.selected = catStrings.includes(opt.value) || catStrings.some(c => opt.text.toLowerCase().includes(c.toLowerCase()));
            }
            catSelect.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof window.jQuery === 'function' && window.jQuery(catSelect).trigger) {
              window.jQuery(catSelect).trigger('chosen:updated');
            }
          }
        }

        // Canal
        const canalSelect = modal.querySelector('select#daecanal, select[name*="canal"], select');
        if (canalSelect && canalSelect.options.length > 0) {
          let optFound = null;
          if (canalAlvo) {
            const alvoLower = String(canalAlvo).trim().toLowerCase();
            optFound = Array.from(canalSelect.options).find(o => o.value === canalAlvo || o.text.toLowerCase().includes(alvoLower));
          }
          if (!optFound) {
            optFound = Array.from(canalSelect.options).find(o => o.text.toLowerCase().includes('whatsapp') || o.text.toLowerCase().includes('atendimento'));
          }
          if (optFound) {
            canalSelect.value = optFound.value;
            canalSelect.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (canalSelect.options.length > 1 && !canalSelect.value) {
            canalSelect.selectedIndex = 1;
            canalSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }

        // Corpo da mensagem
        const txtArea = modal.querySelector('textarea#daetexto, textarea[name*="texto"], textarea');
        if (txtArea && msg && msg.trim()) {
          txtArea.value = msg.trim();
          txtArea.dispatchEvent(new Event('input', { bubbles: true }));
          txtArea.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Checkbox Enviar mensagem automaticamente
        const chkAuto = modal.querySelector('input#daemensagem, input[type="checkbox"][name*="mensagem"], input[type="checkbox"]');
        if (chkAuto) {
          chkAuto.checked = automacaoAtiva;
          chkAuto.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, {
        catList: categorias,
        canalAlvo: canal,
        msg: mensagemTexto,
        automacaoAtiva: automacao === '1'
      });
      await page.waitForTimeout(600);

      // 4.3 Aba Anexos
      if (anexarTodos) {
        await page.evaluate(async () => {
          const tabAnexos = document.querySelector('a[href*="#tabnotatividades"], a[href*="atividades"]');
          if (tabAnexos) tabAnexos.click();
          await new Promise(r => setTimeout(r, 600));

          const pane = document.querySelector('#tabnotatividades, .tab-pane.active') || document.body;
          const anexoBtns = Array.from(pane.querySelectorAll('button[title*="anexar" i], button.btn-danger, button.btn-default, button i.fa-times, button i.fa-close'))
            .map(b => b.closest('button, a')).filter(Boolean);

          for (const btn of anexoBtns) {
            const title = btn.getAttribute('title') || '';
            if (!title.includes('não anexar') && !btn.querySelector('.fa-check')) {
              btn.click();
              await new Promise(r => setTimeout(r, 300));
            }
          }
        });
        await page.waitForTimeout(600);
      }

      // 4.4 Salva o modal de mensagem
      await page.evaluate(() => {
        const btnSalvar = document.querySelector('#btnsalvaramensagem, #dialogoamensagem button.btn-success, #dialogoamensagem button.btn-primary');
        if (btnSalvar) btnSalvar.click();
        else if (typeof window.salvandoAtividadeMensagem === 'function') {
          window.salvandoAtividadeMensagem('coaconfigemailmensagem');
        }
      });
      await page.waitForTimeout(2000);
    }

    // 4.5 Ajusta Tipo de Cancelamento na linha
    if (tipoCancelamento !== undefined && tipoCancelamento !== null) {
      await page.evaluate(({ targetIdx, targetCancel }) => {
        const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
        const trs = Array.from(table?.querySelectorAll('tbody tr') || []);
        const whatsRows = trs.filter(tr => Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]')));
        const tr = whatsRows[targetIdx];
        if (!tr) return;

        const tds = Array.from(tr.querySelectorAll('td'));
        const cancelSelect = tds[3]?.querySelector('select') || tr.querySelector('select[onchange*="alterarAtividadeConfigJustif"], select[name*="cancelamento"], select[id*="cancelamento"]');
        if (cancelSelect) {
          cancelSelect.value = String(targetCancel);
          cancelSelect.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof cancelSelect.onchange === 'function') {
            try { cancelSelect.onchange(); } catch (e) { /* ignore */ }
          }
          if (typeof window.alterarAtividadeConfigJustif === 'function') {
            const onchangeAttr = cancelSelect.getAttribute('onchange') || '';
            const match = onchangeAttr.match(/'([^']+)'\s*,\s*'([^']+)'/);
            const aconfigId = match ? match[2] : null;
            if (aconfigId) {
              try { window.alterarAtividadeConfigJustif(cancelSelect, 'aconfigjustif', aconfigId); } catch (e) { /* ignore */ }
            }
          }
        }
      }, { targetIdx: wIdx, targetCancel: tipoCancelamento });
      await page.waitForTimeout(1200);
    }

    // 4.6 Ajusta Particularidade de Clientes na linha
    if (particularidadeCliente !== undefined && particularidadeCliente !== null && particularidadeCliente !== '') {
      particularidadeSelecionadaLabel = await page.evaluate(async ({ targetIdx, targetPart }) => {
        const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
        const trs = Array.from(table?.querySelectorAll('tbody tr') || []);
        const whatsRows = trs.filter(tr => Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]')));
        const tr = whatsRows[targetIdx];
        if (!tr) return null;

        const tds = Array.from(tr.querySelectorAll('td'));
        const gearBtn = tds[4]?.querySelector('button[onclick*="configuracaoEditarParticularidade"], a[onclick*="configuracaoEditarParticularidade"]')
          || tr.querySelector('button[onclick*="configuracaoEditarParticularidade"]');
        if (!gearBtn) return null;

        gearBtn.click();
        await new Promise(r => setTimeout(r, 1000));
        const modalPart = document.querySelector('#dialogoaparticularidade');
        if (!modalPart) return null;

        const partSelect = modalPart.querySelector('select');
        if (!partSelect) return null;

        let chosenOption = null;
        const targetStr = String(targetPart).trim().toLowerCase();
        for (const opt of partSelect.options) {
          if (opt.value === String(targetPart)) {
            chosenOption = opt;
            break;
          }
        }
        if (!chosenOption) {
          for (const opt of partSelect.options) {
            const optText = opt.text.toLowerCase();
            if (optText.includes(targetStr) || optText.includes('whats') || optText.includes('542')) {
              chosenOption = opt;
              break;
            }
          }
        }

        if (chosenOption) {
          partSelect.value = chosenOption.value;
          partSelect.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof window.jQuery === 'function' && window.jQuery(partSelect).trigger) {
            window.jQuery(partSelect).trigger('chosen:updated');
          }
          await new Promise(r => setTimeout(r, 600));

          const saveBtn = modalPart.querySelector('#btnaparticularidadesalvar, button.btn-primary, button[onclick*="salvar"]');
          if (saveBtn) {
            saveBtn.click();
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        const closeBtn = modalPart.querySelector('button[data-dismiss="modal"], button.btn-white, button.close, [onclick*="close"], [onclick*="fechar"]');
        if (closeBtn) closeBtn.click();
        else {
          modalPart.style.display = 'none';
          document.querySelector('.modal-backdrop')?.remove();
        }
        await new Promise(r => setTimeout(r, 600));

        return chosenOption ? chosenOption.text.trim() : null;
      }, { targetIdx: wIdx, targetPart: particularidadeCliente });
      await page.waitForTimeout(600);
    }
  }

  // 5. REORDENAÇÃO AUTOMÁTICA: Garante que cada WhatsApp fique imediatamente antes do respectivo E-mail
  // Ordem estrita: [WhatsApp 1, E-mail 1, ...intermediárias..., WhatsApp 2, E-mail 2]
  const paresQtd = paridade.emailCount;
  for (let pairIdx = 0; pairIdx < paresQtd; pairIdx++) {
    const tableState = await page.evaluate(() => {
      const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
      const trs = Array.from(table?.querySelectorAll('tbody tr') || []);
      return trs.map((tr, idx) => {
        const select = tr.querySelector('td:first-child select');
        const onchangeAttr = select?.getAttribute('onchange') || '';
        const match = onchangeAttr.match(/'([^']+)'\s*,\s*'([^']+)'/);
        const aconfigId = match ? match[2] : null;
        const isWhats = Boolean(tr.querySelector('img, [class*="whatsapp"], [class*="digisac"], [onclick*="configurarAtividadeMensagem"]'));
        const isEmail = Boolean(!isWhats && (
          tr.querySelector('i.fa-envelope, i.fa-envelope-o, [class*="envelope"], [class*="email"]') ||
          tr.querySelector('button[onclick*="configurarAtividadeEmail"], a[onclick*="configurarAtividadeEmail"]') ||
          tr.querySelector('td:nth-child(3)')?.innerText.toLowerCase().includes('enviar ao cliente')
        ));
        return {
          idx,
          pos: idx + 1,
          aconfigId,
          isWhats,
          isEmail
        };
      });
    });

    const currentEmails = tableState.filter(r => r.isEmail);
    const currentWhatss = tableState.filter(r => r.isWhats);

    const emailAlvo = currentEmails[pairIdx];
    const whatsAlvo = currentWhatss[pairIdx];

    if (emailAlvo && whatsAlvo && whatsAlvo.pos !== emailAlvo.pos - 1) {
      // Se whatsAlvo está depois de emailAlvo, definimos sua ordem como a posição de emailAlvo (o G-Click empurra emailAlvo para a frente)
      const desiredOrder = whatsAlvo.pos > emailAlvo.pos ? emailAlvo.pos : (emailAlvo.pos - 1);

      await page.evaluate(async ({ aconfigId, desiredOrder }) => {
        const table = document.querySelector('#viewobrigpasso2 table') || document.querySelector('table');
        const trs = Array.from(table?.querySelectorAll('tbody tr') || []);
        const tr = trs.find(r => r.querySelector(`select[onchange*="${aconfigId}"]`));
        if (!tr) return;
        const select = tr.querySelector('td:first-child select');
        if (!select) return;
        select.value = String(desiredOrder);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof select.onchange === 'function') {
          try { select.onchange(); } catch (e) { /* ignore */ }
        }
        if (typeof window.alterarAtividadeConfig === 'function') {
          try { window.alterarAtividadeConfig(select, 'aconfig', aconfigId); } catch (e) { /* ignore */ }
        }
      }, { aconfigId: whatsAlvo.aconfigId, desiredOrder });

      await page.waitForTimeout(2000);
    }
  }

  // 6. Relê a tabela real do G-Click para devolver o estado final (ordem e paridade verificadas)
  let atividadesFinais = null;
  let paridadeFinal = null;
  try {
    atividadesFinais = await extractObrigacaoAtividades(page, { id, coid, empId });
    paridadeFinal = classifyObrigacaoParidade(atividadesFinais);
  } catch (e) {
    console.warn(`Não foi possível reler as atividades da obrigação #${id}:`, e.message);
  }

  return {
    success: true,
    id,
    coid,
    tipo: '16',
    texto: textoDesejado,
    tipoCancelamento,
    passosCriados: passosFaltantes,
    passosConfigurados: whatsCountTotal,
    atividadesFinais,
    paridadeFinal,
    reordenado: paridadeFinal ? !paridadeFinal.precisaReordenacao : null,
    particularidadeCliente: particularidadeSelecionadaLabel || particularidadeCliente
  };
}

/**
 * Executa a criação e configuração em massa de passos de WhatsApp para uma lista de obrigações elegíveis.
 */
export async function configureBatchWhatsappActivities(page, {
  items = [],
  empId = '6581',
  config = {},
  onProgress = null
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Nenhuma obrigação informada para configuração de WhatsApp em lote.');
  }

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof onProgress === 'function') {
      onProgress({
        current: i + 1,
        total: items.length,
        item,
        status: 'processando'
      });
    }

    try {
      const res = await createAndConfigureWhatsappActivity(page, {
        id: item.id,
        coid: item.coid,
        empId,
        tipoDesejado: config.tipoDesejado || 'Atendimento: DIGISAC',
        textoDesejado: config.textoDesejado || 'Enviar Cliente',
        categorias: Array.isArray(config.categorias) ? config.categorias : [],
        canal: config.canal || 'WHATSAPP - Atendimento',
        mensagemTexto: config.mensagemTexto || '',
        automacao: config.automacao || '1',
        anexarTodos: config.anexarTodos !== false,
        tipoCancelamento: config.tipoCancelamento || '1',
        particularidadeCliente: config.particularidadeCliente || '542'
      });

      if (res.skipped) {
        results.push({
          id: item.id,
          nome: item.nome,
          success: true,
          skipped: true,
          reason: res.reason
        });
      } else {
        successCount++;
        results.push({
          id: item.id,
          nome: item.nome,
          success: true,
          details: res
        });
      }

      if (typeof onProgress === 'function') {
        onProgress({
          current: i + 1,
          total: items.length,
          item,
          status: 'concluido',
          success: true,
          skipped: res.skipped
        });
      }
    } catch (err) {
      failureCount++;
      results.push({
        id: item.id,
        nome: item.nome,
        success: false,
        error: err.message
      });

      if (typeof onProgress === 'function') {
        onProgress({
          current: i + 1,
          total: items.length,
          item,
          status: 'erro',
          success: false,
          error: err.message
        });
      }
    }
  }

  return {
    total: items.length,
    successCount,
    failureCount,
    results
  };
}
