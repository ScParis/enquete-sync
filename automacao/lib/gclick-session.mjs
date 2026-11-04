/**
 * Utilitários centralizados de sessão, detecção de login e leitura de estado
 * do ecossistema G-Click via Playwright.
 */

/**
 * Verifica se uma URL pertence ao ambiente interno autenticado do G-Click
 * (desconsiderando rotas de login/autenticação pública).
 * 
 * @param {string|URL} urlTarget
 * @returns {boolean}
 */
export function isGclickInternalUrl(urlTarget) {
  try {
    const u = typeof urlTarget === 'string' ? new URL(urlTarget) : urlTarget;
    if (!u || !u.hostname) return false;
    const isGclickDomain = /(^|\.)gclick\.com\.br$/.test(u.hostname);
    const isAuthRoute = u.pathname.startsWith('/autenticacao') || u.pathname.includes('/login');
    return isGclickDomain && !isAuthRoute;
  } catch {
    return false;
  }
}

/**
 * Verifica se uma URL é especificamente a página de login/autenticação do G-Click.
 * 
 * @param {string|URL} urlTarget
 * @returns {boolean}
 */
export function isGclickAuthUrl(urlTarget) {
  try {
    const u = typeof urlTarget === 'string' ? new URL(urlTarget) : urlTarget;
    if (!u || !u.hostname) return false;
    const isGclickDomain = /(^|\.)gclick\.com\.br$/.test(u.hostname);
    return isGclickDomain && (u.pathname.startsWith('/autenticacao') || u.pathname.includes('/login'));
  } catch {
    return false;
  }
}

/**
 * Verifica se o contexto de navegação do Playwright possui ao menos uma aba
 * logada e operando dentro do G-Click.
 * 
 * @param {import('playwright').BrowserContext} context
 * @returns {boolean}
 */
export function hasGclickActiveSession(context) {
  if (!context) return false;
  const pages = context.pages().filter(p => !p.isClosed());
  return pages.some(p => isGclickInternalUrl(p.url()));
}

/**
 * Lê passivamente os dados de empresa ativa e empresas acessíveis do localStorage
 * a partir das abas internas do G-Click.
 * 
 * @param {Array<import('playwright').Page>} pages
 * @returns {Promise<{ activeEmpresa: any, accessEmpresas: Array<any> }>}
 */
export async function extractEmpresaStateFromPages(pages = []) {
  let activeEmpresa = null;
  let accessEmpresas = [];

  for (const p of pages) {
    if (p.isClosed()) continue;
    try {
      if (!isGclickInternalUrl(p.url())) continue;

      const data = await p.evaluate(() => {
        try {
          const curRaw = localStorage.getItem('g3CurrentEmpresa');
          const allRaw = localStorage.getItem('g3AccessEmpresas');
          return {
            current: curRaw ? JSON.parse(curRaw) : null,
            all: allRaw ? JSON.parse(allRaw) : []
          };
        } catch {
          return null;
        }
      }).catch(() => null);

      if (data) {
        if (!activeEmpresa && data.current) activeEmpresa = data.current;
        if (Array.isArray(data.all) && data.all.length && !accessEmpresas.length) {
          accessEmpresas = data.all;
        }
      }
      if (activeEmpresa && accessEmpresas.length) break;
    } catch {
      // Ignora falhas temporárias de contexto fechado ou navegação
    }
  }

  return { activeEmpresa, accessEmpresas };
}
