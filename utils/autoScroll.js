async function autoScroll(page, maxResults, scrollDelay = 1500) {
  await page.evaluate(async (maxResults, scrollDelay) => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return;
    let lastHeight = 0, attempts = 0;
    while (attempts < 50) {
      feed.scrollTo(0, feed.scrollHeight);
      await new Promise(r => setTimeout(r, scrollDelay));
      const currentHeight = feed.scrollHeight;
      const itemCount = document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]').length;
      if (itemCount >= maxResults * 1.5) break;
      attempts = currentHeight === lastHeight ? attempts + 1 : 0;
      lastHeight = currentHeight;
    }
  }, maxResults, scrollDelay);
}

module.exports = { autoScroll };
