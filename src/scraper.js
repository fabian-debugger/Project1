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

    // Extract vegetables from the "deze week" page.
    // The page lists this week's groentetas contents.
    const vegetables = await page.evaluate(() => {
      const results = [];

      // Navigation items to exclude
      const navItems = new Set([
        'home', 'ons bedrijf', 'abonnement', 'aanmelden', 'bezorging',
        'fotogalerij', 'fotogallerij', 'nieuwsbrief', 'contact', 'recepten',
        'menu', 'zoeken', 'search', 'inloggen', 'login',
      ]);

      // Patterns that indicate non-vegetable content
      const junkPatterns = [
        /bezorg/i, /regio/i, /levering/i, /gewijzigd/i, /voorkomen/i,
        /groesbeek/i, /breedeweg/i, /grafwegen/i, /plaatsen/i,
        /\d{2,}/, /week\s*\d+/i, /http/i, /@/,
        /bestellen/i, /prijs/i, /euro/i, /€/,
        /adres/i, /telefoon/i, /openingstijd/i,
      ];

      const isNavItem = (text) => navItems.has(text.trim().toLowerCase());
      const isJunk = (text) => junkPatterns.some((p) => p.test(text));

      const sectionKeywords = [
        'groentetas', 'pakket', 'inhoud', 'deze week',
        'leveringslijst', 'groenten', 'groentepakket',
      ];

      // Strategy 1: Find lists inside the main content area (skip nav/header/footer)
      const contentArea = document.querySelector('main, article, .content, .entry-content, #content')
        || document.body;

      // Look for lists that are NOT inside nav elements
      const lists = contentArea.querySelectorAll('ul, ol');
      for (const list of lists) {
        // Skip lists inside nav, header, or footer
        if (list.closest('nav, header, footer, .menu, .nav, .navigation')) continue;

        const items = list.querySelectorAll('li');
        if (items.length >= 3) {
          const listItems = [];
          for (const item of items) {
            const t = (item.textContent || '').trim();
            // Skip nav-like items and items with links that look like navigation
            if (t.length > 0 && t.length < 60 && !isNavItem(t) && !isJunk(t)) {
              listItems.push(t);
            }
          }
          // Only use this list if most items survived the nav filter
          if (listItems.length >= 3 && listItems.length > items.length * 0.5) {
            results.push(...listItems);
            break;
          }
        }
      }

      // Strategy 2: Find sections with groentetas keywords, then grab list items
      if (results.length === 0) {
        const allElements = contentArea.querySelectorAll('h1, h2, h3, h4, p, li, td, span, div');
        let captureMode = false;

        for (const el of allElements) {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();

          if (el.tagName.match(/^H[1-4]$/) && sectionKeywords.some((kw) => text.includes(kw))) {
            captureMode = true;
            continue;
          }

          if (captureMode && el.tagName === 'LI') {
            const itemText = (el.textContent || '').trim();
            if (itemText.length > 0 && itemText.length < 60 && !isNavItem(itemText) && !isJunk(itemText)) {
              results.push(itemText);
            }
          }

          if (captureMode && el.tagName.match(/^H[1-4]$/) && results.length > 0) {
            break;
          }
        }
      }

      // Strategy 3: Scan plain text for short lines that look like vegetable names
      if (results.length === 0) {
        const bodyText = (contentArea.innerText || '').replace(/\r/g, '');
        const lines = bodyText.split('\n').map((l) => l.trim()).filter(Boolean);

        let inSection = false;
        for (const line of lines) {
          const lower = line.toLowerCase();
          if (sectionKeywords.some((kw) => lower.includes(kw))) {
            inSection = true;
            continue;
          }
          if (inSection) {
            if (
              line.length > 1 &&
              line.length < 60 &&
              !isNavItem(line) &&
              !isJunk(line)
            ) {
              results.push(line);
            }
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
