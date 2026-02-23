# Load Test Playbook

This file provides a repeatable pressure-test process for:

- Login failure storm (`k6`)
- Report generation queue pressure (`autocannon`)

## 1. Preconditions

1. Start backend service and dependencies.
2. Ensure test data is isolated from production.
3. Prepare at least one authenticated account and token.
4. Prepare one or more valid draft IDs:
- `preview` mode: draft should pass validation.
- `generate` mode: draft should be `SUBMITTED` and already have a preview generated.

## 2. Login failure storm (`k6`)

Purpose: verify login limiter behavior under credential brute-force pressure.

Command example:

```bash
LOADTEST_BASE_URL=http://127.0.0.1:3000 \
LOADTEST_EMAIL=admin@example.com \
LOADTEST_PASSWORD=wrong-password \
VUS=50 \
DURATION=3m \
npm run loadtest:login:k6
```

Expected behavior:

- responses are mostly `401` and then `429`
- no `500`
- service remains responsive on `/api/health`

## 3. Report queue pressure (`autocannon`)

Purpose: verify queue hard-limit behavior and estimate user impact when demand spikes.

Command example (preview pressure):

```bash
LOADTEST_BASE_URL=http://127.0.0.1:3000 \
LOADTEST_TOKEN=<bearer-token> \
LOADTEST_DRAFT_IDS=<draft-id-1>,<draft-id-2> \
LOADTEST_REPORT_MODE=preview \
CONNECTIONS=20 \
DURATION_SECONDS=180 \
npm run loadtest:report:autocannon
```

Command example (generate pressure):

```bash
LOADTEST_BASE_URL=http://127.0.0.1:3000 \
LOADTEST_TOKEN=<bearer-token> \
LOADTEST_DRAFT_ID=<draft-id> \
LOADTEST_REPORT_MODE=generate \
CONNECTIONS=10 \
DURATION_SECONDS=180 \
npm run loadtest:report:autocannon
```

Expected behavior:

- queue pressure should produce some `429` (`REPORT_GENERATION_BUSY`) rather than crashing
- no sustained `5xx`
- queue metrics reflect pressure:
  - `app_report_generation_queue_waiting_now_local`
  - `app_report_generation_failure_rate`
  - `app_report_generation_avg_wait_ms`

## 4. Tuning loop

1. Start from `REPORT_GENERATION_CONCURRENCY=2`.
2. Run report pressure test for 10-30 minutes.
3. Observe CPU, memory, and failure rate.
4. Tune one variable at a time:
- increase/decrease `REPORT_GENERATION_CONCURRENCY`
- adjust `REPORT_GENERATION_QUEUE_TIMEOUT_MS`
5. Keep the smallest setting that satisfies business SLA with stable resource usage.
