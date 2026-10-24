import fs from 'node:fs/promises';
import path from 'node:path';
import { gotoWithRetry } from './gclick.mjs';

const DEFAULT_URL = 'https://app.gclick.com.br/configuracaoListar.do?obj=coobrigacaoopen&tipo=0&status=1&empId=6581';

export async function inspectObrigacoesPage(page, { url = DEFAULT_URL, saveArtifacts = true, artifactDir = null } = {}) {
  await gotoWithRetry(page, url);
  await page.waitForLoadState('domcontentloaded');
  // Aguarda carregamento de scripts/tabela
  await page.waitForTimeout(3000);

  const analysis = await page.evaluate(() => {
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

  return await page.evaluate(() => {
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
}
