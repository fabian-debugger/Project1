/**
 * Standalone test script for the AI meal plan generator.
 * Uses a sample vegetable list — no scraping required.
 * Usage: npm run generate
 */
const { generateMealPlan } = require('./ai-generator');
const logger = require('./logger');

const SAMPLE_VEGETABLES = [
  'Boerenkool',
  'Prei',
  'Winterwortel',
  'Rode biet',
  'Knolselderij',
  'Pastinaak',
  'Veldsla',
  'Ui',
];

async function main() {
  logger.info('Testing meal plan generation with sample vegetables...');
  console.log('\nSample groentetas:', SAMPLE_VEGETABLES.join(', '));
  console.log('\nGenerating meal plan...\n');

  try {
    const plan = await generateMealPlan(SAMPLE_VEGETABLES);
    console.log(plan);
    console.log('\n✅ Generation succeeded!');
  } catch (error) {
    console.error('\n❌ Generation failed:', error.message);
    process.exit(1);
  }
}

main();
