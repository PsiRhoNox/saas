import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { detectEdiType, parse835, parse277, normalizeClaimEvent } from './parsers.js';
import { runDemoTriage } from './triage.js';

const storageDir = path.resolve('server/storage');
const state = {
  uploads: {},
  ediFiles: [],
  denials: [],
  payments: [],
  claims: [],
  unmatched: [],
  audit: [],
  integrations: [
    {
      id: 'int-001',
      tenantId: 'demo',
      name: 'Clearinghouse SFTP (demo)',
      host: 'sftp.demo-clearinghouse.com',
      user: 'demo-user',
      path: '/inbox',
      schedule: 'Cada 6 horas',
      timezone: 'UTC-5',
      lastPull: null,
      lastFile: null,
      errors: 0,
      status: 'inactive',
    },
  ],
};

const writeAudit = ({ action, detail, correlationId, source = 'system', before, after }) => {
  state.audit.unshift({
    id: Date.now(),
    ts: new Date().toISOString(),
    action,
    detail,
    correlationId,
    source,
    before,
    after,
  });
};

const saveRawFile = (fileName, content, checksum) => {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  const filePath = path.join(storageDir, `${checksum}-${fileName}`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
};

const upsertClaim = (normalized) => {
  const existing = state.claims.find((c) => c.externalId === normalized.externalId);
  if (existing) {
    Object.assign(existing, normalized);
    return existing;
  }
  state.claims.push(normalized);
  return normalized;
};

const addDenial = (denial) => {
  state.denials.push(denial);
};

const addPayment = (payment) => {
  state.payments.push(payment);
};

const checksum = (content) => crypto.createHash('sha256').update(content).digest('hex');

const processEdiFile = ({ tenantId, fileName, content }) => {
  const correlationId = crypto.randomUUID();
  const fileChecksum = checksum(content);
  if (state.ediFiles.find((f) => f.checksum === fileChecksum)) {
    return { status: 'duplicate', correlationId };
  }

  const type = detectEdiType(fileName, content);
  const rawPath = saveRawFile(fileName, content, fileChecksum);

  const ediFile = {
    id: `edi-${Date.now()}`,
    tenantId,
    fileName,
    type,
    checksum: fileChecksum,
    receivedAt: new Date().toISOString(),
    rawPath,
    status: 'received',
  };
  state.ediFiles.unshift(ediFile);
  writeAudit({ action: 'ingest_start', detail: `${fileName} (${type})`, correlationId });

  if (type === 'unknown') {
    ediFile.status = 'failed';
    state.unmatched.unshift({
      id: `unmatched-${Date.now()}`,
      externalId: null,
      reason: 'Tipo no reconocido',
      fileName,
      suggestion: 'Verificar que el archivo sea 277CA o 835.',
    });
    writeAudit({ action: 'ingest_fail', detail: 'Tipo no reconocido', correlationId });
    return { status: 'needs_review', correlationId };
  }

  const parsed = type === '835' ? parse835(content) : parse277(content);
  if (!parsed.length) {
    ediFile.status = 'failed';
    state.unmatched.unshift({
      id: `unmatched-${Date.now()}`,
      externalId: null,
      reason: 'Sin datos reconocibles',
      fileName,
      suggestion: 'Validar formato del archivo.',
    });
    writeAudit({ action: 'ingest_fail', detail: 'Sin datos', correlationId });
    return { status: 'needs_review', correlationId };
  }

  parsed.forEach((row) => {
    const normalized = normalizeClaimEvent(row, type);
    const claim = upsertClaim(normalized.claim);
    if (normalized.denial) {
      addDenial({ ...normalized.denial, claimId: claim.externalId, correlationId });
      const triage = runDemoTriage(claim, normalized.denial);
      claim.suggestedAction = triage.suggested_action_short;
      claim.triage = triage;
    }
    if (normalized.payment) {
      addPayment({ ...normalized.payment, claimId: claim.externalId, correlationId });
    }
  });

  ediFile.status = 'processed';
  writeAudit({ action: 'ingest_success', detail: `${fileName} procesado`, correlationId });
  return { status: 'processed', correlationId };
};

export const store = {
  state,
  processEdiFile,
  writeAudit,
};
