import fs from 'node:fs/promises';
import path from 'node:path';
import { gotoWithRetry } from './gclick.mjs';
import { parseCsvTable, normalizeCnpj } from './data.mjs';

/**
 * Aplica máscara de CNPJ "00.000.000/0000-00".
 * Se o CNPJ tiver menos de 14 dígitos (por exemplo 13 dígitos porque o Excel/Sheets removeu o zero inicial),
 * preenche com zeros à esquerda via padStart(14, '0').
 */
export function formatCnpjMask(cnpjRaw) {
  let digits = normalizeCnpj(cnpjRaw);
  if (!digits) return { formatted: '', digits: '', valid: false };

  // Se tiver até 14 dígitos, preenche com zeros à esquerda
  if (digits.length > 0 && digits.length <= 14) {
    digits = digits.padStart(14, '0');
  }

  const valid = digits.length === 14;
  const formatted = digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return { formatted, digits, valid };
}

/**
 * Lê e estrutura a planilha de vínculos fornecida.
 * Suporta formatos flexíveis de cabeçalho:
 * - Pessoa responsável / Responsável / Usuário / Apelido
 * - Empresa / Razão Social / Nome Fantasia
 * - CNPJ / CPF/CNPJ / Inscrição
 */
export function parseCarteiraSpreadsheet(csvContent) {
  const table = parseCsvTable(csvContent);
  const headers = table.columns.map(h => h.trim());

  // Localiza colunas por similaridade
  const findCol = (regexList) => {
    for (const r of regexList) {
      const idx = headers.findIndex(h => r.test(h));
      if (idx !== -1) return { index: idx, name: headers[idx] };
    }
    return null;
  };

  const respCol = findCol([
    /^pessoa\s*respons[aá]vel$/i,
    /^respons[aá]vel$/i,
    /^usu[aá]rio$/i,
    /^apelido$/i,
    /^nome\s*do\s*usu[aá]rio$/i
  ]);

  const empCol = findCol([
    /^empresa$/i,
    /^raz[aã]o\s*social$/i,
    /^cliente$/i,
    /^nome\s*fantasia$/i,
    /^nome$/i
  ]);

  const cnpjCol = findCol([
    /^cnpj$/i,
    /^cpf[\/\s]*cnpj$/i,
    /^inscri[cç][aã]o$/i,
    /^documento$/i
  ]);

  if (!respCol) {
    throw new Error('Coluna de responsável não encontrada na planilha. Esperado: "Pessoa responsável", "Responsável" ou "Usuário".');
  }
  if (!cnpjCol) {
    throw new Error('Coluna de CNPJ não encontrada na planilha. Esperado: "CNPJ" ou "CPF/CNPJ".');
  }

  const rows = table.rows.map((row, i) => ({
    linha: i + 2,
    responsavel: row[respCol.index],
    empresa: empCol ? row[empCol.index] : '',
    cnpj: row[cnpjCol.index]
  }));
  return {
    ...buildCarteiraFromRows(rows),
    detectedColumns: {
      responsavel: respCol.name,
      empresa: empCol ? empCol.name : null,
      cnpj: cnpjCol.name
    }
  };
}

/**
 * Agrupa por responsável as linhas já convertidas pelo DE/PARA ({ linha, responsavel, empresa, cnpj }).
 */
export function buildCarteiraFromRows(rows = []) {
  const groups = {};
  let totalRows = 0;
  let validCnpjs = 0;
  let invalidCnpjs = 0;

  rows.forEach((row, i) => {
    const rawResp = String(row.responsavel ?? '').trim();
    const rawCnpj = String(row.cnpj ?? '').trim();
    const rawEmp = String(row.empresa ?? '').trim();

    if (!rawResp && !rawCnpj && !rawEmp) return; // linha vazia
    totalRows++;

    const { formatted, digits, valid } = formatCnpjMask(rawCnpj);
    if (valid) validCnpjs++; else invalidCnpjs++;

    if (!groups[rawResp]) {
      groups[rawResp] = [];
    }

    groups[rawResp].push({
      linha: row.linha ?? i + 2,
      responsavel: rawResp,
      empresa: rawEmp || formatted || 'Empresa sem nome',
      cnpj: digits,
      cnpjFormatado: formatted,
      valido: valid,
      rawCnpj
    });
  });

  const users = Object.keys(groups).map(respKey => ({
    responsavel: respKey,
    totalEmpresas: groups[respKey].length,
    empresas: groups[respKey]
  }));

  return { totalRows, validCnpjs, invalidCnpjs, users, groups };
}

/**
 * Normaliza string para comparação fonética/textual desconsiderando acentos e caracteres especiais.
 */
export function normalizeUserString(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Localiza um usuário pelo apelido (ex.: "ana.exito") ou pelo nome no catálogo de usuários.
 */
export function resolveUser(identifier, usersList = []) {
  if (!identifier || !Array.isArray(usersList) || !usersList.length) return null;
  const rawTrimmed = String(identifier).trim();
  const norm = rawTrimmed.toLowerCase();
  const cleanNorm = normalizeUserString(rawTrimmed);

  // 1. Busca exata por apelido
  let match = usersList.find(u => String(u.apelido || '').trim().toLowerCase() === norm);
  if (match) return match;

  // 2. Busca exata por nome
  match = usersList.find(u => String(u.nome || '').trim().toLowerCase() === norm);
  if (match) return match;

  // 3. Busca por prefixo de e-mail (ex.: ana.exito@...)
  match = usersList.find(u => String(u.email || '').trim().toLowerCase().startsWith(`${norm}@`));
  if (match) return match;

  // 4. Busca normalizada por apelido ou nome (sem acentos)
  match = usersList.find(u => {
    const uApelido = normalizeUserString(u.apelido);
    const uNome = normalizeUserString(u.nome);
    return uApelido === cleanNorm || uNome === cleanNorm;
  });
  if (match) return match;

  // 5. Busca por tokens / prefixos de apelido (ex.: "ana.exito" -> "ana" correspondendo a "Ana Luiza")
  const tokens = cleanNorm.split(' ').filter(t => t.length > 1);
  if (tokens.length) {
    const firstToken = tokens[0];
    // Tenta casar primeiro token com início do primeiro nome ou apelido
    const candidates = usersList.filter(u => {
      const uFirst = normalizeUserString(u.nome).split(' ')[0] || '';
      const uApFirst = normalizeUserString(u.apelido).split(' ')[0] || '';
      return uFirst === firstToken || uApFirst === firstToken;
    });

    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1 && tokens.length > 1) {
      // Se há mais de um candidato com mesmo primeiro nome (ex.: juliany bitencourt vs juliana oliveira)
      const meaningfulTokens = tokens.filter(t => !/^(exito|consultoria|empresa|contabilidade|adm|oper|aux)$/i.test(t));
      const exactCandidate = candidates.find(c => {
        const cNorm = normalizeUserString(c.nome);
        return meaningfulTokens.every(tok => cNorm.includes(tok));
      });
      if (exactCandidate) return exactCandidate;
    }
  }

  // 6. Busca por substring no nome
  match = usersList.find(u => normalizeUserString(u.nome).includes(cleanNorm));
  if (match) return match;

  return null;
}

