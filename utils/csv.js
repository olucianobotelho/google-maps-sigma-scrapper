const fs = require('fs');

function escapeCSV(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function saveToCSV(data, filename, includeQueryColumn = false) {
  if (!data.length) return;

  const keys = Object.keys(data[0]);
  const headers = keys.map(k => escapeCSV(k)).join(',');

  const rows = data.map(row =>
    keys.map(k => escapeCSV(row[k])).join(',')
  ).join('\n');

  fs.writeFileSync(filename, [headers, rows].join('\n'), 'utf-8');
}

module.exports = { saveToCSV };
