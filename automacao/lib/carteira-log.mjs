import { getDatabase } from './db.mjs';

// Registro das escritas na Carteira do G-Click. Grava sucesso, sucesso parcial e erro, para o operador
// saber o que foi feito e o que precisa ser refeito sem depender do console do servidor.
// ok: tudo confirmado e sem ressalva; erro: nada confirmado; parcial: o resto (parte feita ou feita com aviso).
export function statusCarteiraOperacao(solicitados = [], concluidos = [], erro = null) {
  if (!erro && concluidos.length >= solicitados.length) return 'ok';
  return concluidos.length ? 'parcial' : 'erro';
}

export function registrarCarteiraOperacao({ accountId, operador = null, acao, origem = null, usuario, solicitados = [], concluidos = [], erro = null }, db = getDatabase()) {
  const status = statusCarteiraOperacao(solicitados, concluidos, erro);
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO carteira_operacoes (account_id, operador, acao, origem, usuario_gclick, solicitados, concluidos, status, erro, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(accountId), operador, acao, origem, String(usuario), JSON.stringify(solicitados), JSON.stringify(concluidos), status, erro, createdAt);
  return { id: Number(result.lastInsertRowid), status, createdAt };
}

export function listarCarteiraOperacoes(accountId, { limit = 30 } = {}, db = getDatabase()) {
  return db.prepare(`
    SELECT * FROM carteira_operacoes WHERE account_id = ? ORDER BY id DESC LIMIT ?
  `).all(String(accountId), Math.min(Math.max(Number(limit) || 30, 1), 200)).map(row => ({
    id: row.id,
    accountId: row.account_id,
    operador: row.operador,
    acao: row.acao,
    origem: row.origem,
    usuario: row.usuario_gclick,
    solicitados: JSON.parse(row.solicitados),
    concluidos: JSON.parse(row.concluidos),
    status: row.status,
    erro: row.erro,
    createdAt: row.created_at
  }));
}
