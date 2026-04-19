# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 – Build
# Build context must be the monorepo root so workspace packages are available.
# Example:  docker build -f frontend/Dockerfile -t club-erp-web .
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm via corepack (matches the packageManager field in package.json)
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /workspace

# ── 1. Copy workspace manifests first for better layer caching ─────────────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Workspace package manifests
COPY packages/api-client/package.json  packages/api-client/
COPY packages/i18n/package.json        packages/i18n/
COPY packages/ui/package.json          packages/ui/

# Frontend manifest
COPY frontend/package.json             frontend/

# ── 2. Install all workspace dependencies ─────────────────────────────────
RUN pnpm install --frozen-lockfile

# ── 3. Copy all source code ───────────────────────────────────────────────
COPY packages/ packages/
COPY frontend/  frontend/

# ── 4. Build the frontend (vite build) ───────────────────────────────────
WORKDIR /workspace/frontend

# In production the /api proxy in vite.config is irrelevant – Nginx handles it.
RUN pnpm run build


# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 – Production: serve the static bundle with Nginx
# ──────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove the default Nginx site
RUN rm /etc/nginx/conf.d/default.conf

# Nginx config that:
#   - serves the SPA (index.html fallback for client-side routing)
#   - forwards /api/* requests to the backend container at http://backend:8000
COPY frontend/nginx.conf /etc/nginx/conf.d/app.conf

# Copy the compiled Vite output
COPY --from=builder /workspace/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
