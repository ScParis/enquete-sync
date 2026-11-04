/**
 * Gerenciador Centralizado de Jobs, Progresso e Cancelamento Unificado.
 * Permite que qualquer operação assíncrona de longa duração (Enquete, Obrigações,
 * Valida PDF ou Enquete Cadastro) registre seu ciclo de vida, exponha seu progresso
 * e responda imediatamente ao endpoint /api/cancel.
 */

class JobManager {
  constructor() {
    /** @type {{ id: string, name: string, accountId: string, abortController: AbortController, startedAt: string, progress: any } | null} */
    this.currentJob = null;
    this.listeners = new Set();
  }

  /**
   * Verifica se há alguma operação ativa no momento.
   * @returns {boolean}
   */
  isBusy() {
    return Boolean(this.currentJob && this.currentJob.progress?.running !== false);
  }

  /**
   * Inicia um novo job assíncrono controlado.
   * Lança erro se já houver outro job em execução.
   * 
   * @param {string} name - Nome legível da operação (ex.: 'enquete_apply', 'obrigacoes_batch', 'enquete_cadastro')
   * @param {string} accountId - Código empId da conta
   * @param {object} initialProgress - Estrutura inicial de progresso
   * @returns {{ signal: AbortSignal, progress: any, finish: (result?: any) => void }}
   */
  startJob(name, accountId, initialProgress = {}) {
    if (this.isBusy()) {
      throw new Error(`Outra operação (${this.currentJob.name}) já está em andamento. Aguarde ou cancele antes de iniciar nova ação.`);
    }

    const abortController = new AbortController();
    const progress = {
      running: true,
      stage: 'iniciando',
      done: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      ...initialProgress
    };

    const jobId = `${name}-${Date.now()}`;
    this.currentJob = {
      id: jobId,
      name,
      accountId,
      abortController,
      startedAt: progress.startedAt,
      progress
    };

    const finish = (result = null) => {
      if (this.currentJob && this.currentJob.id === jobId) {
        this.currentJob.progress.running = false;
        if (result && typeof result === 'object') {
          Object.assign(this.currentJob.progress, result);
        }
        this.currentJob = null;
      }
    };

    return {
      signal: abortController.signal,
      progress,
      finish
    };
  }

  /**
   * Atualiza os campos de progresso da operação ativa.
   * @param {object} updates
   */
  updateProgress(updates = {}) {
    if (this.currentJob && this.currentJob.progress) {
      Object.assign(this.currentJob.progress, updates);
    }
  }

  /**
   * Obtém o objeto de progresso da operação ativa (ou estado inativo se nenhuma).
   * @returns {object}
   */
  getProgress() {
    if (this.currentJob && this.currentJob.progress) {
      return this.currentJob.progress;
    }
    return { running: false, stage: 'ocioso', done: 0, total: 0 };
  }

  /**
   * Interrompe o job ativo acionando o AbortSignal e atualizando o progresso.
   * @returns {{ cancelled: boolean, message: string }}
   */
  cancelActiveJob() {
    if (!this.currentJob) {
      return { cancelled: false, message: 'Nenhuma operação ativa para cancelar.' };
    }

    const jobName = this.currentJob.name;
    try {
      this.currentJob.abortController.abort();
    } catch {
      // Ignora erro de abort já acionado
    }

    if (this.currentJob.progress) {
      this.currentJob.progress.running = false;
      this.currentJob.progress.stage = 'cancelado';
      this.currentJob.progress.message = 'Operação interrompida pelo operador.';
    }

    this.currentJob = null;
    return {
      cancelled: true,
      message: `Operação "${jobName}" cancelada com sucesso.`
    };
  }
}

export const jobManager = new JobManager();
