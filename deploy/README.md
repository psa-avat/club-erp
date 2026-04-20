# ERP Club – Deployment Guide

> Covers local development, VPS production deployment (shared with the CarnetDeVol stack),
> database provisioning inside the shared `carnet-db` postgres, and routine database
> operations (backup, restore, seeding).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Environment files](#2-environment-files)
3. [Local development](#3-local-development)
4. [VPS – network architecture](#4-vps--network-architecture)
5. [VPS – one-time infrastructure setup](#5-vps--one-time-infrastructure-setup)
6. [VPS – provision the ERP database inside carnet-db](#6-vps--provision-the-erp-database-inside-carnet-db)
7. [VPS – first deployment](#7-vps--first-deployment)
8. [VPS – updating to a new version](#8-vps--updating-to-a-new-version)
9. [Database operations – backup, restore, seeding](#9-database-operations--backup-restore-seeding)
10. [Watchtower – auto-updates with GHCR](#10-watchtower--auto-updates-with-ghcr)
11. [CI/CD – GitHub Actions](#11-cicd--github-actions)
12. [Useful daily commands](#12-useful-daily-commands)

---

## 1. Prerequisites

| Tool | Min version | Notes |
|---|---|---|
| Docker | 25+ | Compose v2 built-in (`docker compose`) |
| pnpm | 10.5.2 | Only needed to run frontend outside Docker |
| Python | 3.13 | Only needed to run backend outside Docker |

---

## 2. Environment files

All secrets live in `deploy/.env` which is **gitignored**.

```bash
cp deploy/.env.example deploy/.env
# Edit deploy/.env with real values
```

### Key variables

| Variable | Dev default | Production value |
|---|---|---|
| `DATABASE_URL` | local `erp-db` container | `@carnet-db:5432/erp_club_db` via `db_network` |
| `ENVIRONMENT` | `DEV` (set by override) | `PROD` (set by compose.yml) |
| `ERP_HOST` | — | `avat.erp-club.psa-avat.fr` |
| `CORS_ORIGINS` | `http://localhost:*` | `https://avat.erp-club.psa-avat.fr` |
| `JWT_SECRET_KEY` | any string | generated strong key |

Generate a JWT secret:
```bash
python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

---

## 3. Local development

The local stack brings up three containers: **postgres** (`erp-db-dev`), **backend**, **frontend**.
Docker Compose automatically merges `docker-compose.yml` + `docker-compose.override.yml` when run from `deploy/`.

### 3.1 First-time setup

```bash
# 1. Create your local .env
cp deploy/.env.example deploy/.env
# Set POSTGRES_PASSWORD and JWT_SECRET_KEY (other dev defaults are fine)

# 2. Build and start
cd deploy
docker compose build
docker compose up -d
```

The `init-db/erp.sql` script runs automatically on first start and creates the full schema + seed data.

### 3.2 Verify

```bash
docker compose ps
# Expected: erp-db-dev, erp-backend, erp-frontend, erp-dozzle-dev all healthy/running

curl http://localhost:8000/health          # backend
# Browser: http://localhost:8080           # frontend (Nginx)
# Browser: http://localhost:9999           # Dozzle log viewer
# Swagger: http://localhost:8000/docs
```

### 3.3 Vite hot-reload instead of the Nginx container

```bash
# Start only DB + backend in Docker
cd deploy
docker compose up -d erp-db erp-backend

# Run frontend with Vite (from repo root)
cd ..
pnpm --filter @club-erp/web dev
# → http://localhost:5173  (Vite proxies /api to localhost:8000)
```

### 3.4 Rebuild after code changes

```bash
cd deploy
docker compose build erp-backend && docker compose up -d erp-backend   # single service
docker compose build && docker compose up -d                             # everything
```

### 3.5 Logs

```bash
docker compose logs -f                  # all services
docker compose logs -f erp-backend
docker compose logs -f erp-db-dev
```

### 3.6 Stop / clean up

```bash
docker compose down          # stop, keep DB volume
docker compose down -v       # stop + delete local postgres volume (full reset)
```

---

## 4. VPS – network architecture

```
Internet
   │  HTTPS *.erp-club.psa-avat.fr
   ▼
┌──────────────────────────────────────────────────────────────────┐
│  web_network  (external, shared with CarnetDeVol + Traefik)      │
│                                                                  │
│  [Traefik]  ──►  erp-frontend :80  (avat.erp-club.psa-avat.fr)  │
│                       │ /api proxy (internal, same network)      │
│                       ▼                                          │
│               erp-backend :8000                                  │
│                                                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │  db_network  (external shared bridge)
                           ▼
                    carnet-db :5432
                 (CarnetDeVol postgres,
                  erp_club_db database)
```

**Why two networks?**
- Putting `carnet-db` on `web_network` would expose the database to every container on that network (Traefik, other apps). Unsafe.
- `db_network` is a small, purpose-built bridge that only connects `carnet-back`, `erp-backend`, and `carnet-db`.

---

## 5. VPS – one-time infrastructure setup

Run these **once** on the VPS before the first deploy.

### 5.1 Create the shared `db_network` bridge

```bash
docker network create db_network
```

### 5.2 Connect `carnet-db` to `db_network`

The `carnet-db` container currently only lives on its stack's default network.
We need to attach it to `db_network` so the ERP backend can reach it.

**Option A – live attach (no restart needed):**
```bash
docker network connect db_network carnet-db
# Verify:
docker inspect carnet-db --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
# Should show: carnetdevol_default db_network
```

**Option B – permanent (update the CarnetDeVol compose):**

Add to `CarnetDeVol/deploy/docker-compose.yml` under the `carnet-db` service:
```yaml
networks:
  - default
  - db_network
```

And add at the top-level `networks:` block:
```yaml
  db_network:
    external: true
    name: db_network
```

Then also connect `carnet-back` to `db_network` if it is not already using the default network to reach the DB (check its `DATABASE_URL`).

Option B survives container recreation. Do both A + B for immediate effect.

### 5.3 Clone the ERP repository on the VPS

```bash
git clone https://github.com/psa-avat/club-erp.git /opt/club-erp
cd /opt/club-erp/deploy

cp .env.example .env
nano .env   # fill in secrets (see §2)
```

### 5.4 Authenticate with GHCR (private repo only)

```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

---

## 6. VPS – provision the ERP database inside `carnet-db`

The ERP gets its own **separate database** (`erp_club_db`) and **dedicated user** (`erpuser`) inside the shared postgres instance. The carnet data is untouched.

### 6.1 Open a superuser psql shell

```bash
docker exec -it carnet-db psql -U postgres
```

### 6.2 Create the ERP user and database

```sql
-- Dedicated user (pick a strong password — same as POSTGRES_PASSWORD in .env)
CREATE USER erpuser WITH PASSWORD 'your-strong-password';

-- Dedicated database
CREATE DATABASE erp_club_db OWNER erpuser;

-- Restrict public access
REVOKE CONNECT ON DATABASE erp_club_db FROM PUBLIC;
GRANT  CONNECT ON DATABASE erp_club_db TO   erpuser;

\q
```

### 6.3 Apply the schema

```bash
# Copy init script into the running container, then execute it
docker cp /opt/club-erp/deploy/init-db/erp.sql carnet-db:/tmp/erp.sql
docker exec -it carnet-db psql -U erpuser -d erp_club_db -f /tmp/erp.sql
docker exec carnet-db rm /tmp/erp.sql
```

### 6.4 Verify

```bash
docker exec -it carnet-db psql -U erpuser -d erp_club_db -c "\dt"
# Expected tables: users, roles, capabilities, user_roles, role_capabilities,
#                  user_settings, auth_challenges, trusted_devices, session_tokens
```

### 6.5 Update `deploy/.env`

```env
POSTGRES_USER=erpuser
POSTGRES_PASSWORD=your-strong-password
POSTGRES_DB=erp_club_db
DATABASE_URL=postgresql+asyncpg://erpuser:your-strong-password@carnet-db:5432/erp_club_db
```

---

## 7. VPS – first deployment

```bash
cd /opt/club-erp/deploy

# Pull images built by CI and start the stack
docker compose pull
docker compose up -d

# Check status
docker compose ps

# Verify via Traefik domain
curl https://avat.erp-club.psa-avat.fr/api/health
```

Traefik will automatically obtain a TLS certificate for `avat.erp-club.psa-avat.fr`
via the `*.erp-club.psa-avat.fr` wildcard DNS entry you've added.

---

## 8. VPS – updating to a new version

```bash
cd /opt/club-erp/deploy

# Pull latest images and restart changed containers
docker compose pull && docker compose up -d

# Or pin to a specific tag
IMAGE_TAG=v1.2.3 docker compose pull && IMAGE_TAG=v1.2.3 docker compose up -d
```

Watchtower (already running on the VPS) will also auto-update containers tagged `:latest`
on its configured schedule — see §10 for GHCR credential setup.

---

## 9. Database operations – backup, restore, seeding

> All commands target `carnet-db` — the shared postgres container on the VPS.

### 9.1 Backup

**Plain SQL (human-readable, easy to inspect):**
```bash
docker exec carnet-db pg_dump \
  -U erpuser -d erp_club_db \
  --no-owner --no-privileges \
  > /opt/backups/erp_$(date +%Y%m%d_%H%M%S).sql
```

**Compressed binary (faster, smaller — recommended for automation):**
```bash
docker exec carnet-db pg_dump \
  -U erpuser -d erp_club_db \
  -Fc --no-owner --no-privileges \
  > /opt/backups/erp_$(date +%Y%m%d_%H%M%S).pgdump
```

**Schema only:**
```bash
docker exec carnet-db pg_dump \
  -U erpuser -d erp_club_db \
  --schema-only --no-owner \
  > /opt/backups/erp_schema_$(date +%Y%m%d).sql
```

**Data only:**
```bash
docker exec carnet-db pg_dump \
  -U erpuser -d erp_club_db \
  --data-only --no-owner \
  > /opt/backups/erp_data_$(date +%Y%m%d).sql
```

**Automate with a daily cron (03:00):**
```bash
crontab -e
# Add this line:
0 3 * * * docker exec carnet-db pg_dump -U erpuser -d erp_club_db -Fc --no-owner > /opt/backups/erp_$(date +\%Y\%m\%d).pgdump && find /opt/backups -name 'erp_*.pgdump' -mtime +30 -delete
```
_(The `find` at the end auto-deletes backups older than 30 days.)_

### 9.2 Restore

**From plain SQL:**
```bash
docker exec -i carnet-db psql -U erpuser -d erp_club_db \
  < /opt/backups/erp_20260101_120000.sql
```

**From compressed binary:**
```bash
docker exec -i carnet-db pg_restore \
  -U erpuser -d erp_club_db \
  --no-owner --no-privileges \
  < /opt/backups/erp_20260101_120000.pgdump
```

**Full reset then restore (⚠️ destroys all current ERP data):**
```bash
docker exec -it carnet-db psql -U erpuser -d erp_club_db \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i carnet-db psql -U erpuser -d erp_club_db \
  < /opt/backups/erp_20260101_120000.sql
```

### 9.3 Copy VPS data to your local dev DB

```bash
# 1. Dump from VPS (run locally — pulls over SSH)
ssh user@your-vps \
  "docker exec carnet-db pg_dump -U erpuser -d erp_club_db -Fc --no-owner" \
  > /tmp/erp_prod.pgdump

# 2. Restore into your local dev container
cd deploy && docker compose up -d erp-db   # make sure it's running
docker exec -i erp-db-dev pg_restore \
  -U erpuser -d erp_club_db \
  --no-owner --clean \
  < /tmp/erp_prod.pgdump
```

### 9.4 Run ad-hoc SQL

**Single statement:**
```bash
docker exec -it carnet-db psql -U erpuser -d erp_club_db \
  -c "SELECT count(*) FROM users;"
```

**Run a SQL file (pipe — no copy needed):**
```bash
docker exec -i carnet-db psql -U erpuser -d erp_club_db < my_script.sql
```

**Interactive psql session:**
```bash
docker exec -it carnet-db psql -U erpuser -d erp_club_db
```

Useful psql meta-commands:
```
\dt              – list all tables
\d users         – describe the users table
\dv              – list views
\di              – list indexes
\x               – toggle expanded display (good for wide rows)
\timing on       – show query execution time
\q               – quit
```

### 9.5 Re-run the schema init script (idempotent)

All seed inserts use `ON CONFLICT DO NOTHING` — safe to re-run at any time:

```bash
docker exec -i carnet-db psql -U erpuser -d erp_club_db \
  < /opt/club-erp/deploy/init-db/erp.sql
```

### 9.6 Quick table stats

```bash
docker exec carnet-db psql -U erpuser -d erp_club_db -c "
SELECT relname AS \"table\", n_live_tup AS rows
FROM   pg_stat_user_tables
ORDER  BY n_live_tup DESC;"
```

---

## 10. Watchtower – auto-updates with GHCR

Watchtower polls registries on a schedule, detects new image versions, and automatically
restarts containers with the updated image. The ERP containers already opt in via:
```yaml
labels:
  - "com.centurylinklabs.watchtower.enable=true"
```

### How it differs from CarnetDeVol (GitLab registry)

| | CarnetDeVol | ERP Club |
|---|---|---|
| Registry | `registry.gitlab.com` | `ghcr.io` (GitHub Container Registry) |
| Auth method | GitLab deploy token | GitHub PAT **or** anonymous (public repo) |
| Credential location | `~/.docker/config.json` on the VPS | Same — `~/.docker/config.json` |

Watchtower reads credentials from the host's Docker config file — **the mechanism is identical**,
only the registry URL and token type differ.

### Case A – Public GitHub repository (recommended)

If both the GitHub repository **and** its packages are set to **Public**, GHCR images can be
pulled without any authentication. Watchtower works with zero extra configuration.

> GitHub packages visibility is set separately from the repository:
> `GitHub → your package → Package settings → Change visibility → Public`

### Case B – Private GitHub repository

Create a **Personal Access Token (classic)** with the `read:packages` scope:
`GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)`

Then authenticate on the VPS:
```bash
# Replace with your GitHub username and PAT
echo "ghp_YOUR_TOKEN_HERE" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

This writes the credential to `~/.docker/config.json`. Verify:
```bash
cat ~/.docker/config.json | grep ghcr
# Should show: "ghcr.io": { "auth": "..." }
```

For Watchtower to use this file it must be mounted into the Watchtower container.
A typical Watchtower compose entry looks like:
```yaml
watchtower:
  image: containrrr/watchtower
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - /root/.docker/config.json:/config.json   # ← this line is the key
  environment:
    - WATCHTOWER_CLEANUP=true
    - WATCHTOWER_LABEL_ENABLE=true             # only update labelled containers
    - WATCHTOWER_POLL_INTERVAL=300             # check every 5 minutes
```

If your Watchtower container already has this volume mount (it does for carnet GitLab),
then simply running `docker login ghcr.io` on the host is all you need.

### Verify Watchtower is tracking ERP containers

```bash
# Check Watchtower logs for mentions of erp-backend / erp-frontend
docker logs watchtower 2>&1 | grep -i erp
# Expected: "Found new ghcr.io/psa-avat/club-erp-backend:latest"
```

---

## 11. CI/CD – GitHub Actions

Workflow: `.github/workflows/docker-publish.yml`

| Trigger | Action |
|---|---|
| Push to `main` | Builds both images, pushes `:latest` + `:main` to GHCR |
| Push tag `v*.*.*` | Also tags `:1.2.3` and `:1.2` |
| Pull request | Build only — validates Dockerfiles, no push |

No extra secrets needed for **public repos** — GitHub provides `GITHUB_TOKEN` automatically.

For **private repos**: `Settings → Actions → General → Workflow permissions → Read and write`.

After images are pushed, Watchtower auto-updates within its poll interval, or you can force it:
```bash
cd /opt/club-erp/deploy
docker compose pull && docker compose up -d
```

---

## 12. Useful daily commands

```bash
# ── From deploy/ ──────────────────────────────────────────────────────────────

docker compose ps                              # container status
docker compose logs -f                         # tail all logs
docker compose logs -f erp-backend             # backend logs only
docker compose restart erp-backend             # restart without downtime
docker compose pull && docker compose up -d    # update to latest images

# ── Database (VPS shared postgres) ────────────────────────────────────────────

# Interactive psql
docker exec -it carnet-db psql -U erpuser -d erp_club_db

# Quick health / connectivity check
docker exec carnet-db psql -U erpuser -d erp_club_db -c "SELECT 1;"

# Check which networks carnet-db is on
docker inspect carnet-db --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'

# ── Database (local dev) ──────────────────────────────────────────────────────

docker exec -it erp-db-dev psql -U erpuser -d erp_club_db
```
docker exec carnet-db pg_dump -U erpuser -d erp_club_db -Fc --no-owner --no-privileges > /opt/backups/erp_$(date +%Y%m%d_%H%M%S).pgdump

docker exec carnet-db pg_dump -U erpuser -d erp_club_db --no-owner --no-privileges > /opt/backups/erp_$(date +%Y%m%d_%H%M%S).sql

docker exec -i carnet-db psql -U erpuser -d erp_club_db < /opt/backups/erp_YYYYMMDD_HHMMSS.sql

Restore from .pgdump (custom format):
docker exec -i carnet-db pg_restore -U erpuser -d erp_club_db --no-owner --no-privileges < /opt/backups/erp_YYYYMMDD_HHMMSS.pgdump

If you need a full reset before restore (destructive):
docker exec -it carnet-db psql -U erpuser -d erp_club_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i carnet-db psql -U erpuser -d erp_club_db < /opt/backups/erp_YYYYMMDD_HHMMSS.sql

Quick verify after restore:
docker exec -it carnet-db psql -U erpuser -d erp_club_db -c "\dt"