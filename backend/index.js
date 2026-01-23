import fs from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import { detectEdiType, parse277, parse835, parse999, parseCsv } from './parsers.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const parseBody = async (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
  });

const checksumFor = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
};

const verifyPassword = (password, stored) => {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const derived = crypto.pbkdf2Sync(password, salt, Number(iter), 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
};

const ensureStorageDir = async () => {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
};

const createSession = async (client, user) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await client.query(
    'INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)',
    [user.tenant_id, user.id, token, expiresAt]
  );
  return { token, expiresAt };
};

const selectClaimMatch = async (client, tenantId, identifiers) => {
  if (identifiers.patientControlNumber) {
    const result = await client.query(
      `SELECT * FROM claims
       WHERE tenant_id = $1 AND patient_control_number = $2
       LIMIT 1`,
      [tenantId, identifiers.patientControlNumber]
    );
    if (result.rowCount) return result.rows[0];
  }
  if (identifiers.payerClaimNumber) {
    const result = await client.query(
      `SELECT * FROM claims
       WHERE tenant_id = $1 AND payer_claim_number = $2
       LIMIT 1`,
      [tenantId, identifiers.payerClaimNumber]
    );
    if (result.rowCount) return result.rows[0];
  }
  if (identifiers.trackingNumber) {
    const result = await client.query(
      `SELECT * FROM claims
       WHERE tenant_id = $1 AND tracking_number = $2
       LIMIT 1`,
      [tenantId, identifiers.trackingNumber]
    );
    if (result.rowCount) return result.rows[0];
  }
  if (identifiers.externalId) {
    const result = await client.query(
      `SELECT * FROM claims
       WHERE tenant_id = $1 AND external_id = $2
       LIMIT 1`,
      [tenantId, identifiers.externalId]
    );
    if (result.rowCount) return result.rows[0];
  }
  return null;
};

