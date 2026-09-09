const INSTAGRAM_NON_PROFILE_PATHS = new Set([
  'about',
  'accounts',
  'developer',
  'direct',
  'explore',
  'legal',
  'p',
  'privacy',
  'reel',
  'reels',
  'stories',
  'tv',
  'web',
]);

function normalizeInstagramProfileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const hostname = url.hostname.toLowerCase();
    if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(hostname)) return '';
    const firstPath = url.pathname.split('/').filter(Boolean)[0] || '';
    const handle = decodeURIComponent(firstPath).replace(/^@/, '');
    if (
      !handle ||
      handle.length > 30 ||
      INSTAGRAM_NON_PROFILE_PATHS.has(handle.toLowerCase()) ||
      !/^[a-z0-9._]+$/i.test(handle)
    ) {
      return '';
    }
    return `https://www.instagram.com/${handle}/`;
  } catch {
    return '';
  }
}

async function extractBusinessData(page) {
  return await page.evaluate(() => {
    // O Maps pode incluir o ícone de localização (fonte Material, área privada
    // Unicode) no textContent do botão. trim() não remove esse glifo.
    const normalizeAddress = (value) => String(value ?? '')
      .normalize('NFC')
      .replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const headings = Array.from(document.querySelectorAll('h1.DUwDvf'));
    const heading = headings.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }) || null;
    const root = heading?.closest('[role="main"][aria-label]') || heading?.closest('[role="main"]') || document;
    const q = (selector) => root.querySelector(selector);
    const qa = (selector) => root.querySelectorAll(selector);
    const data = {
      name: heading?.textContent.trim() || '',
      rating: 0,
      totalReviews: '0',
      reviewCount: 0,
      category: q('button[jsaction*="category"]')?.textContent.trim() || '',
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
      q('button[data-item-id*="address"] div.fontBodyMedium'),
      q('div[data-item-id*="address"] div.fontBodyMedium'),
      q('a[data-item-id*="address"] div.fontBodyMedium'),
      q('button[data-item-id*="address"]'),
      q('div[data-item-id*="address"]'),
      q('[data-item-id*="address"]'),
      q('span[jsinstance]'),
    ].filter(Boolean);
    const addrEl = addrCandidates.find((el) => el && el.textContent && el.textContent.trim().length > 3) || null;
    if (addrEl) data.address = normalizeAddress(addrEl.textContent);

    // --- PHONE ---
    const phoneEl = q('button[data-item-id*="phone:tel:"] div.fontBodyMedium') ||
                    q('a[href^="tel:"]');
    if (phoneEl) data.phone = phoneEl.textContent.trim();

    // --- WEBSITE ---
    // Lê somente o link oficial do painel ativo: o fallback global copiava
    // sites e Instagrams do feed lateral para o lead errado.
    const webEl = q('a[data-item-id*="authority"]');
    if (webEl) data.website = webEl.href;

    // --- PLUS CODE ---
    const plusEl = q('button[data-item-id*="oloc"] div.fontBodyMedium');
    if (plusEl) data.plusCode = plusEl.textContent.trim();

    const hoursCandidates = [
      q('[aria-label*="Hours"]'),
      q('[aria-label*="horário"]'),
      q('[aria-label*="Horario"]'),
      q('button[data-item-id*="oh"]'),
    ].filter(Boolean);
    const hoursText = hoursCandidates
      .map(el => el.getAttribute('aria-label') || el.textContent || '')
      .find(text => text && text.trim().length > 5);
    if (hoursText) data.openingHours = hoursText.replace(/\s+/g, ' ').trim();

    // --- RATING & REVIEWS ---
    const ratingEl = q('div.F7nice span[aria-hidden="true"]');
    if (ratingEl) data.rating = parseFloat(ratingEl.textContent.replace(',', '.')) || 0;

    const reviewBtn = q('div.F7nice button[aria-label*="review"]');
    const reviewText = reviewBtn?.getAttribute('aria-label') ||
                       q('div.F7nice span[aria-label*="review"]')?.textContent || '';
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
  const el = q(sel);
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
    const imgs = qa('button[aria-label*="photo"] img, img[src*="googleusercontent"]');
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
      qa('a[href*="/maps/place/"], a[href*="!3d"], [data-item-id*="share"]').forEach(a => {
        try { if (a.href) hrefs.add(a.href); } catch {}
        try { const h = a.getAttribute('href'); if (h) hrefs.add(h); } catch {}
      });
      const shareBtn = q('[data-item-id*="share"]');
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


module.exports = { extractBusinessData, normalizeInstagramProfileUrl };
