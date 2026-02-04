import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parse277, parse835 } from '../parsers.js';

test('parse277 extracts STC, tracking, patient control number', () => {
  const content = 'TRN*1*TRK-3001*123456789~REF*1K*PAT-3001~STC*A1:19*20240101*U*CO:16~';
  const { rows, errors } = parse277(content);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackingNumber, 'TRK-3001');
  assert.equal(rows[0].patientControlNumber, 'PAT-3001');
  assert.equal(rows[0].status, 'A1:19');
});

test('parse835 extracts CLP identifiers and CAS adjustments', () => {
  const content = 'CLP*PCN-2001*1*1250*0*1250*12*PAT-2001*11~CAS*CO*16*1250~';
  const { rows, errors } = parse835(content);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].patientControlNumber, 'PCN-2001');
  assert.equal(rows[0].payerClaimNumber, 'PAT-2001');
  assert.equal(rows[0].adjustments.length, 1);
  assert.equal(rows[0].adjustments[0].groupCode, 'CO');
});
