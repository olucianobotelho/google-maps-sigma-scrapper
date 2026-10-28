async function extractBusinessData(page) {
  return await page.evaluate(() => {
    // O Maps pode incluir o ícone de localização (fonte Material, área privada
    // Unicode) no textContent do botão. trim() não remove esse glifo.
    const normalizeAddress = (value) => String(value ?? '')
      .normalize('NFC')
      .replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const cleanText = (value) => String(value ?? '')
      .normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}\p{Co}\u{FE0E}\u{FE0F}]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const hostOf = (href) => {
      try { return new URL(href, window.location.origin).hostname.toLowerCase().replace(/^www\./, ''); }
      catch { return ''; }
    };
    // Links do Google (Maps, shortlinks, CDN de fotos) nunca são o site da empresa.
    const isGoogleHost = (host) => /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co|googleusercontent\.com|gstatic\.com|withgoogle\.com)$/.test(host);
    const isSocialHost = (host) => /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|whatsapp\.com|wa\.me|tiktok\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|youtu\.be)$/.test(host);
    const isInstagramHost = (host) => /(^|\.)(instagram\.com|instagr\.am)$/.test(host);
    const isAggregatorHost = (host) => /(^|\.)(linktr\.ee|linktree\.com|beacons\.ai|bio\.site|bio\.link|taplink\.cc|lnk\.bio|linkin\.bio|allmylinks\.com|campsite\.bio)$/.test(host);
    const isMarketplaceHost = (host) => /(^|\.)(ifood\.com\.br|getninjas\.com\.br|doctoralia\.com\.br|tripadvisor\.com(?:\.br)?|reclameaqui\.com\.br)$/.test(host);
    const isShortenerHost = (host) => /(^|\.)(bit\.ly|tinyurl\.com|t\.co|is\.gd)$/.test(host);
    const isNonSiteHost = (host) => isGoogleHost(host) || isSocialHost(host) || isAggregatorHost(host) || isMarketplaceHost(host) || isShortenerHost(host);
    // O painel do lugar é o único escopo confiável: o feed lateral mantém
    // resultados anteriores no DOM e contaminava site/Instagram do lead atual.
    const panel = document.querySelector('div[role="main"]') || document.body;

    const data = {
      name: document.querySelector('h1.DUwDvf')?.textContent.trim() || '',
      rating: 0,
      totalReviews: '0',
      reviewCount: 0,
      category: document.querySelector('button[jsaction*="category"]')?.textContent.trim() || '',
      address: '',
      phone: null,
      website: null,
      instagram: '',
      priceRange: null,
      plusCode: null,
      description: '',
      openingHours: '',
      photos: { main: '', thumbnail: '', all: [], count: 0 },
      latitude: '',
      longitude: '',
      placeId: '',
      googleMapsUrl: window.location.href
    };

    // --- ADDRESS ---
    const addrCandidates = [
      document.querySelector('button[data-item-id*="address"] div.fontBodyMedium'),
      document.querySelector('div[data-item-id*="address"] div.fontBodyMedium'),
      document.querySelector('a[data-item-id*="address"] div.fontBodyMedium'),
      document.querySelector('button[data-item-id*="address"]'),
      document.querySelector('div[data-item-id*="address"]'),
      document.querySelector('[data-item-id*="address"]'),
      document.querySelector('span[jsinstance]'),
    ].filter(Boolean);
    const addrEl = addrCandidates.find((el) => el && el.textContent && el.textContent.trim().length > 3) || null;
    if (addrEl) data.address = normalizeAddress(addrEl.textContent);

    // --- PHONE ---
    const phoneEl = document.querySelector('button[data-item-id*="phone:tel:"] div.fontBodyMedium') ||
                    document.querySelector('a[href^="tel:"]');
    if (phoneEl) data.phone = cleanText(phoneEl.textContent) || null;

    // --- WEBSITE ---
    // 1) Link oficial da ficha (authority). 2) Qualquer link do painel que não
    // seja Google, rede social ou o próprio Maps.
    const authority = document.querySelector('a[data-item-id*="authority"]');
    let website = authority?.href || '';
    if (!website) {
      const candidate = Array.from(panel.querySelectorAll('a[href^="http"]')).find((anchor) => {
        const host = hostOf(anchor.href);
        if (!host || isNonSiteHost(host)) return false;
        return !anchor.closest('button[aria-label*="photo"], div[data-review-id]');
      });
      website = candidate?.href || '';
    }
    if (website && !isNonSiteHost(hostOf(website))) data.website = website;

    // --- INSTAGRAM ---
    const igAnchor = Array.from(panel.querySelectorAll('a[href*="instagram.com"], a[href*="instagr.am"]')).find((anchor) => {
      const host = hostOf(anchor.href);
      if (!isInstagramHost(host)) return false;
      try {
        const first = new URL(anchor.href).pathname.split('/').filter(Boolean)[0] || '';
        return Boolean(first) && !['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct'].includes(first.toLowerCase());
      } catch {
        return false;
      }
    });
    if (igAnchor) data.instagram = igAnchor.href;

    // --- PLUS CODE ---
    const plusEl = document.querySelector('button[data-item-id*="oloc"] div.fontBodyMedium');
    if (plusEl) data.plusCode = plusEl.textContent.trim();

    const hoursCandidates = [
      document.querySelector('[aria-label*="Hours"]'),
      document.querySelector('[aria-label*="horário"]'),
      document.querySelector('[aria-label*="Horario"]'),
      document.querySelector('button[data-item-id*="oh"]'),
    ].filter(Boolean);
    const hoursText = hoursCandidates
      .map(el => el.getAttribute('aria-label') || el.textContent || '')
      .find(text => text && text.trim().length > 5);
    if (hoursText) data.openingHours = hoursText.replace(/\s+/g, ' ').trim();

    // --- RATING & REVIEWS ---
    const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]');
    if (ratingEl) data.rating = parseFloat(ratingEl.textContent.replace(',', '.')) || 0;

    // O texto varia por idioma ("reviews", "avaliações", "reseñas") e o
    // Maps pode trocar o botão por um span. Priorize o número colado ao termo
    // de avaliação; o primeiro número do bloco quase sempre é a nota.
    const reviewCandidates = Array.from(document.querySelectorAll(
      'div.F7nice [aria-label], div.F7nice button, div.F7nice span, div.F7nice'
    )).map((el) => `${el.getAttribute?.('aria-label') || ''} ${el.textContent || ''}`.replace(/\s+/g, ' ').trim());
    const reviewText = reviewCandidates.find((text) => /review|avaliaç|reseñ|avis/i.test(text)) || '';
    const reviewTerm = '(?:reviews?|avalia(?:ções|ção)?|reseñas?|avis)';
    const reviewMatch = reviewText.match(new RegExp(`([\\d.,]+)\\s*(mil|k)?\\s*${reviewTerm}`, 'i'))
      || reviewText.match(new RegExp(`${reviewTerm}[^\\d]*([\\d.,]+)\\s*(mil|k)?`, 'i'))
      || (document.querySelector('div.F7nice')?.textContent || '').match(/\(([\d.,]+)\)/);
    if (reviewMatch) {
      const rawCount = String(reviewMatch[1] || '').trim();
      const compact = rawCount.replace(/[.,]/g, '');
      const multiplier = /^(mil|k)$/i.test(reviewMatch[2] || '') ? 1000 : 1;
      const count = Number(compact) * multiplier;
      if (Number.isFinite(count)) {
        data.totalReviews = rawCount;
        data.reviewCount = Math.round(count);
      }
    }

   // --- DESCRIPTION ---
