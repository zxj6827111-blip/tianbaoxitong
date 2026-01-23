const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

describe('ui screenshots', () => {
  jest.setTimeout(60000);
  it('generates admin screenshots', () => {
    execSync('node scripts/ui/screenshot.js', { stdio: 'inherit' });

    const outputDir = path.resolve(__dirname, '..', 'artifacts', 'ui');
    const files = [
      'admin-overview.png',
      'admin-unit-detail.png',
      'admin-filter-pending.png'
    ];

    files.forEach((file) => {
      const filePath = path.join(outputDir, file);
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
    });
  });
});
