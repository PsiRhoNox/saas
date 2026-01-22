import assert from 'assert';
import { parse835, parse277, parseCsvWorkqueue } from './parsers.js';
import { store } from './store.js';

const sample835 = 'CLP*CLM-100*1*1250*950*300*12*12345*11~';
const parsed835 = parse835(sample835);
assert.equal(parsed835.length, 1);
assert.equal(parsed835[0].externalId, 'CLM-100');
assert.equal(parsed835[0].charged, 1250);

const sample277 = 'TRN*1*CLM-200*123456789~STC*A1:19*20240101*U*CO:16~';
const parsed277 = parse277(sample277);
assert.equal(parsed277.length, 1);
assert.equal(parsed277[0].externalId, 'CLM-200');

const sampleCsv = 'claim_id,denial_code,denial_reason,amount\nCLM-300,CO-16,Falta info,500';
const parsedCsv = parseCsvWorkqueue(sampleCsv);
assert.equal(parsedCsv.length, 1);
assert.equal(parsedCsv[0].externalId, 'CLM-300');

store.processEdiFile({ tenantId: 'demo', fileName: 'test835.edi', content: sample835 });
assert.ok(store.state.claims.find((c) => c.externalId === 'CLM-100'));

console.log('All tests passed');
