const cron = require('node-cron');
const { scrapeGroentetas } = require('./scraper');
const { generateMealPlan } = require('./ai-generator');
const { initWithRetry, sendToGroup, getClient } = require('./whatsapp-bot');
const logger = require('./logger');
const config = require('./config');

/**
 * Main pipeline: scrape → generate → send.
 * Called by the cron job every Monday or manually via CLI.
 */
async function runPipeline() {
  const startTime = Date.now();
  logger.info('=== Starting weekly meal plan pipeline ===');

  try {
    // Step 1: Scrape vegetables
    logger.info('Step 1/3: Scraping groentetas...');
    const vegetables = await scrapeGroentetas();
    logger.info(`Scraped ${vegetables.length} groenten: ${vegetables.join(', ')}`);

    // Step 2: Generate meal plan via AI
    logger.info('Step 2/3: Generating meal plan...');
    const mealPlan = await generateMealPlan(vegetables);

    // Step 3: Send to WhatsApp group
    logger.info('Step 3/3: Sending to WhatsApp group...');
    const header = `🌿 *Weekmenu van Tuinderij de Lijsterbes* 🌿\n_Automatisch gegenereerd op ${new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}_\n\n`;
    await sendToGroup(header + mealPlan);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`=== Pipeline completed in ${duration}s ===`);
  } catch (error) {
    logger.error(`Pipeline failed: ${error.message}`);
    logger.error(error.stack);

    // Try to send error notification to group
    try {
      await sendToGroup(
        `⚠️ De weekmenu-bot is mislukt:\n${error.message}\n\nProbeer het handmatig via "!menu".`
      );
    } catch {
      logger.error('Could not send error notification to WhatsApp group');
    }
  }
}

async function main() {
  logger.info('🤖 WhatsApp Meal Planner Bot starting...');
  logger.info(`Cron schedule: ${config.cron.schedule}`);
  logger.info(`Target group: ${config.whatsapp.groupName}`);

  // Initialize WhatsApp (shows QR URL on first run, retries on failure)
  await initWithRetry();

  // Schedule the weekly job
  cron.schedule(config.cron.schedule, () => {
    logger.info('Cron triggered — running pipeline');
    runPipeline();
  });

  logger.info('Bot is running. Waiting for cron trigger...');
  logger.info('Tip: Send "!menu" in the WhatsApp group to trigger manually.');

  // Allow manual trigger via "!menu" command in WhatsApp
  const waClient = getClient();
  if (waClient) {
    waClient.on('message_create', async (msg) => {
      if (msg.body === '!menu') {
        logger.info('Manual trigger received via "!menu" command');
        await runPipeline();
      }
    });
    logger.info('Manual trigger via "!menu" command enabled');
  }
}

// Prevent unhandled rejections from crashing the process.
// whatsapp-web.js throws "Execution context was destroyed" from internal
// event handlers that cannot be caught with try/catch.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  process.exit(0);
});

// Run
main().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
