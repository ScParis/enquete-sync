// Módulo de Extração e Validação de PDF (Valida PDF / G-Click PDF Layout)
// Responsabilidade Única: Extração de texto de PDFs, identificação de clientes,
// detecção de competências, identificação de tipos de documentos e conciliação com modelos do G-Click.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

// Regexes para extração de identificadores cadastrais
export const CNPJ_REGEX = /\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/g;
export const CNPJ_BASE_REGEX = /\b(\d{2}\.\d{3}\.\d{3})\b/g;
export const CPF_REGEX = /\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/g;
export const CPF_UNMASKED_REGEX = /(?:CPF|Inscrição)[\s:]+(\d{11})\b/gi;

// Meses em português
const MESES_MAP = {
  janeiro: '01', jan: '01',
  fevereiro: '02', fev: '02',
  marco: '03', março: '03', mar: '03',
  abril: '04', abr: '04',
  maio: '05', mai: '05',
  junho: '06', jun: '06',
  julho: '07', jul: '07',
  agosto: '08', ago: '08',
  setembro: '09', set: '09',
  outubro: '10', out: '10',
  novembro: '11', nov: '11',
  dezembro: '12', dez: '12'
};

const MESES_REGEX_STR = Object.keys(MESES_MAP).join('|');

// Padrões de competência
export const COMPETENCIA_LABEL_REGEX = new RegExp(
  `(?:compet[êe]ncia|apura[çc][ãa]o|refer[êe]ncia|p\\.?a\\.?|per[íi]odo\\s+de\\s+apura[çc][ãa]o|comp\\.?\\s*apura[çc][ãa]o|comp\\.?\\s*refer[êe]ncia|m[êe]s\\s+de)[\\s:]*([0-1]?[0-9]/20\\d\\d|20\\d\\d|(?:${MESES_REGEX_STR})/20\\d\\d|13[ºo]?\\s*sal[áa]rio|d[ée]cimo\\s+terceiro|adiantamento)`,
  'i'
);

export const COMPETENCIA_DATE_REGEX = /\b(0[1-9]|1[0-2])\/(20\d\d)\b/g;
export const COMPETENCIA_EXTENSO_REGEX = new RegExp(`\\b(${MESES_REGEX_STR})/(20\\d\\d)\\b`, 'i');
export const COMPETENCIA_ANO_13_REGEX = /\b(20\d\d)\b/;

// Mapeamento padrão de palavras-chave para tipos de documentos comuns
export const DOCUMENT_KEYWORDS = [
  { name: 'GFD - Guia do FGTS Digital', keywords: ['GFD - Guia do FGTS Digital', 'Guia do FGTS Digital', 'FGTS Digital'], category: 'FGTS' },
  { name: 'FGTS (Sefip / GRF / Relatório RE)', keywords: ['GUIA DE RECOLHIMENTO DO FGTS', 'GRF - GUIA', 'Relatório RE', 'Relação de Trabalhadores', 'Detalhe da Guia Emitida'], category: 'FGTS' },
  { name: 'DARF DCTFWeb', keywords: ['Documento de Arrecadação de Receitas Federais', 'DCTFWeb', 'GUIA DCTF WEB', 'DARF DCTFWeb', 'DCTF Web'], category: 'Impostos Federais' },
  { name: 'Recibo de Pagamento (Holerite)', keywords: ['RECIBO DE PAGAMENTO', 'HOLERITE', 'CONTRACHEQUE', 'CONTRA-CHEQUE'], category: 'Folha de Pagamento' },
  { name: 'Recibo de Pró-Labore', keywords: ['RECIBO DE PRO-LABORE', 'RECIBO DE PRÓ-LABORE', 'PRO-LABORE'], category: 'Folha de Pagamento' },
  { name: 'DAE eSocial Doméstica', keywords: ['Documento de Arrecadação do eSocial', 'GuiaPagamento', 'eSocial_Demonstrativo', 'DAE - Documento de Arrecadação', 'Demonstrativo dos Valores Devidos'], category: 'eSocial Doméstica' },
  { name: 'Relação de Líquidos', keywords: ['RELAÇÃO GERAL DOS LÍQUIDOS', 'RELAÇÃO DE CREDITO EM CONTA', 'Relatório de Líquidos', 'RELATORIO DE LIQUIDOS'], category: 'Relatórios Folha' },
  { name: 'Cálculo de Médias', keywords: ['Cálculo de Médias', 'Calculo de Medias', 'DEMONSTRATIVO DE MEDIAS'], category: 'Relatórios Folha' },
  { name: 'Relação da Folha por Empregado', keywords: ['RELAÇÃO DA FOLHA POR EMPREGADO', 'Listagem Da Folha', 'Resumo da Folha', 'RELAÇÃO DE BASES DO INSS', 'RELAÇÃO DE BASES DO IRRF', 'RELAÇÃO DAS BASES DO IRRF', 'RELAÇÃO DAS BASES DO PIS', 'RELAÇÃO DE BASES DO PIS', 'BASES DO IRRF', 'BASES DO PIS'], category: 'Relatórios Folha' },
  { name: 'Encargos e Guias Consignado', keywords: ['LISTAGEM EMPRESTIMO CONSIGNADO', 'GUIA EMPRESTIMO CONSIGNADO', 'RELATORIO RE Consignado', 'EMPRESTIMO CONSIGNADO'], category: 'Consignado' },
  { name: 'Encargos da Folha (INSS / IRRF / PIS)', keywords: ['Encargos de INSS', 'Encargos de IRRF', 'Encargos de PIS', 'Encargos da Folha'], category: 'Tributos Folha' },
  { name: 'Eventos e Benefícios', keywords: ['Bradesco Saude', 'Convenio Farmacia', 'Mensalidade Sindicato', 'Pensao Alimenticia', 'Seguro de vida', 'MOVIMENTOS', 'Rubrica:', 'Relação de Vidas', 'Relação dos Segurados Vigentes', 'VIDA EM GRUPO', 'Detalhes do pedido'], category: 'Benefícios' },
  { name: 'Ponto e Frequência', keywords: ['Relatório Folha de Pagamento', 'Madis Rodbel', 'MD Comune', 'Horas (Sexagesimal)'], category: 'Folha de Pagamento' }
];

/**
 * Extrai texto completo de um PDF preservando o layout ou stream nativo de linhas usando `pdftotext`
 * @param {string} pdfPath - Caminho absoluto para o arquivo PDF
 * @param {object} options - { mode: 'layout' | 'raw' }
 * @returns {Promise<{ rawText: string, lines: Array<{ lineNumber: number, text: string }> }>}
 */
export async function extractPdfText(pdfPath, options = {}) {
  const modeFlag = options.mode === 'raw' ? '-raw' : '-layout';
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', [modeFlag, pdfPath, '-']);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

    child.on('error', err => {
      if (err.code === 'ENOENT') {
        const osHelp = process.platform === 'win32'
          ? 'Instale o Poppler no Windows via: winget install poppler (ou choco install poppler) e reinicie o terminal.'
          : 'Instale o Poppler no Linux via: sudo apt install poppler-utils.';
        return reject(new Error(`pdftotext não encontrado no sistema. ${osHelp}`));
      }
      reject(new Error(`Falha ao executar pdftotext: ${err.message}`));
    });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`pdftotext finalizou com código ${code}: ${stderr}`));
      }

      const rawLines = stdout.split(/\r?\n/);
      let lines = rawLines.map((text, idx) => ({
        lineNumber: idx + 1,
        text: text.replace(/\u0000/g, '')
      }));

      if (options.mode === 'raw') {
        // No modo raw (usado pelo mapeador do G-Click), filtra linhas em branco da 1ª página
        const firstPage = stdout.split('\u000c')[0] || stdout;
        const pageLines = firstPage.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
        lines = pageLines.map((text, idx) => ({
          lineNumber: idx + 1,
          text
        }));
      }

      resolve({
        rawText: stdout,
        lines,
        totalLines: lines.length
      });
    });
  });
}

/**
 * Normaliza CNPJ removendo pontuação
 */
export function cleanCnpj(cnpj) {
  if (!cnpj) return '';
  return String(cnpj).replace(/\D/g, '');
}

/**
 * Valida dígito verificador de CPF (algoritmo Módulo 11)
 */
export function isValidCpf(cpf) {
  const c = String(cpf).replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let sum = 0, rest;
  for (let i = 1; i <= 9; i++) sum += parseInt(c.substring(i - 1, i)) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(c.substring(9, 10))) return false;
  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(c.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  return rest === parseInt(c.substring(10, 11));
}

/**
 * Formata CPF de 11 dígitos para o formato mascarado XXX.XXX.XXX-XX
 */
