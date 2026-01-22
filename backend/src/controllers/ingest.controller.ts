import { Body, Controller, Get, Post } from '@nestjs/common';
import { IngestService } from '../services/ingest.service.js';
import { IngestUploadDto, SftpConfigDto } from '../dto/ingest.dto.js';

@Controller('ingest')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('upload')
  upload(@Body() body: IngestUploadDto) {
    return this.ingestService.enqueueUpload(body);
  }

  @Post('sftp')
  configureSftp(@Body() body: SftpConfigDto) {
    return this.ingestService.saveSftpConfig(body);
  }

  @Get('runs')
  listRuns() {
    return this.ingestService.listRuns();
  }

  @Get('unmatched')
  listUnmatched() {
    return this.ingestService.listUnmatched();
  }
}
