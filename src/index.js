const cron = require('node-cron');
const { scrapeGroentetas } = require('./scraper');
const { generateMealPlan, generateRecipe, generateReplacementDish } = require('./ai-generator');
const { saveMealPlan, getState, getDish, getOriginalDishes, replaceDish } = require('./state');
const { initWithRetry, sendToGroup, getClient, cacheGroupFromMessage } = require('./whatsapp-bot');
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

    // Save meal plan state for !recept and !vervang commands
    saveMealPlan(vegetables, mealPlan);

    // Step 3: Send to WhatsApp group
    logger.info('Step 3/3: Sending to WhatsApp group...');
    const header = `🌿 *Weekmenu van Tuinderij de Lijsterbes* 🌿\n_Automatisch gegenereerd op ${new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}_\n\n`;
    const commandsTip = `\n\n💡 _Commando's: !recept1-5 voor een volledig recept, !vervang1-5 om een gerecht te vervangen_`;
    await sendToGroup(header + mealPlan + commandsTip);

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
  logger.info(`Cron schedule: ${config.cron.schedule} (${config.cron.timezone})`);
  logger.info(`Target group: ${config.whatsapp.groupName}`);

  // Initialize WhatsApp (shows QR URL on first run, retries on failure)
  await initWithRetry();

  // Schedule the weekly job (Amsterdam timezone)
  cron.schedule(config.cron.schedule, () => {
    logger.info('Cron triggered — running pipeline');
    runPipeline();
  }, { timezone: config.cron.timezone });

  logger.info('Bot is running. Waiting for cron trigger...');
  logger.info('Tip: Send "!menu" in the WhatsApp group to trigger manually.');

  // Allow manual trigger via "!menu" command in WhatsApp
  const waClient = getClient();
  if (waClient) {
    waClient.on('message_create', async (msg) => {
      // Cache the group chat from any message to avoid slow getChats() later
      cacheGroupFromMessage(msg);

      const body = msg.body.trim();

      if (body === '!menu') {
        logger.info('Manual trigger received via "!menu" command');
        await runPipeline();
        return;
      }

      const receptMatch = body.match(/^!recept\s?(\d)$/i);
      if (receptMatch) {
        await handleRecept(parseInt(receptMatch[1]));
        return;
      }

      const vervangMatch = body.match(/^!vervang\s?(\d)$/i);
      if (vervangMatch) {
        await handleVervang(parseInt(vervangMatch[1]));
        return;
      }
    });
    logger.info('Commands enabled: !menu, !recept1-5, !vervang1-5');
  }
}

async function handleRecept(dayNum) {
  try {
    const state = getState();
    if (!state.dishes.length) {
      await sendToGroup('Er is nog geen weekmenu gegenereerd. Stuur eerst !menu.');
      return;
    }

    // Find the original dish (not leftover days)
    const originals = getOriginalDishes();
    if (dayNum < 1 || dayNum > originals.length) {
      await sendToGroup(`Kies een nummer van 1 t/m ${originals.length}. Voorbeeld: !recept2`);
      return;
    }

    const dish = originals[dayNum - 1];
    logger.info(`Generating recipe for dish ${dayNum}: ${dish.name}`);
    await sendToGroup(`Een moment, ik zoek het recept op voor *${dish.name}*...`);

    const recipe = await generateRecipe(dish.name, dish.description, state.vegetables);
    await sendToGroup(recipe);
  } catch (error) {
    logger.error(`Recipe generation failed: ${error.message}`);
    await sendToGroup(`Recept ophalen mislukt: ${error.message}`);
  }
}

async function handleVervang(dayNum) {
  try {
    const state = getState();
    if (!state.dishes.length) {
      await sendToGroup('Er is nog geen weekmenu gegenereerd. Stuur eerst !menu.');
      return;
    }

    const originals = getOriginalDishes();
    if (dayNum < 1 || dayNum > originals.length) {
      await sendToGroup(`Kies een nummer van 1 t/m ${originals.length}. Voorbeeld: !vervang2`);
      return;
    }

    const oldDish = originals[dayNum - 1];
    logger.info(`Replacing dish ${dayNum}: ${oldDish.name}`);
    await sendToGroup(`Een moment, ik bedenk een vervanger voor *${oldDish.name}*...`);

    const newDishText = await generateReplacementDish(state.dishes, state.vegetables, oldDish.dayNum);

    // Parse the new dish name from the response
    const nameMatch = newDishText.match(/^Dag\s+\d\s*:\s*(.+)/im);
    const newName = nameMatch ? nameMatch[1].trim() : newDishText.split('\n')[0];
    const newDesc = newDishText.split('\n').slice(1).join(' ').trim();
    replaceDish(oldDish.dayNum, newName, newDesc);

    await sendToGroup(`Gerecht ${dayNum} is vervangen:\n\n${newDishText}`);
  } catch (error) {
    logger.error(`Dish replacement failed: ${error.message}`);
    await sendToGroup(`Vervangen mislukt: ${error.message}`);
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
