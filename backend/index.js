import http from 'node:http';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

const createSession = async (client, user) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await client.query(
    'INSERT INTO sessions (tenant_id, user_id, token, expires_at) VALUES ($1, $2, $3, $4)',
    [user.tenant_id, user.id, token, expiresAt]
  );
  return { token, expiresAt };
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
      const { rows } = await client.query(
        'INSERT INTO ingest_runs (tenant_id, status, created_by) VALUES ($1, $2, $3) RETURNING *',
        [user.tenant_id, 'queued', user.id]
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
      const { rows } = await client.query(
        `INSERT INTO edi_files (tenant_id, ingest_run_id, file_name, file_type, status, counts, errors)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          user.tenant_id,
          runId,
          body.fileName,
          body.fileType,
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
