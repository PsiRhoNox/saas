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
- `GET /audit`
- `POST /ingest_runs`
- `POST /ingest_runs/:id/files`
