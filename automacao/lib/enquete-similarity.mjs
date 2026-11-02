/**
 * Motor de Similaridade Inteligente e Conferência de Enquete (Planilha x G-Click)
 */

export function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'qual', 'quais', 'que', 'de', 'do', 'da', 'dos', 'das', 'em', 'para', 'por', 'com', 'sem',
  'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'e', 'ou', 'se', 'este', 'esse', 'aquele',
  'desta', 'deste', 'desse', 'dessa', 'cliente', 'empresa', 'sao', 'e', 'realizado', 'feita',
  'possui', 'alguma', 'qualquer', 'destes', 'destas', 'deste', 'desta', 'dele', 'dela', 'deles',
  'via', 'forma', 'tipo', 'deste'
]);

export function extractKeywords(str) {
  return normalize(str)
    .split(' ')
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

export function diceBigram(s1, s2) {
  const c1 = normalize(s1);
  const c2 = normalize(s2);
  if (c1 === c2) return 1.0;
  if (c1.length < 2 || c2.length < 2) return 0.0;
  const bigrams = new Map();
  for (let i = 0; i < c1.length - 1; i++) {
    const b = c1.slice(i, i + 2);
    bigrams.set(b, (bigrams.get(b) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < c2.length - 1; i++) {
    const b = c2.slice(i, i + 2);
    const count = bigrams.get(b) || 0;
    if (count > 0) {
      bigrams.set(b, count - 1);
      intersection++;
    }
  }
  return (2.0 * intersection) / ((c1.length - 1) + (c2.length - 1));
}

export function tokenSimilarity(s1, s2) {
  const n1 = normalize(s1);
  const n2 = normalize(s2);
  if (n1 === n2) return 1.0;

  const k1 = extractKeywords(s1);
  const k2 = extractKeywords(s2);

  // Se uma string for curta (ex: "Whatssap" vs "Via Whatsapp" ou "NF Semanal")
  if (!k1.length || !k2.length) {
    return diceBigram(s1, s2);
  }

  let matches = 0;
  for (const w1 of k1) {
    if (k2.some(w2 => w1 === w2 || w1.includes(w2) || w2.includes(w1) || levenshtein(w1, w2) <= 1)) {
      matches++;
    }
  }

  const keywordScore = (2 * matches) / (k1.length + k2.length);
  const bigramScore = diceBigram(s1, s2);

  // Média ponderada
  return Math.max(keywordScore * 0.7 + bigramScore * 0.3, bigramScore);
}

/**
 * Converte linhas do CSV da planilha (formato #, Tipo, Classificação, Nome)
 * em árvore estruturada de Grupos, Perguntas e Respostas.
 */
export function parseSpreadsheetEnquete(csvContent) {
  const lines = String(csvContent || '').split('\n').map(l => l.trim()).filter(Boolean);
  const groups = [];
  let currentGroup = null;
  let currentQuestion = null;

  for (const line of lines) {
    // Quebra por vírgula respeitando campos
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 4) continue;

    // Detecta colunas baseado na presença de 'G', 'P', 'R'
    let tipoIndex = parts.findIndex(p => ['G', 'P', 'R'].includes(p.toUpperCase()));
    if (tipoIndex === -1) continue;

    const tipo = parts[tipoIndex].toUpperCase();
    const classif = parts[tipoIndex + 1] || '';
    const nome = parts.slice(tipoIndex + 2).join(',').replace(/^"+|"+$/g, '').trim();

    if (!nome) continue;

    if (tipo === 'G') {
      currentGroup = {
        classif,
        nome,
        questions: []
      };
      groups.push(currentGroup);
      currentQuestion = null;
    } else if (tipo === 'P') {
      currentQuestion = {
        classif,
        nome,
        groupNome: currentGroup?.nome || null,
        groupClassif: currentGroup?.classif || null,
        answers: []
      };
      if (currentGroup) {
        currentGroup.questions.push(currentQuestion);
      } else {
        const defaultGroup = { classif: '0', nome: 'Geral', questions: [currentQuestion] };
        groups.push(defaultGroup);
        currentGroup = defaultGroup;
      }
    } else if (tipo === 'R') {
      const resposta = {
        classif,
        nome,
        questionNome: currentQuestion?.nome || null,
        questionClassif: currentQuestion?.classif || null,
        groupNome: currentGroup?.nome || null
      };
      if (currentQuestion) {
        currentQuestion.answers.push(resposta);
      }
    }
  }

  return groups;
}

/**
 * Sugere a Categoria de Particularidade com base na Pergunta e no Grupo
 */
export function suggestCategoria(questionNome, groupNome, availableCategorias = []) {
  const qNorm = normalize(questionNome);
  const gNorm = normalize(groupNome);

  // Mapeamentos diretos conhecidos (ex: Ramo de atividade -> Fiscal - Ramo)
  if (/\bramo\b/.test(qNorm) || /\batividade\b/.test(qNorm)) {
    const match = availableCategorias.find(c => normalize(c).includes('ramo'));
    if (match) return match;
    return 'Fiscal - Ramo';
  }

  if (gNorm.includes('pessoal') || gNorm.includes('trabalhista') || /\bfolha\b/.test(qNorm) || /\bsindical\b/.test(qNorm) || /\bdissidio\b/.test(qNorm)) {
    const match = availableCategorias.find(c => normalize(c).includes('pessoal') || normalize(c).includes('dp'));
    if (match) return match;
    return 'Dpto. Pessoal';
  }

  if (/\bnf\b/.test(qNorm) || /\bnota fiscal\b/.test(qNorm) || /\biss\b/.test(qNorm) || gNorm.includes('fiscal')) {
    const match = availableCategorias.find(c => normalize(c) === 'fiscal');
    if (match) return match;
    return 'Fiscal';
  }

  if (gNorm.includes('financeiro') || /\bhonorario\b/.test(qNorm) || /\bpagamento\b/.test(qNorm) || /\bboleto\b/.test(qNorm)) {
    const match = availableCategorias.find(c => normalize(c).includes('financeiro'));
    if (match) return match;
    return 'Financeiro';
  }

  if (gNorm.includes('contabil') || /\bcontabil\b/.test(qNorm)) {
    const match = availableCategorias.find(c => normalize(c).includes('contabil'));
    if (match) return match;
    return 'Contábil';
  }

  // Tenta encontrar uma categoria disponível que combine com o grupo
  if (availableCategorias.length > 0) {
    for (const cat of availableCategorias) {
      if (tokenSimilarity(cat, groupNome) >= 0.5) return cat;
    }
    return availableCategorias[0];
  }

  return 'Sem Categoria';
}

/**
 * Cruza a árvore da planilha modelo com o catálogo da conta G-Click ativa.
 */
export function compareEnqueteModelWithCatalog(spreadsheetGroups, catalog, availableCategorias = []) {
  const catalogQuestions = catalog?.questions || [];
  const results = {
    accountId: catalog?.accountId || null,
    totalGrupos: spreadsheetGroups.length,
    totalPerguntas: 0,
    totalRespostasPlanilha: 0,
    respostasExistentesCount: 0,
    respostasFaltantesCount: 0,
    perguntasFaltantesCount: 0,
    items: []
  };

  for (const group of spreadsheetGroups) {
    for (const q of group.questions) {
      results.totalPerguntas++;
      results.totalRespostasPlanilha += q.answers.length;

      // Busca a melhor pergunta correspondente no catálogo do G-Click
      let bestQ = null;
      let maxQSim = 0;

      for (const cq of catalogQuestions) {
        const sim = tokenSimilarity(q.nome, cq.label);
        if (sim > maxQSim) {
          maxQSim = sim;
          bestQ = cq;
        }
      }

      const questionFound = maxQSim >= 0.45;
      if (!questionFound) {
        results.perguntasFaltantesCount++;
      }

      const qResult = {
        groupClassif: group.classif,
        groupNome: group.nome,
        questionClassif: q.classif,
        questionNome: q.nome,
        questionFound,
        matchedGclickQuestion: questionFound ? {
          ref: bestQ.ref,
          label: bestQ.label,
          category: bestQ.category,
          similarity: Math.round(maxQSim * 100)
        } : null,
        answers: []
      };

      for (const a of q.answers) {
        let bestA = null;
        let maxASim = 0;

        if (questionFound && bestQ.answers) {
          for (const ca of bestQ.answers) {
            const asim = tokenSimilarity(a.nome, ca.label);
            if (asim > maxASim) {
              maxASim = asim;
              bestA = ca;
            }
          }
        }

        const answerExists = maxASim >= 0.55;
        if (answerExists) {
          results.respostasExistentesCount++;
        } else {
          results.respostasFaltantesCount++;
        }

        const suggestedCat = suggestCategoria(q.nome, group.nome, availableCategorias);

        qResult.answers.push({
          answerClassif: a.classif,
          answerNome: a.nome,
          status: answerExists ? 'ja_existe' : 'faltante',
          suggestedCategoria: suggestedCat,
          matchedGclickAnswer: answerExists ? {
            ref: bestA.ref,
            value: bestA.value,
            label: bestA.label,
            similarity: Math.round(maxASim * 100)
          } : null
        });
      }

      results.items.push(qResult);
    }
  }

  return results;
}
