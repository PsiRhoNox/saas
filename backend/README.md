# Backend mínimo (Fase 1)

Backend sin framework para Fase 1: autenticación básica, multi‑tenant, RLS y audit_log append‑only.

## Requisitos
- Node.js 18+
- PostgreSQL 14+

## Configuración
1. Crea una base de datos y aplica el esquema:
   ```bash
   psql "$DATABASE_URL" -f backend/schema.sql
   ```
2. Define `DATABASE_URL` y arranca el servidor:
   ```bash
   export DATABASE_URL="postgres://user:pass@localhost:5432/denials_zero"
   node backend/index.js
   ```

## Flujo mínimo
- Crea un tenant y usuario directamente en DB (la primera vez).
- Usa `POST /auth/login` para obtener token.
- Usa el token en `Authorization: Bearer <token>` para el resto de endpoints.
- Sube archivos en base64 y dispara el procesamiento del lote.

## Storage de archivos
Los archivos se guardan como raw file en disco local por defecto (`backend/storage`). En producción, el mismo pipeline puede
apuntar a un storage compatible con S3.

## Endpoints mínimos
- `POST /auth/login`
- `GET /me`
- `GET /claims`
- `GET /claims/:id`
- `POST /claims/:id/status`
- `GET /denials`
- `GET /tasks`
- `POST /tasks`
- `POST /tasks/:id/complete`
- `POST /tasks/:id/escalate`
- `GET /audit`
- `GET /sftp_integrations`
- `POST /sftp_integrations`
- `GET /playbooks`
- `POST /playbooks`
- `POST /playbooks/:id/apply`
- `POST /claims/:id/documents`
- `POST /claims/:id/submission_status`
- `GET /claims/:id/work_package`
- `POST /ingest_runs`
- `POST /ingest_runs/:id/files`
- `POST /ingest_runs/:id/process`

## Workflow operativo (Fase 4)
El backend modela tareas, playbooks, drafts de apelación/resubmission, y estados de submission dentro del sistema. El envío
real ocurre fuera de la plataforma: se registran evidencias (confirmación o archivo adjunto) sin prometer envío automático.

## Integración SFTP (Fase 5)
El poller de SFTP permite pasar de piloto a producción sin cambiar la operación diaria. Se configura por tenant con host,
usuario, llave, carpeta, patrón y zona horaria. El worker crea `ingest_runs` + `edi_files` y reusa el pipeline de proceso.

### Worker de polling
```bash
node backend/sftp_poller.js
```

## Ingestión (manual)
Ejemplo de carga:
```bash
curl -X POST http://localhost:4000/ingest_runs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"correlationId":"demo-batch-001"}'
```

```bash
curl -X POST http://localhost:4000/ingest_runs/<RUN_ID>/files \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"demo-835.txt","contentBase64":"<BASE64>"}'
```

```bash
curl -X POST http://localhost:4000/ingest_runs/<RUN_ID>/process \
  -H "Authorization: Bearer $TOKEN"
```