/**
 * Lê o catálogo de usuários do G-Click em "Cadastro > Usuários".
 * Salva e retorna o mapeamento Apelido <-> Nome.
 */
export async function fetchGclickUsers(context, accountId, { saveCache = true, catalogsDir = null } = {}) {
  const pages = context.pages().filter(p => !p.isClosed());
  const hasAppp = pages.some(p => {
    try {
      const u = new URL(p.url());
      return /(^|\.)gclick\.com\.br$/.test(u.hostname) && !u.pathname.startsWith('/autenticacao');
    } catch { return false; }
  });

  if (!hasAppp) {
    throw new Error('Sessão no G-Click não detectada. Abra a conexão na seção "Conexão & Sessão" e realize o login antes de sincronizar os usuários.');
  }

  const page = await context.newPage();
  try {
    const targetUrl = 'https://appp.gclick.com.br/cadastros/usuarios';
    await gotoWithRetry(page, targetUrl);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    // Se redirecionou para autenticação, lança erro claro
    if (page.url().includes('/autenticacao') || page.url().includes('/login')) {
      throw new Error('Acesso à tela de Usuários redirecionado para login. Verifique se o operador tem acesso ao escritório no G-Click.');
    }

    // Função auxiliar para extrair usuários da tabela do appp
    const extractPageUsers = () => {
      const rows = Array.from(document.querySelectorAll('table tbody tr, .table tbody tr, [role="row"]'));
      const list = [];
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td, [role="cell"]')).map(c => c.innerText.trim());
        if (cells.length >= 4) {
          let apelido = '';
          let nome = '';
          let email = '';
          let cargo = '';
          let supervisor = '';
          let status = 'Ativo';

          if (cells.length >= 8) {
            apelido = cells[2] || '';
            nome = cells[3] || '';
            email = cells[4] || '';
            cargo = cells[5] || '';
            supervisor = cells[6] || '';
            status = cells[7] || 'Ativo';
          } else {
            apelido = cells[1] || cells[0] || '';
            nome = cells[2] || cells[1] || '';
            email = cells[3] || '';
          }

          if (nome || apelido) {
            list.push({
              id: row.getAttribute('data-id') || row.getAttribute('id') || null,
              apelido,
              nome: nome || apelido,
              email,
              cargo,
              supervisor,
              status
            });
          }
        }
      }
      return list;
    };

    // Tenta selecionar o maior tamanho de página (ex.: 100 itens por página)
    try {
      const paginatorSelect = page.locator(`
        .mat-mdc-paginator-page-size mat-select,
        .mat-paginator-page-size mat-select,
        .mat-mdc-select,
        mat-select[aria-label*="itens por página" i],
        mat-select[aria-label*="items per page" i],
        select[aria-label*="itens por página" i],
        select[name*="pageSize" i]
      `).first();
      if (await paginatorSelect.isVisible({ timeout: 1500 }).catch(() => false)) {
        await paginatorSelect.click().catch(() => {});
        await page.waitForTimeout(300);
        const maxOpt = page.locator('.mat-mdc-select-panel mat-option, mat-option, .mat-select-panel mat-option, option').last();
        if (await maxOpt.isVisible({ timeout: 1000 }).catch(() => false)) {
          await maxOpt.click().catch(() => {});
          await page.waitForTimeout(1000);
          await page.waitForLoadState('networkidle').catch(() => {});
        }
      }
    } catch {}

    // Percorre todas as páginas para não truncar usuários
    const userMap = new Map();
    let hasMorePages = true;
    let pageCount = 0;
    while (hasMorePages && pageCount < 20) {
      pageCount++;
      const currentUsers = await page.evaluate(extractPageUsers).catch(() => []);
      for (const u of currentUsers) {
        const key = (u.apelido || u.nome).toLowerCase().trim();
        if (!userMap.has(key)) userMap.set(key, u);
      }

      const nextBtn = page.locator(`
        button.mat-mdc-paginator-navigation-next:not([disabled]):not([aria-disabled="true"]):not(.mat-mdc-button-disabled),
        button.mat-paginator-navigation-next:not([disabled]):not([aria-disabled="true"]):not(.mat-button-disabled),
        button[aria-label*="próxim" i]:not([disabled]):not([aria-disabled="true"]),
        button[aria-label*="next" i]:not([disabled]):not([aria-disabled="true"]),
        .pagination li.next:not(.disabled) a,
        .pagination a[rel="next"]
      `).first();
      if (await nextBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await nextBtn.click().catch(() => {});
        await page.waitForTimeout(1000);
        await page.waitForLoadState('networkidle').catch(() => {});
      } else {
        hasMorePages = false;
      }
    }

    let users = Array.from(userMap.values());

    // Complementa com o dropdown "Por Usuário:" da Carteira legacy para garantir que 100% dos usuários ativos estejam mapeados
    try {
      const legacyUrl = `https://app.gclick.com.br/Listar.do?obj=usuarioempcarteiraopen&usuariosstatus=1&uid=undefined&empId=${encodeURIComponent(accountId)}`;
      await gotoWithRetry(page, legacyUrl);
      await page.waitForLoadState('domcontentloaded').catch(() => {});

      const legacyUsers = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const userSelect = selects.find(s => {
          const text = s.innerText || '';
          const prev = s.previousElementSibling?.innerText || '';
          const parent = s.parentElement?.innerText || '';
          return /por\s*usu[aá]rio/i.test(text + ' ' + prev + ' ' + parent);
        }) || selects[0];

        if (!userSelect) return [];
        return Array.from(userSelect.options)
          .filter(opt => opt.value && opt.value !== '' && !/selecione/i.test(opt.text))
          .map(opt => ({
            id: opt.value,
            text: opt.text.trim()
          }));
      });

      for (const leg of legacyUsers) {
        const existing = users.find(u => {
          const uNorm = (u.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          const legNorm = leg.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          return uNorm && (legNorm.startsWith(uNorm) || legNorm.includes(uNorm) || uNorm.includes(legNorm.split(' ')[0]));
        });

        if (existing) {
          if (!existing.id) existing.id = leg.id;
        } else {
          users.push({
            id: leg.id,
            apelido: leg.text.toLowerCase().replace(/[^a-z0-9]+/g, '.'),
            nome: leg.text,
            email: '',
            cargo: '',
            supervisor: '',
            status: 'Ativo'
          });
        }
      }
    } catch (e) {
      console.warn('[Carteira] Erro ao complementar usuários com dropdown legacy:', e.message);
    }

    if (saveCache && catalogsDir && users.length) {
      await fs.mkdir(catalogsDir, { recursive: true });
      const cachePath = path.join(catalogsDir, `usuarios-${accountId}.json`);
      await fs.writeFile(cachePath, JSON.stringify(users, null, 2), 'utf8');
    }

    return users;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Lê o catálogo de usuários salvo em cache local para a conta.
 */
