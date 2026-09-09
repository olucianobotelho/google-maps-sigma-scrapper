const assert = require('node:assert/strict');
const test = require('node:test');

function loadScraperWithFakePlaywright(chromium) {
  const scraperPath = require.resolve('../scraper');
  const playwrightPath = require.resolve('playwright');
  const previousScraper = require.cache[scraperPath];
  const previousPlaywright = require.cache[playwrightPath];

  delete require.cache[scraperPath];
  require.cache[playwrightPath] = {
    id: playwrightPath,
    filename: playwrightPath,
    loaded: true,
    exports: { chromium },
  };

  const scraper = require('../scraper');
  return {
    scraper,
    restore() {
      delete require.cache[scraperPath];
      if (previousScraper) require.cache[scraperPath] = previousScraper;
      if (previousPlaywright) require.cache[playwrightPath] = previousPlaywright;
      else delete require.cache[playwrightPath];
    },
  };
}

test('cancellation inside a listing propagates instead of saving partial results', async () => {
  const cancelToken = { cancelled: false };
  let browserClosed = false;
  const listing = { click: async () => { cancelToken.cancelled = true; } };
  const feedLinks = {
    count: async () => 1,
    all: async () => [listing],
    evaluateAll: async () => [{ name: 'Clínica Teste', href: 'https://www.google.com/maps/place/Clinica_Teste' }],
    getByRole: () => ({ first: () => listing }),
  };
  const page = {
    route: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => false,
    getByRole: () => ({ waitFor: async () => {} }),
    locator: (selector) => selector.includes('button')
      ? { first: () => ({ isVisible: async () => false }) }
      : feedLinks,
    close: async () => {},
  };
  const context = { newPage: async () => page, close: async () => {} };
  const chromium = {
    launch: async () => ({
      newContext: async () => context,
      close: async () => { browserClosed = true; },
    }),
  };
  const loaded = loadScraperWithFakePlaywright(chromium);

  try {
    await assert.rejects(
      loaded.scraper.scrapeGoogleMaps('clínica', 1, () => {}, cancelToken),
      (err) => err?.code === 'SCRAPE_CANCELLED',
    );
    assert.equal(browserClosed, true);
  } finally {
    loaded.restore();
  }
});
