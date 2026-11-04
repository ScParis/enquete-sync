import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoWithRetry } from './gclick.mjs';
import { normalize, tokenSimilarity } from './enquete-similarity.mjs';

const BASE = 'https://app.gclick.com.br/Listar.do?obj=enqueteopen&tipo=0&empId=';

/**
 * Atualiza o arquivo de catálogo em disco com a nova resposta criada
 */
export async function addAnswerToCatalogFile(accountId, questionRef, answerName, answerValue = null) {
  try {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalogPath = path.join(rootDir, 'catalogos', `${accountId}.json`);
    const content = await fs.readFile(catalogPath, 'utf8');
    const catalog = JSON.parse(content);
    if (!catalog.questions) return;

    const question = catalog.questions.find(q => q.ref === questionRef);
    if (!question) return;

    if (!question.answers) question.answers = [];

    const clean = answerName.trim();
    const alreadyExists = question.answers.some(a => 
      a.label.toLowerCase() === clean.toLowerCase() || 
      tokenSimilarity(a.label, clean) >= 0.85
    );

    if (!alreadyExists) {
      const nextIndex = String(question.answers.length + 1).padStart(2, '0');
      const newRef = `${questionRef}.${nextIndex}`;
      question.answers.push({
        ref: newRef,
        value: answerValue || String(Date.now()).slice(-4),
        valueKnown: true,
        label: clean,
        display: `${nextIndex} - ${clean}`,
        type: 'R'
      });
      catalog.answerCount = (catalog.answerCount || 0) + 1;
      catalog.capturedAt = new Date().toISOString();
      await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
      console.log(`[ENQUETE-CADASTRO] Catálogo ${accountId}.json atualizado com resposta "${clean}" na pergunta ${questionRef}`);
    }
  } catch (err) {
    console.warn(`[ENQUETE-CADASTRO] Aviso ao atualizar catálogo local ${accountId}.json:`, err.message);
  }
}

/**
 * Lê as categorias disponíveis na aba Categoria ou no modal de particularidades
 */
export async function fetchEnqueteCategorias(page, accountId) {
  if (!page || page.isClosed()) return [];
  try {
    const targetUrl = BASE + encodeURIComponent(accountId);
    if (!page.url().includes('Listar.do?obj=enqueteopen')) {
      await gotoWithRetry(page, targetUrl);
    }

    // Tenta ler da aba 'Categoria' se existir
    const catTab = page.locator('a:has-text("Categoria"), [href*="categoria"]').first();
    if (await catTab.count()) {
      // Abre a aba ou verifica options já existentes
      const cats = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('select[name*="categoria"] option, #categoria option'))
          .map(o => o.textContent.trim())
          .filter(t => t && !/selecione/i.test(t));
        return [...new Set(options)];
      }).catch(() => []);
      if (cats.length) return cats;
    }

    return ['Fiscal - Ramo', 'Fiscal', 'Dpto. Pessoal', 'Financeiro', 'Contábil', 'Sem Categoria'];
  } catch (err) {
    return ['Fiscal - Ramo', 'Fiscal', 'Dpto. Pessoal', 'Financeiro', 'Contábil', 'Sem Categoria'];
  }
}

/**
 * Abre o editor da Pergunta no G-Click
 */
