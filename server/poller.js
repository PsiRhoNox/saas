import fs from 'fs';
import path from 'path';
import { store } from './store.js';

const inboxDir = path.resolve('server/inbox');

const pollInbox = () => {
  if (!fs.existsSync(inboxDir)) return;
  const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith('.txt') || f.endsWith('.edi'));
  files.forEach((file) => {
    const content = fs.readFileSync(path.join(inboxDir, file), 'utf8');
    store.processEdiFile({ tenantId: 'demo', fileName: file, content });
    fs.renameSync(path.join(inboxDir, file), path.join(inboxDir, `${file}.processed`));
  });
};

setInterval(pollInbox, 10000);
console.log('SFTP poller simulado: revisa server/inbox cada 10s');
