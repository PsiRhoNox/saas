import { Module } from '@nestjs/common';
import { IngestController } from '../controllers/ingest.controller.js';
import { IngestService } from '../services/ingest.service.js';
import { ParserService } from '../services/parser.service.js';
import { StorageService } from '../services/storage.service.js';
import { AuditService } from '../services/audit.service.js';

@Module({
  controllers: [IngestController],
  providers: [IngestService, ParserService, StorageService, AuditService],
})
export class AppModule {}