export function formatCpf(cpf) {
  const c = String(cpf).replace(/\D/g, '');
  if (c.length !== 11) return cpf;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

/**
 * Extrai dados do cliente (CNPJ completo, CNPJ Raiz, CPF, Razão Social)
 */
export function extractClientIdentifiers(rawText, lines) {
  const cnpjs = new Set();
  const cnpjsBase = new Set();
  const cpfs = new Set();
  const nomesCandidatos = [];

  // 1. Busca CNPJ com máscara
  const cnpjMatches = rawText.matchAll(CNPJ_REGEX);
  for (const m of cnpjMatches) {
    const full = m[1];
    cnpjs.add(full);
    const cleaned = cleanCnpj(full);
    if (cleaned.length >= 8) {
      cnpjsBase.add(cleaned.slice(0, 8));
    }
  }

  // 2. Busca CNPJ Base explícito (ex: "17.308.338" no FGTS Digital)
  const baseMatches = rawText.matchAll(CNPJ_BASE_REGEX);
  for (const m of baseMatches) {
    const b = m[1];
    const cleaned = cleanCnpj(b);
    if (cleaned.length === 8 && !rawText.includes(b + '/')) {
      cnpjsBase.add(cleaned);
    }
  }

  // 3. Busca CPF com máscara
  const cpfMatches = rawText.matchAll(CPF_REGEX);
  for (const m of cpfMatches) {
    if (isValidCpf(m[1])) {
      cpfs.add(m[1]);
    }
  }

  // 4. Busca CPF sem máscara precedido por rótulo (ex: "CPF: 60008989672")
  const unmaskedMatches = rawText.matchAll(CPF_UNMASKED_REGEX);
  for (const m of unmaskedMatches) {
    if (isValidCpf(m[1])) {
      cpfs.add(formatCpf(m[1]));
    }
  }

  // 4.1 Busca CPF em quebras de linha/colunas após rótulo CPF
  const multilineCpfMatches = rawText.matchAll(/(?:CPF|Inscrição)[^\n]*\n[^\n]*?(\d{11})\b/gi);
  for (const m of multilineCpfMatches) {
    if (isValidCpf(m[1])) {
      cpfs.add(formatCpf(m[1]));
    }
  }

  // 4.2 Em documentos domésticos / eSocial, procura o CPF do EMPREGADOR especificamente
  const empregadorBlock = rawText.match(/EMPREGADOR:[\s\S]*?(?=EMPREGADO:|$)/i);
  if (empregadorBlock) {
    const digits11 = empregadorBlock[0].match(/\b\d{11}\b/g) || [];
    for (const d of digits11) {
      if (isValidCpf(d)) {
        cpfs.add(formatCpf(d));
      }
    }
  }

  // 5. Busca Razão Social em padrões comuns
  const recebiMatch = rawText.match(/Recebi\s+de\s+([^,]+?),\s*inscrita\s+no/i);
  if (recebiMatch && recebiMatch[1].trim()) {
    nomesCandidatos.push(recebiMatch[1].trim());
  }

  for (const item of lines) {
    const t = item.text.trim();
    if (/^\d+|INSS|IRRF|FGTS\s+Mensal/i.test(t)) continue;

    const empMatch = t.match(/(?:Empresa|Nome Empregador|Raz[ãa]o Social)[\s:]+([A-Z0-9\s.,&'-]{4,60})/i);
    if (empMatch) {
      const nome = empMatch[1].replace(/(?:CNPJ|Página|Emissão|Horas|Horário|Total).*/i, '').trim();
      if (nome && nome.length > 3 && !/^\d+$/.test(nome) && !/descontos|vencimentos/i.test(nome)) {
        nomesCandidatos.push(nome);
      }
    }
  }

  let linhaCliente = null;
  const allIdent = [...cnpjs, ...cnpjsBase, ...cpfs];
  for (const item of lines) {
    if (allIdent.some(id => item.text.includes(id) || (id.length === 11 && item.text.includes(id.replace(/\D/g, ''))))) {
      linhaCliente = item.lineNumber;
      break;
    }
  }

  return {
    cnpjs: Array.from(cnpjs),
    cnpjsBase: Array.from(cnpjsBase),
    cpfs: Array.from(cpfs),
    razaoSocial: nomesCandidatos[0] || null,
    todosNomes: nomesCandidatos,
    linhaCliente
  };
}

/**
 * Normaliza competência para formato padrão MM/AAAA (ou AAAA para anual/13º)
 */
export function normalizeCompetencia(compStr) {
  if (!compStr) return null;
  const s = String(compStr).trim().toLowerCase();

  // Caso 1: MM/AAAA, MM.AAAA ou MM-AAAA direto
  const mmYyyy = s.match(/\b(0?[1-9]|1[0-2])[\/.-](20\d\d)\b/);
  if (mmYyyy) {
    const mes = mmYyyy[1].padStart(2, '0');
    return `${mes}/${mmYyyy[2]}`;
  }

  // Caso 1.1: MMAAAA numérico contíguo (ex: 092026 em nomes de arquivo)
  const mmDigits = s.match(/\b(0[1-9]|1[0-2])(20\d\d)\b/);
  if (mmDigits) {
    return `${mmDigits[1]}/${mmDigits[2]}`;
  }

  // Caso 2: Mês extenso / AAAA (ex: setembro/2026)
  for (const [nomeMes, numMes] of Object.entries(MESES_MAP)) {
    const reg = new RegExp(`\\b${nomeMes}/(20\\d\\d)\\b`, 'i');
    const m = s.match(reg);
    if (m) {
      return `${numMes}/${m[1]}`;
    }
  }

  // Caso 3: "Setembro de 2026"
  for (const [nomeMes, numMes] of Object.entries(MESES_MAP)) {
    const reg = new RegExp(`\\b${nomeMes}\\s+de\\s+(20\\d\\d)\\b`, 'i');
    const m = s.match(reg);
    if (m) {
      return `${numMes}/${m[1]}`;
    }
  }

  // Caso 4: 13º salário anual (ex: 2025)
  if (/13[ºo]?|d[ée]cimo|anual/i.test(s)) {
    const anoM = s.match(/\b(20\d\d)\b/);
    if (anoM) return `13/${anoM[1]}`;
    return '13';
  }

  // Caso 5: Ano simples de 4 dígitos no contexto de apuração
  const anoSimples = s.match(/\b(20\d\d)\b/);
  if (anoSimples) return anoSimples[1];

  return s;
}

/**
 * Extrai competência do texto priorizando campos identificadores rotulados
 */
export function extractCompetencia(rawText, lines) {
  const achados = [];

  const pushAchado = (val, rotulo, linha = null) => {
    const norm = normalizeCompetencia(val);
    if (norm && !achados.some(a => a.normalizado === norm)) {
      achados.push({
        valorOriginal: val,
        normalizado: norm,
        linha,
        rotulo
      });
    }
  };

  // 1. Procura por rótulo em linha única (ex: "Competência: 09/2026", "Período de Apuração: setembro/2026")
  const inlineReg = new RegExp(
    `(?:compet[êe]ncia|apura[çc][ãa]o|refer[êe]ncia|p\\.?a\\.?|per[íi]odo\\s+de\\s+apura[çc][ãa]o|comp\\.?\\s*apura[çc][ãa]o|comp\\.?\\s*refer[êe]ncia)[\\s:]*([0-1]?[0-9]/20\\d\\d|20\\d\\d|(?:${MESES_REGEX_STR})/20\\d\\d|13[ºo]?\\s*sal[áa]rio|d[ée]cimo\\s+terceiro)`,
    'i'
  );

  for (const item of lines) {
    const t = item.text.trim();
    const match = t.match(inlineReg);
    if (match) {
      pushAchado(match[1].trim(), match[0].split(':')[0].trim(), item.lineNumber);
    }
  }

  // 2. Procura em tabelas onde "Competência" é cabeçalho de coluna e o valor está nas linhas abaixo (ex: FGTS Digital)
  for (let i = 0; i < lines.length; i++) {
    const lText = lines[i].text;
    const colIdx = lText.search(/\bCompet[êe]ncia\b/i);
    if (colIdx !== -1) {
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const nextLine = lines[j].text;
        const sub = nextLine.slice(Math.max(0, colIdx - 4), colIdx + 20);
        const dateMatch = sub.match(/\b(0[1-9]|1[0-2])\/(20\d\d)\b/);
        if (dateMatch) {
          pushAchado(`${dateMatch[1]}/${dateMatch[2]}`, 'coluna_competencia', lines[j].lineNumber);
          break;
        }
      }
    }
  }

  // 3. Procura frases multilinhas como "referente ao meu Pró-Labore do mês\nde Setembro/2026"
  const multiMatch = rawText.match(/(?:m[êe]s\s*(?:de)?|referente\s+ao[^\n]+\s*m[êe]s\s*(?:de)?)\s*[:\n\r\s]+([a-zçã]+[\/\s]+20\d\d|[0-1]?[0-9]\/20\d\d)/i);
  if (multiMatch) {
    pushAchado(multiMatch[1].trim(), 'texto_referente_mes');
  }

  // 4. Procura data por extenso do recibo (ex: "30 DE SETEMBRO DE 2026" -> 09/2026)
  const extensoMatch = rawText.match(new RegExp(`\\b\\d{1,2}\\s+de\\s+(${MESES_REGEX_STR})\\s+de\\s+(20\\d\\d)\\b`, 'i'));
  if (extensoMatch) {
    pushAchado(`${extensoMatch[1]}/${extensoMatch[2]}`, 'data_extenso_documento');
  }

  // 5. Fallback: datas MM/AAAA gerais
  if (achados.length === 0) {
    const dates = Array.from(rawText.matchAll(COMPETENCIA_DATE_REGEX));
    for (const d of dates) {
      pushAchado(`${d[1]}/${d[2]}`, 'data_detectada');
    }
  }

  return {
    competenciaPrincipal: achados[0]?.normalizado || null,
    candidatos: achados
  };
}

/**
 * Extrai o tipo / nome do documento e possíveis correspondências de modelos
 */
export function extractDocumentName(rawText, lines, availableModels = []) {
  const matches = [];

  // 1. Testa os 184 modelos do G-Click caso informados
  if (Array.isArray(availableModels) && availableModels.length > 0) {
    for (const model of availableModels) {
      const nomeModelo = model.modelo || model.nome;
      if (!nomeModelo) continue;

      const escaped = nomeModelo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`\\b${escaped}\\b`, 'i');

      if (reg.test(rawText)) {
        matches.push({
          origem: 'gclick_model',
          modelId: model.modelId || model.id || null,
          departamento: model.departamento || null,
          nome: nomeModelo,
          confianca: 'alta'
        });
      }
    }
  }

  // 2. Testa as palavras-chave padrões de documentos contábeis
  for (const doc of DOCUMENT_KEYWORDS) {
    for (const kw of doc.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`\\b${escaped}\\b`, 'i');
      if (reg.test(rawText)) {
        matches.push({
          origem: 'padrao_sistema',
          nome: doc.name,
          palavraChaveEncontrada: kw,
          categoria: doc.category,
          confianca: kw.length > 8 ? 'alta' : 'media'
        });
        break;
      }
    }
  }

  let linhaIdentificada = null;
  if (matches.length > 0 && Array.isArray(lines)) {
    const kwTarget = (matches[0].palavraChaveEncontrada || matches[0].nome).toLowerCase();
    for (const item of lines) {
      if (item.text.toLowerCase().includes(kwTarget)) {
        linhaIdentificada = item.lineNumber;
        break;
      }
    }
  }

  return {
    documentoIdentificado: matches[0]?.nome || null,
    modelosCompativeis: matches,
    linhaIdentificada
  };
}

/**
 * Analisa o nome do arquivo para verificar compatibilidade com o recurso "Anexo por Nome" do G-Click
 * Padrão recomendado: [Obrigação / Nome Documento] - [CNPJ/Inscrição] - [Competência].ext
 */
export function parseAnexoPorNome(fileName) {
  if (!fileName) return { compativel: false, valido: false };
  const base = fileName.replace(/\.[a-zA-Z0-9]+$/, '').trim();
  let parts = base.split(/\s+[-–—_]\s+/);

  if (parts.length < 3) {
    const cnpjMatch = base.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
    const compMatch = base.match(/\b(0?[1-9]|1[0-2])[\/.-](20\d\d)\b/);
    if (cnpjMatch && compMatch) {
      const idxCnpj = base.indexOf(cnpjMatch[0]);
      const docName = base.slice(0, idxCnpj).replace(/[-–—_]\s*$/, '').trim();
      const compNorm = normalizeCompetencia(compMatch[0]) || compMatch[0];
      return {
        compativel: true,
        valido: true,
        obrigacao: docName || 'Documento',
        documento: docName || 'Documento',
        cnpj: cnpjMatch[0],
        inscricao: cnpjMatch[0].replace(/\D/g, ''),
        competencia: compNorm,
        detalhe: 'Compatível com recurso Anexo por Nome do G-Click'
      };
    }
  }

  if (parts.length >= 3) {
    const docName = parts[0].trim();
    const rawInscricao = parts[1].trim();
    const inscricaoClean = rawInscricao.replace(/\D/g, '');
    const compStr = parts.slice(2).join('');
    const compNorm = normalizeCompetencia(compStr) || compStr;
    return {
      compativel: true,
      valido: true,
      obrigacao: docName,
      documento: docName,
      cnpj: rawInscricao,
      inscricao: inscricaoClean,
      competencia: compNorm,
      detalhe: 'Compatível com recurso Anexo por Nome do G-Click'
    };
  }
  return { compativel: false, valido: false };
}

/**
 * Validação completa de um arquivo PDF aplicando as 4 regras do usuário
 * @param {string} filePath - Caminho do arquivo PDF
 * @param {object} options - Opções (ex: lista de modelos cadastrados, dados esperados do cliente/competência)
 */
export async function validatePdfFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  const models = options.models || [];
  const expectedCnpj = options.expectedCnpj ? cleanCnpj(options.expectedCnpj) : null;
  const expectedCpf = options.expectedCpf ? String(options.expectedCpf).replace(/\D/g, '') : null;
  const expectedCompetencia = options.expectedCompetencia ? normalizeCompetencia(options.expectedCompetencia) : null;
  const anexoPorNome = parseAnexoPorNome(fileName);

  try {
    const { rawText, lines, totalLines } = await extractPdfText(filePath);

    // Regra 1: Extração de texto bem-sucedida
    const hasText = rawText.trim().length > 0;
    if (!hasText) {
      return {
        fileName,
        filePath,
        valido: false,
        status: 'erro_extracao',
        mensagem: 'O arquivo PDF não contém camada de texto selecionável ou é uma imagem.',
        anexoPorNome,
        diagnosticoGclick: {
          tipoErro: 'erro_extracao_ocr',
          titulo: 'Documento Digitalizado / Imagem Sem OCR',
          acaoRecomendada: 'O ValidaPDF do G-Click requer texto selecionável. Aplique OCR prévio no arquivo ou use o "Anexo por Nome" para arquivos digitalizados.',
          checklist: [
            { item: '1. Modelo cadastrado com a mesma estrutura de linhas?', status: 'pendente' },
            { item: '2. Cliente existente no cadastro do G-Click?', status: 'pendente' },
            { item: '3. Tarefa da competência gerada?', status: 'pendente' }
          ]
        },
        regras: {
          extracaoTexto: { ok: false, detalhe: 'Arquivo vazio ou sem texto OCR' },
          identificacaoCliente: { ok: false },
          competencia: { ok: false },
          nomeDocumento: { ok: false }
        }
      };
    }

    // Regra 2: Identificação do cliente
    const cliente = extractClientIdentifiers(rawText, lines);
    let clienteOk = cliente.cnpjs.length > 0 || cliente.cnpjsBase.length > 0 || cliente.cpfs.length > 0;
    let clienteMatch = true;

    if (expectedCnpj) {
      const foundClean = cliente.cnpjs.map(cleanCnpj);
      const foundBase = cliente.cnpjsBase;
      const expectedBase = expectedCnpj.slice(0, 8);
      clienteMatch = foundClean.includes(expectedCnpj) || foundBase.includes(expectedBase);
      clienteOk = clienteOk && clienteMatch;
    } else if (expectedCpf) {
      const foundCleanCpf = cliente.cpfs.map(c => c.replace(/\D/g, ''));
      clienteMatch = foundCleanCpf.includes(expectedCpf);
      clienteOk = clienteOk && clienteMatch;
    }

    // Regra 3: Competência
    const comp = extractCompetencia(rawText, lines);
    let compOk = Boolean(comp.competenciaPrincipal);
    let compMatch = true;

    if (expectedCompetencia && comp.competenciaPrincipal) {
      compMatch = comp.competenciaPrincipal === expectedCompetencia ||
                  comp.candidatos.some(c => c.normalizado === expectedCompetencia);
      compOk = compOk && compMatch;
    }

    // Regra 4: Nome do Documento
    const doc = extractDocumentName(rawText, lines, models);
    const docOk = Boolean(doc.documentoIdentificado);

    // Consolidação do status final
    const valido = clienteOk && compOk && docOk;
    let status = 'valido';
    let mensagem = 'Documento validado com sucesso.';

    let diagnosticoGclick = {
      tipo: 'ok',
      tipoErro: null,
      titulo: 'Validação 100% Conforme',
      acaoRecomendada: 'Arquivo perfeitamente compatível com os modelos do G-Click e pronto para entrega na tarefa.',
      checklist: [
        { item: '1. Modelo cadastrado com a mesma estrutura de linhas?', status: 'ok' },
        { item: '2. Cliente existente no cadastro do G-Click?', status: 'ok' },
        { item: '3. Tarefa da competência gerada?', status: 'ok' }
      ]
    };

    if (!docOk) {
      status = 'documento_desconhecido';
      mensagem = 'Não foi possível identificar o nome ou modelo deste documento.';
      diagnosticoGclick = {
        tipo: 'erro_1_modelo',
        tipoErro: 'erro_1_modelo_nao_encontrado',
        titulo: 'Erro 1 (G-Click): Modelo não encontrado ou estrutura de linhas alterada',
        acaoRecomendada: 'O G-Click não reconheceu a estrutura de linhas deste documento. Se já existe um modelo para esta obrigação, a posição das linhas divergiu (ex.: linha 2 vs linha 4). Cadastre um novo modelo alternativo (ex.: Modelo 2) ou utilize o "Anexo por Nome" para folhas de pagamento com rubricas variáveis.',
        checklist: [
          { item: '1. Modelo cadastrado com a mesma estrutura de linhas?', status: 'pendente' },
          { item: '2. Cliente existente no cadastro do G-Click?', status: clienteOk ? 'ok' : 'pendente' },
          { item: '3. Tarefa da competência gerada?', status: compOk ? 'ok' : 'pendente' }
        ]
      };
    } else if (!clienteOk) {
      status = 'cliente_invalido';
      mensagem = expectedCnpj || expectedCpf
        ? 'Opa, parece que o arquivo não corresponde à este cliente, tente novamente com o arquivo correto!'
        : 'Nenhum CNPJ, CNPJ Base ou CPF foi identificado no documento.';
      diagnosticoGclick = {
        tipo: 'erro_2_cliente',
        tipoErro: 'erro_2_cliente_nao_encontrado',
        titulo: 'Erro 2 (G-Click): Cliente não encontrado na base',
        acaoRecomendada: expectedCnpj || expectedCpf
          ? 'O CNPJ/CPF lido no documento diverge do cliente da tarefa ativa.'
          : 'O documento não contém CNPJ/CPF impresso ou o cliente não existe na conta ativa do G-Click. Para documentos sem CNPJ (ex.: recibos internos), utilize a validação por "Campo Adicional" (código ERP ou Inscrição Estadual/Municipal) cadastrado no cliente.',
        checklist: [
          { item: '1. Modelo cadastrado com a mesma estrutura de linhas?', status: 'ok' },
          { item: '2. Cliente existente no cadastro do G-Click?', status: 'pendente' },
          { item: '3. Tarefa da competência gerada?', status: compOk ? 'ok' : 'pendente' }
        ]
      };
    } else if (!compOk) {
      status = 'competencia_invalida';
      mensagem = expectedCompetencia
        ? 'Opa, parece que o arquivo não corresponde à está competência, tente novamente com o arquivo correto!'
        : 'Nenhuma competência (referência/apuração) identificada no documento.';
      diagnosticoGclick = {
        tipo: 'erro_3_tarefa',
        tipoErro: 'erro_3_tarefa_nao_encontrada',
        titulo: 'Erro 3 (G-Click): Tarefa ou competência não encontrada',
        acaoRecomendada: expectedCompetencia
          ? `A competência lida no documento (${comp.competenciaPrincipal || '--'}) diverge da competência esperada (${expectedCompetencia}).`
          : 'A competência do documento não foi identificada ou a tarefa correspondente a esta competência ainda não foi gerada no G-Click.',
        checklist: [
          { item: '1. Modelo cadastrado com a mesma estrutura de linhas?', status: 'ok' },
          { item: '2. Cliente existente no cadastro do G-Click?', status: 'ok' },
          { item: '3. Tarefa da competência gerada?', status: 'pendente' }
        ]
      };
    }

    // Normalização do checklist com formato estruturado de 3 perguntas
    diagnosticoGclick.checklist3Perguntas = (diagnosticoGclick.checklist || []).map(c => ({
      pergunta: c.item,
      resposta: c.status === 'ok' ? 'Identificado e validado com sucesso' : 'Pendente de validação ou não encontrado',
      ok: c.status === 'ok'
    }));

    // Sugestão de Anexo por Nome para documentos com variação mensal de linhas (Folhas, Recibos, Holerites)
    const docNome = doc.documentoIdentificado || fileName;
    if (/folha|holerite|recibo|pró-labore|adiantamento|salário/i.test(docNome)) {
      const cliIdent = cliente.cnpjs[0] || cliente.cpfs[0] || '17.308.338/0001-08';
      const cComp = comp.competenciaPrincipal ? comp.competenciaPrincipal.replace('/', '.') : '09.2026';
      diagnosticoGclick.sugestaoAnexoPorNome = {
        motivo: 'Documentos de folha e recibos sofrem alterações mensais de linhas (entradas/saídas de horas extras, adicionais e descontos). O recurso "Anexo por Nome" do G-Click permite vincular o arquivo pelo nome sem depender da estrutura interna de linhas.',
        exemploNome: `${docNome.replace(/\//g, '-')} - ${cliIdent} - ${cComp}.pdf`
      };
    }

    return {
      fileName,
      filePath,
      valido,
      status,
      mensagem,
      totalLines,
      anexoPorNome,
      diagnosticoGclick,
      regras: {
        extracaoTexto: {
          ok: true,
          caracteres: rawText.length,
          linhas: totalLines
        },
        identificacaoCliente: {
          ok: clienteOk,
          correspondeEsperado: clienteMatch,
          cnpjs: cliente.cnpjs,
          cnpjsBase: cliente.cnpjsBase,
          cpfs: cliente.cpfs,
          razaoSocial: cliente.razaoSocial,
          linha: cliente.linhaCliente,
          linhaCliente: cliente.linhaCliente
        },
        competencia: {
          ok: compOk,
          correspondeEsperado: compMatch,
          competenciaDetectada: comp.competenciaPrincipal,
          candidatos: comp.candidatos,
          linha: comp.candidatos[0]?.linha || null,
          linhaCompetencia: comp.candidatos[0]?.linha || null
        },
        nomeDocumento: {
          ok: docOk,
          identificado: doc.documentoIdentificado,
          modelosCompativeis: doc.modelosCompativeis,
          linha: doc.linhaIdentificada,
          linhaIdentificada: doc.linhaIdentificada
        }
      }
    };
  } catch (error) {
    return {
      fileName,
      filePath,
      valido: false,
      status: 'erro_processamento',
      mensagem: `Falha ao processar arquivo: ${error.message}`,
      regras: {
        extracaoTexto: { ok: false, erro: error.message },
        identificacaoCliente: { ok: false },
        competencia: { ok: false },
        nomeDocumento: { ok: false }
      }
    };
  }
}

