import test from 'node:test';
import assert from 'node:assert/strict';
import { jobManager } from '../lib/job-manager.mjs';

test('JobManager: ciclo de vida de job, bloqueio de concorrência e cancelamento', async () => {
  assert.equal(jobManager.isBusy(), false);
  assert.equal(jobManager.getProgress().running, false);

  // Inicia job
  const job = jobManager.startJob('test_job', '6019', { custom: 123 });
  assert.equal(jobManager.isBusy(), true);
  assert.equal(job.signal.aborted, false);
  assert.equal(jobManager.getProgress().running, true);
  assert.equal(jobManager.getProgress().custom, 123);

  // Tentativa de iniciar outro job simultâneo deve falhar
  assert.throws(() => {
    jobManager.startJob('another_job', '6019');
  }, /já está em andamento/);

  // Atualização de progresso
  jobManager.updateProgress({ done: 5, total: 10, stage: 'processando' });
  assert.equal(jobManager.getProgress().done, 5);
  assert.equal(jobManager.getProgress().total, 10);
  assert.equal(jobManager.getProgress().stage, 'processando');

  // Cancelamento
  const cancelResult = jobManager.cancelActiveJob();
  assert.equal(cancelResult.cancelled, true);
  assert.equal(job.signal.aborted, true);
  assert.equal(jobManager.isBusy(), false);

  // Segundo cancelamento não falha e informa que nada está ativo
  const cancelAgain = jobManager.cancelActiveJob();
  assert.equal(cancelAgain.cancelled, false);
});

test('JobManager: finalização normal com finish()', async () => {
  const job = jobManager.startJob('normal_job', '6019', { total: 1 });
  assert.equal(jobManager.isBusy(), true);

  job.finish({ stage: 'concluido', done: 1 });
  assert.equal(jobManager.isBusy(), false);
});
