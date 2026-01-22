import { Injectable } from '@nestjs/common';
import { detectEdiType, parse835, parse277, parseCsvWorkqueue, parse999 } from '../parsers/x12.parser.js';

@Injectable()
export class ParserService {
  processFile(input: { tenantId: string; fileName: string; content: string }, fileId: string) {
    const type = detectEdiType(input.fileName, input.content);
    if (type === 'unknown') {
      return {
        status: 'failed',
        unmatched: [
          {
            id: `unmatched-${Date.now()}`,
            fileId,
            reason: 'Tipo no soportado',
            suggestion: 'Sube 277CA/835/999 o CSV de workqueue.',
          },
        ],
      };
    }

    if (type === 'csv') {
      const parsed = parseCsvWorkqueue(input.content);
      return { status: 'processed', parsed };
    }

    if (type === '999') {
      return { status: 'processed', parsed: parse999(input.content) };
    }

    if (type === '835') {
      return { status: 'processed', parsed: parse835(input.content) };
    }

    return { status: 'processed', parsed: parse277(input.content) };
  }
}
