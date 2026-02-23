# Production Deployment Checklist

This document focuses on safe production startup for this project.

## 1. Required prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 6+ (recommended for login rate limiting)
- LibreOffice installed on server (`soffice` available in PATH)
- Chinese fonts installed on server (to avoid PDF text rendering issues)

## 2. First-time deployment steps

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

3. Update critical values in `.env`:
- `DATABASE_URL`
- `JWT_SECRET`
- `TRUST_PROXY` (set `1` if behind reverse proxy/load balancer)
- `REPORT_GENERATION_CONCURRENCY`
- `LOGIN_RATE_LIMIT_*`
- `REDIS_URL` (if using Redis limiter backend)
- `METRICS_ENABLED` / `METRICS_TOKEN`

4. Run migrations:
```bash
npm run db:migrate
```

Important: migration `016_add_login_rate_limit_bucket` must be applied in production.  
This table powers cross-instance login rate limiting.

5. Build frontend:
```bash
npm run ui:build
```

6. Start app with process manager (PM2 or container entrypoint):
```bash
npm run start
```

## 3. Login rate-limit config guide

Set `LOGIN_RATE_LIMIT_BACKEND=auto` (default) and provide `REDIS_URL` for Redis-backed rate limiting.  
If Redis is unavailable, the service falls back to DB table `login_rate_limit_bucket`.

### Recommended starting values

- Small internal traffic:
  - `LOGIN_RATE_LIMIT_BACKEND=auto`
  - `REDIS_URL=redis://127.0.0.1:6379`
  - `LOGIN_RATE_LIMIT_WINDOW_MS=900000`
  - `LOGIN_RATE_LIMIT_CREDENTIAL_MAX=8`
  - `LOGIN_RATE_LIMIT_IP_MAX=200`
- Higher internet-facing pressure:
  - `LOGIN_RATE_LIMIT_BACKEND=auto`
  - `REDIS_URL=redis://127.0.0.1:6379`
  - `LOGIN_RATE_LIMIT_WINDOW_MS=900000`
  - `LOGIN_RATE_LIMIT_CREDENTIAL_MAX=5`
  - `LOGIN_RATE_LIMIT_IP_MAX=100`

## 4. Report-generation queue tuning

- `REPORT_GENERATION_CONCURRENCY=2` is safe default for a 4C8G machine.
- For 8C16G, usually `2-4` is acceptable after stress test.
- Keep queue timeout finite:
  - `REPORT_GENERATION_QUEUE_TIMEOUT_MS=180000`
- Queue metrics endpoint (admin/maintainer auth required):
  - `GET /api/admin/system/report-generation-metrics`
- Prometheus scrape endpoint:
  - `GET /metrics` (enable with `METRICS_ENABLED=true`)

## 5. Smoke checks after startup

1. API health:
```bash
curl http://127.0.0.1:3000/api/health
```

2. Migration status:
```bash
npm run db:status
```

3. Golden flow:
```bash
npm run golden:check
```

4. Prometheus metrics (if enabled):
```bash
curl http://127.0.0.1:3000/metrics
```

## 6. Recommended monitoring

- API status code distribution (`2xx/4xx/5xx`)
- Request ID propagation (`X-Request-Id`) and JSON request logs
- P95/P99 request latency
- Login 429 rate (too many requests)
- Queue wait time for report generation
- DB connection usage
- Host CPU/memory and OOM events

## 7. Monitoring stack (Prometheus + Grafana)

Start monitoring profile:

```bash
docker compose --profile monitoring up -d prometheus grafana
```

Default access:

- Prometheus: `http://127.0.0.1:9090`
- Grafana: `http://127.0.0.1:3001`

Files:

- Prometheus scrape config: `ops/monitoring/prometheus/prometheus.yml`
- Alert rules: `ops/monitoring/prometheus/alerts.yml`
- Grafana dashboard: `ops/monitoring/grafana/dashboards/report-generation-overview.json`

Default alert thresholds:

- queue backlog high: waiting jobs `>= 3` for 3 minutes
- failure rate high: `>= 15%` for 5 minutes
- average queue wait high: `>= 30000ms` for 5 minutes

## 8. Load testing before go-live

Run pressure tests before final concurrency settings:

- Login storm: `npm run loadtest:login:k6`
- Report queue pressure: `npm run loadtest:report:autocannon`

Detailed runbook: `LOADTEST.md`