export async function getCachedUsers(catalogsDir, accountId) {
  if (!catalogsDir || !accountId) return [];
  const cachePath = path.join(catalogsDir, `usuarios-${accountId}.json`);
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('Erro ao ler cache de usuários:', e);
    return [];
  }
}

/**
 * Localiza uma aba existente da Carteira já aberta no contexto do navegador.
 */
export function findExistingCarteiraPage(context, accountId = null) {
  if (!context) return null;
  const pages = context.pages().filter(p => !p.isClosed());
  return pages.find(p => {
    try {
      const u = new URL(p.url());
      const isGclick = /(^|\.)gclick\.com\.br$/.test(u.hostname);
      const isCarteira = u.searchParams.get('obj') === 'usuarioempcarteiraopen' || p.url().includes('usuarioempcarteiraopen') || /carteira/i.test(p.url());
      // Aba de outra conta não pode ser reaproveitada: o robô operaria no escritório errado.
      return isGclick && isCarteira && (!accountId || u.searchParams.get('empId') === String(accountId));
    } catch { return false; }
  }) || null;
}

/**
 * Localiza ou abre a página da Carteira de forma inteligente e segura:
 * 1. Reutiliza a aba Carteira se já estiver aberta no navegador do operador.
 * 2. Se houver uma aba aberta em Cadastros > Usuários, aciona a guia "Carteira" nativa.
 * 3. Se não houver, abre nova página e navega diretamente.
 */
export async function ensureCarteiraPage(context, accountId) {
  if (!context) throw new Error('Contexto do navegador não disponível.');

  const existingCarteira = findExistingCarteiraPage(context, accountId);
  if (existingCarteira) {
    await existingCarteira.bringToFront().catch(() => {});
    return { page: existingCarteira, isNew: false };
  }

  const pages = context.pages().filter(p => !p.isClosed());
  const usuariosPage = pages.find(p => p.url().includes('cadastros/usuarios') || p.url().includes('/cadastros'));
  if (usuariosPage) {
    try {
      await usuariosPage.bringToFront().catch(() => {});
      const carteiraTab = usuariosPage.locator('text=Carteira, a:has-text("Carteira"), button:has-text("Carteira")').first();
      if (await carteiraTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        const [popup] = await Promise.all([
          context.waitForEvent('page', { timeout: 6000 }).catch(() => null),
          carteiraTab.click().catch(() => {})
        ]);
        if (popup) {
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          return { page: popup, isNew: false };
        }
      }
    } catch {}
  }

  const newPage = await context.newPage();
  return { page: newPage, isNew: true };
}

// Colunas da tela Carteira (legacy). "Minha Carteira" é o que já está com o usuário; as outras duas são as
// origens possíveis do vínculo, cada uma com o seu botão "<- Vincular" logo abaixo.
export const CARTEIRA_ORIGENS = {
  mesmo_cargo: { key: 'mesmoCargo', label: 'Clientes Disponíveis com o mesmo Cargo' },
  restantes: { key: 'restantes', label: 'Clientes Restantes Disponíveis' }
};

export function assertCarteiraOrigem(origem) {
  if (!CARTEIRA_ORIGENS[origem]) throw new Error('Escolha de onde vincular: "Clientes Disponíveis com o mesmo Cargo" ou "Clientes Restantes Disponíveis".');
  return CARTEIRA_ORIGENS[origem];
}

