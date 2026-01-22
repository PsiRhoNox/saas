import http from 'http';
import { parse } from 'url';
import fs from 'fs';
import { store } from './store.js';

const parseBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (error) {
        resolve({});
      }
    });
  });

const send = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
  const { pathname } = parse(req.url, true);
  if (req.method === 'POST' && pathname === '/api/v1/uploads/edi') {
    const body = await parseBody(req);
    const { tenantId = 'demo', fileName, content } = body;
    if (!fileName || !content) return send(res, 400, { error: 'fileName and content required' });
    const result = store.processEdiFile({ tenantId, fileName, content });
    return send(res, 200, { status: result.status, correlationId: result.correlationId });
  }

  if (req.method === 'GET' && pathname.startsWith('/api/v1/uploads/edi/')) {
    const id = pathname.split('/').pop();
    const upload = store.state.ediFiles.find((f) => f.id === id);
    return send(res, 200, { upload });
  }

  if (req.method === 'GET' && pathname === '/api/v1/uploads/edi') {
    return send(res, 200, { uploads: store.state.ediFiles });
  }

  if (req.method === 'POST' && pathname === '/api/v1/uploads/edi/retry') {
    const body = await parseBody(req);
    const file = store.state.ediFiles.find((f) => f.id === body.id);
    if (!file) return send(res, 404, { error: 'file not found' });
    const content = fs.readFileSync(file.rawPath, 'utf8');
    const result = store.processEdiFile({ tenantId: file.tenantId, fileName: file.fileName, content });
    return send(res, 200, { status: result.status, correlationId: result.correlationId });
  }

  if (req.method === 'GET' && pathname === '/api/v1/integrations') {
    return send(res, 200, { integrations: store.state.integrations });
  }

  if (req.method === 'POST' && pathname === '/api/v1/integrations') {
    const body = await parseBody(req);
    store.state.integrations.unshift({
      ...body,
      id: `int-${Date.now()}`,
      status: 'active',
      lastPull: null,
      lastFile: null,
      errors: 0,
    });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/v1/ai/triage/run') {
    const body = await parseBody(req);
    const denial = store.state.denials.find((d) => d.claimId === body.denialId);
    if (!denial) return send(res, 404, { error: 'denial not found' });
    return send(res, 200, { triage: denial.triage || denial });
  }

  if (req.method === 'GET' && pathname.startsWith('/api/v1/ai/triage/')) {
    const id = pathname.split('/').pop();
    const denial = store.state.denials.find((d) => d.claimId === id);
    return send(res, 200, { triage: denial?.triage || null });
  }

  if (req.method === 'POST' && pathname.startsWith('/api/v1/unmatched/')) {
    const id = pathname.split('/').pop();
    store.state.unmatched = store.state.unmatched.filter((u) => u.id !== id);
    store.writeAudit({ action: 'unmatched_resolved', detail: id, source: 'user' });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/v1/audit') {
    return send(res, 200, { audit: store.state.audit });
  }

  return send(res, 404, { error: 'not found' });
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`API listening on :${port}`);
});
