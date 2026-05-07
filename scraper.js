const { chromium } = require('playwright');

// ─── SCRAPE GOOGLE MAPS ────────────────────
async function scrapeGoogleMaps(searchQuery, maxResults = 999, onProgress = console.log) {
  onProgress('Launching browser...');
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const places = [];

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });

    const encodedQuery = encodeURIComponent(searchQuery);
    await page.goto(`https://www.google.com/maps/search/${encodedQuery}`, { timeout: 60000, waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // Accept cookies
    try {
      const btn = page.locator('button:has-text("Accept all"), button:has-text("Aceitar todos")').first();
      if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); await page.waitForTimeout(800); }
    } catch (e) {}

    // Wait for results
    try { await page.waitForSelector('div[role="feed"]', { timeout: 15000 }); }
    catch (e) { onProgress('No results found'); await browser.close(); return { success: false, error: 'No results' }; }

    // Scroll until no more
    onProgress('Loading results...');
    let prev = 0, stuck = 0;
    while (stuck < 5) {
      await page.evaluate(() => { const f = document.querySelector('div[role="feed"]'); if (f) f.scrollTop = f.scrollHeight; });
      await page.waitForTimeout(800);
      const count = await page.locator('a[href*="/maps/place/"]').count();
      onProgress(`  Found: ${count}`);
      if (count === prev) stuck++; else stuck = 0;
      prev = count;
      if (count >= maxResults) break;
    }

    // Collect and extract
    const listings = await page.locator('a[href*="/maps/place/"]').all();
    const total = Math.min(listings.length, maxResults);
    onProgress(`\nExtracting ${total} places...`);

    for (let i = 0; i < total; i++) {
      try {
        await listings[i].click();
        await page.waitForTimeout(600);

        const place = await page.evaluate(() => {
          const d = { name: '', address: '', phone: '', website: '', instagram: '', email: '', rating: '', totalReviews: '', category: '' };

          const n = document.querySelector('h1.DUwDvf'); if (n) d.name = n.textContent.trim();
          const r = document.querySelector('div.F7nice span[aria-hidden="true"]'); if (r) d.rating = r.textContent.trim();

          const rev = document.querySelector('div.F7nice button[aria-label]');
          if (rev) d.totalReviews = rev.getAttribute('aria-label') || '';

          const a = document.querySelector('button[data-item-id="address"]'); if (a) d.address = a.textContent.trim();
          const p = document.querySelector('button[data-item-id*="phone:tel:"]'); if (p) d.phone = p.textContent.trim().replace(/\D/g, '');
          const w = document.querySelector('a[data-item-id="authority"]'); if (w) d.website = w.href || '';

          // Instagram detection
          if (d.website && d.website.includes('instagram.com')) {
            d.instagram = d.website;
            d.website = '';
          }
          // Look for instagram links elsewhere
          if (!d.instagram) {
            const ig = document.querySelector('a[href*="instagram.com"]');
            if (ig) d.instagram = ig.href;
          }

          const c = document.querySelector('button[jsaction*="category"]'); if (c) d.category = c.textContent.trim();
          return d;
        });

        if (place.name) {
          // Email scraping for real websites (not instagram/facebook/etc)
          if (place.website && !place.website.includes('instagram.com') && !place.website.includes('facebook.com') && !place.website.includes('youtube.com')) {
            place.email = await scrapeEmails(browser, place.website, onProgress);
          }
          places.push(place);
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
  } catch (e) {
    onProgress(`Error: ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
  }

  onProgress(`\nDone! ${places.length} places.`);
  return { success: true, data: places, count: places.length };
}

// ─── EMAIL SCRAPER ─────────────────────────
async function scrapeEmails(browser, url, onProgress) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const emails = await page.evaluate(() => {
      const found = new Set();
      // Mailto links
      document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
        const em = a.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
        if (em.includes('@')) found.add(em.toLowerCase());
      });
      // Text content
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
