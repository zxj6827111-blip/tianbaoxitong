#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'ui/src'];
const TARGET_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.md']);

// Common mojibake fragments observed in this codebase (UTF-8 text decoded with GBK).
const suspiciousTokenRegex = /(鎼滅储|鍗曚綅|浠ｇ爜|姣忛〉|缃戞牸|鍒楄〃|娣诲姞|缂栬緫|鍒犻櫎|鏇存柊|鏃堕棿|鎿嶄綔|鍙|涓夊叕|鏀跺叆|鏀嚭|鍐崇畻|棰勭畻|涓婁紶|鍚嶈瘝|鏈烘瀯|鍥涚被|璇疯緭鍏)/;
const suspiciousCharRegex = /[锛銆鈥]/;

const shouldScanFile = (filePath) => TARGET_EXTS.has(path.extname(filePath).toLowerCase());

const walk = (dirPath, files = []) => {
  if (!fs.existsSync(dirPath)) return files;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, files);
      continue;
    }
    if (entry.isFile() && shouldScanFile(absolutePath)) {
      files.push(absolutePath);
    }
  }
  return files;
};

const checkFile = (absolutePath) => {
  const relPath = path.relative(ROOT, absolutePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const issues = [];

  lines.forEach((line, index) => {
    if (suspiciousTokenRegex.test(line) || suspiciousCharRegex.test(line)) {
      issues.push({
        file: relPath,
        line: index + 1,
        text: line.trim().slice(0, 180)
      });
    }
  });

  return issues;
};

const main = () => {
  const files = TARGET_DIRS
    .map((dir) => path.join(ROOT, dir))
    .flatMap((dir) => walk(dir));

  const issues = files.flatMap((filePath) => checkFile(filePath));

  if (issues.length === 0) {
    console.log('No suspicious mojibake text found in source files.');
    return;
  }

  console.error(`Found ${issues.length} suspicious mojibake occurrence(s):`);
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line}`);
    console.error(`  ${issue.text}`);
  }

  process.exitCode = 1;
};

main();
