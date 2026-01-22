# Denials Zero Desk

Prototipo React para el flujo de denials, scoring y auditoría.

## Requisitos
- Node.js 18+
- npm

## Uso (Frontend)
```bash
npm install
npm run dev
```

## API local (demo)
Este MVP incluye un backend mínimo sin dependencias para simular carga de EDI y triage.

```bash
node server/index.js
```

Opcional: simular polling SFTP dejando archivos en `server/inbox`.

```bash
node server/poller.js
```

### Endpoints demo
- `POST /api/v1/uploads/edi` (JSON `{ tenantId, fileName, content }`)
- `GET /api/v1/uploads/edi/:id/status`
- `GET /api/v1/integrations`
- `POST /api/v1/integrations`
- `POST /api/v1/ai/triage/run`
- `GET /api/v1/ai/triage/:denialId`
- `POST /api/v1/unmatched/:id/resolve`

## Build
```bash
npm run build
npm run preview
```

## Testing
```bash
npm run build
```
