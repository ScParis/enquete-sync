export function buildAuditLogRows(report, catalog, savedMappings = [], ledger = []) {
  if (!report) return [];
  const accountId = String(report.accountId ?? report.rules?.accountId ?? '');
  const catalogQuestions = catalog?.questions ?? [];
  const qByRef = new Map();
  const aByRef = new Map();
  const aByVal = new Map();
  for (const q of catalogQuestions) {
    qByRef.set(q.ref, q);
    for (const a of q.answers) {
      aByRef.set(a.ref, { ...a, questionRef: q.ref, questionLabel: q.label, category: q.category });
      if (a.value) aByVal.set(String(a.value), { ...a, questionRef: q.ref, questionLabel: q.label });
    }
  }

  const mappingsByTask = new Map();
  for (const m of savedMappings) {
    if (m.accountId === accountId || !m.accountId) mappingsByTask.set(m.task, m);
  }

  const markedLedger = new Set((ledger || []).map(e => `${String(e.cnpj).replace(/\D/g, '')}|${String(e.task).trim()}`));

  const statusLabels = {
    ja_correto: 'Já respondido / correto',
    vazio: 'Não respondido / vazio',
    marcado_robo: 'Marcado pelo robô',
    nao_encontrado: 'Não localizado no G-Click',
    bloqueado: 'Bloqueado',
    divergente: 'Divergente',
    sem_mapeamento: 'Sem mapeamento',
    nao_verificado: 'Não verificado',
    invalido: 'Dados incompletos na planilha'
  };

  const actionLabels = {
    ja_correto: 'Nenhuma alteração necessária (já correto)',
    vazio: 'Pendente de gravação pelo robô',
    marcado_robo: 'Gravado com sucesso no G-Click',
    nao_encontrado: 'Não alterado: cliente não localizado no G-Click',
    bloqueado: 'Não alterado: bloqueado por validação',
    divergente: 'Não alterado: cliente possui outra opção marcada',
    sem_mapeamento: 'Não alterado: tarefa sem associação na Enquete',
    nao_verificado: 'Não alterado: leitura não concluída',
    invalido: 'Não alterado: linha sem CNPJ e ID na planilha'
  };

  const items = report.inspected ?? report.plan ?? [];
  const out = [];

  for (const item of items) {
    const task = item.mappingTask || item.task || (item.tasks?.[0] ?? '');
    const ansRef = item.mappingAnswer || item.target || mappingsByTask.get(task)?.answerRef || '';
    const ans = aByRef.get(ansRef) || null;
    const qRef = item.questionRef || ans?.questionRef || '';
    const qLabel = item.questionLabel || ans?.questionLabel || qByRef.get(qRef)?.label || '';
    const category = item.category || ans?.category || qByRef.get(qRef)?.category || '';
    const ansLabel = item.answerLabel || ans?.display || ans?.label || '';
    const ansVal = item.answerValue || ans?.value || '';

    let status = item.uiStatus ?? item.status ?? 'nao_verificado';
    const key = `${String(item.cnpj).replace(/\D/g, '')}|${String(task).trim()}`;
    if (markedLedger.has(key) && status === 'ja_correto' && item.uiReason?.includes('Gravado')) {
      status = 'marcado_robo';
    }

    const currentVal = item.currentValue ? String(item.currentValue).trim() : '';
    let currentDesc = '';
    if (status === 'nao_encontrado') {
      currentDesc = 'Não localizado';
    } else if (currentVal) {
      const matchA = aByVal.get(currentVal);
      currentDesc = matchA ? `Marcado: ${matchA.display || matchA.label} (${currentVal})` : `Valor marcado: ${currentVal}`;
    } else if (status === 'ja_correto') {
      currentDesc = `Marcado: ${ansLabel || ansVal || 'Sim'}`;
    } else if (status === 'vazio') {
      currentDesc = 'Não marcado / Vazio';
    } else {
      currentDesc = 'Não verificado';
    }

    let reason = item.uiReason ?? item.reason ?? '';
    if (!reason) {
      if (status === 'ja_correto') reason = `Já respondido na Enquete com a opção mapeada (${ansLabel || ansVal})`;
      else if (status === 'vazio') reason = 'Pergunta sem resposta para este cliente no G-Click (elegível para gravação)';
      else if (status === 'divergente') reason = `Cliente possui outra opção marcada no G-Click (${currentDesc})`;
      else if (status === 'nao_encontrado') reason = `Cliente não localizado na lista desta pergunta no G-Click`;
    }

    out.push({
      conta: accountId,
      linhaPlanilha: Array.isArray(item.matchingRows) ? item.matchingRows.join(' | ') : (item.row ?? ''),
      codCliente: item.empId ?? item.cod ?? '',
      cnpj: item.cnpj ?? '',
      empresa: item.empresa ?? '',
      clienteGClick: item.nomeNoDialogo ?? '',
      tarefa: task,
      codPergunta: qRef,
      pergunta: qLabel,
      categoria: category,
      codResposta: ansRef,
      respostaEsperada: ansLabel,
      valorInterno: ansVal,
      statusTexto: statusLabels[status] ?? status,
      statusCodigo: status,
      respostaAtualGClick: currentDesc,
      motivo: reason,
      acaoRobo: actionLabels[status] ?? '',
      auditadoEm: report.createdAt ?? new Date().toISOString()
    });
  }

  for (const inv of report.invalidSource ?? []) {
    out.push({
      conta: accountId,
      linhaPlanilha: inv.row ?? '',
      codCliente: inv.empId ?? inv.cod ?? '',
      cnpj: inv.cnpj ?? '-',
      empresa: inv.empresa ?? '',
      clienteGClick: '',
      tarefa: inv.task ?? '',
      codPergunta: '',
      pergunta: '',
      categoria: '',
      codResposta: '',
      respostaEsperada: '',
      valorInterno: '',
      statusTexto: statusLabels.invalido,
      statusCodigo: 'invalido',
      respostaAtualGClick: 'Não avaliado',
      motivo: inv.reason ?? 'Dados de identificação ausentes na planilha',
      acaoRobo: actionLabels.invalido,
      auditadoEm: report.createdAt ?? new Date().toISOString()
    });
  }

  return out.sort((a, b) => {
    const na = Number(String(a.linhaPlanilha).split('|')[0]);
    const nb = Number(String(b.linhaPlanilha).split('|')[0]);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return 0;
  });
}

