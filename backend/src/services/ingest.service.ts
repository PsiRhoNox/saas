import { Injectable } from '@nestjs/common';
import { IngestUploadDto, SftpConfigDto } from '../dto/ingest.dto.js';
import { ParserService } from './parser.service.js';
import { StorageService } from './storage.service.js';
import { AuditService } from './audit.service.js';

@Injectable()
export class IngestService {
  private runs: Array<Record<string, any>> = [];
  private unmatched: Array<Record<string, any>> = [];
  private sftpConfigs: Array<Record<string, any>> = [];

  constructor(
    private readonly parser: ParserService,
    private readonly storage: StorageService,
    private readonly audit: AuditService
  ) {}

  enqueueUpload(body: IngestUploadDto) {
    const runId = `run-${Date.now()}`;
    const fileId = this.storage.saveRaw(body.fileName, body.content);
    this.runs.unshift({
      id: runId,
      tenantId: body.tenantId,
      fileId,
      status: 'received',
      createdAt: new Date().toISOString(),
    });
    this.audit.log({
      action: 'ingest_start',
      detail: body.fileName,
      source: 'system',
      requestId: runId,
    });

    const result = this.parser.processFile(body, fileId);
    if (result.unmatched?.length) {
      this.unmatched.unshift(...result.unmatched);
    }
    this.runs[0].status = result.status;
    this.audit.log({
      action: result.status === 'processed' ? 'ingest_success' : 'ingest_fail',
      detail: body.fileName,
      source: 'system',
      requestId: runId,
    });

    return { runId, status: result.status };
  }

  saveSftpConfig(body: SftpConfigDto) {
    this.sftpConfigs.unshift({
      ...body,
      id: `sftp-${Date.now()}`,
      status: 'active',
      lastPull: null,
    });
    this.audit.log({ action: 'sftp_configured', detail: body.host, source: 'user' });
    return { ok: true };
  }

  listRuns() {
    return { runs: this.runs };
  }

  listUnmatched() {
    return { unmatched: this.unmatched };
  }
}
