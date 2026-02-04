import crypto from 'node:crypto';
import { Pool } from 'pg';
import SftpClient from 'ssh2-sftp-client';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const checksumFor = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const detectEdiType = (fileName, content) => {
  const upper = `${fileName} ${content}`.toUpperCase();
  if (fileName.toLowerCase().endsWith('.csv')) return 'CSV';
  if (upper.includes('835') || upper.includes('BPR') || upper.includes('CLP')) return '835';
  if (upper.includes('277') || upper.includes('STC')) return '277CA';
  if (upper.includes('999')) return '999';
  return 'unknown';
};

const createIngestRun = async (client, tenantId, createdBy = null) => {
  const { rows } = await client.query(
    'INSERT INTO ingest_runs (tenant_id, status, created_by, correlation_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [tenantId, 'queued', createdBy, crypto.randomUUID()]
  );
  return rows[0];
};

const fetchAndStoreFiles = async (client, integration) => {
  const sftp = new SftpClient();
  const filesFetched = [];
  const errors = [];
  try {
    await sftp.connect({
      host: integration.host,
      username: integration.username,
      privateKey: integration.private_key,
    });
    const list = await sftp.list(integration.remote_path);
    const candidates = list.filter((file) => file.type === '-' && file.name.match(new RegExp(integration.file_pattern.replace('*', '.*'))));
    if (!candidates.length) {
      return { filesFetched: 0, errors: 0 };
    }
    const ingestRun = await createIngestRun(client, integration.tenant_id, null);
    for (const file of candidates) {
      const remote = `${integration.remote_path}/${file.name}`;
      const buffer = await sftp.get(remote);
      const checksum = checksumFor(buffer);
      const existing = await client.query(
        'SELECT id FROM edi_files WHERE tenant_id = $1 AND checksum = $2',
        [integration.tenant_id, checksum]
      );
      if (existing.rowCount) continue;
      const detectedType = detectEdiType(file.name, buffer.toString('utf8'));
      await client.query(
        `INSERT INTO edi_files (tenant_id, ingest_run_id, file_name, file_type, checksum, storage_path, detected_type, status, counts, errors)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          integration.tenant_id,
          ingestRun.id,
          file.name,
          detectedType,
          checksum,
          `sftp://${integration.host}${remote}`,
          detectedType,
          'queued',
          {},
          [],
        ]
      );
      filesFetched.push(file.name);
    }
    await client.query(
      'UPDATE sftp_integrations SET last_pull_at = now(), last_file_name = $1, error_message = NULL WHERE id = $2',
      [filesFetched[filesFetched.length - 1] || null, integration.id]
    );
    await client.query(
      'INSERT INTO sftp_poll_logs (tenant_id, integration_id, status, files_fetched, errors, detail) VALUES ($1, $2, $3, $4, $5, $6)',
      [integration.tenant_id, integration.id, 'ok', filesFetched.length, 0, `Fetched ${filesFetched.length} files`]
    );
    return { filesFetched: filesFetched.length, errors: 0 };
  } catch (error) {
    errors.push(error.message);
    await client.query(
      'UPDATE sftp_integrations SET error_message = $1 WHERE id = $2',
      [error.message, integration.id]
    );
    await client.query(
      'INSERT INTO sftp_poll_logs (tenant_id, integration_id, status, files_fetched, errors, detail) VALUES ($1, $2, $3, $4, $5, $6)',
      [integration.tenant_id, integration.id, 'error', 0, 1, error.message]
    );
    return { filesFetched: 0, errors: 1 };
  } finally {
    sftp.end();
  }
};

const run = async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM sftp_integrations WHERE status = $1', ['active']);
    for (const integration of rows) {
      await client.query('BEGIN');
      await client.query('SET LOCAL app.tenant_id = $1', [integration.tenant_id]);
      await fetchAndStoreFiles(client, integration);
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('SFTP poller failed', error);
  } finally {
    client.release();
  }
};

run().finally(() => pool.end());
