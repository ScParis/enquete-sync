import {
  parseSpreadsheetEnquete,
  compareEnqueteModelWithCatalog
} from '../lib/enquete-similarity.mjs';
import {
  fetchEnqueteCategorias,
  createAndAttachResposta,
  executeBatchCadastro
} from '../lib/enquete-cadastro.mjs';
import { readPublicGoogleCsv } from '../lib/google-service.mjs';

const DEFAULT_MODEL_SHEET = 'https://docs.google.com/spreadsheets/d/1fxVpJ6WMWFdsQmmquaJK-_7IFTeIBepVGoBPUSHED5g/edit?gid=278193778#gid=278193778';

let batchProgress = {
  running: false,
  current: 0,
  total: 0,
  message: '',
  logs: []
};

export async function handleEnqueteCadastroRoutes(req, res, ctx) {
  const {
    url,
    currentUser,
    authService,
    send,
    loginContext,
    readStoredCatalog,
    readQuestionCatalog,
    loginReady,
    hasGclickActiveSession,
    exclusive,
    jobManager
  } = ctx;
  const runExclusive = typeof exclusive === 'function' ? exclusive : (fn) => fn();

  // 1. GET /api/enquete/conferencia
  if (req.method === 'GET' && url.pathname === '/api/enquete/conferencia') {
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.visualizar')) {
      return send(res, 403, { error: 'Acesso negado: permissão "enquete.visualizar" necessária' });
    }

    const accountId = url.searchParams.get('accountId') || '3032';
    const sheetUrl = url.searchParams.get('sheetUrl') || DEFAULT_MODEL_SHEET;

    try {
      // 1. Busca CSV da planilha
      let csvContent = '';
      try {
        csvContent = await readPublicGoogleCsv(sheetUrl);
      } catch (err) {
        throw new Error(`Não foi possível baixar o CSV da planilha. ${err.message}`);
      }

      // 2. Parse da planilha
      const groups = parseSpreadsheetEnquete(csvContent);

      // 3. Lê catálogo da conta
      const catalog = await readStoredCatalog(accountId);
      if (!catalog || !catalog.questions) {
        return send(res, 400, {
          error: `Catálogo da conta ${accountId} ainda não foi lido. Abra a janela de login e leia a Enquete antes de conferir.`
        });
      }

      // 4. Categorias disponíveis
      const categories = ['Fiscal - Ramo', 'Fiscal', 'Dpto. Pessoal', 'Financeiro', 'Contábil', 'Sem Categoria'];

      // 5. Comparação e similaridade
      const rawComparison = compareEnqueteModelWithCatalog(groups, catalog, categories);

      // Constrói lista linear de respostas para a interface
      const flatItems = [];
      for (const q of rawComparison.items) {
        for (const a of q.answers) {
          flatItems.push({
            grupo: q.groupNome,
            pergunta: q.questionNome,
            perguntaMatched: q.questionFound,
            perguntaId: q.matchedGclickQuestion?.ref || null,
            perguntaMatchNome: q.matchedGclickQuestion?.label || null,
            perguntaScore: q.matchedGclickQuestion?.similarity ? q.matchedGclickQuestion.similarity / 100 : 0,
            resposta: a.answerNome,
            status: a.status,
            categoriaSugerida: a.suggestedCategoria,
            matchedGclickAnswer: a.matchedGclickAnswer
          });
        }
      }

      const comparison = {
        accountId,
        totalGrupos: rawComparison.totalGrupos,
        totalPerguntas: rawComparison.totalPerguntas,
        totalRespostas: rawComparison.totalRespostasPlanilha,
        respostasJaExistem: rawComparison.respostasExistentesCount,
        respostasFaltantes: rawComparison.respostasFaltantesCount,
        perguntasFaltantes: rawComparison.perguntasFaltantesCount,
        items: flatItems
      };

      return send(res, 200, {
        ok: true,
        sheetUrl,
        accountId,
        comparison,
        categories
      });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // 2. GET /api/enquete/categorias
  if (req.method === 'GET' && url.pathname === '/api/enquete/categorias') {
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.visualizar')) {
      return send(res, 403, { error: 'Acesso negado' });
    }

    const accountId = url.searchParams.get('accountId') || '3032';
    if (!loginContext) {
      return send(res, 200, {
        categories: ['Fiscal - Ramo', 'Fiscal', 'Dpto. Pessoal', 'Financeiro', 'Contábil', 'Sem Categoria']
      });
    }

    const page = loginContext.pages()[0];
    const categories = await fetchEnqueteCategorias(page, accountId);
    return send(res, 200, { categories });
  }

  // 3. GET /api/enquete/progresso
  if (req.method === 'GET' && url.pathname === '/api/enquete/progresso') {
    return send(res, 200, { progress: batchProgress });
  }

  // 4. POST /api/enquete/cadastrar
  if (req.method === 'POST' && url.pathname === '/api/enquete/cadastrar') {
    if (!currentUser || !authService.hasPermission(currentUser.id, 'enquete.gravar')) {
      return send(res, 403, { error: 'Acesso negado: permissão "enquete.gravar" necessária' });
    }

    const isSessionActive = loginReady || (typeof hasGclickActiveSession === 'function' ? hasGclickActiveSession(loginContext) : Boolean(loginContext));
    if (!loginContext || !isSessionActive) {
      return send(res, 400, {
        error: 'A janela do G-Click precisa estar aberta e logada para cadastrar respostas. Abra o login na seção Conexão.'
      });
    }

    let dataPayload = ctx.payload;
    if (!dataPayload) {
      let body = '';
      for await (const chunk of req) body += chunk;
      try { dataPayload = JSON.parse(body); } catch { return send(res, 400, { error: 'JSON inválido' }); }
    }

    const { accountId, items } = dataPayload || {};
    if (!accountId || !Array.isArray(items) || !items.length) {
      return send(res, 400, { error: 'Informe accountId e uma lista de items para cadastrar' });
    }

    if (batchProgress.running || (jobManager && jobManager.isBusy())) {
      return send(res, 409, { error: 'Outro processo de automação já está em andamento.' });
    }

    batchProgress = {
      running: true,
      current: 0,
      total: items.length,
      message: 'Iniciando cadastro...',
      logs: []
    };

    let job = null;
    if (jobManager) {
      try {
        job = jobManager.startJob('enquete_cadastro', accountId, batchProgress);
      } catch (err) {
        return send(res, 409, { error: err.message });
      }
    }

    try {
      const results = await runExclusive(async () => {
        const activePages = loginContext.pages().filter(p => !p.isClosed());
        const gclickPage = activePages.find(p => {
          try {
            const u = new URL(p.url());
            return /(^|\.)gclick\.com\.br$/.test(u.hostname);
          } catch { return false; }
        });
        const page = gclickPage || activePages[0] || await loginContext.newPage();

        return executeBatchCadastro(
          page,
          accountId,
          items,
          (prog) => {
            batchProgress.current = prog.current;
            batchProgress.total = prog.total;
            batchProgress.message = prog.message;
            if (jobManager) {
              jobManager.updateProgress({
                done: prog.current,
                total: prog.total,
                message: prog.message
              });
            }
            if (prog.message) {
              const formatted = `[${new Date().toLocaleTimeString('pt-BR')}] ${prog.message}`;
              batchProgress.logs.push(formatted);
              console.log(`[ENQUETE-CADASTRO] ${formatted}`);
            }
          },
          () => (job ? job.signal.aborted : false)
        );
      });

      batchProgress.running = false;
      if (job) job.finish({ running: false, stage: 'concluido' });

      // Atualiza catálogo em segundo plano
      if (readQuestionCatalog) {
        readQuestionCatalog(loginContext, accountId).catch(() => {});
      }

      return send(res, 200, {
        ok: true,
        accountId,
        total: items.length,
        results
      });
    } catch (err) {
      batchProgress.running = false;
      batchProgress.message = `Erro: ${err.message}`;
      batchProgress.logs.push(`[${new Date().toLocaleTimeString('pt-BR')}] ERRO: ${err.message}`);
      if (job) job.finish({ running: false, stage: 'erro', message: err.message });
      return send(res, 500, { error: err.message });
    }
  }

  return false;
}
