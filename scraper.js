const { chromium } = require('playwright');
const CONFIG = require('./config');
const { extractBusinessData } = require('./utils/businessData');
const { geocodeAddress, isValidCoord } = require('./utils/geocode');
const { normalizeAddress } = require('./utils/address-normalizer');
const { normalizeText } = require('./utils/text-normalizer');
const {
  normalizeInstagram,
  normalizeLeadLinks,
  normalizePhoneDisplay,
  isRealWebsite,
  isNonSiteUrl,
} = require('./utils/lead-links');

function normalizePlaceText(place = {}) {
  const links = normalizeLeadLinks(place);
  return {
    ...place,
    name: normalizeText(place.name),
    category: normalizeText(place.category),
    description: normalizeText(place.description),
    openingHours: normalizeText(place.openingHours),
    address: normalizeAddress(place.address),
    phone: normalizePhoneDisplay(place.phone) || normalizeText(place.phone),
    website: links.website,
    instagram: links.instagram,
  };
}

function checkCancelled(cancelToken) {
  if (cancelToken?.cancelled) {
    const err = new Error('Scrape cancelled');
    err.code = 'SCRAPE_CANCELLED';
    throw err;
  }
}

function describeExtractedPlace(place, current, total) {
  const details = [];
  if (place.phone) details.push('telefone');
  if (place.website) details.push('site');
  if (place.instagram) details.push('Instagram');
  if (place.email) details.push('e-mail');
  const rating = Number(place.rating);
  const ratingText = Number.isFinite(rating) && rating > 0
    ? ` · nota ${String(place.rating).replace('.', ',')}`
    : '';
  const detailsText = details.length ? ` · ${details.join(', ')} encontrado${details.length > 1 ? 's' : ''}` : '';
  return `Empresa ${current} de ${total} extraída: ${place.name}${ratingText}${detailsText}.`;
}

async function scrapeGoogleMaps(searchQuery, maxResults = 999, onProgress = console.log, cancelToken = null) {
  onProgress('Abrindo o navegador para a extração…');
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
      onProgress(`Não foi possível abrir o navegador (${opts.channel || 'integrado'}): ${e.message}`);
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
    catch (e) { onProgress('Nenhum resultado foi encontrado no Google Maps.'); await browser.close(); return { success: false, error: 'Nenhum resultado encontrado.', data: [], count: 0, statistics }; }

    onProgress('Carregando os resultados encontrados…');
    let prev = 0, stuck = 0;
    while (stuck < CONFIG.SEARCH_DEPTH) {
      checkCancelled(cancelToken);
      await page.evaluate(() => { const f = document.querySelector('div[role="feed"]'); if (f) f.scrollTop = f.scrollHeight; });
      await page.waitForTimeout(CONFIG.SCROLL_DELAY);
      const count = await page.locator('a[href*="/maps/place/"]').count();
      onProgress({
        type: 'listing-count',
        found: count,
        message: `${count} empresa${count === 1 ? '' : 's'} encontrada${count === 1 ? '' : 's'} na lista do Google Maps.`,
      });
      if (count === prev) stuck++; else stuck = 0;
      prev = count;
      if (count >= maxResults) break;
    }

    const listings = await page.locator('a[href*="/maps/place/"]').all();
    const total = Math.min(listings.length, maxResults);
    onProgress(`Iniciando a extração de ${total} empresa${total === 1 ? '' : 's'}…`);

    for (let i = 0; i < total; i++) {
      try {
        checkCancelled(cancelToken);
        await listings[i].click();
        try { await page.waitForSelector('h1.DUwDvf', { timeout: 3000 }); } catch {}
        await page.waitForTimeout(500);
        for (let attempt = 0; attempt < 4; attempt++) {
          const hasPoi = await page.evaluate(() => document.documentElement.innerHTML.includes('!3d-') || document.documentElement.innerHTML.includes('!3d')).catch(() => false);
          if (hasPoi) break;
          await page.waitForTimeout(400);
        }
        checkCancelled(cancelToken);

        let place = normalizePlaceText(await extractBusinessData(page));
        if (!place.latitude || place.coordSource === 'none') {
          await page.waitForTimeout(700);
          const retry = normalizePlaceText(await extractBusinessData(page));
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
          // O Instagram já vem do painel do lugar. O fallback fica restrito ao
          // mesmo painel para não herdar a rede social de outro resultado.
          if (!place.instagram) {
            const ig = page.locator('div[role="main"] a[href*="instagram.com"]').first();
            if (await ig.count() > 0) place.instagram = normalizeInstagram(await ig.getAttribute('href'));
          }

          // E-mail só faz sentido em site próprio: rede social e agregador não
          // expõem contato da empresa de forma confiável.
          if (place.website && !isNonSiteUrl(place.website)) {
            checkCancelled(cancelToken);
            place.email = await scrapeEmails(browser, place.website, onProgress, cancelToken);
          } else {
            place.email = '';
          }

          places.push(place);

          if (place.phone) statistics.withPhone++;
          if (isRealWebsite(place.website)) statistics.withWebsite++;
          if (place.instagram) statistics.withInstagram++;
          if (place.email) statistics.withEmail++;
          if (place.rating) statistics.withRating++;
          if (place.photos?.count > 0) statistics.withPhotos++;

          onProgress({
            type: 'lead',
            current: i + 1,
            total,
            found: places.length,
            lead: place,
            message: describeExtractedPlace(place, i + 1, total),
          });
        }
      } catch (err) {
        if (err.code === 'SCRAPE_CANCELLED') throw err;
        onProgress({
          type: 'skipped',
          current: i + 1,
          total,
          found: places.length,
          message: `Empresa ${i + 1} de ${total} ignorada por dados incompletos.`,
        });
      }
    }
    await page.close();
    await context.close();
  } catch (e) {
    if (e.code === 'SCRAPE_CANCELLED') {
      onProgress('Extração cancelada.');
      throw e;
    }
    onProgress(`Erro durante a extração: ${e.message}`);
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

  onProgress(`Extração concluída: ${places.length} empresa${places.length === 1 ? '' : 's'} extraída${places.length === 1 ? '' : 's'}.`);
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
      onProgress(`Nova tentativa ${attempt} de ${CONFIG.MAX_RETRIES - 1} em ${Math.round(delay / 1000)} s…`);
      await page.waitForTimeout(delay);
    }
  }
}

async function scrapeEmails(browser, url, onProgress, cancelToken = null) {
  const page = await browser.newPage();
  try {
    checkCancelled(cancelToken);
    await page.goto(url, { timeout: CONFIG.PAGE_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    checkCancelled(cancelToken);

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
    if (e.code === 'SCRAPE_CANCELLED') throw e;
    return '';
  }
}

module.exports = { scrapeGoogleMaps };
