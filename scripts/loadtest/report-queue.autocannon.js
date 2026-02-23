#!/usr/bin/env node

const autocannon = require('autocannon');

const baseUrl = String(process.env.LOADTEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const token = String(process.env.LOADTEST_TOKEN || '').trim();
const mode = String(process.env.LOADTEST_REPORT_MODE || 'preview').trim().toLowerCase();
const connections = Number(process.env.CONNECTIONS || 20);
const duration = Number(process.env.DURATION_SECONDS || 180);
const pipelining = Number(process.env.PIPELINING || 1);

const parseDraftIds = () => {
  const list = String(process.env.LOADTEST_DRAFT_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length > 0) {
    return list;
  }

  const single = String(process.env.LOADTEST_DRAFT_ID || '').trim();
  return single ? [single] : [];
};

const draftIds = parseDraftIds();

if (!token) {
  console.error('Missing LOADTEST_TOKEN (Bearer token for authenticated pressure test).');
  process.exit(1);
}

if (!['preview', 'generate'].includes(mode)) {
  console.error('Invalid LOADTEST_REPORT_MODE, use "preview" or "generate".');
  process.exit(1);
}

if (draftIds.length === 0) {
  console.error('Missing draft ids. Set LOADTEST_DRAFT_ID or LOADTEST_DRAFT_IDS.');
  process.exit(1);
}

let requestIndex = 0;
const nextPath = () => {
  const draftId = encodeURIComponent(draftIds[requestIndex % draftIds.length]);
  requestIndex += 1;
  return `/api/drafts/${draftId}/${mode}`;
};

const statusCounters = new Map();
let requestErrors = 0;

console.log('[loadtest] report queue test config');
console.log(JSON.stringify({
  baseUrl,
  mode,
  draftIds,
  connections,
  duration,
  pipelining
}, null, 2));

const instance = autocannon({
  url: baseUrl,
  connections,
  duration,
  pipelining,
  requests: [{
    method: 'POST',
    path: nextPath(),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: '{}',
    setupRequest: (request) => {
      request.path = nextPath();
      request.body = '{}';
      return request;
    }
  }]
}, (error, result) => {
  if (error) {
    console.error('[loadtest] autocannon execution failed:', error);
    process.exit(1);
  }

  console.log('\n[loadtest] status code distribution');
  Array.from(statusCounters.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
  console.log(`  request_errors: ${requestErrors}`);

  console.log('\n[loadtest] latency summary (ms)');
  console.log(`  p50: ${result.latency.p50}`);
  console.log(`  p90: ${result.latency.p90}`);
  console.log(`  p99: ${result.latency.p99}`);

  console.log('\n[loadtest] throughput summary');
  console.log(`  requests.average: ${result.requests.average}`);
  console.log(`  requests.total: ${result.requests.total}`);
  console.log(`  errors: ${result.errors}`);
  console.log(`  timeouts: ${result.timeouts}`);

  const tooManyRequests = Number(statusCounters.get(429) || 0);
  if (tooManyRequests > 0) {
    console.log('\n[hint] 429 responses detected: queue limit and timeout are working.');
    console.log('       If 429 ratio is too high for business expectation, tune REPORT_GENERATION_CONCURRENCY or timeout.');
  }
});

instance.on('response', (client, statusCode) => {
  const status = Number(statusCode || 0);
  statusCounters.set(status, Number(statusCounters.get(status) || 0) + 1);
});

instance.on('reqError', (error) => {
  requestErrors += 1;
  if (requestErrors <= 5) {
    console.warn('[loadtest] request error sample:', error?.message || String(error));
  }
});

autocannon.track(instance, {
  renderProgressBar: true,
  renderResultsTable: true
});
