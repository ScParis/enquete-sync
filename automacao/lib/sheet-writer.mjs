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
    const norm = v => String(v || '').trim().toLowerCase();
    const findCol = names => cabecalho.findIndex(c => names.some(n => norm(c) === n || norm(c).includes(n)));
    let iCnpj = findCol(['cnpj']);
    let iCod = findCol(['cod.', 'cod', 'empid', 'código', 'codigo']);
    let iTarefa = findCol(['obrigação / tarefa', 'obrigacao / tarefa', 'descrição da enquete', 'descricao da enquete', 'tarefa', 'column 18']);
    if ((iCnpj < 0 && iCod < 0) || iTarefa < 0) return resposta({ ok: false, erro: 'Colunas de identificação (CNPJ ou Cod.) e Tarefa não encontradas na aba' });
    let iColuna = cabecalho.indexOf(COLUNA);
    if (iColuna < 0) { iColuna = cabecalho.length; aba.getRange(1, iColuna + 1).setValue(COLUNA); }
    const digitos = v => String(v || '').replace(/\\D/g, '');
    const chave = (cnpj, tarefa) => digitos(cnpj) + '|' + String(tarefa).trim();
    const chaveCod = (cod, tarefa) => 'id:' + String(cod || '').trim() + '|' + String(tarefa).trim();
    const pedidos = new Map();
    (pedido.marcacoes || []).forEach(m => {
      if (m.cnpj) pedidos.set(chave(m.cnpj, m.tarefa), m.texto);
      const codVal = m.cod || m.empId;
      if (codVal) pedidos.set(chaveCod(codVal, m.tarefa), m.texto);
    });
    const encontrados = new Set();
    let linhas = 0;
    const alteracoes = [];
    valores.slice(1).forEach((linha, i) => {
      const valCnpj = iCnpj >= 0 ? linha[iCnpj] : '';
      const valCod = iCod >= 0 ? linha[iCod] : '';
      const valTarefa = linha[iTarefa];
      const k1 = chave(valCnpj, valTarefa);
      const k2 = chaveCod(valCod, valTarefa);
      const text = pedidos.get(k1) || pedidos.get(k2);
      if (!text) return;
      if (pedidos.has(k1)) encontrados.add(k1);
      if (pedidos.has(k2)) encontrados.add(k2);
      linhas++;
      alteracoes.push({ row: i + 2, text: text });
    });
    let bloco = null;
    for (let j = 0; j < alteracoes.length; j++) {
      const alt = alteracoes[j];
      if (bloco && alt.row === bloco.startRow + bloco.values.length) {
        bloco.values.push([alt.text]);
      } else {
        if (bloco) aba.getRange(bloco.startRow, iColuna + 1, bloco.values.length, 1).setValues(bloco.values);
        bloco = { startRow: alt.row, values: [[alt.text]] };
      }
    }
    if (bloco) aba.getRange(bloco.startRow, iColuna + 1, bloco.values.length, 1).setValues(bloco.values);
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
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') {
    throw new Error('Use o endereço do app da web do Apps Script (https://script.google.com/macros/s/…/exec)');
  }
  if (url.pathname.endsWith('/dev')) {
    throw new Error('Você colou o endereço de teste (/dev). No Apps Script, clique no botão azul "Implantar" > "Nova implantação" > Tipo "App da Web" para gerar o endereço final que termina em /exec.');
  }
  if (!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) {
    throw new Error('Use o endereço do app da web do Apps Script (https://script.google.com/macros/s/…/exec)');
  }
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
  return call(url, { chave: token, gid, marcacoes: marks.map(m => ({ cnpj: m.cnpj, ...(m.empId || m.cod ? { cod: m.empId ?? m.cod } : {}), tarefa: m.task, texto: m.texto })) }, fetcher);
}
