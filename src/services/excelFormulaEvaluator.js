const XLSX = require('xlsx');

const CELL_KEY_PATTERN = /^[A-Z]+[0-9]+$/;
const COLUMN_KEY_PATTERN = /^[A-Z]+$/;
const ROW_KEY_PATTERN = /^[0-9]+$/;
const NUMERIC_PATTERN = /^[-+]?\d+(?:\.\d+)?$/;
const ADD_SUB_EXPR_PATTERN = /^[A-Z0-9$]+(?:\s*[+-]\s*[A-Z0-9$]+)+$/i;
const ROUNDING_DECIMALS = 10;

const safeDecodeCell = (address) => {
  try {
    return XLSX.utils.decode_cell(address);
  } catch {
    return null;
  }
};

const parseNumericLike = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const splitArgs = (argsText) => {
  const result = [];
  let current = '';
  let depth = 0;
  for (const ch of argsText) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(depth - 1, 0);
    if ((ch === ',' || ch === ';') && depth === 0) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
};

const resolveRefToken = (token, formulaAddress) => {
  const formulaCell = safeDecodeCell(formulaAddress);
  if (!formulaCell) return null;

  const normalized = String(token || '').replace(/\$/g, '').trim().toUpperCase();
  if (!normalized) return null;
  if (CELL_KEY_PATTERN.test(normalized)) return normalized;
  if (COLUMN_KEY_PATTERN.test(normalized)) {
    return `${normalized}${formulaCell.r + 1}`;
  }
  if (ROW_KEY_PATTERN.test(normalized)) {
    const col = XLSX.utils.encode_col(formulaCell.c);
    return `${col}${normalized}`;
  }
  return null;
};

const normalizeComputedNumber = (value) => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(ROUNDING_DECIMALS));
  return Math.abs(rounded) < 1e-12 ? 0 : rounded;
};

const formatComputed = (cell, value) => {
  const normalized = normalizeComputedNumber(value);
  const format = typeof cell?.z === 'string' ? cell.z : null;
  if (format) {
    try {
      return XLSX.SSF.format(format, normalized);
    } catch {
      // Fall back to plain conversion when SSF cannot parse the format.
    }
  }
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
};

const evaluateFormula = ({ sheet, formula, address, state, evaluateCellAtAddress }) => {
  const body = String(formula || '').trim().replace(/^=/, '');
  if (!body) return null;

  const sumMatch = body.match(/^SUM\s*\((.*)\)$/i);
  if (sumMatch) {
    let total = 0;
    const args = splitArgs(sumMatch[1]);
    for (const arg of args) {
      if (!arg) continue;
      if (arg.includes(':')) {
        const [startToken, endToken] = arg.split(':', 2);
        const startAddress = resolveRefToken(startToken, address);
        const endAddress = resolveRefToken(endToken, address);
        if (!startAddress || !endAddress) continue;
        let range;
        try {
          range = XLSX.utils.decode_range(`${startAddress}:${endAddress}`);
        } catch {
          continue;
        }
        for (let r = range.s.r; r <= range.e.r; r += 1) {
          for (let c = range.s.c; c <= range.e.c; c += 1) {
            total += evaluateCellAtAddress(XLSX.utils.encode_cell({ r, c }), state);
          }
        }
        continue;
      }

      if (NUMERIC_PATTERN.test(arg)) {
        total += Number(arg);
        continue;
      }

      const refAddress = resolveRefToken(arg, address);
      if (!refAddress) continue;
      total += evaluateCellAtAddress(refAddress, state);
    }
    return total;
  }

  if (NUMERIC_PATTERN.test(body)) {
    return Number(body);
  }

  const directRefAddress = resolveRefToken(body, address);
  if (directRefAddress) {
    return evaluateCellAtAddress(directRefAddress, state);
  }

  if (ADD_SUB_EXPR_PATTERN.test(body)) {
    const tokens = body.replace(/\s+/g, '').split(/([+-])/).filter(Boolean);
    if (tokens.length === 0) return null;
    let total = 0;
    let op = '+';
    for (const token of tokens) {
      if (token === '+' || token === '-') {
        op = token;
        continue;
      }
      let value = 0;
      if (NUMERIC_PATTERN.test(token)) {
        value = Number(token);
      } else {
        const refAddress = resolveRefToken(token, address);
        if (refAddress) {
          value = evaluateCellAtAddress(refAddress, state);
        }
      }
      total = op === '-' ? total - value : total + value;
    }
    return total;
  }

  return null;
};

const recalculateSheetFormulaCells = (sheet) => {
  if (!sheet || typeof sheet !== 'object') return;
  const formulaAddresses = Object.keys(sheet).filter((key) => {
    if (key.startsWith('!')) return false;
    const cell = sheet[key];
    return cell && typeof cell.f === 'string' && cell.f.trim() !== '';
  });
  if (formulaAddresses.length === 0) return;

  const state = {
    memo: new Map(),
    stack: new Set()
  };

  const evaluateCellAtAddress = (cellAddress) => {
    if (!cellAddress || !CELL_KEY_PATTERN.test(cellAddress)) return 0;
    if (state.memo.has(cellAddress)) return state.memo.get(cellAddress);
    if (state.stack.has(cellAddress)) return 0;

    const cell = sheet[cellAddress];
    if (!cell) {
      state.memo.set(cellAddress, 0);
      return 0;
    }

    if (typeof cell.f === 'string' && cell.f.trim()) {
      state.stack.add(cellAddress);
      const computed = evaluateFormula({
        sheet,
        formula: cell.f,
        address: cellAddress,
        state,
        evaluateCellAtAddress
      });
      state.stack.delete(cellAddress);

      if (computed === null) {
        const fallback = parseNumericLike(cell.v ?? cell.w);
        state.memo.set(cellAddress, fallback);
        return fallback;
      }

      const value = normalizeComputedNumber(computed);
      cell.t = 'n';
      cell.v = value;
      cell.w = formatComputed(cell, value);
      state.memo.set(cellAddress, value);
      return value;
    }

    const value = parseNumericLike(cell.v ?? cell.w);
    state.memo.set(cellAddress, value);
    return value;
  };

  for (const address of formulaAddresses) {
    evaluateCellAtAddress(address);
  }
};

module.exports = {
  recalculateSheetFormulaCells
};

module.exports.__private = {
  parseNumericLike,
  resolveRefToken,
  splitArgs
};