export async function openPerguntaEditor(page, accountId, questionRef, questionNome = '', onLog = () => {}) {
  const targetUrl = BASE + encodeURIComponent(accountId);

  // 1. Se já estiver na tela "Alterando Pergunta", verifica se já é a pergunta correta
  const btnNovaCheck = page.locator('xpath=/html/body/div[2]/div[2]/div[2]/div[1]/div[2]/div/div[2]/div[2]/button').or(
    page.locator('button:has-text("Nova Particularidade"), a:has-text("Nova Particularidade")')
  );
  const isEditing = (await page.locator('text=Alterando Pergunta').count()) > 0 ||
                    (await btnNovaCheck.count()) > 0;

  if (isEditing) {
    const currentRefVal = (await page.locator('input[name*="classificacao"], #classificacao').inputValue().catch(() => '')).trim();

    if (questionRef && currentRefVal === questionRef) {
      onLog(`Já posicionado na pergunta "${questionRef}".`);
      return true;
    }

    // Não é a pergunta desejada (ex: está em 01.05 e queremos 01.05.03.01): clica em "Voltar"
    onLog(`Saindo da pergunta ${currentRefVal || 'atual'} para buscar "${questionRef || questionNome}"...`);
    const btnVoltar = page.locator('button:has-text("Voltar"), a:has-text("Voltar"), input[value="Voltar"]').first();
    if (await btnVoltar.count()) {
      await btnVoltar.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  // 2. Navega para a lista da Enquete se a tabela principal não estiver visível
  const tablePresent = (await page.locator('#DataTables_Table_0').count()) > 0;
  if (!tablePresent) {
    onLog('Acessando listagem da Enquete...');
    await gotoWithRetry(page, targetUrl);
  }

  // Garante que está na aba "Enquete"
  const enqueteTab = page.locator('a:has-text("Enquete"), li:has-text("Enquete")').first();
  if (await enqueteTab.count() && (await enqueteTab.getAttribute('class'))?.includes('active') === false) {
    await enqueteTab.click().catch(() => {});
  }

  const table = page.locator('#DataTables_Table_0');
  await table.waitFor({ state: 'visible', timeout: 15000 });

  // Ajusta paginação para exibir até 100 itens se possível
  const lengthSelect = page.locator('select[name="DataTables_Table_0_length"]').first();
  if (await lengthSelect.count()) {
    await lengthSelect.selectOption('100').catch(() => {});
    await page.waitForTimeout(300);
  }

  // 3. Aplica filtro na busca da tabela
  const filterInput = page.locator('#DataTables_Table_0_filter input, input[aria-controls="DataTables_Table_0"]').first();
  if (await filterInput.count()) {
    onLog(`Filtrando pergunta "${questionRef || questionNome}" na tabela...`);
    await filterInput.click();
    await filterInput.fill('');
    await filterInput.pressSequentially(questionRef || questionNome, { delay: 25 });
    await filterInput.dispatchEvent('keyup').catch(() => {});
    await page.waitForTimeout(600);
  }

  await page.screenshot({ path: '/home/piperun/.gemini/antigravity/brain/2537d836-9109-4d7e-b48a-46aa97e3572f/passo2_filtro_pergunta.png' }).catch(() => {});

  // 4. Localiza o link específico da pergunta
  let linkLocator = null;

  // Busca no DOM pela correspondência da coluna 3 (Classificação exata) ou coluna 4 (Nome da pergunta)
  const domMatch = await page.evaluate(({ qRef, qNome }) => {
    const rows = Array.from(document.querySelectorAll('#DataTables_Table_0 tbody tr'));

    // Prioridade 1: correspondência EXATA da classificação (coluna 3)
    for (const tr of rows) {
      const cells = tr.querySelectorAll('td');
      if (cells.length >= 4) {
        const classif = (cells[2].innerText || '').trim();
        if (qRef && classif === qRef) {
          const a = cells[3].querySelector('a') || tr.querySelector('a');
          if (a) {
            a.setAttribute('data-target-click', 'true');
            return { found: true, text: a.innerText, trId: tr.id, classif };
          }
        }
      }
    }

    // Prioridade 2: classificação contida ou correspondência de nome (coluna 4)
    for (const tr of rows) {
      const cells = tr.querySelectorAll('td');
      if (cells.length >= 4) {
        const classif = (cells[2].innerText || '').trim();
        const nome = (cells[3].innerText || '').trim();
        const refMatch = qRef && (classif.startsWith(qRef) || qRef.startsWith(classif));
        const nomeMatch = qNome && (nome.toLowerCase().includes(qNome.toLowerCase()) || qNome.toLowerCase().includes(nome.toLowerCase()));
        if (refMatch || nomeMatch) {
          const a = cells[3].querySelector('a') || tr.querySelector('a');
          if (a) {
            a.setAttribute('data-target-click', 'true');
            return { found: true, text: a.innerText, trId: tr.id, classif, nome };
          }
        }
      }
    }

    // Prioridade 3: se a tabela filtrada tiver apenas 1 linha de pergunta (tipo P)
    for (const tr of rows) {
      const cells = tr.querySelectorAll('td');
      if (cells.length >= 4) {
        const tipo = (cells[1].innerText || '').trim();
        if (tipo === 'P' || rows.length === 1) {
          const a = cells[3].querySelector('a') || tr.querySelector('a');
          if (a) {
            a.setAttribute('data-target-click', 'true');
            return { found: true, text: a.innerText, trId: tr.id };
          }
        }
      }
    }

    return { found: false, count: rows.length };
  }, { qRef: questionRef, qNome: questionNome });

  if (domMatch?.found) {
    linkLocator = page.locator('[data-target-click="true"]').first();
  }

  // Fallback: primeiro link da coluna 4 no resultado filtrado
  if (!linkLocator || (await linkLocator.count()) === 0) {
    linkLocator = page.locator('#DataTables_Table_0 tbody tr td:nth-child(4) a, #DataTables_Table_0 tbody tr a').first();
  }

  if (!linkLocator || (await linkLocator.count()) === 0) {
    throw new Error(`Pergunta "${questionRef || questionNome}" não localizada na tabela da Enquete.`);
  }

  // 5. Clica no link para entrar na pergunta
  onLog(`Entrando na pergunta "${questionRef || questionNome}"...`);
  await linkLocator.scrollIntoViewIfNeeded().catch(() => {});

  // Executa o clique via DOM nativo e Playwright
  await page.evaluate((el) => {
    if (el) {
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }, await linkLocator.elementHandle().catch(() => null)).catch(() => {});
  await linkLocator.click({ force: true }).catch(() => {});

  // 6. Aguarda com assertividade a tela "Alterando Pergunta" abrir
  onLog('Aguardando tela Alterando Pergunta carregar...');
  const btnNova = page.locator('xpath=/html/body/div[2]/div[2]/div[2]/div[1]/div[2]/div/div[2]/div[2]/button').or(
    page.locator('button:has-text("Nova Particularidade"), a:has-text("Nova Particularidade")')
  ).first();

  try {
    await btnNova.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    // Se ainda não carregou, faz um clique de reforço no link
    onLog('Reforçando clique no link da pergunta...');
    await linkLocator.click({ force: true }).catch(() => {});
    await btnNova.waitFor({ state: 'visible', timeout: 10000 });
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/piperun/.gemini/antigravity/brain/2537d836-9109-4d7e-b48a-46aa97e3572f/passo3_alterando_pergunta.png' }).catch(() => {});

  return true;
}

/**
 * Cria a particularidade e a vincula à pergunta ativa
 */
export async function createAndAttachResposta(page, accountId, rawItem, onLog = () => {}) {
  const questionRef = rawItem.questionRef || rawItem.perguntaId || '';
  const questionNome = rawItem.questionNome || rawItem.perguntaNome || rawItem.pergunta || '';
  const answerName = rawItem.answerName || rawItem.resposta || '';
  const answerDesc = rawItem.answerDesc || rawItem.resposta || answerName;
  const categoriaName = rawItem.categoriaName || rawItem.categoria || rawItem.categoriaSugerida || 'Sem Categoria';

  const cleanAnswerName = String(answerName || '').trim();
  const cleanAnswerDesc = String(answerDesc || cleanAnswerName).trim();
  const cleanCat = String(categoriaName || 'Sem Categoria').trim();

  // 1. Abre a tela de alteração da pergunta alvo
  await openPerguntaEditor(page, accountId, questionRef, questionNome, onLog);

  // 2. Valida se a resposta já está na tabela de respostas da pergunta (idempotência)
  const existingAnswers = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('table tbody tr td'));
    return cells.map(c => c.innerText.trim()).filter(Boolean);
  }).catch(() => []);

  if (existingAnswers.some(t => t.includes(cleanAnswerName) || tokenSimilarity(t, cleanAnswerName) >= 0.85)) {
    onLog(`A resposta "${cleanAnswerName}" já está vinculada a esta pergunta.`);
    return {
      success: true,
      alreadyExisted: true,
      created: false,
      attached: true,
      answerName: cleanAnswerName,
      message: `A resposta "${cleanAnswerName}" já está vinculada a esta pergunta.`
    };
  }

  // 3. Clica no botão "Nova Particularidade"
  onLog('Clicando em "Nova Particularidade"...');
  const btnByXpath = page.locator('xpath=/html/body/div[2]/div[2]/div[2]/div[1]/div[2]/div/div[2]/div[2]/button');
  const btnByText = page.locator('button:has-text("Nova Particularidade"), a:has-text("Nova Particularidade"), input[value*="Nova Particularidade"]');
  const btnNova = btnByXpath.or(btnByText).first();
  await btnNova.waitFor({ state: 'visible', timeout: 10000 });
  await btnNova.click({ force: true });

  // 4. Aguarda modal "Nova Particularidade" abrir
  onLog('Aguardando modal Nova Particularidade...');
  const modal = page.locator('.modal:visible, [role="dialog"]:visible, .modal.show, .modal.in').filter({
    hasText: /Nova Particularidade/i
  }).first();
  await modal.waitFor({ state: 'visible', timeout: 12000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/piperun/.gemini/antigravity/brain/2537d836-9109-4d7e-b48a-46aa97e3572f/passo4_modal_aberto.png' }).catch(() => {});

  // 5. Preenche campos do modal (Nome, Descrição, Categoria)
  onLog(`Preenchendo Nome: "${cleanAnswerName}" e Descrição: "${cleanAnswerDesc}"...`);
  const inputNome = modal.locator('input[name*="nome" i], input#nome, input[type="text"]').first();
  try {
    await inputNome.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    // Se o modal não abriu o input a tempo, reforça clique em Nova Particularidade
    await btnNova.click({ force: true }).catch(() => {});
    await inputNome.waitFor({ state: 'visible', timeout: 8000 });
  }
  await inputNome.fill('');
  await inputNome.fill(cleanAnswerName);

  const txtDesc = modal.locator('textarea[name*="desc" i], textarea#descricao, textarea').first();
  if (await txtDesc.count()) {
    await txtDesc.fill(cleanAnswerDesc);
  }

  onLog(`Selecionando Categoria: "${cleanCat}"...`);
  const selectCat = modal.locator('select[name*="cat" i], select#categoria, select').first();
  if (await selectCat.count()) {
    let selected = false;
    const options = await selectCat.locator('option').allInnerTexts();
    for (const opt of options) {
      if (opt.toLowerCase().includes(cleanCat.toLowerCase()) || tokenSimilarity(opt, cleanCat) >= 0.6) {
        await selectCat.selectOption({ label: opt }).catch(() => {});
        selected = true;
        break;
      }
    }
    if (!selected && options.length > 1) {
      await selectCat.selectOption({ index: 1 }).catch(() => {});
    }
  }

  await page.screenshot({ path: '/home/piperun/.gemini/antigravity/brain/2537d836-9109-4d7e-b48a-46aa97e3572f/passo5_modal_preenchido.png' }).catch(() => {});

  // 6. Clica em "Salvar" no modal
  onLog('Salvando Nova Particularidade...');
  const btnSalvarModal = modal.locator('button:has-text("Salvar"), input[value="Salvar"]').first();
  await btnSalvarModal.click();
  await page.waitForTimeout(1000);

  // 7. Fecha o modal se ainda estiver visível
  const btnFecharModal = modal.locator('button:has-text("Fechar"), .close, [data-dismiss="modal"]').first();
  if (await btnFecharModal.isVisible().catch(() => false)) {
    await btnFecharModal.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: '/home/piperun/.gemini/antigravity/brain/2537d836-9109-4d7e-b48a-46aa97e3572f/passo6_modal_fechado.png' }).catch(() => {});

  // 8. Seleciona a nova particularidade no select "Particularidade *" da pergunta
  onLog(`Vinculando "${cleanAnswerName}" no select Particularidade da pergunta...`);
  let attached = false;

  // Tenta select nativo
  const selectPart = page.locator('select[name*="particularidade" i], select#particularidade').first();
  if (await selectPart.count()) {
    const partOptions = await selectPart.locator('option').allInnerTexts();
    for (const opt of partOptions) {
      if (opt.toLowerCase().includes(cleanAnswerName.toLowerCase()) || tokenSimilarity(opt, cleanAnswerName) >= 0.75) {
        await selectPart.selectOption({ label: opt }).catch(() => {});
        await selectPart.dispatchEvent('change').catch(() => {});
        attached = true;
        break;
      }
    }
  }

  // Se for Chosen / Select2
  if (!attached) {
    const selectContainer = page.locator('.chosen-container, .select2-container, [id*="particularidade"]').first();
    if (await selectContainer.count()) {
      await selectContainer.click().catch(() => {});
      await page.waitForTimeout(300);

      const searchInput = page.locator('.chosen-search input, .select2-search input, .select2-dropdown input').first();
      if (await searchInput.count()) {
        await searchInput.fill('');
        await searchInput.pressSequentially(cleanAnswerName, { delay: 50 });
        await page.waitForTimeout(600);
      }

      // Procura primeiro opção visível que contenha exatamente o texto da resposta
      const resultsLocator = page.locator('.chosen-results li:not(.disabled):not(.group-result), .select2-results__option:not([aria-disabled="true"])');
      const count = await resultsLocator.count();
      let matchedIndex = -1;

      for (let i = 0; i < count; i++) {
        const itemText = (await resultsLocator.nth(i).innerText().catch(() => '')).trim();
        if (itemText.toLowerCase().includes(cleanAnswerName.toLowerCase()) || tokenSimilarity(itemText, cleanAnswerName) >= 0.75) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex >= 0) {
        const targetOption = resultsLocator.nth(matchedIndex);
        await targetOption.scrollIntoViewIfNeeded().catch(() => {});
        await targetOption.click({ force: true }).catch(() => {});
        attached = true;
      } else if (await searchInput.count()) {
        // Fallback: pressiona Enter no campo de busca se houver resultado destacado
        await searchInput.press('Enter').catch(() => {});
        attached = true;
      }
    }
  }

  // Se houver botão de inclusão/adicionar ao lado do select
  const btnAdd = page.locator('button:has-text("Adicionar"), button:has-text("Incluir"), button:has-text("+"), a:has-text("Adicionar")').first();
  if (await btnAdd.isVisible().catch(() => false)) {
    await btnAdd.click().catch(() => {});
  }

  await page.waitForTimeout(1200);

  // 9. Validação final: confirma que a resposta agora aparece na tabela de respostas
  const answersAfter = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('table tbody tr td'));
    return cells.map(c => c.innerText.trim()).filter(Boolean);
  }).catch(() => []);

  const verified = answersAfter.some(t => t.includes(cleanAnswerName) || tokenSimilarity(t, cleanAnswerName) >= 0.85);

  await page.screenshot({ path: '/home/piperun/.gemini/antigravity/brain/2537d836-9109-4d7e-b48a-46aa97e3572f/passo7_concluido.png' }).catch(() => {});

  if (verified || attached) {
    await addAnswerToCatalogFile(accountId, questionRef, cleanAnswerName);
  }


  return {
    success: verified || attached,
    alreadyExisted: false,
    created: true,
    attached: verified || attached,
    answerName: cleanAnswerName,
    questionRef,
    verified,
    message: verified
      ? `Resposta "${cleanAnswerName}" cadastrada e vinculada com sucesso à pergunta ${questionRef}.`
      : `Particularidade "${cleanAnswerName}" criada e enviada ao G-Click.`
  };
}

