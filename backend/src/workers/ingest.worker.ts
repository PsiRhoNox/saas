import { Processor, Process } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ParserService } from '../services/parser.service.js';

@Processor('ingest')
export class IngestWorker {
  constructor(private readonly parser: ParserService) {}

  @Process('parse')
  handle(job: Job) {
    return this.parser.processFile(job.data.input, job.data.fileId);
  }
}
