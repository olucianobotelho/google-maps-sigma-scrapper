const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');
const businessData = require('../utils/businessData');

let browser;
let page;

before(async () => {
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
});

test('ignores external links from the Maps results feed when the active lead has no website', async () => {
  await page.setContent(`
    <main role="main">
      <div role="feed">
        <article>
          <a href="https://www.instagram.com/wagnerchavesadvogados/">Website</a>
        </article>
      </div>
    </main>
    <main role="main" aria-label="Lead atual sem site">
      <h1 class="DUwDvf">Lead atual sem site</h1>
      <button data-item-id="address"><div class="fontBodyMedium">Rua do Lead, 10</div></button>
    </main>
  `);

  const lead = await businessData.extractBusinessData(page);

  assert.equal(lead.name, 'Lead atual sem site');
  assert.equal(lead.address, 'Rua do Lead, 10');
  assert.equal(lead.website, null);
});

test('normalizes only Instagram profile URLs from an official website', () => {
  const normalize = businessData.normalizeInstagramProfileUrl || (() => '');

  assert.equal(
    normalize('https://instagram.com/elton_dasp/?igsh=abc'),
    'https://www.instagram.com/elton_dasp/',
  );
  assert.equal(normalize('https://www.instagram.com/p/ABC123/'), '');
  assert.equal(normalize('https://instagram.com.evil.example/elton_dasp'), '');
  assert.equal(normalize('https://www.instagram.com/'), '');
});
