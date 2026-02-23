import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const baseUrl = (__ENV.LOADTEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const email = __ENV.LOADTEST_EMAIL || 'admin@example.com';
const wrongPassword = __ENV.LOADTEST_PASSWORD || 'wrong-password';
const pauseSeconds = Number(__ENV.SLEEP_SECONDS || '0.2');

const blockedRate = new Rate('login_blocked_rate');
const unexpectedStatusTotal = new Counter('login_unexpected_status_total');

export const options = {
  vus: Number(__ENV.VUS || '30'),
  duration: __ENV.DURATION || '3m',
  thresholds: {
    login_unexpected_status_total: ['count==0']
  }
};

export default function runLoginStorm() {
  const payload = JSON.stringify({
    email,
    password: wrongPassword
  });

  const response = http.post(`${baseUrl}/api/auth/login`, payload, {
    headers: {
      'Content-Type': 'application/json'
    },
    tags: {
      scenario: 'login_storm'
    }
  });

  const isExpected = response.status === 401 || response.status === 429;
  check(response, {
    'status is 401 or 429': () => isExpected
  });
  blockedRate.add(response.status === 429);
  if (!isExpected) {
    unexpectedStatusTotal.add(1);
  }

  sleep(pauseSeconds);
}
