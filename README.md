# Denials Zero Desk

Prototipo React para el flujo de denials, scoring y auditoría.

## Requisitos
- Node.js 18+
- npm

## Uso (Demo Frontend)
```bash
npm install
npm run dev
```

## Qué incluye el demo
- Flujo completo en frontend (intake → cola → tareas → auditoría).
- Ingesta simulada de 277CA, 835 y CSV (ZIP no soportado).
- Datos ficticios sin PHI; todo se guarda solo en `localStorage`.

## Build
```bash
npm run build
npm run preview
```

## Plan por etapas
1. **Hoy (MVP demo)**: Intake manual, cola priorizada, tareas y auditoría.
2. **Siguiente**: Backend único con Postgres + colas de procesamiento.
3. **Producción**: Conectores SFTP reales, monitoreo y exportación automatizada.
