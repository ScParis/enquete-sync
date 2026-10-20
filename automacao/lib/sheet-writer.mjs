// Escrita na planilha do escritório por um Apps Script publicado como app da web na própria planilha.
// Não exige Google Cloud: o script roda com a permissão de quem o publicou e só aceita pedidos com a chave da conta.
export const SHEET_COLUMN = 'Enquete G-Click';

export function appsScriptSource(token) {
  if (!/^[a-f0-9]{32,}$/.test(token)) throw new Error('Chave inválida para o script');
  return `// Robô da Enquete G-Click: registra na coluna "${SHEET_COLUMN}" os CNPJs marcados na Enquete.
// Publicar: Implantar > Nova implantação > Tipo: App da Web > Executar como: Eu > Quem pode acessar: Qualquer pessoa.
const CHAVE = '${token}';
const COLUNA = '${SHEET_COLUMN}';

function doPost(e) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const pedido = JSON.parse(e.postData.contents);
    if (pedido.chave !== CHAVE) return resposta({ ok: false, erro: 'Chave inválida' });
    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheets().find(s => s.getSheetId() === Number(pedido.gid));
    if (!aba) return resposta({ ok: false, erro: 'Aba não encontrada (gid ' + pedido.gid + ')' });
    if (pedido.teste) return resposta({ ok: true, aba: aba.getName() });
    const valores = aba.getDataRange().getValues();
    const cabecalho = valores[0].map(v => String(v).trim());
    const iCnpj = cabecalho.indexOf('CNPJ'), iTarefa = cabecalho.indexOf('Obrigação / Tarefa');
    if (iCnpj < 0 || iTarefa < 0) return resposta({ ok: false, erro: 'Colunas CNPJ e Obrigação / Tarefa não encontradas na aba' });
    let iColuna = cabecalho.indexOf(COLUNA);
    if (iColuna < 0) { iColuna = cabecalho.length; aba.getRange(1, iColuna + 1).setValue(COLUNA); }
    const digitos = v => String(v).replace(/\\D/g, '');
    const chave = (cnpj, tarefa) => digitos(cnpj) + '|' + String(tarefa).trim();
    const pedidos = new Map(pedido.marcacoes.map(m => [chave(m.cnpj, m.tarefa), m.texto]));
    const encontrados = new Set();
    let linhas = 0;
    valores.slice(1).forEach((linha, i) => {
      const k = chave(linha[iCnpj], linha[iTarefa]);
      if (!pedidos.has(k)) return;
      aba.getRange(i + 2, iColuna + 1).setValue(pedidos.get(k));
      encontrados.add(k); linhas++;
    });
    return resposta({ ok: true, linhas, naoEncontrados: [...pedidos.keys()].filter(k => !encontrados.has(k)) });
  } catch (erro) {
    return resposta({ ok: false, erro: String(erro) });
  } finally {
    lock.releaseLock();
  }
}

function resposta(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

export function validScriptUrl(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { throw new Error('Endereço do Apps Script inválido'); }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))
    throw new Error('Use o endereço do app da web do Apps Script (https://script.google.com/macros/s/…/exec)');
  return url.toString();
}

// O Apps Script responde com redirecionamento para o resultado; o fetch segue e devolve o JSON.
async function call(url, body, fetcher) {
  const res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(/<html/i.test(text) ? 'O Apps Script não respondeu como app da web. Confira se a implantação permite acesso a "Qualquer pessoa".' : `Resposta inesperada do Apps Script (HTTP ${res.status})`); }
  if (!data.ok) throw new Error(`Apps Script: ${data.erro ?? 'falha desconhecida'}`);
  return data;
}

export function testSheetWriter({ url, token, gid }, fetcher = fetch) {
  return call(url, { chave: token, gid, teste: true }, fetcher);
}

export function writeMarks({ url, token, gid }, marks, fetcher = fetch) {
  return call(url, { chave: token, gid, marcacoes: marks.map(m => ({ cnpj: m.cnpj, tarefa: m.task, texto: m.texto })) }, fetcher);
}