/**
 * Processador em lote (Batch Runner)
 */
export async function executeBatchCadastro(page, accountId, items = [], onProgress = () => {}, isCancelled = () => false) {
  const results = [];
  let current = 0;
  const total = items.length;

  for (const item of items) {
    if (typeof isCancelled === 'function' && isCancelled()) {
      onProgress({
        step: 'cancelled',
        current,
        total,
        results,
        message: 'Operação cancelada pelo operador.'
      });
      break;
    }
    current++;
    const aName = item.answerName || item.resposta || 'Resposta';
    const qName = item.questionRef || item.perguntaId || item.questionNome || item.perguntaNome || item.pergunta || 'Pergunta';

    const logAndNotify = (subMsg) => {
      onProgress({
        step: 'in_progress',
        current,
        total,
        item,
        message: `[${current}/${total}] ${subMsg}`
      });
    };

    logAndNotify(`Cadastrando "${aName}" na pergunta ${qName}…`);

    try {
      const res = await createAndAttachResposta(page, accountId, item, logAndNotify);
      results.push({ ...item, ...res, error: null });
      onProgress({
        step: 'item_completed',
        current,
        total,
        item,
        result: res,
        message: res.message
      });
    } catch (err) {
      results.push({ ...item, success: false, error: err.message });
      onProgress({
        step: 'item_failed',
        current,
        total,
        item,
        error: err.message,
        message: `Erro ao cadastrar "${aName}": ${err.message}`
      });
    }

    // Intervalo de segurança entre cadastros
    await page.waitForTimeout(800);
  }

  onProgress({
    step: 'completed',
    current: total,
    total,
    results,
    message: `Processamento concluído: ${results.filter(r => r.success).length} sucesso(s), ${results.filter(r => !r.success).length} falha(s).`
  });

  return results;
}