/**
 * Sincroniza a lista de modelos de PDF Layout do G-Click da conta informada
 * @param {object} loginContext - Playwright BrowserContext ativo
 * @param {string|number} accountId - ID da empresa (ex: 6019)
 * @param {string} cacheDir - Diretório para salvar o cache JSON
 */
export async function syncGclickPdfModels(loginContext, accountId, cacheDir = null) {
  if (!loginContext) {
    throw new Error('Sessão no G-Click não conectada. Conecte a sessão na seção Conexão G-Click.');
  }

  const page = await loginContext.newPage();
  try {
    const targetUrl = `https://app.gclick.com.br/configuracaoListar.do?obj=pdflayoutopen&tipo=0&empId=${encodeURIComponent(accountId)}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const models = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 4) return null;
        const link = tr.querySelector('a[href*="id="]');
        let modelId = null;
        if (link) {
          const m = link.href.match(/id=(\d+)/);
          if (m) modelId = m[1];
        }
        return {
          num: tds[0]?.innerText.trim(),
          departamento: tds[1]?.innerText.trim(),
          modelo: tds[2]?.innerText.trim(),
          status: tds[3]?.innerText.trim(),
          modelId,
          link: link?.href || null
        };
      }).filter(Boolean);
    });

    if (cacheDir && models.length > 0) {
      await fs.mkdir(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, `pdf-models-${accountId}.json`);
      await fs.writeFile(cacheFile, JSON.stringify(models, null, 2), 'utf8');
    }

    return models;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Inspeciona as telas do G-Click para identificar a área de dropzone/upload do ValidaPDF
 */
export async function inspectGclickValidaPdfScreen(loginContext, accountId) {
  if (!loginContext) throw new Error('Sessão no G-Click não conectada.');
  const page = await loginContext.newPage();
  try {
    const urlsToInspect = [
      `https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=646&empId=${encodeURIComponent(accountId)}`,
      `https://app.gclick.com.br/configuracaoListar.do?obj=pdflayoutopen&tipo=0&empId=${encodeURIComponent(accountId)}`
    ];

    const results = {};
    for (const u of urlsToInspect) {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const data = await page.evaluate(() => {
        const formInputs = Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
          tag: el.tagName,
          id: el.id,
          name: el.name,
          type: el.type,
          value: el.value,
          visible: el.offsetParent !== null
        }));

        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
          id: el.id,
          name: el.name,
          accept: el.accept,
          visible: el.offsetParent !== null,
          parentTag: el.parentElement?.tagName,
          parentId: el.parentElement?.id,
          parentClass: el.parentElement?.className
        }));

        const dropzones = Array.from(document.querySelectorAll('[class*="drop"], [class*="upload"], [id*="drop"], [id*="upload"], [class*="valida"], [id*="valida"], [class*="anex"], [id*="anex"]')).map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          text: el.innerText ? el.innerText.trim().slice(0, 100) : '',
          visible: el.offsetParent !== null
        }));

        const actionButtons = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]')).map(el => ({
          tag: el.tagName,
          id: el.id,
          text: el.innerText?.trim() || el.value || '',
          href: el.href || '',
          onclick: el.getAttribute('onclick') || ''
        })).filter(b => b.text && !/sair|ajuda|manual|suporte/i.test(b.text));

        const menuLinks = Array.from(document.querySelectorAll('#side-menu a, .navbar a, .metismenu a')).map(a => ({
          text: a.innerText?.trim() || '',
          href: a.href || ''
        })).filter(a => a.href && !a.href.endsWith('#') && a.text);

        const tableRows = Array.from(document.querySelectorAll('table tbody tr')).slice(0, 3).map(tr => {
          const btns = Array.from(tr.querySelectorAll('button, a, i')).map(el => ({
            tag: el.tagName,
            text: el.innerText?.trim() || '',
            className: el.className,
            title: el.getAttribute('title') || '',
            onclick: el.getAttribute('onclick') || '',
            href: el.getAttribute('href') || ''
          }));
          return { text: tr.innerText.slice(0, 60), btns };
        });

        return {
          title: document.title,
          url: window.location.href,
          menuLinks,
          formInputs: formInputs.slice(0, 30),
          fileInputs,
          tableRows,
          dropzones: dropzones.slice(0, 20),
          actionButtons: actionButtons.slice(0, 30)
        };
      });
      results[u] = data;
    }
    return results;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Executa a validação de um PDF diretamente no motor de telas do G-Click via Playwright
 */
