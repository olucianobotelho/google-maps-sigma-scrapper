const fs = require('fs');

function escapeCSV(value) {
  const normalized =
    value && typeof value === 'object' ? JSON.stringify(value) : value;
  const str = String(normalized ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function saveToCSV(data, filename, includeQueryColumn = false) {
  const rowsData = Array.isArray(data) ? data : [];
  const keys = rowsData.length
    ? Object.keys(rowsData[0])
    : includeQueryColumn
      ? ['query']
      : ['name', 'category', 'rating', 'totalReviews', 'phone', 'website', 'instagram', 'email', 'address'];
  const headers = keys.map(k => escapeCSV(k)).join(',');

  const rows = rowsData.map(row =>
    keys.map(k => escapeCSV(row[k])).join(',')
  ).join('\n');

  fs.writeFileSync(filename, rows ? [headers, rows].join('\n') : `${headers}\n`, 'utf-8');
}

module.exports = { saveToCSV };
