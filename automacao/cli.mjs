#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { parseCsv, readScope, makePlan } from './lib/data.mjs';
import { LOGIN_URL, hasGclickSession, openBrowser, readGoogleCsv, openQuestion, inspectAll, applyBatch } from './lib/gclick.mjs';

const root = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const command = args.shift();
const get = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const has = key => args.includes(key);
const profile = process.env.GCLICK_PROFILE_DIR || path.join(os.homedir(), '.local/share/gclick-enquete/browser-profile');
const outputDir = path.join(root, 'runs');
const rules = JSON.parse(await fs.readFile(get('--rules') ?? path.join(root, 'regras.json'), 'utf8'));
if (!/^\d+$/.test(rules.accountId) || !/^\d+(?:\.\d+)+$/.test(rules.questionRef) || !/^\d+$/.test(rules.answerValue) || !rules.question || !rules.answerRef) throw new Error('regras.json inválido');

async function audit(payload) {
  await fs.mkdir(outputDir, { recursive: true });
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex') + '.json';
  const file = path.join(outputDir, name);
  await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  console.log(`Relatório: ${file}`);
}
function print(items) {
  console.table(items.map(x => ({ CNPJ: x.cnpj, EmpID: x.empId, tarefa: x.tasks?.filter(t => rules.allowedTasks.includes(t)).join(' | ') ?? '', planilha: x.status, GClick: x.uiStatus ?? '-', motivo: x.uiReason ?? x.reason ?? '' })));
}
async function openQuestionWithLogin(context, page) {
  try { return await openQuestion(page, rules); }
  catch (error) { if (!error.message.includes('Sessão do G-Click ausente/expirada')) throw error; }
  await page.goto(LOGIN_URL);
  console.log(`Entre no G-Click, selecione a conta ${rules.accountId} e abra a Enquete nesta janela.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      await rl.question('Pressione Enter após abrir a Enquete.');
      if (await hasGclickSession(context, rules.accountId)) break;
      console.log('A Enquete ainda não abriu nesta janela. Selecione a conta e tente novamente.');
    }
  } finally { rl.close(); }
  return openQuestion(page, rules);
}
async function lock(fn) {
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const lockPath = path.join(profile, 'automation.lock');
  let handle;
  try { handle = await fs.open(lockPath, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error(`Outra execução pode estar ativa. Confira e remova manualmente o lock obsoleto: ${lockPath}`); throw e; }
  try { await handle.writeFile(String(process.pid)); return await fn(); }
  finally { await handle.close(); await fs.unlink(lockPath).catch(() => {}); }
}

try {
  if (!['login', 'plan', 'preview', 'apply'].includes(command)) throw new Error('Uso: node cli.mjs <login|plan|preview|apply> --cnpjs lote.txt (--csv arquivo.csv | --sheet-url URL) [--apply]');
  if (command === 'login') {
    await lock(async () => {
      const context = await openBrowser(profile, true);
      try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(LOGIN_URL);
        console.log(`Entre no G-Click, selecione a conta ${rules.accountId} e abra a Enquete nessa janela.`);
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          while (true) {
            await rl.question('Pressione Enter para verificar o acesso à Enquete.');
            if (await hasGclickSession(context, rules.accountId)) break;
            console.log('A Enquete ainda não abriu nessa sessão. Selecione a conta e tente novamente.');
          }
        } finally { rl.close(); }
      } finally { await context.close(); }
    });
    process.exit(0);
  }
  const cnpjsPath = get('--cnpjs');
  const csvPath = get('--csv'); const sheetUrl = get('--sheet-url');
  if (!cnpjsPath || Number(Boolean(csvPath)) + Number(Boolean(sheetUrl)) !== 1) throw new Error('Informe --cnpjs e exatamente uma fonte: --csv ou --sheet-url');
  if (command === 'apply' && !has('--apply')) throw new Error('Gravação exige comando apply e flag --apply');
  const scope = await readScope(cnpjsPath);
  await lock(async () => {
    let context;
    let csv;
    try {
      if (csvPath) {
        if (command === 'apply' && Date.now() - (await fs.stat(csvPath)).mtimeMs > 24 * 60 * 60 * 1000) throw new Error('CSV tem mais de 24 horas. Exporte novamente a planilha para gravar.');
        csv = await fs.readFile(csvPath, 'utf8');
      }
      else {
        context = await openBrowser(profile, command !== 'plan');
        csv = await readGoogleCsv(context, sheetUrl);
      }
      const hash = crypto.createHash('sha256').update(csv).digest('hex');
      const plan = makePlan(parseCsv(csv), scope, rules);
      if (command === 'plan') {
        print(plan); await audit({ command, time: new Date().toISOString(), sourceSha256: hash, rules, plan });
        return;
      }
      context ??= await openBrowser(profile, true);
      const page = context.pages()[0] ?? await context.newPage();
      const detectedType = await openQuestionWithLogin(context, page);
      const resolvedRules = { ...rules, inputType: detectedType };
      const inspected = await inspectAll(page, plan, resolvedRules);
      print(inspected);
      if (command === 'preview') {
        await audit({ command, time: new Date().toISOString(), sourceSha256: hash, rules: resolvedRules, inspected });
        return;
      }
      let result;
      try { result = await applyBatch(page, inspected, resolvedRules); }
      catch (error) {
        await audit({ command, time: new Date().toISOString(), sourceSha256: hash, rules: resolvedRules, inspected, error: error.message, status: 'verificar_manualmente' });
        throw error;
      }
      await audit({ command, time: new Date().toISOString(), sourceSha256: hash, rules: resolvedRules, inspected, result, status: 'verificado' });
      console.log(`Gravados: ${result.changed.length}; verificados após recarga: ${result.verified.length}`);
    } finally { if (context) await context.close(); }
  });
} catch (error) { console.error(`Erro: ${error.message}`); process.exitCode = 1; }
