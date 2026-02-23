const client = require('prom-client');
const logger = require('./logger');
const { getReportGenerationMetrics } = require('./reportService');

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const METRICS_ENABLED = String(process.env.METRICS_ENABLED || 'false').toLowerCase() === 'true';
const METRICS_TOKEN = String(process.env.METRICS_TOKEN || '').trim();
const METRICS_CACHE_MS = parsePositiveInt(process.env.METRICS_CACHE_MS, 5000);

const registry = new client.Registry();
client.collectDefaultMetrics({
  register: registry,
  prefix: 'app_'
});

const queueWaitingNowLocal = new client.Gauge({
  name: 'app_report_generation_queue_waiting_now_local',
  help: 'Current queued report generation jobs in this process.',
  registers: [registry]
});

const queueWaitingPeakLocal = new client.Gauge({
  name: 'app_report_generation_queue_waiting_peak_local',
  help: 'Observed peak queued report generation jobs in this process.',
  registers: [registry]
});

const queueRunningNowLocal = new client.Gauge({
  name: 'app_report_generation_queue_running_now_local',
  help: 'Current running report generation jobs in this process.',
  registers: [registry]
});

const queueRunningPeakLocal = new client.Gauge({
  name: 'app_report_generation_queue_running_peak_local',
  help: 'Observed peak running report generation jobs in this process.',
  registers: [registry]
});

const queueRunningNowGlobal = new client.Gauge({
  name: 'app_report_generation_queue_running_now_global',
  help: 'Current running report generation jobs cluster-wide from PG advisory locks.',
  registers: [registry]
});

const totalJobs = new client.Gauge({
  name: 'app_report_generation_jobs_total',
  help: 'Total report generation jobs seen by this process.',
  registers: [registry]
});

const totalSuccess = new client.Gauge({
  name: 'app_report_generation_jobs_success_total',
  help: 'Total successful report generation jobs seen by this process.',
  registers: [registry]
});

const totalFailed = new client.Gauge({
  name: 'app_report_generation_jobs_failed_total',
  help: 'Total failed report generation jobs seen by this process.',
  registers: [registry]
});

const totalTimeout = new client.Gauge({
  name: 'app_report_generation_jobs_timeout_total',
  help: 'Total timed-out report generation jobs seen by this process.',
  registers: [registry]
});

const totalFailureRate = new client.Gauge({
  name: 'app_report_generation_failure_rate',
  help: 'Overall report generation failure rate (0-1) in this process.',
  registers: [registry]
});

const averageWaitMs = new client.Gauge({
  name: 'app_report_generation_avg_wait_ms',
  help: 'Average wait time in queue for report generation jobs (ms).',
  registers: [registry]
});

const averageDurationMs = new client.Gauge({
  name: 'app_report_generation_avg_duration_ms',
  help: 'Average runtime for report generation jobs (ms).',
  registers: [registry]
});

const operationJobs = new client.Gauge({
  name: 'app_report_generation_operation_jobs_total',
  help: 'Total jobs grouped by operation in this process.',
  labelNames: ['operation'],
  registers: [registry]
});

const operationFailureRate = new client.Gauge({
  name: 'app_report_generation_operation_failure_rate',
  help: 'Failure rate by operation (0-1) in this process.',
  labelNames: ['operation'],
  registers: [registry]
});

const operationAvgWaitMs = new client.Gauge({
  name: 'app_report_generation_operation_avg_wait_ms',
  help: 'Average queue wait time by operation in this process (ms).',
  labelNames: ['operation'],
  registers: [registry]
});

const operationAvgDurationMs = new client.Gauge({
  name: 'app_report_generation_operation_avg_duration_ms',
  help: 'Average runtime by operation in this process (ms).',
  labelNames: ['operation'],
  registers: [registry]
});

let refreshedAt = 0;
let refreshPromise = null;

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const applyReportMetricsToRegistry = (metrics) => {
  const queue = metrics?.queue || {};
  const totals = metrics?.totals || {};
  const byOperation = metrics?.by_operation || {};

  queueWaitingNowLocal.set(toFiniteNumber(queue.waiting_now_local));
  queueWaitingPeakLocal.set(toFiniteNumber(queue.waiting_peak_local));
  queueRunningNowLocal.set(toFiniteNumber(queue.running_now_local));
  queueRunningPeakLocal.set(toFiniteNumber(queue.running_peak_local));
  queueRunningNowGlobal.set(toFiniteNumber(queue.running_now_global));

  totalJobs.set(toFiniteNumber(totals.jobs));
  totalSuccess.set(toFiniteNumber(totals.success));
  totalFailed.set(toFiniteNumber(totals.failed));
  totalTimeout.set(toFiniteNumber(totals.timeout));
  totalFailureRate.set(toFiniteNumber(totals.failure_rate));
  averageWaitMs.set(toFiniteNumber(totals.avg_wait_ms));
  averageDurationMs.set(toFiniteNumber(totals.avg_duration_ms));

  operationJobs.reset();
  operationFailureRate.reset();
  operationAvgWaitMs.reset();
  operationAvgDurationMs.reset();
  Object.entries(byOperation).forEach(([operation, item]) => {
    const op = String(operation || 'unknown');
    operationJobs.set({ operation: op }, toFiniteNumber(item.jobs));
    operationFailureRate.set({ operation: op }, toFiniteNumber(item.failure_rate));
    operationAvgWaitMs.set({ operation: op }, toFiniteNumber(item.avg_wait_ms));
    operationAvgDurationMs.set({ operation: op }, toFiniteNumber(item.avg_duration_ms));
  });
};

const refreshMetricsSnapshot = async (force = false) => {
  const now = Date.now();
  if (!force && now - refreshedAt < METRICS_CACHE_MS) {
    return;
  }

  if (refreshPromise) {
    await refreshPromise;
    return;
  }

  refreshPromise = (async () => {
    try {
      const reportMetrics = await getReportGenerationMetrics();
      applyReportMetricsToRegistry(reportMetrics);
      refreshedAt = Date.now();
    } catch (error) {
      logger.warn('metrics_snapshot_refresh_failed', { error });
      refreshedAt = Date.now();
    } finally {
      refreshPromise = null;
    }
  })();

  await refreshPromise;
};

const isMetricsEnabled = () => METRICS_ENABLED;

const isMetricsAuthorized = (req) => {
  if (!METRICS_TOKEN) {
    return true;
  }

  const auth = String(req.headers.authorization || '').trim();
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return false;
  }

  const token = auth.slice(7).trim();
  return token.length > 0 && token === METRICS_TOKEN;
};

const getPrometheusMetricsPayload = async () => {
  await refreshMetricsSnapshot();
  return registry.metrics();
};

const getPrometheusMetricsContentType = () => registry.contentType;

module.exports = {
  isMetricsEnabled,
  isMetricsAuthorized,
  getPrometheusMetricsPayload,
  getPrometheusMetricsContentType
};
