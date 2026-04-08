const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CACHE_FILE = path.resolve(__dirname, '..', '.meal-plan-cache.json');

let state = {
  vegetables: [],
  rawPlan: '',
  dishes: [],
  timestamp: null,
};

/**
 * Parse dish entries from the raw AI-generated meal plan text.
 * Expects lines like "Dag 1: Naam gerecht" or "Dag 3: Restjes Dag 1"
 */
function parseDishes(rawPlan) {
  const dishes = [];
  const lines = rawPlan.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^Dag\s+(\d)\s*:\s*(.+)/i);
    if (match) {
      const dayNum = parseInt(match[1]);
      const name = match[2].replace(/🍲x2/g, '').trim();
      const isDouble = lines[i].includes('🍲x2');
      const isLeftover = /restjes/i.test(name);

      // Next line(s) may contain the description
      let description = '';
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (!nextLine || /^Dag\s+\d/i.test(nextLine) || /^🛒/.test(nextLine)) break;
        description += (description ? ' ' : '') + nextLine;
      }

      dishes.push({ dayNum, name, description, isDouble, isLeftover });
    }
  }

  return dishes;
}

/**
 * Save the meal plan to memory and disk.
 */
function saveMealPlan(vegetables, rawPlan) {
  const dishes = parseDishes(rawPlan);
  state = {
    vegetables,
    rawPlan,
    dishes,
    timestamp: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(state, null, 2));
    logger.info(`Meal plan saved (${dishes.length} days parsed)`);
  } catch (err) {
    logger.warn(`Could not save meal plan to disk: ${err.message}`);
  }
}

/**
 * Load meal plan from disk on startup.
 */
function loadMealPlan() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      state = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      logger.info(`Loaded cached meal plan from ${state.timestamp} (${state.dishes.length} days)`);
    }
  } catch (err) {
    logger.warn(`Could not load cached meal plan: ${err.message}`);
  }
}

function getState() {
  return state;
}

/**
 * Get a specific dish by day number (1-7).
 */
function getDish(dayNum) {
  return state.dishes.find((d) => d.dayNum === dayNum) || null;
}

/**
 * Get only the "real" dishes (not leftover days). Returns up to 5 dishes.
 */
function getOriginalDishes() {
  return state.dishes.filter((d) => !d.isLeftover);
}

/**
 * Replace a dish in the state and save.
 */
function replaceDish(dayNum, newName, newDescription) {
  const dish = state.dishes.find((d) => d.dayNum === dayNum);
  if (dish) {
    dish.name = newName;
    dish.description = newDescription;
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(state, null, 2));
    } catch { /* ignore */ }
  }
}

// Load from disk on module load
loadMealPlan();

module.exports = { saveMealPlan, getState, getDish, getOriginalDishes, replaceDish };