export async function validatePdfOnGclickScreen(loginContext, accountId, options = {}) {
  if (!loginContext) {
    throw new Error('Sessão no G-Click não conectada. Conecte a sessão na seção "Conexão G-Click" antes de validar.');
  }

  const { filePath, modelId } = options;
  if (!filePath) {
    throw new Error('Caminho do arquivo (filePath) é obrigatório para validação no G-Click.');
  }

  const page = await loginContext.newPage();
  try {
    // 1. Navega para a tela de PDF Layouts no G-Click
    let targetUrl = `https://app.gclick.com.br/configuracaoListar.do?obj=pdflayoutopen&tipo=0&empId=${encodeURIComponent(accountId)}`;
    if (modelId) {
      targetUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=${encodeURIComponent(modelId)}&empId=${encodeURIComponent(accountId)}`;
    }

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Abre o modal de testar validação (#dialogovalidar)
    await page.evaluate(() => {
      if (typeof window.$ === 'function') {
        window.$('#dialogovalidar').modal('show');
      } else {
        const d = document.getElementById('dialogovalidar');
        if (d) {
          d.style.display = 'block';
          d.classList.add('in');
        }
      }
    });
    await page.waitForTimeout(1000);

    // 3. Localiza o input de arquivo do Dropzone e faz o upload do arquivo
    const fileInput = await page.$('#anexararquivov input[type="file"]') ||
                      await page.$('.dz-hidden-input') ||
                      await page.$('input[type="file"]');

    if (!fileInput) {
      throw new Error('Elemento de upload do ValidaPDF não foi encontrado na tela do G-Click.');
    }

    await fileInput.setInputFiles(filePath);
    await page.waitForTimeout(3000); // Aguarda upload do dropzone

    // 4. Clica no botão "Testar" (#btnsalvarvalidacao)
    const testBtn = await page.$('#btnsalvarvalidacao');
    if (testBtn) {
      await testBtn.click();
    } else {
      await page.evaluate(() => {
        if (typeof window.validarModelo === 'function') {
          window.validarModelo('pdflvalidar');
        }
      });
    }

    // 5. Aguarda conclusão do teste na div #viewvalidacao (máx 15s)
    let tentativas = 0;
    let resultadoHtml = '';
    let resultadoTexto = '';

    while (tentativas < 15) {
      tentativas++;
      await page.waitForTimeout(1000);
      const viewData = await page.evaluate(() => {
        const v = document.getElementById('viewvalidacao');
        const spinner = document.getElementById('progressvalidacao');
        const isSpinning = spinner && spinner.style.display !== 'none' && spinner.offsetParent !== null;
        return {
          text: v ? v.innerText.trim() : '',
          html: v ? v.innerHTML.trim() : '',
          isSpinning
        };
      });

      if (viewData.text && !viewData.isSpinning) {
        resultadoHtml = viewData.html;
        resultadoTexto = viewData.text;
        break;
      }
    }

    if (!resultadoTexto) {
      resultadoTexto = await page.evaluate(() => {
        const v = document.getElementById('viewvalidacao');
        return v ? v.innerText.trim() : 'Nenhum retorno recebido da tela de teste do G-Click.';
      });
    }

    const parsedGclick = parseGclickValidationHtml(resultadoHtml || resultadoTexto);
    const sucesso = parsedGclick ? parsedGclick.valido : (
      /conforme|sucesso|válido|validação realizada|ok/i.test(resultadoTexto) &&
      !/não encontrado|erro|inconsistente|divergência|inválid/i.test(resultadoTexto)
    );

    return {
      ok: true,
      validoGclick: sucesso,
      parsedGclick,
      retornoTexto: resultadoTexto,
      retornoHtml: resultadoHtml,
      targetUrl,
      fileName: path.basename(filePath),
      modelId: modelId || null,
      timestamp: new Date().toISOString()
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Realiza o parsing estruturado do HTML retornado pelo modal de validação do G-Click
 * Avalia os 3 pilares oficiais: Dados Fixos (Obrigação), Inscrição (Cliente) e Competência.
 * @param {string} html - HTML ou texto contido na div #viewvalidacao
 */
export function parseGclickValidationHtml(html) {
  if (!html || typeof html !== 'string') return null;

  const isDanger = /alert-danger|fa-times|inválid|erro/i.test(html);
  const items = [];

  // 1. Tenta extrair elementos estruturados das divs com ícones e negrito
  const regexDivs = /<div[^>]*>\s*<i\s+class="fa\s+([^"]+)"[^>]*><\/i>\s*<b>([^<]+)<\/b>\s*([^<]*)<\/div>/gi;
  let match;
  while ((match = regexDivs.exec(html)) !== null) {
    const iconClass = match[1];
    const rawLabel = match[2].trim().replace(/:$/, '');
    const val = match[3].trim();
    const isOk = /fa-check/i.test(iconClass) && !/inválid|erro/i.test(rawLabel);
    items.push({
      label: rawLabel,
      valor: val,
      textoCompleto: val ? `${rawLabel}: ${val}` : rawLabel,
      status: isOk ? 'ok' : 'erro'
    });
  }

  // 2. Fallback por regex textual caso o HTML venha limpo ou em texto puro
  if (items.length === 0) {
    const lines = html.replace(/<[^>]+>/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of lines) {
      if (/dados fixos/i.test(l)) {
        const isOk = /válid/i.test(l) && !/inválid/i.test(l);
        items.push({ label: 'Dados fixos', valor: l, textoCompleto: l, status: isOk ? 'ok' : 'erro' });
      } else if (/inscrição|cnpj|cpf/i.test(l)) {
        const isOk = /válid/i.test(l) && !/inválid|não encontrada/i.test(l);
        items.push({ label: 'Inscrição', valor: l, textoCompleto: l, status: isOk ? 'ok' : 'erro' });
      } else if (/competência/i.test(l)) {
        const isOk = /válid/i.test(l) && !/inválid|não encontrada/i.test(l);
        items.push({ label: 'Competência', valor: l, textoCompleto: l, status: isOk ? 'ok' : 'erro' });
      }
    }
  }

  // Mapeamento dos 3 pilares
  const dadosFixosItem = items.find(i => /dados fixos|obrigação/i.test(i.label)) || null;
  const inscricaoItem = items.find(i => /inscrição|cliente|cnpj|cpf/i.test(i.label)) || null;
  const competenciaItem = items.find(i => /competência|referência/i.test(i.label)) || null;

  const valido = !isDanger && items.length > 0 && items.every(i => i.status === 'ok');

  let diagnostico = 'Validação 100% conforme no motor oficial do G-Click.';
  if (!valido) {
    if (dadosFixosItem && dadosFixosItem.status === 'erro') {
      diagnostico = 'O G-Click não encontrou a palavra-chave/obrigação na linha esperada por este modelo. A estrutura interna do PDF divergiu do modelo.';
    } else if (inscricaoItem && inscricaoItem.status === 'erro') {
      diagnostico = 'A inscrição (CNPJ/CPF) não foi encontrada na linha esperada pelo modelo do G-Click.';
    } else if (competenciaItem && competenciaItem.status === 'erro') {
      diagnostico = 'A competência não foi localizada na linha esperada pelo modelo do G-Click.';
    } else {
      diagnostico = 'Inconsistência identificada pelo motor do G-Click durante a validação.';
    }
  }

  return {
    valido,
    items,
    pilares: {
      dadosFixos: dadosFixosItem,
      inscricao: inscricaoItem,
      competencia: competenciaItem
    },
    diagnostico
  };
}

/**
 * Gera um documento estruturado de diagnóstico e auditoria de validação de PDFs
 * Informa em detalhes as falhas, qual é o documento, sua localização física e plano de ação.
 * @param {Array} validations - Lista de resultados de validatePdfFile
 * @param {object} options - Opções adicionais (targetDir, accountId, accountName, format)
 */
export function generateValidationDiagnosticReport(validations = [], options = {}) {
  const targetDir = options.targetDir || 'Diretório não especificado';
  const accountId = options.accountId || '6019';
  const accountName = options.accountName || 'CONTABILIDADE MAGNUM LTDA';
  const dataGeracao = new Date().toLocaleString('pt-BR');

  const total = validations.length;
  const validos = validations.filter(v => v.valido).length;
  const inconsistentes = validations.filter(v => !v.valido).length;
  const taxaConformidade = total > 0 ? ((validos / total) * 100).toFixed(1) : '0.0';

  const semTextoOcr = validations.filter(v => v.status === 'erro_extracao').length;
  const clienteInvalido = validations.filter(v => v.status === 'cliente_invalido').length;
  const compInvalida = validations.filter(v => v.status === 'competencia_invalida').length;
  const docDesconhecido = validations.filter(v => v.status === 'documento_desconhecido').length;

  const falhas = validations.filter(v => !v.valido).map((v, idx) => {
    let motivoFalha = 'Inconsistência geral';
    let classificacao = 'Erro';

    if (v.status === 'erro_extracao') {
      motivoFalha = 'Arquivo digitalizado / Imagem sem camada de texto selecionável (Requer OCR)';
      classificacao = 'Sem Camada OCR';
    } else if (v.status === 'cliente_invalido') {
      motivoFalha = 'Cliente não encontrado: Nenhum CNPJ, CNPJ Base ou CPF localizado no cabeçalho ou texto';
      classificacao = 'Erro 2 (Cliente)';
    } else if (v.status === 'competencia_invalida') {
      motivoFalha = 'Competência não identificada no formato MM/AAAA ou mês por extenso';
      classificacao = 'Erro 3 (Competência)';
    } else if (v.status === 'documento_desconhecido') {
      motivoFalha = 'Estrutura de linhas ou palavra-chave não coincide com os modelos do G-Click';
      classificacao = 'Erro 1 (Modelo)';
    }

    return {
      num: idx + 1,
      fileName: v.fileName || 'arquivo.pdf',
      documentoIdentificado: v.regras?.nomeDocumento?.identificado || 'Não identificado',
      modeloVinculado: v.regras?.nomeDocumento?.modelosCompativeis?.[0]?.nome || null,
      modeloId: v.regras?.nomeDocumento?.modelosCompativeis?.[0]?.id || null,
      filePath: v.filePath || 'Caminho não disponível',
      relPath: v.relPath || v.fileName,
      subpasta: v.subpasta || (v.relPath && v.relPath.includes('/') ? v.relPath.substring(0, v.relPath.lastIndexOf('/')) : 'Raiz'),
      status: v.status,
      classificacao,
      motivoFalha,
      mensagem: v.mensagem || '',
      tituloDiagnostico: v.diagnosticoGclick?.titulo || 'Pendência de Validação',
      acaoRecomendada: v.diagnosticoGclick?.acaoRecomendada || 'Revisar arquivo e modelo no G-Click.',
      checklist: v.diagnosticoGclick?.checklist3Perguntas || [],
      sugestaoAnexoPorNome: v.diagnosticoGclick?.sugestaoAnexoPorNome || null
    };
  });

  const format = options.format || 'html';

  if (format === 'json') {
    return {
      metadados: {
        titulo: 'Relatório de Diagnóstico e Auditoria de PDF Layout',
        empresa: accountName,
        accountId,
        targetDir,
        dataGeracao,
        resumo: {
          total,
          validos,
          inconsistentes,
          taxaConformidade: `${taxaConformidade}%`,
          semTextoOcr,
          clienteInvalido,
          compInvalida,
          docDesconhecido
        }
      },
      falhas,
      inventario: validations.map(v => ({
        fileName: v.fileName,
        filePath: v.filePath,
        relPath: v.relPath,
        subpasta: v.subpasta,
        valido: v.valido,
        status: v.status,
        documento: v.regras?.nomeDocumento?.identificado || null,
        cliente: v.regras?.identificacaoCliente?.cnpjs?.[0] || v.regras?.identificacaoCliente?.cpfs?.[0] || null,
        competencia: v.regras?.competencia?.competenciaDetectada || null
      }))
    };
  }

  if (format === 'markdown') {
    let md = `# Relatório de Diagnóstico e Auditoria de PDF Layout\n\n`;
    md += `**Empresa:** ${accountName} (Conta ${accountId})  \n`;
    md += `**Diretório Auditado:** \`${targetDir}\`  \n`;
    md += `**Data da Auditoria:** ${dataGeracao}  \n\n`;
    md += `## Sumário Executivo\n\n`;
    md += `- **Total de Arquivos:** ${total}\n`;
    md += `- **100% Válidos e Conformes:** ${validos} (${taxaConformidade}%)\n`;
    md += `- **Arquivos com Pendências/Inconsistentes:** ${inconsistentes}\n`;
    md += `- **Sem Camada OCR (Digitalizados):** ${semTextoOcr}\n`;
    md += `- **Cliente Não Identificado:** ${clienteInvalido}\n\n`;

    if (falhas.length > 0) {
      md += `## Detalhamento das Falhas e Plano de Ação (#VOCEPODE)\n\n`;
      falhas.forEach(f => {
        md += `### ${f.num}. ${f.fileName} [${f.classificacao}]\n`;
        md += `- **Documento Identificado:** ${f.documentoIdentificado}\n`;
        md += `- **Onde está (Caminho Físico):** \`${f.filePath}\`\n`;
        md += `- **Subpasta:** \`${f.subpasta}\`\n`;
        md += `- **Falha Técnica:** ${f.motivoFalha}\n`;
        md += `- **Ação Corretiva:** ${f.acaoRecomendada}\n`;
        if (f.sugestaoAnexoPorNome) {
          md += `- **💡 Sugestão de Anexo por Nome:** \`${f.sugestaoAnexoPorNome.exemploNome}\`\n`;
        }
        md += `\n`;
      });
    }

    return md;
  }

  // Formato HTML profissional e imprimível
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Diagnóstico de Validação de PDFs - ${accountName}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      background: #f8fafc;
      margin: 0;
      padding: 30px;
      line-height: 1.5;
    }
    .report-container {
      max-width: 1040px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 36px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      border-bottom: 2px solid #0f766e;
      padding-bottom: 18px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header h1 {
      margin: 0 0 6px 0;
      font-size: 22px;
      color: #0f766e;
      font-weight: 700;
    }
    .header p {
      margin: 0;
      color: #64748b;
      font-size: 13px;
    }
    .meta-box {
      background: #f1f5f9;
      padding: 14px 18px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 13px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 10px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .kpi-card {
      padding: 14px;
      border-radius: 8px;
      text-align: center;
      border: 1px solid #e2e8f0;
    }
    .kpi-card.total { background: #f8fafc; border-color: #cbd5e1; }
    .kpi-card.valid { background: #f0fdf4; border-color: #86efac; color: #166534; }
    .kpi-card.invalid { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
    .kpi-card.rate { background: #f0fdfa; border-color: #99f6e4; color: #0f766e; }
    .kpi-val { font-size: 24px; font-weight: 700; display: block; margin-top: 4px; }
    .kpi-lbl { font-size: 11.5px; font-weight: 600; text-transform: uppercase; color: #64748b; }
    
    h2 { font-size: 17px; color: #0f172a; margin: 28px 0 14px 0; border-left: 4px solid #0f766e; padding-left: 10px; }
    
    .fail-card {
      border: 1px solid #fecaca;
      background: #fffafa;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .fail-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      border-bottom: 1px solid #fee2e2;
      padding-bottom: 8px;
    }
    .fail-title { font-size: 15px; font-weight: 700; color: #991b1b; margin: 0; }
    .fail-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }
    .location-box {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: #334155;
      margin: 8px 0 12px 0;
      word-break: break-all;
    }
    .action-box {
      background: #ecfeff;
      border-left: 3px solid #06b6d4;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 12.5px;
      color: #0e7490;
      margin-top: 10px;
    }
    table.inventory {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 12px;
    }
    table.inventory th, table.inventory td {
      border: 1px solid #e2e8f0;
      padding: 8px 10px;
      text-align: left;
    }
    table.inventory th { background: #f8fafc; font-weight: 600; color: #475569; }
    table.inventory tr:nth-child(even) { background: #f8fafc; }
    
    .print-bar {
      margin-bottom: 20px;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .btn {
      background: #0f766e;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .report-container { border: none; box-shadow: none; padding: 0; }
      .print-bar { display: none; }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="print-bar">
      <button class="btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    </div>

    <div class="header">
      <div>
        <h1>Diagnóstico & Auditoria de Validação de PDFs</h1>
        <p>G-Click Automação · Mapeamento de Layouts & Diretrizes #VOCEPODE Omie</p>
      </div>
      <div style="text-align:right;">
        <span style="font-weight:700;color:#0f766e;font-size:15px;">${accountName}</span><br>
        <span style="font-size:12px;color:#64748b;">ID da Empresa: ${accountId}</span>
      </div>
    </div>

    <div class="meta-box">
      <div><strong>📁 Diretório Auditado:</strong> <code>${targetDir}</code></div>
      <div><strong>📅 Data da Auditoria:</strong> ${dataGeracao}</div>
      <div><strong>🔍 Escopo:</strong> Varredura recursiva completa de PDFs</div>
      <div><strong>🏢 Escritório:</strong> ${accountName}</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card total">
        <span class="kpi-lbl">Total de PDFs</span>
        <span class="kpi-val">${total}</span>
      </div>
      <div class="kpi-card valid">
        <span class="kpi-lbl">100% Válidos</span>
        <span class="kpi-val">${validos}</span>
      </div>
      <div class="kpi-card invalid">
        <span class="kpi-lbl">Inconsistentes</span>
        <span class="kpi-val">${inconsistentes}</span>
      </div>
      <div class="kpi-card rate">
        <span class="kpi-lbl">Taxa de Conformidade</span>
        <span class="kpi-val">${taxaConformidade}%</span>
      </div>
    </div>

    <h2>🚨 Detalhamento das Falhas de Validação (${falhas.length} arquivos com pendência)</h2>
    ${falhas.length === 0 ? `
      <div style="background:#f0fdf4;border:1px solid #86efac;padding:16px;border-radius:8px;color:#166534;">
        ✔ <strong>Parabéns!</strong> Todos os ${total} documentos PDF desta pasta estão 100% conformes com as regras e modelos cadastrados no G-Click.
      </div>
    ` : falhas.map(f => `
      <div class="fail-card">
        <div class="fail-header">
          <h3 class="fail-title">${f.num}. ${f.fileName}</h3>
          <span class="fail-badge">${f.classificacao}</span>
        </div>
        
        <div style="font-size:13px;margin-bottom:6px;">
          <strong>📄 Qual é o documento:</strong> ${f.documentoIdentificado}
          ${f.modeloVinculado ? `(Modelo G-Click: <em>${f.modeloVinculado}</em> - ID ${f.modeloId})` : ''}
        </div>

        <div style="font-size:13px;margin-bottom:4px;">
          <strong>📍 Onde ele está:</strong> Subpasta <code>${f.subpasta}</code>
        </div>
        <div class="location-box">${f.filePath}</div>

        <div style="font-size:13px;color:#991b1b;margin-bottom:8px;">
          <strong>❌ Motivo da Falha:</strong> ${f.motivoFalha}
        </div>

        <div class="action-box">
          <strong>🛠️ Ação Recomendada (#VOCEPODE Omie):</strong><br>
          ${f.acaoRecomendada}
          ${f.sugestaoAnexoPorNome ? `
            <div style="margin-top:6px;font-family:monospace;font-size:11.5px;color:#0f766e;">
              Padrão sugerido: ${f.sugestaoAnexoPorNome.exemploNome}
            </div>
          ` : ''}
        </div>
      </div>
    `).join('')}

    <h2>📑 Inventário Completo de Documentos (${total} arquivos)</h2>
    <table class="inventory">
      <thead>
        <tr>
          <th>#</th>
          <th>Arquivo</th>
          <th>Subpasta</th>
          <th>Documento Identificado</th>
          <th>Cliente (CNPJ/CPF)</th>
          <th>Competência</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${validations.map((v, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${v.fileName}</strong></td>
            <td><code>${v.subpasta || '-'}</code></td>
            <td>${v.regras?.nomeDocumento?.identificado || '<span style="color:#94a3b8;">--</span>'}</td>
            <td>${v.regras?.identificacaoCliente?.cnpjs?.[0] || v.regras?.identificacaoCliente?.cpfs?.[0] || '<span style="color:#94a3b8;">--</span>'}</td>
            <td>${v.regras?.competencia?.competenciaDetectada || '<span style="color:#94a3b8;">--</span>'}</td>
            <td>
              <span style="font-weight:600;color:${v.valido ? '#166534' : '#991b1b'}">
                ${v.valido ? '✔ Válido' : '⚠️ Inconsistente'}
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:14px;font-size:11.5px;color:#94a3b8;display:flex;justify-content:space-between;">
      <span>G-Click Automação · Módulo Valida PDF</span>
      <span>Documento gerado em ${dataGeracao}</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Autodetecta os 3 pilares do G-Click em um PDF (Modo Raw idêntico ao G-Click):
 * 1. Palavra-chave ou código para identificar a Obrigação
 * 2. Inscrição ou campo adicional para identificar o cliente (CNPJ/CPF)
 * 3. Competência da obrigação (Ordem Mês/Ano ou Ano/Mês)
 * @param {string} pdfPath - Caminho do arquivo
 * @param {object} options - Opções (ex.: modelo prévio, departamento)
 */
export async function autoDetectPdfMapping(pdfPath, options = {}) {
  const fileName = path.basename(pdfPath);
  const extraction = await extractPdfText(pdfPath, { mode: 'raw' });
  const lines = extraction.lines;

  // 1. Detecção do Pilar 1: Palavra-chave da Obrigação
  // Títulos estruturais fixos do documento têm prioridade sobre rubricas de eventos
  let pilar1 = null;
  const obrigacaoCandidates = [
    { regex: /RECIBO\s+DE\s+PAGAMENTO/i, nome: 'RECIBO DE PAGAMENTO' },
    { regex: /RECIBO\s+DE\s+PR[ÓO]-LABORE/i, nome: 'RECIBO DE PRO-LABORE' },
    { regex: /DOCUMENTO\s+DE\s+ARRECADA[ÇC][ÃA]O\s+DE\s+RECEITAS\s+FEDERAIS|DARF/i, nome: 'DARF DCTFWeb' },
    { regex: /GUIA\s+DO\s+FGTS\s+DIGITAL|GFD/i, nome: 'GFD - Guia do FGTS Digital' },
    { regex: /DOCUMENTO\s+DE\s+ARRECADA[ÇC][ÃA]O\s+DO\s+ESOCIAL|DAE\s+ESOCIAL/i, nome: 'DAE eSocial Doméstica' },
    { regex: /eSocial|Demonstrativo\s+dos\s+Valores\s+Devidos/i, nome: 'eSocial' },
    { regex: /RELA[ÇC][ÃA]O\s+GERAL\s+DOS\s+L[ÍI]QUIDOS|L[ÍI]QUIDOS/i, nome: 'Relação de Líquidos' },
    { regex: /C[ÁA]LCULO\s+DE\s+M[ÉE]DIAS/i, nome: 'Cálculo de Médias' },
    { regex: /13\s+SALARIO\s+ADIANTADO/i, nome: '13 SALARIO ADIANTADO' }
  ];

  for (const cand of obrigacaoCandidates) {
    const matchLine = lines.find(l => {
      // Se for rubrica salarial e a linha estiver no miolo de tabela de rendimentos/descontos (com códigos ou valores), evitar para não colidir com 'dados fixos'
      if (cand.nome === '13 SALARIO ADIANTADO' && lines.some(other => /RECIBO\s+DE\s+PAGAMENTO/i.test(other.text))) {
        return false;
      }
      return cand.regex.test(l.text);
    });
    if (matchLine) {
      const m = matchLine.text.match(cand.regex);
      pilar1 = {
        linha: matchLine.lineNumber,
        textoCompleto: matchLine.text,
        termoMapeado: m ? m[0] : matchLine.text,
        nomeSugerido: cand.nome
      };
      break;
    }
  }

  // Fallback Pilar 1 caso não case com padrões conhecidos
  if (!pilar1) {
    const firstWordyLine = lines.find(l => l.text.length > 5 && !/^\d+$/.test(l.text) && !/cnpj|cpf/i.test(l.text));
    if (firstWordyLine) {
      pilar1 = {
        linha: firstWordyLine.lineNumber,
        textoCompleto: firstWordyLine.text,
        termoMapeado: firstWordyLine.text,
        nomeSugerido: 'Documento'
      };
    }
  }

  // 2. Detecção do Pilar 2: Inscrição do Cliente (CNPJ / CPF)
  let pilar2 = null;

  // A. Busca CNPJ mascarado
  const cnpjLine = lines.find(l => CNPJ_REGEX.test(l.text));
  if (cnpjLine) {
    CNPJ_REGEX.lastIndex = 0;
    const m = cnpjLine.text.match(CNPJ_REGEX);
    pilar2 = {
      tipo: 'CNPJ',
      linha: cnpjLine.lineNumber,
      textoCompleto: cnpjLine.text,
      valor: m ? m[0] : cnpjLine.text,
      opcao: '1'
    };
  }

  // B. Busca CPF no bloco de EMPREGADOR (documentos domésticos / eSocial)
  if (!pilar2) {
    const empIdx = lines.findIndex(l => /EMPREGADOR/i.test(l.text));
    if (empIdx !== -1) {
      const endIdx = lines.findIndex((l, idx) => idx > empIdx && /EMPREGADO/i.test(l.text));
      const slice = lines.slice(empIdx, endIdx !== -1 ? endIdx : empIdx + 8);
      for (const l of slice) {
        const mMask = l.text.match(CPF_REGEX);
        if (mMask && isValidCpf(mMask[0])) {
          pilar2 = {
            tipo: 'CPF',
            linha: l.lineNumber,
            textoCompleto: l.text,
            valor: mMask[0],
            opcao: '1'
          };
          break;
        }
        const mDigits = l.text.match(/\b\d{11}\b/);
        if (mDigits && isValidCpf(mDigits[0])) {
          pilar2 = {
            tipo: 'CPF',
            linha: l.lineNumber,
            textoCompleto: l.text,
            valor: mDigits[0],
            opcao: '1'
          };
          break;
        }
      }
    }
  }

  // C. Busca CPF mascarado em qualquer linha
  if (!pilar2) {
    const cpfLine = lines.find(l => {
      CPF_REGEX.lastIndex = 0;
      const m = l.text.match(CPF_REGEX);
      return m && isValidCpf(m[0]);
    });
    if (cpfLine) {
      CPF_REGEX.lastIndex = 0;
      const m = cpfLine.text.match(CPF_REGEX);
      pilar2 = {
        tipo: 'CPF',
        linha: cpfLine.lineNumber,
        textoCompleto: cpfLine.text,
        valor: m ? m[0] : cpfLine.text,
        opcao: '1'
      };
    }
  }

  // D. Busca CPF associado a rótulo 'CPF:' ou 'Inscrição:'
  if (!pilar2) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const inlineM = l.text.match(/(?:CPF|Inscri[çc][ãa]o)[^\d]*(\d{11})\b/i);
      if (inlineM && isValidCpf(inlineM[1])) {
        pilar2 = {
          tipo: 'CPF',
          linha: l.lineNumber,
          textoCompleto: l.text,
          valor: inlineM[1],
          opcao: '1'
        };
        break;
      }
      if (/^\s*(?:CPF|Inscri[çc][ãa]o)\s*:?\s*$/i.test(l.text) && lines[i + 1]) {
        const nextDigits = lines[i + 1].text.match(/\b\d{11}\b/);
        if (nextDigits && isValidCpf(nextDigits[0])) {
          pilar2 = {
            tipo: 'CPF',
            linha: lines[i + 1].lineNumber,
            textoCompleto: lines[i + 1].text,
            valor: nextDigits[0],
            opcao: '1'
          };
          break;
        }
      }
    }
  }

  // E. Busca CPF puro de 11 dígitos válido em qualquer linha
  if (!pilar2) {
    for (const l of lines) {
      const m = l.text.match(/\b\d{11}\b/);
      if (m && isValidCpf(m[0])) {
        pilar2 = {
          tipo: 'CPF',
          linha: l.lineNumber,
          textoCompleto: l.text,
          valor: m[0],
          opcao: '1'
        };
        break;
      }
    }
  }

  // F. Busca CNPJ Base (8 dígitos, ex: FGTS Digital)
  if (!pilar2) {
    const baseLine = lines.find(l => CNPJ_BASE_REGEX.test(l.text));
    if (baseLine) {
      CNPJ_BASE_REGEX.lastIndex = 0;
      const m = baseLine.text.match(CNPJ_BASE_REGEX);
      pilar2 = {
        tipo: 'CNPJ Base',
        linha: baseLine.lineNumber,
        textoCompleto: baseLine.text,
        valor: m ? m[0] : baseLine.text,
        opcao: '1'
      };
    }
  }

  // 3. Detecção do Pilar 3: Competência da Obrigação
  let pilar3 = null;
  // Prioridade 1: Linha com 'Competência:' ou 'Período de Apuração:' explícita
  const compLineExplicit = lines.find(l => /compet[êe]ncia[\s:]+|per[íi]odo\s+de\s+apura[çc][ãa]o[\s:]+/i.test(l.text));
  const compLine = compLineExplicit || lines.find(l => {
    // Evita cabeçalhos de colunas como 'Código Descrição Referência Rendimentos'
    if (/c[óo]digo\s+descri[çc][ãa]o/i.test(l.text)) return false;
    return /compet[êe]ncia|apura[çc][ãa]o/i.test(l.text);
  });

  if (compLine) {
    let formatoData = 'mes_ano';
    const norm = normalizeCompetencia(compLine.text);
    if (/^\d{4}\/\d{2}$/.test(norm)) {
      formatoData = 'ano_mes';
    }

    // Extrai o trecho exato que representa a data na linha (ex: "Novembro/2025", "11/2025" ou "2025")
    let trechoExato = null;
    const extensoMatch = compLine.text.match(COMPETENCIA_EXTENSO_REGEX);
    if (extensoMatch) {
      trechoExato = extensoMatch[0];
    } else {
      COMPETENCIA_DATE_REGEX.lastIndex = 0;
      const numMatch = compLine.text.match(COMPETENCIA_DATE_REGEX);
      if (numMatch) {
        trechoExato = numMatch[0];
      } else {
        const anoMatch = compLine.text.match(/\b20\d\d\b/);
        if (anoMatch) {
          trechoExato = anoMatch[0];
          formatoData = 'ano';
        }
      }
    }

    if (trechoExato && /^\d{4}$/.test(trechoExato)) {
      formatoData = 'ano';
    }

    pilar3 = {
      linha: compLine.lineNumber,
      textoCompleto: compLine.text,
      trechoExato: trechoExato || norm,
      competenciaDetectada: trechoExato || norm,
      competenciaNormalizada: norm,
      formato: formatoData,
      formatoLabel: formatoData === 'ano' ? 'Ano' : (formatoData === 'mes_ano' ? 'Mês e ano' : 'Ano e mês')
    };
  } else {
    const dateLine = lines.find(l => COMPETENCIA_DATE_REGEX.test(l.text) || COMPETENCIA_EXTENSO_REGEX.test(l.text));
    if (dateLine) {
      let trecho = null;
      const extM = dateLine.text.match(COMPETENCIA_EXTENSO_REGEX);
      if (extM) {
        trecho = extM[0];
      } else {
        COMPETENCIA_DATE_REGEX.lastIndex = 0;
        const numM = dateLine.text.match(COMPETENCIA_DATE_REGEX);
        if (numM) trecho = numM[0];
      }

      pilar3 = {
        linha: dateLine.lineNumber,
        textoCompleto: dateLine.text,
        trechoExato: trecho,
        competenciaDetectada: trecho,
        competenciaNormalizada: normalizeCompetencia(trecho),
        formato: 'mes_ano',
        formatoLabel: 'Mês e ano'
      };
    }
  }

  // Identifica se é contracheque / holerite
  const multiLinhasRecomendado = /recibo|folha|holerite|pró-labore|salário/i.test(fileName) ||
                                 (pilar1 && /recibo|folha|holerite|salario/i.test(pilar1.termoMapeado));

  return {
    fileName,
    filePath: pdfPath,
    totalLines: lines.length,
    lines,
    pilares: {
      pilar1_obrigacao: pilar1,
      pilar2_cliente: pilar2,
      pilar3_competencia: pilar3
    },
    multiLinhas: multiLinhasRecomendado,
    prontoParaMapear: Boolean(pilar1 && pilar2 && pilar3)
  };
}

/**
 * Executa a criação e mapeamento de modelo de PDF Layout diretamente no G-Click via Playwright
 * @param {object} loginContext - Sessão ativa Playwright
 * @param {string|number} accountId - ID da empresa no G-Click
 * @param {object} params - Dados do modelo e mapeamento
 */
export async function createAndMapPdfLayoutOnGclick(loginContext, accountId, params = {}) {
  if (!loginContext) {
    throw new Error('Sessão no G-Click não conectada. Conecte a sessão antes de realizar o mapeamento.');
  }

  const {
    nomeModelo,
    departamentoNome = 'Departamento Pessoal',
    filePath,
    pilar1,
    pilar2,
    pilar3,
    multiLinhas = true,
    obrigacaoNome = null,
    onStep = null
  } = params;

  if (!nomeModelo) throw new Error('O nome do modelo é obrigatório.');
  if (!filePath) throw new Error('O caminho do arquivo PDF de modelo é obrigatório.');

  const page = await loginContext.newPage();
  let modelPage = null;
  const logs = [];

  try {
    const logStep = (step, msg, data = {}) => {
      const entry = { step, msg, time: new Date().toISOString(), ...data };
      logs.push(entry);
      if (typeof onStep === 'function') {
        try { onStep(entry); } catch {}
      }
    };

    logStep(1, `Acessando lista de modelos de PDF Layout na conta ${accountId}...`);
    const listUrl = `https://app.gclick.com.br/configuracaoListar.do?obj=pdflayoutopen&tipo=0&empId=${encodeURIComponent(accountId)}`;
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Clicar no botão "+ Criar Modelo"
    logStep(2, `Abrindo modal para criar modelo "${nomeModelo}"...`);
    const btnCriar = page.locator('button:has-text("Criar Modelo"), button[data-target="#dialogonovopdflayout"], a:has-text("Criar Modelo")').first();
    await btnCriar.waitFor({ state: 'visible', timeout: 15000 });
    await btnCriar.click();
    await page.waitForTimeout(1000);

    // 2. Preencher Nome no modal #dialogonovopdflayout
    const inputNome = page.locator('#novopdflnome, #dialogonovopdflayout input[type="text"]').first();
    await inputNome.waitFor({ state: 'visible', timeout: 10000 });
    await inputNome.fill(nomeModelo);

    // 3. Selecionar Departamento no dropdown #novodepartamento
    const selectDepto = page.locator('#novodepartamento, #dialogonovopdflayout select').first();
    if (await selectDepto.count() > 0) {
      try {
        await selectDepto.selectOption({ label: departamentoNome });
      } catch {
        // Fallback pelo label parcial ou primeiro departamento
        const options = await selectDepto.locator('option').all();
        let matched = false;
        for (const opt of options) {
          const text = (await opt.textContent() || '').trim();
          if (text.toLowerCase().includes(departamentoNome.toLowerCase())) {
            const val = await opt.getAttribute('value');
            if (val) {
              await selectDepto.selectOption(val);
              matched = true;
              break;
            }
          }
        }
        if (!matched && options.length > 1) {
          const val = await options[1].getAttribute('value');
          if (val) await selectDepto.selectOption(val);
        }
      }
    }

    // 4. Salvar modal e capturar a abertura da página do modelo
    logStep(3, 'Salvando novo modelo e abrindo página de configuração...');
    const btnSalvarModal = page.locator('#dialogonovopdflayout button:has-text("Salvar"), #dialogonovopdflayout .btn-primary').first();

    const popupPromise = page.context().waitForEvent('page', { timeout: 12000 }).catch(() => null);
    await btnSalvarModal.click();

    modelPage = await popupPromise;

    if (!modelPage) {
      await page.waitForTimeout(2500);
      const newId = await page.evaluate(() => {
        const resp = document.getElementById('resposta');
        if (resp && resp.value && resp.value.trim()) return resp.value.trim();
        const hidden = document.querySelector('#viewbranco input, input[name="id"]');
        return hidden && hidden.value ? hidden.value.trim() : null;
      });

      if (newId) {
        const modelUrl = `https://app.gclick.com.br/configuracaoAbrir.do?obj=pdflayoutopen&id=${encodeURIComponent(newId)}&empId=${encodeURIComponent(accountId)}`;
        await page.goto(modelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        modelPage = page;
      } else {
        const pages = page.context().pages();
        modelPage = pages[pages.length - 1];
      }
    }

    await modelPage.waitForLoadState('domcontentloaded').catch(() => {});
    await modelPage.waitForTimeout(2000);

    const layoutId = await modelPage.evaluate(() => document.getElementById('id')?.value || '');
    logStep(4, `Página do modelo aberta (ID: ${layoutId || 'desconhecido'}). Anexando arquivo PDF de modelo...`);

    // 5. Passo 1: Anexar arquivo PDF de modelo
    const fileInput = modelPage.locator('#anexararquivoa input[type="file"], .dropzone input[type="file"], input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
    await modelPage.waitForTimeout(4000);

    // Clicar em "Confirmar" no Passo 1
    const btnConfirmar = modelPage.locator('button:has-text("Confirmar"), button[onclick*="anexarModelo"]').first();
    if (await btnConfirmar.count() > 0) {
      await btnConfirmar.click();
      await modelPage.waitForTimeout(3000);
    }

    // Garantir transição para o Passo 2
    if (!modelPage.url().includes('paramaba=2')) {
      await modelPage.evaluate(() => {
        if (typeof window.proximoPassoPDFLayout === 'function') {
          window.proximoPassoPDFLayout('2');
        }
      }).catch(() => {});
    }
    await modelPage.waitForTimeout(2000);

    logStep(5, 'Passo 2 carregado. Mapeando sequencialmente os 3 pilares...');

    // 6. Passo 2: Mapeamento Sequencial dos 3 Pilares com Seleção Precisa
    const p1Linha = pilar1?.linha;
    const p1Texto = (pilar1?.texto || pilar1?.valor || '').trim();

    const p2Linha = pilar2?.linha;
    const p2Texto = (pilar2?.texto || pilar2?.valor || '').trim();

    const p3Linha = pilar3?.linha;
    const p3Texto = (pilar3?.texto || pilar3?.valor || pilar3?.exemplo || '').trim();
    const p3Formato = pilar3?.formato || 'mes_ano';

    async function salvarPilarGclick(num, nome, linha, texto, tipoFixo = null, formato = null) {
      return await modelPage.evaluate(async ({ num, nome, linha, texto, tipoFixo, formato, accountId }) => {
        const layoutId = document.getElementById('id')?.value;
        const empId = document.getElementById('empId')?.value || accountId;

        // Tenta descobrir o texto da linha se texto vier vazio
        let cleanTexto = (texto || '').trim();
        let lineEl = document.getElementById(linha) || document.getElementById(`l${linha}`) || document.querySelector(`tr:nth-child(${linha}) td:last-child`);
        const lineText = lineEl ? (lineEl.textContent || '').trim() : '';
        if (!cleanTexto && lineText) cleanTexto = lineText;

        // Se num == 2, seleciona a opção correta no dropdown #f2
        let tipo = tipoFixo;
        if (num === 2) {
          const selectF2 = document.getElementById('f2') || document.querySelector('#tab2 select, #viewcampos select');
          if (selectF2) {
            const cleanDigits = cleanTexto.replace(/\D/g, '');
            let found = false;
            for (let i = 0; i < selectF2.options.length; i++) {
              const opt = selectF2.options[i];
              const t = (opt.text || '').toLowerCase();
              if (cleanDigits.length === 8 && t.includes('raiz')) {
                selectF2.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              } else if (cleanDigits.length === 11 && t.includes('cpf')) {
                selectF2.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              } else if (cleanDigits.length === 14 && t.includes('cnpj') && !t.includes('raiz')) {
                selectF2.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              }
            }
            if (!found && selectF2.value) tipo = selectF2.value;
          }
          if (!tipo) {
            const cleanDigits = cleanTexto.replace(/\D/g, '');
            if (cleanDigits.length === 8) tipo = 24;
            else if (cleanDigits.length === 11) tipo = 22;
            else tipo = 21;
          }
        }

        // Se num == 3, seleciona a opção correta no dropdown #f3
        if (num === 3) {
          const selectF3 = document.getElementById('f3') || document.querySelector('#tab3 select, #viewcampos select');
          if (selectF3) {
            const fLower = (formato || '').toLowerCase();
            const isJustYear = fLower === 'ano' || /^\d{4}$/.test(cleanTexto);
            let found = false;
            for (let i = 0; i < selectF3.options.length; i++) {
              const opt = selectF3.options[i];
              const t = (opt.text || '').toLowerCase();

              if (isJustYear && (t.includes('ano') && !t.includes('mês') && !t.includes('mes') && !t.includes('dia'))) {
                selectF3.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              } else if (!isJustYear && (fLower === 'mes_ano' || fLower.includes('mes') || fLower.includes('mês')) && (t.includes('mês e ano') || t.includes('mes e ano'))) {
                selectF3.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              } else if (!isJustYear && (fLower === 'dia_mes_ano' || fLower.includes('dia')) && t.includes('dia')) {
                selectF3.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              } else if (!isJustYear && fLower === 'ano_mes' && (t.includes('ano e mês') || t.includes('ano e mes'))) {
                selectF3.selectedIndex = i;
                tipo = opt.value;
                found = true;
                break;
              }
            }
            if (!found && selectF3.value) tipo = selectF3.value;
          }
          if (!tipo) tipo = /^\d{4}$/.test(cleanTexto) ? 314 : 316; // 314 = Ano, 316 = Mês/Ano
        }

        // Preenche campos auxiliares do G-Click
        if (document.getElementById(`t${num}`)) document.getElementById(`t${num}`).value = cleanTexto;
        if (document.getElementById(`n${num}`)) document.getElementById(`n${num}`).value = nome;
        if (document.getElementById('linha')) document.getElementById('linha').value = linha;
        if (document.getElementById('linhaselecionada')) document.getElementById('linhaselecionada').value = lineText || cleanTexto;
        if (document.getElementById('selecionado')) document.getElementById('selecionado').value = cleanTexto;

        // Calcula pos inicial se possível
        let pos = 0;
        if (lineText && cleanTexto) {
          const idx = lineText.indexOf(cleanTexto);
          if (idx >= 0) pos = idx;
        }

        // Grifa visualmente o trecho na linha à esquerda com a cor nativa do G-Click
        if (lineEl && cleanTexto) {
          const corMap = { 1: '#ADFF2F', 2: '#FFD700', 3: '#87CEEB', 4: '#D2B48C' };
          const cor = corMap[num] || '#ADFF2F';
          try {
            const currentHtml = lineEl.innerHTML;
            if (!currentHtml.includes(`background-color:${cor}`)) {
              lineEl.innerHTML = currentHtml.replace(cleanTexto, `<span style="background-color:${cor}">${cleanTexto}</span>`);
            }
          } catch (e) {}
        }

        const cleanLinha = String(linha).replace(/\D/g, '');
        const url = `configuracaoSalvar.do?obj=pdfcampo&layout=${layoutId}&nome=${encodeURIComponent(nome)}&exemplo=${encodeURIComponent(cleanTexto)}&tipo=${tipo}&linha=${cleanLinha}&posinicial=${pos}&empId=${empId}`;

        return new Promise((resolve) => {
          if (window.$ && window.$.get) {
            window.$.get(url, (data, status) => {
              if (window.viewcampos) window.viewcampos(data, status);
              resolve({ ok: true, data });
            });
          } else {
            fetch(url).then(r => r.text()).then(data => resolve({ ok: true, data })).catch(err => resolve({ ok: false, error: err.message }));
          }
        });
      }, { num, nome, linha, texto, tipoFixo, formato, accountId });
    }

    // Executa Pilar 1 (Obrigação)
    if (p1Linha) {
      logStep(6, `Gravando Pilar 1 (Obrigação) na linha ${p1Linha}: "${p1Texto}"...`);
      await salvarPilarGclick(1, 'Obrigatório', p1Linha, p1Texto, 1);
      await modelPage.waitForTimeout(2000);
    }

    // Executa Pilar 2 (Cliente / Inscrição)
    if (p2Linha) {
      const cleanDigits = (p2Texto || '').replace(/\D/g, '');
      const p2Tipo = pilar2.tipo || '';
      let tipoPilar2 = 21; // CNPJ padrão
      if (p2Tipo === 'CPF' || cleanDigits.length === 11) {
        tipoPilar2 = 22; // Inscrição - CPF
      } else if (p2Tipo === 'CNPJ_BASE' || cleanDigits.length === 8) {
        tipoPilar2 = 24; // Inscrição - CNPJ RAIZ
      }
      logStep(7, `Gravando Pilar 2 (Inscrição - ${tipoPilar2 === 22 ? 'CPF' : (tipoPilar2 === 24 ? 'CNPJ Raiz' : 'CNPJ')}) na linha ${p2Linha}: "${p2Texto}"...`);
      await salvarPilarGclick(2, 'Inscrição', p2Linha, p2Texto, tipoPilar2);
      await modelPage.waitForTimeout(2000);
    }

    // Executa Pilar 3 (Competência)
    if (p3Linha) {
      logStep(8, `Gravando Pilar 3 (Competência) na linha ${p3Linha}: "${p3Texto}" (formato: ${p3Formato})...`);
      await salvarPilarGclick(3, 'Competência', p3Linha, p3Texto, null, p3Formato);
      await modelPage.waitForTimeout(2000);
    }

    // 7. Opção "Buscar informações em diferentes linhas" (MultiLinhas)
    if (multiLinhas) {
      logStep(9, 'Ativando opção "Buscar informações em diferentes linhas" (contracheques/holerites)...');
      await modelPage.evaluate(({ accountId }) => {
        const layoutId = document.getElementById('id')?.value;
        const empId = document.getElementById('empId')?.value || accountId;
        const chk = document.getElementById('fdadofixolinha');
        if (chk) chk.checked = true;

        if (typeof window.pdflayoutDadofixo === 'function') {
          window.pdflayoutDadofixo(1, 'pdfldadofixo');
        } else {
          const url = `configuracaoSalvar.do?obj=pdfldadofixo&id=${layoutId}&dadofixo=1&empId=${empId}`;
          if (window.$ && window.$.get) window.$.get(url);
        }
      }, { accountId }).catch(() => {});
      await modelPage.waitForTimeout(1000);
    }

    // 8. Clicar em "Salvar e continuar" e aguardar o processo comparativo do G-Click
    logStep(10, 'Disparando "Salvar e continuar" no G-Click e aguardando conferência comparativa...');
    const btnSalvarEContinuar = modelPage.locator('button:has-text("Salvar e continuar"), .btn-info:has-text("Salvar e continuar")').first();
    if (await btnSalvarEContinuar.count() > 0) {
      await btnSalvarEContinuar.click().catch(() => {});

      // O G-Click abre o modal #dialogopdflayoutvalidacao e compara modelos com barra de progresso (0% a 100%)
      let validacaoConcluida = false;
      let erroDetectado = null;

      for (let w = 0; w < 25; w++) {
        await modelPage.waitForTimeout(1000);
        const modalStatus = await modelPage.evaluate(() => {
          const modal = document.getElementById('dialogopdflayoutvalidacao');
          const isVisible = modal && $(modal).is(':visible');
          
          // Verifica conflito real apontado pelo G-Click
          const conflito = document.getElementById('pdflayoutconflito')?.value;
          const modelosRestantes = document.getElementById('pdflayoutmodelos')?.value;
          const erroBloco = document.getElementById('viewpdflayoutmodeloresultadoerro');
          const erroVisivel = erroBloco && $(erroBloco).is(':visible');
          const conflitoTextoEl = document.getElementById('configpdfmodeloconflito');
          const conflitoTexto = conflitoTextoEl ? conflitoTextoEl.textContent.trim().replace(/\s+/g, ' ') : '';

          const sucessoEl = document.getElementById('viewpdflayoutmodeloresultado');
          const sucessoVisivel = sucessoEl && $(sucessoEl).is(':visible');
          const percentual = document.getElementById('configpdfprogressopercentual1')?.textContent || '';
          const passo3Visivel = $('#viewpdfpasso3').is(':visible');

          return {
            isVisible,
            conflito,
            erroVisivel,
            conflitoTexto,
            modelosRestantes,
            sucessoVisivel,
            percentual,
            passo3Visivel
          };
        }).catch(() => null);

        if (!modalStatus) continue;

        if (modalStatus.percentual) {
          logStep(10, `Comparando modelo no G-Click: ${modalStatus.percentual}...`);
        }

        // Se ocorreu um conflito real confirmado pelo G-Click
        if (modalStatus.conflito === 'true' && modalStatus.erroVisivel) {
          erroDetectado = modalStatus.conflitoTexto || 'Conflito de validação com outro modelo de PDF cadastrado no G-Click';
          break;
        }

        // Se avançou para o Passo 3 ou concluiu a validação com sucesso
        if (modalStatus.passo3Visivel || modalStatus.sucessoVisivel || (!modalStatus.isVisible && (modalStatus.percentual === '100%' || modalStatus.modelosRestantes === ','))) {
          validacaoConcluida = true;
          break;
        }

        // Se todos os modelos foram comparados e conflito é false, confirma modelo validado
        if (modalStatus.modelosRestantes === ',' && modalStatus.conflito === 'false') {
          await modelPage.evaluate(() => {
            if (typeof window.confirmarModeloValidado === 'function') {
              window.confirmarModeloValidado();
            }
          }).catch(() => {});
        }
      }

      if (erroDetectado) {
        logStep(10, `G-Click apontou conflito: "${erroDetectado}"`);
        throw new Error(`G-Click recusou o mapeamento por conflito: "${erroDetectado}".`);
      }

      logStep(10, 'Validação e conferência de campos concluída com sucesso no G-Click.');

      // Fechar modal de validação se ainda estiver visível
      const btnFecharModalProg = modelPage.locator('#dialogopdflayoutvalidacao button:has-text("Fechar"), #dialogopdflayoutvalidacao .close').first();
      if (await btnFecharModalProg.count() > 0 && await btnFecharModalProg.isVisible()) {
        await btnFecharModalProg.click().catch(() => {});
      }
    }

    // 9. Transição para Passo 3: Vincular modelo à Obrigação
    logStep(11, 'Avançando para o Passo 3 (Vínculo com Obrigação)...');
    await modelPage.evaluate(() => {
      if (typeof window.proximoPassoPDFLayout === 'function') {
        window.proximoPassoPDFLayout('3');
      }
    }).catch(() => {});
    await modelPage.waitForTimeout(2000);

    let vinculado = false;
    if (obrigacaoNome) {
      logStep(12, `Localizando obrigação "${obrigacaoNome}" para vínculo automático...`);
      const rowObrig = modelPage.locator(`tr:has-text("${obrigacaoNome}")`).first();
      if (await rowObrig.count() > 0) {
        const btnVincular = rowObrig.locator('button:has-text("Vincular"), a:has-text("Vincular")').first();
        if (await btnVincular.count() > 0) {
          await btnVincular.click();
          await modelPage.waitForTimeout(2000);
          vinculado = true;
          logStep(12, `Obrigação "${obrigacaoNome}" vinculada com sucesso!`);
        }
      } else {
        logStep(12, `Obrigação "${obrigacaoNome}" não encontrada na listagem do modelo. O usuário pode vincular manualmente nas configurações da obrigação.`);
      }
    }

    const finalUrl = modelPage.url();
    logStep(13, `Processo finalizado com sucesso. Modelo pronto no G-Click! URL: ${finalUrl}`);

    return {
      ok: true,
      nomeModelo,
      departamentoNome,
      vinculado,
      urlFinal: finalUrl,
      steps: logs,
      mensagem: `Modelo "${nomeModelo}" importado e mapeado com sucesso no G-Click!`
    };
  } finally {
    if (modelPage && modelPage !== page) {
      await modelPage.close().catch(() => {});
    }
    await page.close().catch(() => {});
  }
}
