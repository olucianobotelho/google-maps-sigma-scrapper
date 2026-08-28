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
    // Prioridade: 1) link canônico do lugar (tem coords exatas), 2) coords do pin no mapa, 3) centro da viewport
    let foundLat = '';
    let foundLng = '';
    let coordSource = '';

    // 1) Botão de compartilhar / link canônico contém !3dLAT!4dLNG exato do POI
    const shareLink = document.querySelector('a[href*="/maps/place/"]')?.href || document.querySelector('[data-item-id*="share"]')?.href || '';
    const allLinks = [shareLink, window.location.href].join(' ');
    const poiCoord = allLinks.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (poiCoord) {
      foundLat = poiCoord[1];
      foundLng = poiCoord[2];
      coordSource = 'poi';
    }

    // 2) Meta de lugar com coords do marcador
    if (!foundLat) {
      const metaCoords = document.documentElement.innerHTML.match(/"lat":\s*(-?\d+\.\d+)\s*,\s*"lng":\s*(-?\d+\.\d+)/)
        || document.documentElement.innerHTML.match(/APP_INITIALIZATION_STATE[^;]*?\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/);
      if (metaCoords) {
        // Sanity: deve estar no Brasil (-35 a 5 lat, -74 a -34 lng) pra evitar pegar outra coisa
        const ml = parseFloat(metaCoords[1]);
        const mn = parseFloat(metaCoords[2]);
        if (ml >= -35 && ml <= 5 && mn >= -74 && mn <= -34) {
          foundLat = String(ml);
          foundLng = String(mn);
          coordSource = 'meta';
        }
      }
    }

    // 3) Fallback: centro da viewport @lat,lng (pode estar deslocado)
    if (!foundLat) {
      const viewportCoord = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (viewportCoord) {
        foundLat = viewportCoord[1];
        foundLng = viewportCoord[2];
        coordSource = 'viewport';
      }
    }

    if (foundLat) {
      data.latitude = parseFloat(foundLat);
      data.longitude = parseFloat(foundLng);
      data.coordSource = coordSource;
    }
    // PlaceId fallback
    const plusMatch = plusEl?.textContent.match(/0x[a-f0-9]+/) || allLinks.match(/!1s(0x[a-f0-9:]+)/);
    if (plusMatch) data.placeId = plusMatch[0];

    return data;
  });
}


module.exports = { extractBusinessData };
