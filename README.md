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
- Vite corre sin `@vitejs/plugin-react`; Fast Refresh puede no estar disponible en este modo.

## Build
```bash
npm run build
npm run preview
```

## Deploy en Hostinger (Vite)
Si Hostinger marca “Unsupported framework or invalid project structure”, revisa:
- **Raíz del repo**: `package.json`, `index.html` y `vite.config.js` deben estar en la raíz del repositorio.
- **Rama correcta**: selecciona la rama que contiene el código (no solo README).
- **Repositorio limpio**: no subas `node_modules` (ya está en `.gitignore`).

Configuración recomendada en Hostinger:
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Start command**: `npm run start` (usa `PORT` del entorno)

> Nota: en este demo `vite preview` reemplaza al servidor de producción. Si tu panel exige un servidor dedicado, puedes usar un adaptador externo, pero este setup funciona para demos.

## Plan por etapas
1. **Hoy (MVP demo)**: Intake manual, cola priorizada, tareas y auditoría.
2. **Siguiente**: Backend único con Postgres + colas de procesamiento.
3. **Producción**: Conectores SFTP reales, monitoreo y exportación automatizada.