// Roda dentro da página da Carteira. Precisa ser autocontida: o Playwright a serializa para o navegador.
// action "read" lê as três colunas; "mark" marca os CNPJs pedidos numa coluna; "click" aciona o botão dessa coluna
// ("Retirar" abaixo de Minha Carteira, "<- Vincular" abaixo das outras duas).
function carteiraColumnsInPage({ action = 'read', column = null, cnpjs = [] } = {}) {
  const clean = s => String(s || '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
  const TITLES = {
    minha: /minha\s*carteira/i,
    mesmoCargo: /clientes\s*dispon[ií]veis.*mesmo\s*cargo/i,
    restantes: /clientes\s*restantes\s*dispon[ií]veis/i
  };
  const DOC = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/;

  const candidates = Array.from(document.querySelectorAll('th, td, strong, b, h1, h2, h3, h4, h5, h6, label, span, div'))
    .filter(el => (el.textContent || '').length < 80);
  // O mesmo texto aparece no aviso do topo ("Minha Carteira = clientes..."); vale o título que está num cabeçalho de tabela.
  const headerOf = re => {
    const matches = candidates.filter(el => re.test(clean(el.textContent)))
      .filter(el => !Array.from(el.children).some(child => re.test(clean(child.textContent))));
    return matches.find(el => el.closest('th, thead')) || matches.find(el => el.closest('td, table')) || matches[0] || null;
  };
  const headers = Object.fromEntries(Object.entries(TITLES).map(([key, re]) => [key, headerOf(re)]));

  // Sobe do título até o maior bloco que ainda não inclui o título de outra coluna.
  const columnBox = key => {
    const header = headers[key];
    if (!header) return null;
    const others = Object.entries(headers).filter(([k, h]) => k !== key && h).map(([, h]) => h);
    let box = header;
    while (box.parentElement && box.parentElement !== document.body && !others.some(h => box.parentElement.contains(h))) box = box.parentElement;
    return box;
  };
  const leafRows = scope => Array.from(scope.querySelectorAll('tr'))
    .filter(tr => tr.querySelector('td') && !tr.querySelector('tr'))
    .filter(tr => tr.querySelector('input[type="checkbox"]') || DOC.test(tr.textContent));
  const xRange = key => {
    const box = columnBox(key);
    const rect = (box && box !== headers[key] ? box : headers[key]?.closest('table') || headers[key])?.getBoundingClientRect();
    return rect ? [rect.left, rect.right] : null;
  };
  const insideX = (el, range) => {
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    return rect.width > 0 && range && center >= range[0] && center <= range[1];
  };
  const rowsOf = key => {
    const box = columnBox(key);
    if (!box) return [];
    const inBox = leafRows(box);
    if (inBox.length) return inBox;
    // Cabeçalho e lista em tabelas irmãs: usa a faixa horizontal da coluna.
    const range = xRange(key);
    return leafRows(document).filter(tr => {
      const cb = tr.querySelector('input[type="checkbox"]');
      return insideX(cb || tr, range);
    });
  };
  const itemOf = tr => {
    const text = clean(tr.innerText || tr.textContent);
    const doc = (text.match(DOC) || [''])[0];
    let digits = doc.replace(/\D/g, '');
    if (digits) digits = digits.padStart(14, '0');
    const cb = tr.querySelector('input[type="checkbox"]');
    const link = tr.querySelector('a');
    return {
      cnpj: digits,
      empresa: clean(link?.innerText || link?.textContent) || clean(text.replace(DOC, '').replace(/^\d+\s+/, '')),
      hasCheckbox: Boolean(cb),
      checkboxId: cb ? (cb.id || cb.name || cb.value || null) : null,
      isChecked: Boolean(cb?.checked)
    };
  };
  const actionButtonOf = key => {
    const range = xRange(key);
    const label = key === 'minha' ? /retirar/i : /vincular/i;
    const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
      .filter(el => label.test(el.innerText || el.value || ''));
    const matched = allButtons.find(el => insideX(el, range));
    if (matched) return matched;
    if (key === 'minha') return allButtons[0] || null;
    if (key === 'mesmoCargo') return allButtons[0] || null;
    if (key === 'restantes') return allButtons[allButtons.length - 1] || null;
    return null;
  };

  if (action === 'read') {
    const read = key => rowsOf(key).map(itemOf);
    return {
      found: Object.fromEntries(Object.keys(TITLES).map(key => [key, Boolean(headers[key])])),
      minhaCarteira: read('minha'),
      mesmoCargo: read('mesmoCargo'),
      restantes: read('restantes'),
      hasVincularBtn: Boolean(actionButtonOf('mesmoCargo') || actionButtonOf('restantes'))
    };
  }

  if (!headers[column]) return { columnFound: false };
  if (action === 'mark') {
    const wanted = new Set(cnpjs);
    const markedList = [];
    for (const tr of rowsOf(column)) {
      const item = itemOf(tr);
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!item.cnpj || !wanted.has(item.cnpj) || !cb || cb.checked) continue;
      cb.click();
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      markedList.push(item.cnpj);
    }
    return { columnFound: true, markedList, hasBtn: Boolean(actionButtonOf(column)) };
  }
  if (action === 'click') {
    const button = actionButtonOf(column);
    if (button) button.click();
    return { columnFound: true, clicked: Boolean(button) };
  }
  return { columnFound: true };
}

const CARTEIRA_URL = accountId => `https://app.gclick.com.br/Listar.do?obj=usuarioempcarteiraopen&usuariosstatus=1&uid=undefined&empId=${encodeURIComponent(accountId)}`;

