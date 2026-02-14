const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'artifacts', 'ui');

const waitForServer = async (url, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return true;
      }
    } catch (error) {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server not ready at ${url}`);
};

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const waitForPageSettled = async (page, url) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('body').waitFor({ state: 'visible' });
};

const getAvailablePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : null;

  await new Promise((resolve) => server.close(resolve));
  if (!port) {
    throw new Error('Unable to allocate a free port for ui:dev');
  }
  return port;
};

const stopServer = async (child) => {
  if (!child || child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const done = () => resolve();
    child.once('exit', done);

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true
      });
      killer.on('exit', () => resolve());
      setTimeout(resolve, 3000);
      return;
    }

    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolve();
    }, 3000);
  });
};

const run = async () => {
  ensureDir(OUTPUT_DIR);
  const uiPort = await getAvailablePort();
  const baseUrl = `http://localhost:${uiPort}`;

  const devServer = spawn('npm', ['run', 'ui:dev', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env },
    shell: true
  });

  let browser;
  try {
    await waitForServer(`${baseUrl}/admin`);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await waitForPageSettled(page, `${baseUrl}/admin`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-overview.png'), fullPage: true });

    await waitForPageSettled(page, `${baseUrl}/admin?unit=unit-1`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-unit-detail.png'), fullPage: true });

    await waitForPageSettled(page, `${baseUrl}/admin?filter=pendingSug`);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-filter-pending.png'), fullPage: true });
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopServer(devServer);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
