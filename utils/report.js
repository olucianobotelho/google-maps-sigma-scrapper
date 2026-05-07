const fs = require('fs');
const { percent } = require('./stats');

function saveReport(query, data, filename) {
  const report = [];
  report.push('='.repeat(80));
  report.push('GOOGLE MAPS SCRAPING REPORT');
  report.push('='.repeat(80));
  report.push(`Query: ${query}`);
  report.push(`Date: ${new Date().toLocaleString('en-US')}`);
  report.push(`Total Results: ${data.length}\n`);
  report.push('DATA QUALITY : ');
  report.push('-'.repeat(80));
  report.push(`✓ Coordinates: ${data.filter(r => r.latitude).length}/${data.length} (${percent(data, r => r.latitude)}%)`);
  report.push(`✓ Rating: ${data.filter(r => r.rating).length}/${data.length} (${percent(data, r => r.rating)}%)`);
  report.push(`✓ Review Count: ${data.filter(r => r.reviewCount).length}/${data.length} (${percent(data, r => r.reviewCount)}%)`);
  report.push(`✓ Category: ${data.filter(r => r.category).length}/${data.length} (${percent(data, r => r.category)}%)`);
  report.push(`✓ Description: ${data.filter(r => r.description && r.description.length > 50).length}/${data.length} (${percent(data, r => r.description && r.description.length > 50)}%)`);
  report.push(`✓ Photos: ${data.filter(r => (r.photos?.all || []).length > 0).length}/${data.length} (${percent(data, r => (r.photos?.all || []).length > 0)}%)`);
  report.push(`✓ Contact: ${data.filter(r => r.phone).length}/${data.length} (${percent(data, r => r.phone)}%)`);
  report.push(`✓ Website: ${data.filter(r => r.website).length}/${data.length} (${percent(data, r => r.website)}%)`);
  report.push('\n' + '='.repeat(80));
  fs.writeFileSync(filename, report.join('\n'), 'utf-8');
}

module.exports = { saveReport };
