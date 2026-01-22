# Backend MVP (NestJS)

## Propósito
Backend mínimo para ingestión realista de 277CA/835/999 y CSV workqueue.

## Ejecutar (demo)
```bash
npm install
npm run start:dev
```

## Endpoints
- `POST /api/v1/ingest/upload` (JSON `{ tenantId, fileName, content }`)
- `POST /api/v1/ingest/sftp`
- `GET /api/v1/ingest/runs`
- `GET /api/v1/ingest/unmatched`

## Notas
- Persistencia en Postgres y storage S3 compatible están descritos en `prisma/schema.sql`.
- Workers BullMQ definidos en `src/workers/ingest.worker.ts`.