async function openCarteiraScreen(page, accountId) {
  if (!page.url().includes('usuarioempcarteiraopen')) await gotoWithRetry(page, CARTEIRA_URL(accountId));
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (page.url().includes('/autenticacao') || page.url().includes('/login')) {
    throw new Error('Sessão no G-Click não autenticada. Abra a conexão na seção "Conexão & Sessão" e realize o login antes de usar a Carteira.');
  }
  await page.waitForSelector('select, #idUsuario, select[name*="usuario" i], [role="combobox"], .select2-container', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

// Escolhe o usuário no "Por Usuário:" pelo valor da opção (sincronização) ou pelo nome (planilha).
// Sem target, só devolve as opções disponíveis.
function chooseCarteiraUserInPage({ targetName = '', targetValue = null } = {}) {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const selects = Array.from(document.querySelectorAll('select'));
  if (!selects.length) return null;

  let targetSelect = selects.find(s => /^(uid|idusuario|usuario|id_usuario)$/i.test(s.name || s.id || '') || /usuario/i.test(s.id || s.name || ''));
  if (!targetSelect) {
    for (const s of selects) {
      if (s.id) {
        const lbl = document.querySelector(`label[for="${s.id}"]`);
        if (lbl && /por\s*usu[aá]rio/i.test(clean(lbl.innerText))) { targetSelect = s; break; }
      }
      const parent = s.parentElement;
      if (parent && /por\s*usu[aá]rio/i.test(clean(parent.innerText))) { targetSelect = s; break; }
      const prev = s.previousElementSibling;
      if (prev && /por\s*usu[aá]rio/i.test(clean(prev.innerText))) { targetSelect = s; break; }
      const td = s.closest('td');
      if (td?.previousElementSibling && /por\s*usu[aá]rio/i.test(clean(td.previousElementSibling.innerText))) { targetSelect = s; break; }
    }
  }
  if (!targetSelect) targetSelect = selects.find(s => Array.from(s.options).some(o => /selecione/i.test(o.text)));
  if (!targetSelect) targetSelect = selects[0];

  const options = Array.from(targetSelect.options);
  const availableOptions = options
    .filter(o => o.value && !/selecione/i.test(o.text))
    .map(o => ({ value: o.value, text: clean(o.text) }));
  if (targetValue === null && !targetName) return { foundSelect: true, selected: false, availableOptions };

  const cleanNorm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  let match = null;
  if (targetValue !== null) {
    match = options.find(opt => opt.value === String(targetValue));
  } else {
    const normTarget = cleanNorm(targetName);
    const targetTokens = normTarget.split(' ').filter(t => t.length > 1);
    // 1. Correspondência exata ou por inclusão
    match = options.find(opt => {
      const optNorm = cleanNorm(opt.text);
      return optNorm === normTarget || optNorm.includes(normTarget) || (normTarget.length > 3 && normTarget.includes(optNorm));
    });
    // 2. Correspondência por tokens (ex.: "raquel.exito" -> primeiro token "raquel" casando com "Raquel Boccuzzi - Fis,Cont - Oper")
    if (!match && targetTokens.length) {
      const firstToken = targetTokens[0];
      const candidates = options.filter(opt => {
        const optTokens = cleanNorm(opt.text).split(' ').filter(Boolean);
        return optTokens[0] === firstToken;
      });

      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        // Se há mais de um candidato com mesmo primeiro nome (ex.: juliana vs juliany),
        // filtra tokens significativos desconsiderando sufixos genéricos de empresa
        const meaningfulTokens = targetTokens.filter(t => !/^(exito|consultoria|empresa|contabilidade|adm|oper|aux)$/i.test(t));
        match = candidates.find(opt => {
          const optNorm = cleanNorm(opt.text);
          return meaningfulTokens.every(tok => optNorm.includes(tok));
        }) || candidates[0];
      }
    }
  }

  if (!match) return { foundSelect: true, selected: false, availableOptions };
  if (targetSelect.value === match.value) {
    return { foundSelect: true, selected: true, alreadySelected: true, selectedValue: match.value, selectedText: clean(match.text) };
  }

  targetSelect.value = match.value;
  targetSelect.dispatchEvent(new Event('input', { bubbles: true }));
  targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
  if (typeof targetSelect.onchange === 'function') {
    try { targetSelect.onchange(); } catch {}
  }
  // Notifica Select2 / jQuery se disponível
  if (typeof window.$ === 'function') {
    try { window.$(targetSelect).trigger('change'); } catch {}
  }
  return { foundSelect: true, selected: true, selectedValue: match.value, selectedText: clean(match.text) };
}

async function inFrames(page, fn, arg, accept) {
  const frames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
  for (const frame of frames) {
    const result = await frame.evaluate(fn, arg).catch(() => null);
    if (result && accept(result)) return { frame, result };
  }
  return { frame: null, result: null };
}

async function waitCarteiraRefresh(page) {
  await Promise.race([
    page.waitForNavigation({ timeout: 4000 }).catch(() => {}),
    page.waitForTimeout(2500)
  ]);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);
}

async function readCarteiraColumns(page) {
  const { result } = await inFrames(page, carteiraColumnsInPage, { action: 'read' },
    data => data.minhaCarteira.length || data.mesmoCargo.length || data.restantes.length || data.hasVincularBtn);
  return result || { minhaCarteira: [], mesmoCargo: [], restantes: [], hasVincularBtn: false };
}

/**
 * Acessa a aba Carteira do G-Click, seleciona o usuário no dropdown "Por Usuário:"
 * e lê as três colunas: "Minha Carteira", "Clientes Disponíveis com o mesmo Cargo" e "Clientes Restantes Disponíveis".
 */
export async function inspectUserCarteira(page, accountId, userIdentifier, usersList = [], { optionValue = null } = {}) {
  const resolved = optionValue === null ? resolveUser(userIdentifier, usersList) : null;
  const userNameToSelect = resolved?.nome || userIdentifier;

  await openCarteiraScreen(page, accountId);

  const { result: selectInfo } = await inFrames(page, chooseCarteiraUserInPage,
    { targetName: userNameToSelect, targetValue: optionValue }, info => info.foundSelect);

  if (!selectInfo) {
    const pageUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    console.error(`[Carteira Debug] URL: ${pageUrl}, Título: ${pageTitle}, Frames: ${page.frames().length}`);
    throw new Error(`Campo "Por Usuário:" não encontrado na tela da Carteira (Página: ${pageTitle || pageUrl}). Certifique-se de que a sessão no G-Click está ativa e que a aba Carteira carregou corretamente.`);
  }

  if (!selectInfo.selected) {
    const opts = selectInfo.availableOptions?.map(o => o.text).slice(0, 10).join(', ');
    console.warn(`[Carteira] Usuário "${userNameToSelect}" não encontrado nas opções do G-Click. Opções disponíveis: ${opts || 'Nenhuma'}.`);
    return {
      accountId,
      user: {
        identificadorOriginal: userIdentifier,
        resolvido: resolved,
        nomeSelecionado: null,
        valorSelecionado: null,
        encontradoNoGclick: false
      },
      encontradoNoGclick: false,
      minhaCarteira: [],
      mesmoCargo: [],
      restantes: [],
      hasVincularBtn: false,
      availableOptions: selectInfo.availableOptions
    };
  }

  if (!selectInfo.alreadySelected) await waitCarteiraRefresh(page);
  const columns = await readCarteiraColumns(page);
  // Sem os três títulos, os blocos de uma coluna podem engolir os das outras: melhor parar do que classificar errado.
  const missing = Object.entries({ minha: 'Minha Carteira', mesmoCargo: CARTEIRA_ORIGENS.mesmo_cargo.label, restantes: CARTEIRA_ORIGENS.restantes.label })
    .filter(([key]) => columns.found && !columns.found[key]).map(([, label]) => label);
  if (missing.length) throw new Error(`Coluna(s) não encontrada(s) na tela da Carteira do G-Click: ${missing.join(', ')}. A tela pode ter mudado; nada foi conferido nem vinculado.`);

  return {
    accountId,
    user: {
      identificadorOriginal: userIdentifier,
      resolvido: resolved,
      nomeSelecionado: selectInfo.selectedText,
      valorSelecionado: selectInfo.selectedValue
    },
    minhaCarteira: columns.minhaCarteira,
    mesmoCargo: columns.mesmoCargo,
    restantes: columns.restantes,
    hasVincularBtn: columns.hasVincularBtn
  };
}