export function auditLogCsv(rows) {
  const quote = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Conta',
    'Linha Planilha',
    'Cod. / ID Cliente',
    'CNPJ',
    'Razão Social / Empresa',
    'Cliente no G-Click',
    'Obrigação / Tarefa',
    'Cód. Pergunta',
    'Pergunta',
    'Departamento / Categoria',
    'Cód. Resposta Mapeada',
    'Resposta Mapeada',
    'Valor Interno',
    'Status da Auditoria',
    'Código do Status',
    'Resposta Atual no G-Click',
    'Motivo / Detalhes da Validação',
    'Ação do Robô',
    'Auditado em'
  ];

  const body = rows.map(r => [
    r.conta,
    r.linhaPlanilha,
    r.codCliente,
    r.cnpj,
    r.empresa,
    r.clienteGClick,
    r.tarefa,
    r.codPergunta,
    r.pergunta,
    r.categoria,
    r.codResposta,
    r.respostaEsperada,
    r.valorInterno,
    r.statusTexto,
    r.statusCodigo,
    r.respostaAtualGClick,
    r.motivo,
    r.acaoRobo,
    r.auditadoEm
  ].map(quote).join(','));

  return '\uFEFF' + [headers.map(quote).join(','), ...body].join('\r\n') + '\r\n';
}
