const { scrapeGoogleMaps } = require('./scraper');

async function main() {
  try {
    console.log('GOOGLE MAPS SCRAPER');
    
    const searchQuery = 'Cafe in Soppeng';
    const maxResults = 10;
    
    const results = await scrapeGoogleMaps(searchQuery, maxResults);

    if (results.length > 0) {
      console.log('FIRST RESULT:');
      console.log('='.repeat(70));
      console.log(JSON.stringify(results[0], null, 2));
      console.log('='.repeat(70));
    }
    
    console.log('\nScrape complete!\n');
  } catch (error) {
    console.error('\nError:', error.message);
  }
}

main();
