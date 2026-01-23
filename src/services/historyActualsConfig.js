const { BUDGET_MAPPING } = require('./budgetMapping');

const HISTORY_ACTUAL_KEYS = Array.from(new Set(BUDGET_MAPPING.map((item) => item.key)));

module.exports = {
  HISTORY_ACTUAL_KEYS
};
