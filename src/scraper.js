const puppeteer = require('puppeteer');
const logger = require('./logger');
const config = require('./config');

/**
 * Scrape the weekly vegetable list from Tuinderij de Lijsterbes.
 * The site shows the contents of the weekly "groentetas" (vegetable bag).
 * Since the site blocks simple HTTP requests (403), we use a headless browser.
 *
 * @returns {Promise<string[]>} Array of vegetable names
 */
async function scrapeGroentetas() {
  logger.info(`Scraping groentetas from ${config.scraper.url}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const page = await browser.newPage();

    // Set a realistic user-agent to avoid bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(config.scraper.url, {
      waitUntil: 'networkidle2',
      timeout: config.scraper.timeout,
    });

    // Wait for the page content to be fully rendered
    await page.waitForSelector('body', { timeout: 10_000 });

    // Extract vegetables from the page.
    // Strategy: look for common patterns on farm/CSA sites:
    //   1. Lists (<ul>/<ol>) containing vegetable names
    //   2. Sections with keywords like "groentetas", "pakket", "inhoud", "deze week"
    //   3. Fallback: scan all text content for a recognizable vegetable list
    const vegetables = await page.evaluate(() => {
      const results = [];

      // Helper: clean text and check if it looks like a vegetable item
      const cleanText = (text) =>
        text.replace(/\s+/g, ' ').trim().toLowerCase();

      // Strategy 1: Find sections about the groentetas / weekly package
      const allElements = document.querySelectorAll(
        'h1, h2, h3, h4, p, li, td, span, div'
      );
      let captureMode = false;
      const sectionKeywords = [
        'groentetas',
        'pakket',
        'inhoud',
        'deze week',
        'leveringslijst',
        'groenten',
        'groentepakket',
      ];

      for (const el of allElements) {
        const text = cleanText(el.textContent || '');

        // Check if this element is a header that signals the veggie list
        if (
          el.tagName.match(/^H[1-4]$/) &&
          sectionKeywords.some((kw) => text.includes(kw))
        ) {
          captureMode = true;
          continue;
        }

        // If in capture mode, grab list items
        if (captureMode && el.tagName === 'LI') {
          const itemText = (el.textContent || '').trim();
          if (itemText.length > 0 && itemText.length < 100) {
            results.push(itemText);
          }
        }

        // Stop capturing at the next unrelated header
        if (captureMode && el.tagName.match(/^H[1-4]$/) && results.length > 0) {
          break;
        }
      }

      // Strategy 2: If nothing found yet, look for any <ul> or <ol> with 4+ items
      // that contains short text entries (typical for a vegetable list)
      if (results.length === 0) {
        const lists = document.querySelectorAll('ul, ol');
        for (const list of lists) {
          const items = list.querySelectorAll('li');
          if (items.length >= 4) {
            const listItems = [];
            for (const item of items) {
              const t = (item.textContent || '').trim();
              if (t.length > 0 && t.length < 80) {
                listItems.push(t);
              }
            }
            if (listItems.length >= 4) {
              results.push(...listItems);
              break;
            }
          }
        }
      }

      // Strategy 3: Look for an image with alt text about the groentetas,
      // or text blocks that list items separated by commas or newlines
      if (results.length === 0) {
        const bodyText = document.body.innerText || '';
        const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);

        let inSection = false;
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (sectionKeywords.some((kw) => lower.includes(kw))) {
            inSection = true;
            continue;
          }
          if (inSection) {
            // Check if this line looks like a vegetable item (short, no URLs)
            if (
              line.length > 1 &&
              line.length < 80 &&
              !line.includes('http') &&
              !line.includes('@')
            ) {
              results.push(line);
            }
            // Stop if we hit an empty line or long text after collecting items
            if (results.length > 0 && (line.length > 100 || line === '')) {
              break;
            }
          }
        }
      }

      return results;
    });

    // Deduplicate and clean
    const cleaned = [...new Set(vegetables.map((v) => v.trim()))].filter(
      (v) => v.length > 0
    );

    if (cleaned.length === 0) {
      // Last resort: take a screenshot for debugging and return page text
      const bodyText = await page.evaluate(() => document.body.innerText);
      logger.warn(
        'Could not parse vegetable list from page. Full page text:\n' + bodyText
      );
      throw new Error(
        'Geen groenten gevonden op de website. Controleer of de pagina-structuur is veranderd.'
      );
    }

    logger.info(`Found ${cleaned.length} vegetables: ${cleaned.join(', ')}`);
    return cleaned;
  } catch (error) {
    logger.error(`Scraping failed: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { scrapeGroentetas };
