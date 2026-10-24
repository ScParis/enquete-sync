import crypto from 'node:crypto';

const tokenUrl = 'https://oauth2.googleapis.com/token';
const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export function parseSheetUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/|$)/.test(u.pathname)) throw new Error('Link de Google Sheets inválido');
  const id = u.pathname.split('/')[3];
  const gid = new URLSearchParams(u.hash.slice(1)).get('gid') ?? u.searchParams.get('gid');
  if (!/^\d+$/.test(gid ?? '')) throw new Error('gid da aba não encontrado no link');
  return { id, gid: Number(gid) };
}
const b64url = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
export function makeServiceJwt(key, now = Math.floor(Date.now() / 1000)) {
  if (key?.type !== 'service_account' || typeof key.client_email !== 'string' || !key.client_email.endsWith('.gserviceaccount.com') ||
      typeof key.private_key !== 'string' || !key.private_key.includes('BEGIN PRIVATE KEY') || key.token_uri !== tokenUrl) throw new Error('Arquivo JSON de conta de serviço inválido');
  const head = b64url({ alg: 'RS256', typ: 'JWT' });
  const claims = b64url({ iss: key.client_email, scope, aud: tokenUrl, iat: now, exp: now + 3600 });
  const input = `${head}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), key.private_key).toString('base64url');
  return `${input}.${signature}`;
}
async function getAccessToken(key, fetcher) {
  const assertion = makeServiceJwt(key);
  const res = await fetcher(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!res.ok) throw new Error(`Google recusou a credencial de serviço (HTTP ${res.status}). Verifique a chave e o relógio do computador.`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Google não retornou token de acesso');
  return data.access_token;
}
async function getJson(url, token, fetcher) {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403) throw new Error('A conta de serviço não tem acesso à planilha ou a API Google Sheets não está habilitada. Compartilhe a planilha com o e-mail da conta de serviço como Leitor.');
  if (res.status === 404) throw new Error('Planilha ou aba não encontrada pela conta de serviço. Confira o link e o compartilhamento.');
  if (!res.ok) throw new Error(`Falha ao ler a planilha na API Google Sheets (HTTP ${res.status})`);
  return res.json();
}
export function valuesToCsv(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('Aba vazia no Google Sheets');
  const quote = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  return values.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
export async function readWithServiceAccount(rawUrl, key, fetcher = fetch) {
  const { id, gid } = parseSheetUrl(rawUrl);
  const token = await getAccessToken(key, fetcher);
  const meta = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`, token, fetcher);
  const sheet = meta.sheets?.find(x => x.properties?.sheetId === gid);
  if (!sheet) throw new Error(`Aba gid=${gid} não encontrada na planilha`);
  const title = sheet.properties.title;
  const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
  const response = await getJson(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE`, token, fetcher);
  return valuesToCsv(response.values);
}
export async function readPublicGoogleCsv(rawUrl, fetcher = fetch) {
  const { id, gid } = parseSheetUrl(rawUrl);
  const res = await fetcher(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
  if (res.status === 401 || res.status === 403) throw new Error('A planilha exige acesso. Envie um CSV/XLSX ou informe um JSON de conta de serviço com acesso de Leitor. O login do Google na janela automatizada é recusado pelo próprio Google.');
  if (!res.ok) throw new Error(`Falha ao exportar planilha pública (HTTP ${res.status})`);
  const body = await res.text();
  if (/^\s*<!doctype html|^\s*<html/i.test(body)) throw new Error('O link não retornou um CSV. Use uma exportação local ou uma conta de serviço.');
  return body;
}