const upsertClaim = async (client, tenantId, identifiers, data) => {
  const match = await selectClaimMatch(client, tenantId, identifiers);
  if (match) {
    const updated = await client.query(
      `UPDATE claims
       SET patient_control_number = COALESCE($1, patient_control_number),
           payer_claim_number = COALESCE($2, payer_claim_number),
           tracking_number = COALESCE($3, tracking_number),
           amount = COALESCE($4, amount),
           payer = COALESCE($5, payer),
           denied_at = COALESCE($6, denied_at)
       WHERE id = $7
       RETURNING *`,
      [
        identifiers.patientControlNumber || null,
        identifiers.payerClaimNumber || null,
        identifiers.trackingNumber || null,
        data.amount || null,
        data.payer || null,
        data.deniedAt || null,
        match.id,
      ]
    );
    return { claim: updated.rows[0], matched: true };
  }
  const created = await client.query(
    `INSERT INTO claims (tenant_id, external_id, patient_control_number, payer_claim_number, tracking_number, payer, amount, status, denied_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      tenantId,
      identifiers.externalId || null,
      identifiers.patientControlNumber || null,
      identifiers.payerClaimNumber || null,
      identifiers.trackingNumber || null,
      data.payer || 'Unknown',
      data.amount || 0,
      'pending',
      data.deniedAt || null,
    ]
  );
  return { claim: created.rows[0], matched: false };
};

const recordEvent = async (client, tenantId, eventKey, entityType, entityId) => {
  const result = await client.query(
    `INSERT INTO ingest_events (tenant_id, event_key, entity_type, entity_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, event_key) DO NOTHING
     RETURNING id`,
    [tenantId, eventKey, entityType, entityId]
  );
  return result.rowCount > 0;
};

const withTenant = async (req, res, handler) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    json(res, 401, { error: 'missing_token' });
    return;
  }
  const client = await pool.connect();
  try {
    const sessionResult = await client.query(
      `SELECT sessions.token, sessions.expires_at, users.id, users.tenant_id, users.role, users.email
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = $1`,
      [token]
    );
    if (!sessionResult.rowCount) {
      json(res, 401, { error: 'invalid_token' });
      return;
    }
    const user = sessionResult.rows[0];
    if (new Date(user.expires_at) < new Date()) {
      json(res, 401, { error: 'expired_token' });
      return;
    }
    await client.query('BEGIN');
    await client.query('SET LOCAL app.tenant_id = $1', [user.tenant_id]);
    await handler(client, user);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    json(res, 500, { error: 'server_error', detail: error.message });
  } finally {
    client.release();
  }
};

const routes = async (req, res) => {
  if (req.method === 'POST' && req.url === '/auth/login') {
    try {
      const body = await parseBody(req);
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT * FROM users WHERE email = $1', [body.email]);
        if (!result.rowCount || !verifyPassword(body.password || '', result.rows[0].password_hash)) {
          json(res, 401, { error: 'invalid_credentials' });
          return;
        }
        const session = await createSession(client, result.rows[0]);
        json(res, 200, {
          token: session.token,
          expiresAt: session.expiresAt,
          user: { id: result.rows[0].id, email: result.rows[0].email, role: result.rows[0].role },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      json(res, 400, { error: 'invalid_json' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/me') {
    return withTenant(req, res, async (_client, user) => {
      json(res, 200, { user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenant_id } });
    });
  }

  if (req.method === 'GET' && req.url === '/claims') {
    return withTenant(req, res, async (client) => {
      const { rows } = await client.query('SELECT * FROM claims ORDER BY created_at DESC');
      json(res, 200, { claims: rows });
    });
  }

  if (req.method === 'GET' && req.url.startsWith('/claims/')) {
    const claimId = req.url.split('/')[2];
    return withTenant(req, res, async (client) => {
      const { rows } = await client.query('SELECT * FROM claims WHERE id = $1', [claimId]);
      if (!rows.length) return json(res, 404, { error: 'not_found' });
      json(res, 200, { claim: rows[0] });
    });
  }

  if (req.method === 'POST' && req.url.startsWith('/claims/') && req.url.endsWith('/status')) {
    const claimId = req.url.split('/')[2];
    return withTenant(req, res, async (client, user) => {
      const body = await parseBody(req);
      const { rows } = await client.query(
        'UPDATE claims SET status = $1 WHERE id = $2 RETURNING *',
        [body.status, claimId]
      );
      if (!rows.length) return json(res, 404, { error: 'not_found' });
      await client.query(
        'INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [user.tenant_id, 'claim.status_changed', 'claim', claimId, `Status -> ${body.status}`, user.id]
      );
      json(res, 200, { claim: rows[0] });
    });
  }

  if (req.method === 'GET' && req.url === '/denials') {
    return withTenant(req, res, async (client) => {
      const { rows } = await client.query('SELECT * FROM denials ORDER BY created_at DESC');
      json(res, 200, { denials: rows });
    });
  }

  if (req.method === 'GET' && req.url === '/tasks') {
    return withTenant(req, res, async (client) => {
      const { rows } = await client.query('SELECT * FROM tasks ORDER BY created_at DESC');
      json(res, 200, { tasks: rows });
    });
  }

  if (req.method === 'POST' && req.url === '/tasks') {
    return withTenant(req, res, async (client, user) => {
      const body = await parseBody(req);
      const { rows } = await client.query(
        `INSERT INTO tasks (tenant_id, claim_id, title, task_type, status, owner_role, owner_name, due_date, next_follow_up_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          user.tenant_id,
          body.claimId,
          body.title,
          body.taskType,
          body.status || 'open',
          body.ownerRole,
          body.ownerName,
          body.dueDate || null,
          body.nextFollowUpAt || null,
        ]
      );
      await client.query(
        'INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [user.tenant_id, 'task.created', 'task', rows[0].id, rows[0].title, user.id]
      );
      json(res, 201, { task: rows[0] });
    });
  }

  if (req.method === 'POST' && req.url.startsWith('/tasks/') && req.url.endsWith('/complete')) {
    const taskId = req.url.split('/')[2];
    return withTenant(req, res, async (client, user) => {
      const { rows } = await client.query(
        'UPDATE tasks SET status = $1, completed_at = now() WHERE id = $2 RETURNING *',
        ['done', taskId]
      );
      if (!rows.length) return json(res, 404, { error: 'not_found' });
      await client.query(
        'INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [user.tenant_id, 'task.completed', 'task', taskId, rows[0].title, user.id]
      );
      json(res, 200, { task: rows[0] });
    });
  }

  if (req.method === 'GET' && req.url === '/audit') {
    return withTenant(req, res, async (client) => {
      const { rows } = await client.query('SELECT * FROM audit_log ORDER BY created_at DESC');
      json(res, 200, { audit: rows });
    });
  }

  if (req.method === 'POST' && req.url === '/ingest_runs') {
    return withTenant(req, res, async (client, user) => {
      const body = await parseBody(req);
      const { rows } = await client.query(
        'INSERT INTO ingest_runs (tenant_id, status, created_by, correlation_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [user.tenant_id, 'queued', user.id, body.correlationId || crypto.randomUUID()]
      );
      await client.query(
        'INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [user.tenant_id, 'ingest_run.created', 'ingest_run', rows[0].id, 'Ingest run created', user.id]
      );
      json(res, 201, { ingestRun: rows[0] });
    });
  }

  if (req.method === 'POST' && req.url.startsWith('/ingest_runs/') && req.url.endsWith('/files')) {
    const runId = req.url.split('/')[2];
    return withTenant(req, res, async (client, user) => {
      const body = await parseBody(req);
      await ensureStorageDir();
      const rawBuffer = Buffer.from(body.contentBase64 || '', 'base64');
      const checksum = checksumFor(rawBuffer);
      const detectedType = detectEdiType(body.fileName || 'upload', rawBuffer.toString('utf8'));
      const storagePath = path.join(STORAGE_DIR, `${checksum}-${body.fileName || 'upload'}`);
      const existing = await client.query(
        'SELECT * FROM edi_files WHERE tenant_id = $1 AND checksum = $2',
        [user.tenant_id, checksum]
      );
      if (existing.rowCount) {
        json(res, 200, { file: existing.rows[0], deduped: true });
        return;
      }
      await fs.writeFile(storagePath, rawBuffer);
      const { rows } = await client.query(
        `INSERT INTO edi_files (tenant_id, ingest_run_id, file_name, file_type, checksum, storage_path, detected_type, status, counts, errors)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          user.tenant_id,
          runId,
          body.fileName,
          body.fileType || detectedType,
          checksum,
          storagePath,
          detectedType,
          body.status || 'queued',
          body.counts || {},
          body.errors || [],
        ]
      );
      await client.query(
        'INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [user.tenant_id, 'edi_file.created', 'edi_file', rows[0].id, body.fileName, user.id]
      );
      json(res, 201, { file: rows[0] });
    });
  }

  if (req.method === 'POST' && req.url.startsWith('/ingest_runs/') && req.url.endsWith('/process')) {
    const runId = req.url.split('/')[2];
    return withTenant(req, res, async (client, user) => {
      const files = await client.query(
        'SELECT * FROM edi_files WHERE ingest_run_id = $1 ORDER BY created_at ASC',
        [runId]
      );
      const runCounts = { files: files.rowCount, denials: 0, payments: 0, unmatched: 0 };
      for (const file of files.rows) {
        const content = await fs.readFile(file.storage_path, 'utf8');
        const type = file.detected_type;
        let rows = [];
        let errors = [];
        if (type === '835') ({ rows, errors } = parse835(content));
        if (type === '277CA') ({ rows, errors } = parse277(content));
        if (type === 'CSV') ({ rows, errors } = parseCsv(content));
        if (type === '999') ({ rows, errors } = parse999(content));
        const summary = { claims: rows.length, denials: 0, payments: 0, unmatched: 0 };
        for (const row of rows) {
          const identifiers = {
            patientControlNumber: row.patientControlNumber || row.patient_control_number || row.patient_control || '',
            payerClaimNumber: row.payerClaimNumber || row.payer_claim_number || row.claim_id || '',
            trackingNumber: row.trackingNumber || row.tracking_number || '',
            externalId: row.claimId || row.claim_id || '',
          };
          const result = await upsertClaim(client, user.tenant_id, identifiers, {
            amount: row.charged || row.amount || 0,
            payer: row.payer || 'Unknown',
            deniedAt: new Date().toISOString().slice(0, 10),
          });
          if (!result.matched) {
            summary.unmatched += 1;
            runCounts.unmatched += 1;
            await client.query(
              `INSERT INTO unmatched_items (tenant_id, ingest_run_id, reason, payload)
               VALUES ($1, $2, $3, $4)`,
              [
                user.tenant_id,
                runId,
                'Claim no encontrado en matching',
                {
                  identifiers,
                  detectedType: type,
                  fileId: file.id,
                },
              ]
            );
          }
          if (type === '835') {
            const denialAdjustments = row.adjustments?.filter((adj) => adj.amount > 0) || [];
            const nonPrAdjustments = denialAdjustments.filter((adj) => adj.groupCode !== 'PR');
            const isDenied =
              row.paid === 0 || nonPrAdjustments.some((adj) => ['CO', 'PI', 'OA'].includes(adj.groupCode));
            if (isDenied && nonPrAdjustments.length) {
              const primary = nonPrAdjustments[0];
              const eventKey = `${file.id}:${result.claim.id}:denial:${primary.groupCode}-${primary.reasonCode}`;
              const created = await recordEvent(client, user.tenant_id, eventKey, 'denial', null);
              if (created) {
                await client.query(
                  `INSERT INTO denials (tenant_id, claim_id, code, reason)
                   VALUES ($1, $2, $3, $4)`,
                  [
                    user.tenant_id,
                    result.claim.id,
                    `${primary.groupCode}-${primary.reasonCode}`,
                    `Ajuste ${primary.reasonCode}`,
                  ]
                );
                summary.denials += 1;
                runCounts.denials += 1;
              }
            }
            if (row.paid > 0) {
              const eventKey = `${file.id}:${result.claim.id}:payment:${row.paid}`;
              const created = await recordEvent(client, user.tenant_id, eventKey, 'payment', null);
              if (created) {
                await client.query(
                  `INSERT INTO payments (tenant_id, claim_id, amount, paid_at)
                   VALUES ($1, $2, $3, $4)`,
                  [user.tenant_id, result.claim.id, row.paid, new Date().toISOString().slice(0, 10)]
                );
                summary.payments += 1;
                runCounts.payments += 1;
              }
            }
          }
          if (type === '277CA') {
            const status = row.status || '';
            if (status.startsWith('A1') || status.startsWith('A7') || status.startsWith('R') || status.startsWith('E')) {
              const eventKey = `${file.id}:${result.claim.id}:denial:${status}`;
              const created = await recordEvent(client, user.tenant_id, eventKey, 'denial', null);
              if (created) {
                await client.query(
                  `INSERT INTO denials (tenant_id, claim_id, code, reason)
                   VALUES ($1, $2, $3, $4)`,
                  [user.tenant_id, result.claim.id, `277-${status.split(':')[0]}`, `Estatus ${status}`]
                );
                summary.denials += 1;
                runCounts.denials += 1;
              }
            }
          }
          if (type === 'CSV' && row.denial_code) {
            const eventKey = `${file.id}:${result.claim.id}:denial:${row.denial_code}`;
            const created = await recordEvent(client, user.tenant_id, eventKey, 'denial', null);
            if (created) {
              await client.query(
                `INSERT INTO denials (tenant_id, claim_id, code, reason)
                 VALUES ($1, $2, $3, $4)`,
                [user.tenant_id, result.claim.id, row.denial_code, row.denial_reason || 'CSV denial']
              );
              summary.denials += 1;
              runCounts.denials += 1;
            }
          }
        }
        const status = errors.length ? 'error' : 'processed';
        await client.query(
          `UPDATE edi_files
           SET status = $1, counts = $2, errors = $3, processed_at = now()
           WHERE id = $4`,
          [status, summary, errors, file.id]
        );
        await client.query(
          'INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
          [user.tenant_id, 'edi_file.processed', 'edi_file', file.id, `${file.file_name} processed`, user.id]
        );
      }
      await client.query('UPDATE ingest_runs SET status = $1 WHERE id = $2', ['completed', runId]);
      json(res, 200, { runId, summary: runCounts });
    });
  }

  json(res, 404, { error: 'not_found' });
};

const server = http.createServer((req, res) => {
  routes(req, res).catch((error) => {
    json(res, 500, { error: 'server_error', detail: error.message });
  });
});

server.listen(process.env.PORT || 4000, () => {
  // eslint-disable-next-line no-console
  console.log('Backend listening on port 4000');
});
