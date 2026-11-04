import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Escreve dados em um arquivo de forma atômica utilizando arquivo temporário
 * e operação rename, garantindo integridade contra falhas de processo ou concorrência.
 * 
 * @param {string} filePath - Caminho completo do arquivo de destino
 * @param {any} data - Conteúdo a ser serializado em JSON (ou string direta)
 * @param {number} mode - Permissões do arquivo (padrão 0o600 para segurança de credenciais/dados)
 */
export async function writeJsonAtomic(filePath, data, mode = 0o600) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  
  await fs.writeFile(tempPath, content, { mode });
  await fs.rename(tempPath, filePath);
}

/**
 * Lê e analisa um arquivo JSON com tratamento gracioso de inexistência (ENOENT)
 * e retorno de valor padrão configurável.
 * 
 * @param {string} filePath - Caminho do arquivo JSON
 * @param {any} defaultValue - Valor retornado caso o arquivo não exista
 * @returns {Promise<any>}
 */
export async function readJsonSafe(filePath, defaultValue = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return defaultValue;
    throw error;
  }
}
