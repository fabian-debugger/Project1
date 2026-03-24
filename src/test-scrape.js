/**
 * Standalone test script for the scraper.
 * Usage: npm run scrape
 */
const { scrapeGroentetas } = require('./scraper');
const logger = require('./logger');

async function main() {
  logger.info('Testing scraper...');
  try {
    const vegetables = await scrapeGroentetas();
    console.log('\n✅ Scraping succeeded!\n');
    console.log('Groenten gevonden:');
    vegetables.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));
    console.log(`\nTotaal: ${vegetables.length} groenten`);
  } catch (error) {
    console.error('\n❌ Scraping failed:', error.message);
    process.exit(1);
  }
}

main();
