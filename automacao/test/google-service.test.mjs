import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseSheetUrl, makeServiceJwt, valuesToCsv, readWithServiceAccount } from '../lib/google-service.mjs';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const key = { type: 'service_account', client_email: 'leitor@projeto.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' };
test('identifica id e gid da aba', () => assert.deepEqual(parseSheetUrl('https://docs.google.com/spreadsheets/d/abc-123/edit?gid=150#gid=150'), { id: 'abc-123', gid: 150 }));
test('assina JWT de conta de serviço com escopo somente leitura', () => {
  const jwt = makeServiceJwt(key, 1000); const [h,p,s] = jwt.split('.');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
});
test('lê aba pela API e preserva CSV', async () => {
  const calls=[];
  const fetcher=async (url, options) => { calls.push(String(url));
    if (String(url).includes('oauth2')) return {ok:true,json:async()=>({access_token:'token'})};
    if (String(url).includes('?fields=')) return {ok:true,json:async()=>({sheets:[{properties:{sheetId:150,title:'Obrigações'}}]})};
    return {ok:true,json:async()=>({values:[['Obrigação / Tarefa','CNPJ'],['DAS - Mensal','19.402.991/0001-67']]})};
  };
  const csv=await readWithServiceAccount('https://docs.google.com/spreadsheets/d/abc-123/edit?gid=150',key,fetcher);
  assert.match(csv,/DAS - Mensal/); assert.equal(calls.length,3);
  assert.match(valuesToCsv([['A','B'],['x,y','z']]), /"x,y"/);
});
