const fs = require('node:fs/promises');
const path = require('node:path');

const templateDir = path.resolve(process.cwd(), 'templates');

const getTemplatePath = (templateVersion) => {
  const safeName = path.basename(`${templateVersion}.html`);
  return path.join(templateDir, safeName);
};

const loadTemplate = async (templateVersion) => {
  const templatePath = getTemplatePath(templateVersion);
  const html = await fs.readFile(templatePath, 'utf8');
  return {
    html,
    templatePath
  };
};

const formatValue = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
};

const resolveManualValue = (input) => {
  if (!input) {
    return '';
  }
  if (input.value_text) {
    return input.value_text;
  }
  if (input.value_numeric !== null && input.value_numeric !== undefined) {
    return formatValue(Number(input.value_numeric));
  }
  if (input.value_json !== null && input.value_json !== undefined) {
    return typeof input.value_json === 'string' ? input.value_json : JSON.stringify(input.value_json);
  }
  return '';
};

const escapeHtml = (value) => (
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

const applyTemplate = ({ html, values }) => {
  let output = html;

  output = output.replace(/\{\{\s*fact:([\w_\-]+)\s*\}\}/g, (_, key) => (
    escapeHtml(formatValue(values.facts[key]))
  ));

  output = output.replace(/\{\{\s*manual:([\w_\-]+)\s*\}\}/g, (_, key) => (
    escapeHtml(resolveManualValue(values.manual_inputs[key]))
  ));

  output = output.replace(/\{\{\s*line_items_reason\s*\}\}/g, () => {
    if (!Array.isArray(values.line_items_reason) || values.line_items_reason.length === 0) {
      return '<p>无主要项目支出。</p>';
    }
    const listItems = values.line_items_reason.map((item, index) => {
      const reasonText = item.reason_text ? String(item.reason_text).trim() : '';
      const hasAmount = reasonText.includes('万元');
      const label = escapeHtml(item.item_label || '');
      const current = Number(item.amount_current_wanyuan ?? 0).toFixed(2);
      const prev = Number(item.amount_prev_wanyuan ?? 0).toFixed(2);
      if (reasonText && hasAmount) {
        return `<li>${index + 1}. ${escapeHtml(reasonText)}</li>`;
      }
      const reasonSnippet = reasonText ? reasonText : '原因待补充';
      return `<li>${index + 1}. “${label}”${current}万元，上年:${prev}万元，主要${escapeHtml(reasonSnippet)}。</li>`;
    });
    return `<ul class="line-items" style="list-style: none; padding: 0;">${listItems.join('')}</ul>`;
  });

  return output;
};

module.exports = {
  templateDir,
  getTemplatePath,
  loadTemplate,
  applyTemplate
};
