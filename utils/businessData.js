async function extractBusinessData(page) {
  return await page.evaluate(() => {
    const data = {
      name: document.querySelector('h1.DUwDvf')?.textContent.trim() || '',
      rating: 0,
      totalReviews: '0',
      reviewCount: 0,
      category: document.querySelector('button[jsaction*="category"]')?.textContent.trim() || '',
      address: '',
      phone: null,
      website: null,
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
    if (addrEl) data.address = addrEl.textContent.trim();

    // --- PHONE ---
    const phoneEl = document.querySelector('button[data-item-id*="phone:tel:"] div.fontBodyMedium') ||
                    document.querySelector('a[href^="tel:"]');
    if (phoneEl) data.phone = phoneEl.textContent.trim();

    // --- WEBSITE ---
    const webEl = document.querySelector('a[data-item-id*="authority"]') ||
                  Array.from(document.querySelectorAll('a[href^="http"]'))
                    .find(a => !a.href.includes('google.com'));
    if (webEl) data.website = webEl.href;

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

    const reviewBtn = document.querySelector('div.F7nice button[aria-label*="review"]');
    const reviewText = reviewBtn?.getAttribute('aria-label') || 
                       document.querySelector('div.F7nice span[aria-label*="review"]')?.textContent || '';
    const match = reviewText.match(/([\d.,]+)/);
    if (match) {
      data.totalReviews = match[1];
      data.reviewCount = parseInt(match[1].replace(/[.,]/g,'')) || 0;
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
