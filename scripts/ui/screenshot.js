const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
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

const run = async () => {
  ensureDir(OUTPUT_DIR);

  const devServer = spawn('npm', ['run', 'ui:dev'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env },
    shell: true
  });

  let browser;
  try {
    await waitForServer('http://localhost:5173/admin');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    await page.goto('http://localhost:5173/admin', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-overview.png'), fullPage: true });

    await page.goto('http://localhost:5173/admin?unit=unit-1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-unit-detail.png'), fullPage: true });

    await page.goto('http://localhost:5173/admin?filter=pendingSug', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-filter-pending.png'), fullPage: true });
  } finally {
    if (browser) {
      await browser.close();
    }
    devServer.kill('SIGTERM');
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