const descSelectors = [
  'div[class*="description"]',
  'div.WeS02d.fontBodyMedium',
  'div[aria-label*="Information"]',
  'div.PYvSYb'
];

for (const sel of descSelectors) {
  const el = document.querySelector(sel);
  if (el && el.textContent.trim().length > 10) {
    let rawDesc = el.textContent.replace(/\s+/g, ' ').trim();
    
    // Split out key information for readability
    rawDesc = rawDesc
      .replace(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/g, '\n$1:')
      .replace(/Open 24 hours/g, 'Open 24 hours\n')
      .replace(/Suggest new hours/g, '\nSuggest new hours:')
      .replace(/(\d{2,4}-\d{2,4}-\d{2,4})/g, '\nPhone: $1')
      .replace(/RQXQ\+2C/g, '\nPlus Code: RQXQ+2C');

    data.description = rawDesc;
    break;
  }
}

    // --- PHOTOS ---
    const imgs = document.querySelectorAll('button[aria-label*="photo"] img, img[src*="googleusercontent"]');
    const photoUrls = [...new Set(Array.from(imgs).map(img => {
      let src = img.src || img.getAttribute('data-src');
      if (!src) return null;
      src = src.replace(/=w\d+-h\d+-[^=]+/g,'=w1920-h1080-k-no').replace(/=s\d+/g,'=w1920-h1080-k-no');
      return src;
    }).filter(Boolean))];
    data.photos.all = photoUrls;
    if (photoUrls.length) {
      data.photos.main = photoUrls[0];
      data.photos.thumbnail = photoUrls[0].replace('=w1920-h1080-k-no','=w400-h400-k-no');
      data.photos.count = photoUrls.length;
    }
  

    // Backward compatibility alias
    data.reviews = data.reviewCount;

    // --- COORDINATES & PLACE ID ---
    // Prioridade: 1) !3d/!4d do link canônico (POI exato), 2) meta lat/lng do painel, 3) Plus Code geocodável, 4) NADA (sem viewport sujo)
    let foundLat = '';
    let foundLng = '';
    let coordSource = '';

    const collectLinks = () => {
      const hrefs = new Set();
      hrefs.add(window.location.href);
      document.querySelectorAll('a[href*="/maps/place/"], a[href*="!3d"], [data-item-id*="share"]').forEach(a => {
        try { if (a.href) hrefs.add(a.href); } catch {}
        try { const h = a.getAttribute('href'); if (h) hrefs.add(h); } catch {}
      });
      const shareBtn = document.querySelector('[data-item-id*="share"]');
      try { if (shareBtn?.href) hrefs.add(shareBtn.href); } catch {}
      return [...hrefs].join(' ');
    };
    const allLinks = collectLinks();

    // 1) Link canônico do lugar contém !3dLAT!4dLNG exato do POI
    const poiCoord = allLinks.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (poiCoord) {
      foundLat = poiCoord[1];
      foundLng = poiCoord[2];
      coordSource = 'poi';
    }

    // 2) Meta lat/lng injetado no estado da página
    if (!foundLat) {
      const html = document.documentElement.innerHTML;
      const metaCoords = html.match(/"lat"\s*:\s*(-?\d+\.\d+)\s*,\s*"lng"\s*:\s*(-?\d+\.\d+)/)
        || html.match(/APP_INITIALIZATION_STATE[^;]*?\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/)
        || html.match(/"center"\s*:\s*\{\s*"lat"\s*:\s*(-?\d+\.\d+)\s*,\s*"lng"\s*:\s*(-?\d+\.\d+)/);
      if (metaCoords) {
        const ml = parseFloat(metaCoords[1]);
        const mn = parseFloat(metaCoords[2]);
        if (ml >= -35 && ml <= 5 && mn >= -74 && mn <= -34) {
          foundLat = String(ml);
          foundLng = String(mn);
          coordSource = 'meta';
        }
      }
    }

    // 3) NÃO usa @viewport — deixa vazio pra geocodificar pelo endereço depois
    // (viewport joga pin no meio da floresta quando o Google ainda não carregou o POI)

    if (foundLat) {
      data.latitude = parseFloat(foundLat);
      data.longitude = parseFloat(foundLng);
      data.coordSource = coordSource;
    } else {
      data.coordSource = 'none';
    }
    const plusMatch = plusEl?.textContent.match(/0x[a-f0-9]+/) || allLinks.match(/!1s(0x[a-f0-9:]+)/);
    if (plusMatch) data.placeId = plusMatch[0];

    return data;
  });
}


module.exports = { extractBusinessData };
