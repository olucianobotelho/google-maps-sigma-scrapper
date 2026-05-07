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
      photos: { main: '', thumbnail: '', all: [], count: 0 },
      latitude: '',
      longitude: '',
      placeId: '',
      googleMapsUrl: window.location.href
    };

    // --- ADDRESS ---
    const addrEl = document.querySelector('button[data-item-id*="address"] div.fontBodyMedium') ||
                   document.querySelector('span[jsinstance]') || null;
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
    const url = window.location.href;
    const coord = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (coord) {
      data.latitude = parseFloat(coord[1]);
      data.longitude = parseFloat(coord[2]);
    }
    // PlaceId fallback
    const plusMatch = plusEl?.textContent.match(/0x[a-f0-9]+/) || url.match(/!1s(0x[a-f0-9:]+)/);
    if (plusMatch) data.placeId = plusMatch[0];

    return data;
  });
}


module.exports = { extractBusinessData };
