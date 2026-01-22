import { Injectable } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

@Injectable()
export class StorageService {
  private baseDir = path.resolve('backend/storage');

  saveRaw(fileName: string, content: string) {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const fileId = `${checksum}-${fileName}`;
    const filePath = path.join(this.baseDir, fileId);
    fs.writeFileSync(filePath, content, 'utf8');
    return fileId;
  }
}
