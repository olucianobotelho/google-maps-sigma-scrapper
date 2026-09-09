const { chromium } = require('playwright');
const CONFIG = require('./config');
const { extractBusinessData, normalizeInstagramProfileUrl } = require('./utils/businessData');
const { geocodeAddress, isValidCoord } = require('./utils/geocode');
const { normalizeAddress } = require('./utils/address-normalizer');

function checkCancelled(cancelToken) {
  if (cancelToken?.cancelled) {
    const err = new Error('Scrape cancelled');
    err.code = 'SCRAPE_CANCELLED';
    throw err;
  }
}

async function scrapeGoogleMaps(searchQuery, maxResults = 999, onProgress = console.log, cancelToken = null) {
  onProgress('Launching browser...');
  let browser;
  const launchAttempts = [
    { headless: CONFIG.HEADLESS, channel: 'chrome' },
    { headless: CONFIG.HEADLESS },
  ];
  let launchError;
  for (const opts of launchAttempts) {
    try {
      browser = await chromium.launch(opts);
      break;
    } catch (e) {
      launchError = e;
      onProgress(`Browser launch attempt failed (${opts.channel || 'bundled'}): ${e.message}`);
    }
  }
  if (!browser) {
    throw new Error(`Falha ao abrir navegador. Verifique se o Chrome está instalado. Detalhes: ${launchError?.message || 'unknown'}`);
  }
  const places = [];
  const statistics = { withPhone: 0, withWebsite: 0, withInstagram: 0, withEmail: 0, withRating: 0, withPhotos: 0 };
  let context;
  let page;

  try {
    checkCancelled(cancelToken);
    context = await browser.newContext({
      userAgent: CONFIG.USER_AGENT,
      viewport: { width: 1366, height: 768 }
    });
    page = await context.newPage();

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
    checkCancelled(cancelToken);
    await gotoWithRetry(page, `https://www.google.com/maps/search/${encodedQuery}`, onProgress);
    await page.waitForTimeout(CONFIG.INITIAL_WAIT);
    checkCancelled(cancelToken);

    try {
      const btn = page.locator('button:has-text("Accept all"), button:has-text("Aceitar todos")').first();
      if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); await page.waitForTimeout(800); }
    } catch (e) {}

    try { await page.waitForSelector('div[role="feed"]', { timeout: 15000 }); }
    catch (e) { onProgress('No results found'); await browser.close(); return { success: false, error: 'No results', data: [], count: 0, statistics }; }

    onProgress('Loading results...');
    let prev = 0, stuck = 0;
    while (stuck < CONFIG.SEARCH_DEPTH) {
      checkCancelled(cancelToken);
      await page.evaluate(() => { const f = document.querySelector('div[role="feed"]'); if (f) f.scrollTop = f.scrollHeight; });
      await page.waitForTimeout(CONFIG.SCROLL_DELAY);
      const count = await page.locator('div[role="feed"] a[href*="/maps/place/"]').count();
      onProgress(`  Found: ${count}`);
      if (count === prev) stuck++; else stuck = 0;
      prev = count;
      if (count >= maxResults) break;
    }

    const listings = await page.locator('div[role="feed"] a[href*="/maps/place/"]').evaluateAll((anchors, limit) => {
      const seen = new Set();
      return anchors
        .map((anchor) => ({
          name: (anchor.getAttribute('aria-label') || anchor.textContent || '').trim(),
          href: anchor.href || '',
        }))
        .filter(({ name, href }) => name && href && !seen.has(href) && seen.add(href))
        .slice(0, limit);
    }, maxResults);
    const total = listings.length;
    onProgress(`\nExtracting ${total} places...`);

    for (let i = 0; i < total; i++) {
      try {
        checkCancelled(cancelToken);
        const target = listings[i];
        const listing = page
          .locator('div[role="feed"]')
          .getByRole('link', { name: target.name, exact: true })
          .first();
        await listing.click();
        await page
          .getByRole('main', { name: target.name, exact: true })
          .waitFor({ state: 'visible', timeout: CONFIG.ELEMENT_TIMEOUT });
        await page.waitForTimeout(500);
        checkCancelled(cancelToken);

        let place = await extractBusinessData(page);
        place.address = normalizeAddress(place.address);
        if (!place.latitude || place.coordSource === 'none') {
          await page.waitForTimeout(700);
          const retry = await extractBusinessData(page);
          retry.address = normalizeAddress(retry.address);
          if (retry.latitude && retry.coordSource !== 'none') place = retry;
        }

        if (place.name) {
          const lat = parseFloat(place.latitude);
          const lng = parseFloat(place.longitude);
          const hasPreciseCoord = isValidCoord(lat, lng) && (place.coordSource === 'poi' || place.coordSource === 'meta');
          const needsGeocode = !hasPreciseCoord && place.address && place.address.length > 5;
          if (needsGeocode) {
            try {
              checkCancelled(cancelToken);
              const geo = await geocodeAddress(place.address, searchQuery);
              if (geo && isValidCoord(geo.lat, geo.lng)) {
                place.latitude = geo.lat;
                place.longitude = geo.lng;
                place.geocodeConfidence = geo.confidence;
                place.geocodeSource = geo.source;
                place.geocodeDisplayName = geo.displayName;
                place.coordSource = 'nominatim';
              } else if (!isValidCoord(lat, lng)) {
                place.coordSource = 'none';
                place.latitude = '';
                place.longitude = '';
              }
            } catch (err) {
              if (err.code === 'SCRAPE_CANCELLED') throw err;
            }
          }
          place.instagram = normalizeInstagramProfileUrl(place.website);
          if (place.instagram) place.website = '';

          if (place.website && !place.website.includes('facebook.com') && !place.website.includes('youtube.com')) {
            checkCancelled(cancelToken);
            const contacts = await scrapeWebsiteContacts(browser, place.website, cancelToken);
            place.email = contacts.email;
            place.instagram = contacts.instagram;
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
        if (err.code === 'SCRAPE_CANCELLED') throw err;
        onProgress(`  [${i + 1}/${total}] skip`);
      }
    }
    await page.close();
    await context.close();
  } catch (e) {
    if (e.code === 'SCRAPE_CANCELLED') {
      onProgress('Scrape cancelled.');
      throw e;
    }
    onProgress(`Error: ${e.message}`);
    if (places.length === 0) {
      return { success: false, error: e.message, data: [], count: 0, statistics };
    }
    statistics.total = places.length;
    return { success: true, partial: true, warnings: [e.message], data: places, count: places.length, statistics };
  } finally {
    await page?.close?.().catch(() => {});
    await context?.close?.().catch(() => {});
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

async function scrapeWebsiteContacts(browser, url, cancelToken = null) {
  const page = await browser.newPage();
  try {
    checkCancelled(cancelToken);
    await page.goto(url, { timeout: CONFIG.PAGE_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    checkCancelled(cancelToken);

    const contacts = await page.evaluate(() => {
      const found = new Set();
      document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
        const em = a.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
        if (em.includes('@')) found.add(em.toLowerCase());
      });
      const text = document.body?.innerText || '';
      const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const em = m[0].toLowerCase();
        if (!em.endsWith('.png') && !em.endsWith('.jpg') && !em.includes('example.com')) found.add(em);
      }
      return {
        emails: [...found].slice(0, 5),
        links: Array.from(document.querySelectorAll('a[href]'), (anchor) => anchor.href),
      };
    });

    return {
      email: contacts.emails.join(', '),
      instagram: contacts.links.map(normalizeInstagramProfileUrl).find(Boolean) || '',
    };
  } catch (e) {
    if (e.code === 'SCRAPE_CANCELLED') throw e;
    return { email: '', instagram: '' };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeGoogleMaps };
