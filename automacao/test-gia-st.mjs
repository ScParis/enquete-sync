#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { openBrowser, hasGclickSession, applyByColumnMatrix, LOGIN_URL } from './lib/gclick.mjs';

const profile = process.env.GCLICK_PROFILE_DIR || path.join(os.homedir(), '.local/share/gclick-enquete/browser-profile');
const lockPath = path.join(profile, 'automation.lock');

const TARGETS = [
  '68.699.407/0001-92',
  '68.699.448/0001-89'
];

async function acquireLock() {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number((await fs.readFile(lockPath, 'utf8')).trim());
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        throw new Error(`Outra automação está ativa (PID ${pid}). Encerre-a antes de rodar o teste.`);
      } catch (check) {
        if (check.code !== 'ESRCH') throw check;
      }
    }
    await fs.unlink(lockPath).catch(() => {});
    handle = await fs.open(lockPath, 'wx', 0o600);
  }
  await handle.writeFile(String(process.pid));
  return async () => {
    await handle.close();
    await fs.unlink(lockPath).catch(() => {});
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log(' TESTE CONTROLADO: SELEÇÃO POR MATRIZ (08 GIA ST)');
  console.log('='.repeat(70));
  console.log('Clientes alvo:');
  TARGETS.forEach((c, i) => console.log(`  [${i + 1}] CNPJ ${c}`));
  console.log('Obrigação: 08 GIA ST (Pergunta 02.03 - Dpto. Fiscal/Tributário)');
  console.log('-'.repeat(70));

  const unlock = await acquireLock();
  let context;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('Abrindo Chrome com o perfil de automação...');
    context = await openBrowser(profile, true);
    const page = context.pages()[0] ?? await context.newPage();

    if (!(await hasGclickSession(context, '6581'))) {
      console.log('Sessão expirada. Faça login no G-Click na janela aberta.');
      await page.goto(LOGIN_URL);
      while (true) {
        await rl.question('Pressione ENTER após abrir a Enquete da conta 6581...');
        if (await hasGclickSession(context, '6581')) break;
        console.log('Ainda não detectei a Enquete aberta. Tente novamente.');
      }
    }

    console.log('Navegando até a pergunta 02.03 e localizando a coluna 08 GIA ST...');
    const result = await applyByColumnMatrix(page, {
      accountId: '6581',
      category: 'Dpto. Fiscal/Tributário',
      questionRef: '02.03',
      question: 'Qual dessas Obrigações Estaduais são entregues para esse cliente ? (Part 2)',
      columnName: '08 GIA ST',
      cnpjs: TARGETS,
      onModalReady: async ({ modal, column, clientsToMark, shownIds, confirm }) => {
        console.log('\n' + '='.repeat(70));
        console.log(' 🛑 MODAL DE CONFIRMAÇÃO ABERTO NO G-CLICK!');
        console.log('='.repeat(70));
        console.log(`Coluna / Obrigação: ${column}`);
        console.log('Clientes marcados para alteração:');
        clientsToMark.forEach(c => {
          console.log(`  ✔ CNPJ: ${c.cnpj} | Internal ID: ${c.internalId}`);
          console.log(`    ${c.rowText}`);
        });
        console.log('\n>>> ATENÇÃO: O robô está pausado aguardando seu OK.');
        console.log('>>> Você pode conferir a tela no Chrome.');
        console.log('>>> Pressione ENTER no terminal para autorizar a gravação:');
        console.log('='.repeat(70) + '\n');

        const enterPromise = rl.question('');
        const clickPromise = modal.locator('#progressConfirmar').waitFor({ state: 'visible', timeout: 300000 });

        const winner = await Promise.race([
          enterPromise.then(() => 'enter'),
          clickPromise.then(() => 'browser_click')
        ]);

        if (winner === 'enter') {
          console.log('OK recebido no terminal! Clicando no botão Confirmar...');
          await confirm();
        } else {
          console.log('Confirmação acionada diretamente no navegador!');
        }

        console.log('Aguardando resposta do servidor G-Click...');
      }
    });

    console.log('\n' + '='.repeat(70));
    console.log(' RESULTADO DA OPERAÇÃO:');
    console.log('='.repeat(70));
    console.log(`Sucesso: ${result.success}`);
    console.log(`Coluna: ${result.column}`);
    console.log(`Clientes gravados: ${result.changed.length ? result.changed.join(', ') : 'Nenhum (já estavam marcados)'}`);
    if (result.results) {
      console.table(result.results);
    }
    console.log('Cores de confirmação:', result.confirmedColors);
    console.log('='.repeat(70));
  } finally {
    rl.close();
    if (context) await context.close();
    await unlock();
  }
}

main().catch(err => {
  console.error('\nErro no teste:', err.message);
  process.exitCode = 1;
});
