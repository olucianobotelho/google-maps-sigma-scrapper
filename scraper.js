const { chromium } = require('playwright');
const CONFIG = require('./config');
const { extractBusinessData } = require('./utils/businessData');

async function scrapeGoogleMaps(searchQuery, maxResults = 999, onProgress = console.log) {
  onProgress('Launching browser...');
  const browser = await chromium.launch({ headless: CONFIG.HEADLESS, channel: 'chrome' });
  const places = [];
  const statistics = { withPhone: 0, withWebsite: 0, withInstagram: 0, withEmail: 0, withRating: 0, withPhotos: 0 };

  try {
    const context = await browser.newContext({
      userAgent: CONFIG.USER_AGENT,
      viewport: { width: 1366, height: 768 }
    });
    const page = await context.newPage();

    if (CONFIG.REQUEST_BLOCK_TYPES.length > 0) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (CONFIG.REQUEST_BLOCK_TYPES.includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    const encodedQuery = encodeURIComponent(searchQuery);
    await gotoWithRetry(page, `https://www.google.com/maps/search/${encodedQuery}`, onProgress);
    await page.waitForTimeout(CONFIG.INITIAL_WAIT);

    try {
      const btn = page.locator('button:has-text("Accept all"), button:has-text("Aceitar todos")').first();
      if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); await page.waitForTimeout(800); }
    } catch (e) {}

    try { await page.waitForSelector('div[role="feed"]', { timeout: 15000 }); }
    catch (e) { onProgress('No results found'); await browser.close(); return { success: false, error: 'No results', data: [], count: 0, statistics }; }

    onProgress('Loading results...');
    let prev = 0, stuck = 0;
    while (stuck < CONFIG.SEARCH_DEPTH) {
      await page.evaluate(() => { const f = document.querySelector('div[role="feed"]'); if (f) f.scrollTop = f.scrollHeight; });
      await page.waitForTimeout(CONFIG.SCROLL_DELAY);
      const count = await page.locator('a[href*="/maps/place/"]').count();
      onProgress(`  Found: ${count}`);
      if (count === prev) stuck++; else stuck = 0;
      prev = count;
      if (count >= maxResults) break;
    }

    const listings = await page.locator('a[href*="/maps/place/"]').all();
    const total = Math.min(listings.length, maxResults);
    onProgress(`\nExtracting ${total} places...`);

    for (let i = 0; i < total; i++) {
      try {
        await listings[i].click();
        await page.waitForTimeout(600);

        const place = await extractBusinessData(page);

        if (place.name) {
          place.instagram = '';
          if (place.website && place.website.includes('instagram.com')) {
            place.instagram = place.website;
            place.website = '';
          }
          if (!place.instagram) {
            const ig = await page.locator('a[href*="instagram.com"]').first();
            if (await ig.count() > 0) place.instagram = await ig.getAttribute('href');
          }

          if (place.website && !place.website.includes('instagram.com') && !place.website.includes('facebook.com') && !place.website.includes('youtube.com')) {
            place.email = await scrapeEmails(browser, place.website, onProgress);
          } else {
            place.email = '';
          }

          places.push(place);

          if (place.phone) statistics.withPhone++;
          if (place.website) statistics.withWebsite++;
          if (place.instagram) statistics.withInstagram++;
          if (place.email) statistics.withEmail++;
          if (place.rating) statistics.withRating++;
          if (place.photos?.count > 0) statistics.withPhotos++;

          const web = place.website ? '🌐' : '';
          const ig = place.instagram ? '📷' : '';
          const em = place.email ? '✉️' : '';
          onProgress(`  [${i + 1}/${total}] ${place.name} ${place.rating}★${web}${ig}${em}`);
        }
      } catch (err) {
        onProgress(`  [${i + 1}/${total}] skip`);
      }
    }
    await page.close();
    await context.close();
  } catch (e) {
    onProgress(`Error: ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
  }

  onProgress(`\nDone! ${places.length} places.`);
  statistics.total = places.length;
  return { success: true, data: places, count: places.length, statistics };
}

async function gotoWithRetry(page, url, onProgress) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      await page.goto(url, { timeout: CONFIG.PAGE_TIMEOUT, waitUntil: 'load' });
      return;
    } catch (e) {
      if (attempt === CONFIG.MAX_RETRIES) throw e;
      const delay = 2000 * Math.pow(2, attempt - 1);
      onProgress(`  Retry ${attempt}/${CONFIG.MAX_RETRIES - 1} in ${delay}ms...`);
      await page.waitForTimeout(delay);
    }
  }
}

async function scrapeEmails(browser, url, onProgress) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { timeout: CONFIG.PAGE_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const emails = await page.evaluate(() => {
      const found = new Set();
      document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
        const em = a.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
        if (em.includes('@')) found.add(em.toLowerCase());
      });
      const text = document.body.innerText;
      const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const em = m[0].toLowerCase();
        if (!em.endsWith('.png') && !em.endsWith('.jpg') && !em.includes('example.com')) found.add(em);
      }
      return [...found].slice(0, 5);
    });

    await page.close();
    return emails.join(', ');
  } catch (e) {
    await page.close().catch(() => {});
    return '';
  }
}

module.exports = { scrapeGoogleMaps };