/**
 * Percorre todos os usuários do "Por Usuário:" e guarda o que está em "Minha Carteira" de cada um.
 * Somente leitura: não marca nem vincula nada.
 */
export async function syncMinhaCarteira(page, accountId, { catalogsDir = null } = {}) {
  await openCarteiraScreen(page, accountId);
  const { result } = await inFrames(page, chooseCarteiraUserInPage, {}, info => info.foundSelect);
  if (!result) throw new Error('Campo "Por Usuário:" não encontrado na tela da Carteira. Confira se a aba Carteira do G-Click carregou.');

  const usuarios = [];
  for (const option of result.availableOptions) {
    try {
      const inspection = await inspectUserCarteira(page, accountId, option.text, [], { optionValue: option.value });
      const empresas = (inspection.minhaCarteira || []).map(item => ({
        cnpj: item.cnpj,
        cnpjFormatado: item.cnpj ? formatCnpjMask(item.cnpj).formatted : '',
        empresa: item.empresa
      }));
      usuarios.push({ valor: option.value, nome: option.text, total: empresas.length, empresas });
    } catch (error) {
      usuarios.push({ valor: option.value, nome: option.text, total: 0, empresas: [], erro: error.message });
    }
  }

  const snapshot = {
    accountId: String(accountId),
    syncedAt: new Date().toISOString(),
    totalUsuarios: usuarios.length,
    totalEmpresas: usuarios.reduce((sum, u) => sum + u.total, 0),
    usuarios
  };
  if (catalogsDir) {
    await fs.mkdir(catalogsDir, { recursive: true });
    await fs.writeFile(path.join(catalogsDir, `carteira-minha-${accountId}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
  }
  return snapshot;
}

export async function getCachedMinhaCarteira(catalogsDir, accountId) {
  if (!catalogsDir || !/^\d+$/.test(String(accountId))) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(catalogsDir, `carteira-minha-${accountId}.json`), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('Erro ao ler a Minha Carteira sincronizada:', e);
    return null;
  }
}

// Depois de uma retirada, a cópia sincronizada daquele usuário passa a refletir o que o G-Click mostrou na conferência.
export async function updateCachedMinhaCarteiraUser(catalogsDir, accountId, valor, minhaCarteira = []) {
  const snapshot = await getCachedMinhaCarteira(catalogsDir, accountId);
  const usuario = snapshot?.usuarios?.find(u => String(u.valor) === String(valor));
  if (!usuario) return null;
  usuario.empresas = minhaCarteira.map(item => ({ cnpj: item.cnpj, cnpjFormatado: item.cnpj ? formatCnpjMask(item.cnpj).formatted : '', empresa: item.empresa }));
  usuario.total = usuario.empresas.length;
  delete usuario.erro;
  snapshot.totalEmpresas = snapshot.usuarios.reduce((sum, u) => sum + u.total, 0);
  await fs.writeFile(path.join(catalogsDir, `carteira-minha-${accountId}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
  return usuario;
}

/**
 * Compara a relação de empresas/CNPJs da planilha contra o resultado da inspeção no G-Click.
 * Classifica cada cliente em:
 * - ja_vinculado: está em Minha Carteira
 * - disponivel_para_vincular: está em "Clientes Disponíveis com o mesmo Cargo" e/ou em "Clientes Restantes Disponíveis"
 *   (origens lista onde: mesmo_cargo, restantes)
 * - nao_localizado: não está em nenhuma das colunas
 */
export function auditUserCarteira(spreadsheetEmpresas = [], carteiraInspection = {}) {
  // Se o usuário não foi localizado no G-Click desta conta
  if (carteiraInspection.encontradoNoGclick === false) {
    const results = spreadsheetEmpresas.map(entry => {
      const digits = entry.cnpj;
      const formatted = entry.cnpjFormatado || formatCnpjMask(digits).formatted;
      return {
        linha: entry.linha,
        responsavel: entry.responsavel,
        empresa: entry.empresa,
        cnpj: digits,
        cnpjFormatado: formatted,
        status: 'usuario_nao_localizado',
        situacao: 'Usuário não cadastrado no G-Click',
        colunaGclick: null,
        origens: [],
        detalhe: `Usuário "${entry.responsavel}" não encontrado entre os colaboradores da conta G-Click ativa.`
      };
    });

    return {
      user: carteiraInspection.user,
      encontradoNoGclick: false,
      total: spreadsheetEmpresas.length,
      jaVinculados: 0,
      disponiveis: 0,
      disponiveisMesmoCargo: 0,
      disponiveisRestantes: 0,
      naoLocalizados: spreadsheetEmpresas.length,
      items: results
    };
  }

  const toSet = list => new Set((list || []).map(item => item.cnpj).filter(Boolean));
  const minha = toSet(carteiraInspection.minhaCarteira);
  const byOrigem = {
    mesmo_cargo: toSet(carteiraInspection.mesmoCargo),
    restantes: toSet(carteiraInspection.restantes)
  };

  const results = [];
  let jaVinculados = 0;
  let disponiveis = 0;
  let naoLocalizados = 0;
  const porOrigem = { mesmo_cargo: 0, restantes: 0 };

  for (const entry of spreadsheetEmpresas) {
    const digits = entry.cnpj;
    const base = {
      linha: entry.linha,
      responsavel: entry.responsavel,
      usuarioNome: carteiraInspection.user?.nomeSelecionado || carteiraInspection.user?.resolvido?.nome || carteiraInspection.user?.nome || null,
      empresa: entry.empresa,
      cnpj: digits,
      cnpjFormatado: entry.cnpjFormatado || formatCnpjMask(digits).formatted
    };
    const origens = digits ? Object.keys(byOrigem).filter(origem => byOrigem[origem].has(digits)) : [];

    if (digits && minha.has(digits)) {
      jaVinculados++;
      results.push({ ...base, status: 'ja_vinculado', situacao: 'Já vinculado ao usuário', colunaGclick: 'Minha Carteira', origens: [], detalhe: 'Empresa já presente na carteira do usuário' });
    } else if (origens.length) {
      disponiveis++;
      origens.forEach(origem => porOrigem[origem]++);
      results.push({
        ...base,
        status: 'disponivel_para_vincular',
        situacao: 'Disponível para vincular',
        colunaGclick: origens.map(origem => CARTEIRA_ORIGENS[origem].label).join(' / '),
        origens,
        detalhe: origens.length > 1 ? 'Disponível nas duas colunas: escolha a origem na hora de vincular' : 'Empresa disponível para ser vinculada ao usuário'
      });
    } else {
      naoLocalizados++;
      results.push({ ...base, status: 'nao_localizado', situacao: 'Não localizado na G-Click', colunaGclick: null, origens: [], detalhe: 'CNPJ não encontrado em Minha Carteira, em Clientes Disponíveis com o mesmo Cargo nem em Clientes Restantes Disponíveis' });
    }
  }

  return {
    user: carteiraInspection.user,
    encontradoNoGclick: true,
    total: spreadsheetEmpresas.length,
    jaVinculados,
    disponiveis,
    disponiveisMesmoCargo: porOrigem.mesmo_cargo,
    disponiveisRestantes: porOrigem.restantes,
    naoLocalizados,
    items: results
  };
}

// Trata modal HTML do G-Click ("Vinculando Usuário", "Confirmar", etc.):
// Clica no botão Confirmar e aguarda o fechamento do modal e o carregamento dos dados.
async function handleActionConfirmation(page, frame) {
  const avisos = [];
  const targetFrames = [frame, page.mainFrame(), ...page.frames().filter(f => f !== frame && f !== page.mainFrame())];

  const startTime = Date.now();
  let clicked = false;

  // Aguarda até 3.5 segundos pela abertura de modal HTML de confirmação
  while (Date.now() - startTime < 3500) {
    for (const f of targetFrames) {
      try {
        const res = await f.evaluate(() => {
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && (el.offsetWidth > 0 || el.offsetHeight > 0);
          };

          // 1. Procura modais visíveis
          const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"], .inmodal, div[id*="dialog"], div[class*="dialog"]'))
            .filter(isVisible);

          for (const modal of modals) {
            const buttons = Array.from(modal.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a[role="button"]'))
              .filter(isVisible);
            const confirmBtn = buttons.find(b => {
              const text = (b.innerText || b.value || b.textContent || '').trim();
              return /confirmar/i.test(text);
            });
            if (confirmBtn) {
              const modalText = (modal.innerText || modal.textContent || '').trim().replace(/\s+/g, ' ');
              confirmBtn.click();
              if (typeof window.$ === 'function') {
                try { window.$(confirmBtn).trigger('click'); } catch {}
              }
              return { clicked: true, text: modalText };
            }
          }

          // 2. Procura botão "Confirmar" visível no documento caso o container do modal não use as classes padrão
          const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a[role="button"]'))
            .filter(isVisible);
          const confirmBtn = allButtons.find(b => {
            const text = (b.innerText || b.value || b.textContent || '').trim();
            return /^confirmar$/i.test(text) || /confirmar/i.test(text);
          });
          if (confirmBtn) {
            confirmBtn.click();
            if (typeof window.$ === 'function') {
              try { window.$(confirmBtn).trigger('click'); } catch {}
            }
            return { clicked: true, text: 'Confirmar' };
          }

          return null;
        });

        if (res && res.clicked) {
          clicked = true;
          if (res.text && !/^(confirmar|fechar)$/i.test(res.text)) avisos.push(res.text);
          break;
        }
      } catch {}
    }

    if (clicked) break;
    await page.waitForTimeout(200);
  }

  if (clicked) {
    // 1. Aguarda o modal fechar
    const hideStart = Date.now();
    while (Date.now() - hideStart < 10000) {
      let anyVisible = false;
      for (const f of targetFrames) {
        try {
          const visible = await f.evaluate(() => {
            const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"], .inmodal, div[id*="dialog"]'));
            return modals.some(m => {
              const st = window.getComputedStyle(m);
              return st.display !== 'none' && st.visibility !== 'hidden' && m.offsetHeight > 0;
            });
          });
          if (visible) { anyVisible = true; break; }
        } catch {}
      }
      if (!anyVisible) break;
      await page.waitForTimeout(250);
    }

    // 2. Aguarda término de spinners ou overlays de carregamento
    await page.waitForFunction(() => {
      const spinners = Array.from(document.querySelectorAll('.sk-spinner, .loading, .blockUI, [id*="progress"], [class*="spinner"]'));
      return !spinners.some(s => {
        const st = window.getComputedStyle(s);
        return st.display !== 'none' && st.visibility !== 'hidden' && s.offsetHeight > 0;
      });
    }, { timeout: 15000 }).catch(() => {});

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    // Sem modal HTML: aguarda carregamento padrão
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  return avisos;
}

// Clica no botão da coluna. Confirmações do G-Click (modal HTML ou dialog nativo) são aceitas
// e as mensagens exibidas voltam para entrar no registro da operação.
async function clickColumnAction(page, frame, column) {
  const avisos = [];
  const onDialog = dialog => { avisos.push(dialog.message()); dialog.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    await frame.evaluate(carteiraColumnsInPage, { action: 'click', column }).catch(() => null);
    const modalAvisos = await handleActionConfirmation(page, frame);
    avisos.push(...modalAvisos);
  } finally {
    page.off('dialog', onDialog);
  }
  return avisos;
}

/**
 * Executa a vinculação dos clientes no G-Click, a partir da coluna de origem escolhida pelo operador:
 * 1. Seleciona o usuário na Carteira.
 * 2. Marca os checkboxes dos CNPJs na coluna de origem ("mesmo Cargo" ou "Restantes").
 * 3. Clica no "<- Vincular" que fica abaixo dessa coluna.
 * 4. Confere o resultado em Minha Carteira.
 */
export async function vincularClientesCarteira(page, accountId, userIdentifier, cnpjsToLink = [], usersList = [], { origem } = {}) {
  const { key: column, label } = assertCarteiraOrigem(origem);
  if (!cnpjsToLink.length) {
    return { success: true, user: userIdentifier, origem, linkedCount: 0, message: 'Nenhum cliente pendente para vincular.' };
  }

  // 1. Inspeciona a tela para garantir que estamos com o usuário selecionado
  const inspection = await inspectUserCarteira(page, accountId, userIdentifier, usersList);
  if (inspection.encontradoNoGclick === false) {
    throw new Error(`Usuário "${userIdentifier}" não encontrado nas opções do G-Click da conta ${accountId}. Operação de vinculação cancelada.`);
  }

  const targetCnpjs = Array.from(new Set(cnpjsToLink.map(c => normalizeCnpj(c).padStart(14, '0'))));

  // 2. Marca os checkboxes na coluna de origem
  const { frame, result: checkResult } = await inFrames(page, carteiraColumnsInPage, { action: 'mark', column, cnpjs: targetCnpjs }, data => data.columnFound);
  if (!checkResult) throw new Error(`Coluna "${label}" não encontrada na tela da Carteira.`);
  if (!checkResult.hasBtn) throw new Error(`Botão "<- Vincular" de "${label}" não encontrado na tela da Carteira.`);

  if (!checkResult.markedList.length) {
    return {
      success: true,
      user: inspection.user,
      origem,
      linkedCount: 0,
      message: `Nenhum dos clientes solicitados estava disponível em "${label}".`
    };
  }

  // 3. Clica no "<- Vincular" da mesma coluna (pode recarregar a página)
  const avisos = await clickColumnAction(page, frame, column);

  // 4. Reinspeciona para verificar o sucesso da transferência
  const finalInspection = await inspectUserCarteira(page, accountId, userIdentifier, usersList);
  const finalMinhaCnpjs = new Set(finalInspection.minhaCarteira.map(c => c.cnpj));
  const verifiedTransfers = checkResult.markedList.filter(c => finalMinhaCnpjs.has(c));

  return {
    success: true,
    user: inspection.user,
    origem,
    requestedCount: cnpjsToLink.length,
    markedCount: checkResult.markedList.length,
    avisos,
    verifiedCount: verifiedTransfers.length,
    transferredCnpjs: verifiedTransfers
  };
}

/**
 * Gera relatório CSV formatado a partir dos resultados de auditoria.
 */
export function buildCarteiraAuditCsv(auditItems = []) {
  const quote = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const headers = ['Linha', 'Responsável', 'Empresa', 'CNPJ', 'Situação', 'Coluna no G-Click', 'Detalhes'];

  const rows = auditItems.map(item => [
    quote(item.linha || ''),
    quote(item.responsavel || ''),
    quote(item.empresa || ''),
    quote(item.cnpjFormatado || item.cnpj || ''),
    quote(item.situacao || ''),
    quote(item.colunaGclick || 'Não localizado'),
    quote(item.detalhe || '')
  ].join(','));

  return [headers.map(quote).join(','), ...rows].join('\r\n') + '\r\n';
}

/**
 * Retira clientes da "Minha Carteira" de um usuário no G-Click:
 * 1. Seleciona o usuário (pelo valor da opção, vindo da sincronização, ou pelo nome).
 * 2. Marca os CNPJs em Minha Carteira.
 * 3. Clica em "Retirar" abaixo dessa coluna.
 * 4. Confere que saíram de Minha Carteira.
 * CNPJs que não estavam na carteira voltam em naoEncontrados.
 */
export async function retirarClientesCarteira(page, accountId, userIdentifier, cnpjsToRemove = [], usersList = [], { optionValue = null } = {}) {
  const targetCnpjs = Array.from(new Set(cnpjsToRemove.map(c => normalizeCnpj(c).padStart(14, '0')).filter(c => /^\d{14}$/.test(c))));
  if (!targetCnpjs.length) throw new Error('Nenhum CNPJ válido informado para retirar.');

  const inspection = await inspectUserCarteira(page, accountId, userIdentifier, usersList, { optionValue });
  if (inspection.encontradoNoGclick === false) {
    throw new Error(`Usuário "${userIdentifier}" não encontrado nas opções do G-Click da conta ${accountId}. Nada foi retirado.`);
  }

  const { frame, result: checkResult } = await inFrames(page, carteiraColumnsInPage, { action: 'mark', column: 'minha', cnpjs: targetCnpjs }, data => data.columnFound);
  if (!checkResult) throw new Error('Coluna "Minha Carteira" não encontrada na tela da Carteira.');
  if (!checkResult.hasBtn) throw new Error('Botão "Retirar" de Minha Carteira não encontrado na tela da Carteira.');

  const naoEncontrados = targetCnpjs.filter(c => !checkResult.markedList.includes(c));
  let avisos = [];
  let removidos = [];
  let finalInspection = inspection;
  if (checkResult.markedList.length) {
    avisos = await clickColumnAction(page, frame, 'minha');
    finalInspection = await inspectUserCarteira(page, accountId, userIdentifier, usersList, { optionValue: inspection.user.valorSelecionado });
    const restantesNaCarteira = new Set(finalInspection.minhaCarteira.map(c => c.cnpj));
    removidos = checkResult.markedList.filter(c => !restantesNaCarteira.has(c));
  }

  return {
    success: true,
    user: inspection.user,
    requestedCount: targetCnpjs.length,
    markedCount: checkResult.markedList.length,
    removidos,
    naoRemovidos: checkResult.markedList.filter(c => !removidos.includes(c)),
    naoEncontrados,
    avisos,
    minhaCarteira: finalInspection.minhaCarteira
  };
}
