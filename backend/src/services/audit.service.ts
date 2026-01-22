import { Injectable } from '@nestjs/common';

@Injectable()
export class AuditService {
  private logs: Array<Record<string, any>> = [];

  log(entry: Record<string, any>) {
    this.logs.unshift({
      id: Date.now(),
      ts: new Date().toISOString(),
      ...entry,
    });
  }

  list() {
    return this.logs;
  }
}
