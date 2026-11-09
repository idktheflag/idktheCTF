# idktheCTF frontend

React/Vite SPA served by Cloudflare Workers Static Assets from the backend Worker. Build with `npm run build` at the repository root. All API requests use same-origin `/api`; local Vite proxies this path to Wrangler on port 8787.

For development, run `npm run dev --workspace=ctfv-frontend` alongside `npm run dev --workspace=ctfv-backend`. Set local `APP_URL=http://localhost:5173` in the backend `.dev.vars` so capability emails return to Vite.

Run component tests with `npm run test --workspace=ctfv-frontend` and lint with `npm run lint`. Browser security headers are configured in `public/_headers` and copied into the Worker assets build. Deployment uses the root `npm run deploy`; no separate frontend host is required.
