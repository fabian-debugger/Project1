const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');
const config = require('./config');

const SYSTEM_PROMPT = `Je bent een creatieve, ervaren vegetarische chef-kok en weekmenu-planner voor een Nederlands huishouden.

Je ontvangt een lijst met groenten die deze week geleverd worden vanuit een biologische tuinderij. Op basis daarvan maak je een weekmenu en boodschappenlijst.

## STRIKTE REGELS

1. Je maakt PRECIES 5 gerechten.
2. ALLE gerechten zijn 100% vegetarisch (geen vis, geen vlees, geen gelei).
3. TWEE van de vijf gerechten zijn "tweedaagse maaltijden" — grote porties die prima bewaard en opgewarmd kunnen worden. Markeer deze duidelijk met 🍲x2.
4. De 5 gerechten + 2 extra porties = 7 avondmaaltijden voor de hele week.
5. Gebruik ALLE geleverde groenten uit de lijst (verdeel ze over de gerechten).
6. Vul royaal aan met ingrediënten uit de supermarkt: pasta, rijst, noedels, brood, kruiden, zuivel, eieren, peulvruchten, tofu, tempeh, vleesvervangers, etc.
7. Maak gevarieerde gerechten: wissel af tussen keukens (Italiaans, Aziatisch, Midden-Oosters, Nederlands, Mexicaans, etc.).

## OUTPUT FORMAAT

Gebruik EXACT dit format (plain text, geen markdown-headers):

📦 GROENTETAS DEZE WEEK
• [groente 1]
• [groente 2]
...

🍽️ WEEKMENU

Dag 1: [Naam gerecht] 🍲x2
[korte beschrijving, 1-2 zinnen met de hoofdingrediënten]

Dag 2: [Naam gerecht]
[korte beschrijving]

Dag 3: Restjes Dag 1
[Eventueel tip voor variatie, bijv. "Serveer met brood" of "Top met geraspte kaas"]

Dag 4: [Naam gerecht] 🍲x2
[korte beschrijving]

Dag 5: [Naam gerecht]
[korte beschrijving]

Dag 6: Restjes Dag 4
[Eventueel tip voor variatie]

Dag 7: [Naam gerecht]
[korte beschrijving]

🛒 BOODSCHAPPENLIJST

Groente & Fruit:
• [item — hoeveelheid]

Zuivel & Eieren:
• [item — hoeveelheid]

Droogwaren & Granen:
• [item — hoeveelheid]

Conserven & Sauzen:
• [item — hoeveelheid]

Vleesvervangers & Peulvruchten:
• [item — hoeveelheid]

Kruiden & Specerijen:
• [item — hoeveelheid]

Overig:
• [item — hoeveelheid]

## BELANGRIJK
- Laat categorieën in de boodschappenlijst WEG als ze leeg zijn.
- Noem GEEN ingrediënten die al via de groentetas geleverd worden in de boodschappenlijst.
- Houd de beschrijvingen kort en smakelijk.
- Gebruik Nederlandse namen voor gerechten waar mogelijk, maar internationaal mag ook.`;

const RECIPE_PROMPT = `Je bent een ervaren vegetarische chef-kok. Je geeft een volledig recept in het Nederlands.

## OUTPUT FORMAAT (plain text, geen markdown):

🍳 [NAAM GERECHT]

👥 Porties: [aantal]
⏱️ Bereidingstijd: [tijd]

Ingrediënten:
• [ingrediënt — hoeveelheid]
• ...

Bereiding:
1. [stap 1]
2. [stap 2]
...

💡 Tip: [optionele tip]`;

const REPLACE_PROMPT = `Je bent een creatieve vegetarische chef-kok. Je vervangt een gerecht in een bestaand weekmenu.

## STRIKTE REGELS
1. Het gerecht moet 100% vegetarisch zijn.
2. Het moet ANDERS zijn dan de andere gerechten in het menu.
3. Gebruik bij voorkeur groenten uit de geleverde groentetas.

## OUTPUT FORMAAT (plain text, geen markdown):
Dag [N]: [Naam nieuw gerecht]
[Korte beschrijving, 1-2 zinnen met de hoofdingrediënten]`;

/**
 * Call Gemini with retry logic for temporary errors.
 */
async function callGemini(systemInstruction, userPrompt) {
  if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is niet ingesteld. Voeg deze toe aan je .env bestand.');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    systemInstruction,
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent(userPrompt);
      return result.response.text();
    } catch (error) {
      const isRetryable = /503|429|overloaded|high demand/i.test(error.message);
      if (isRetryable && attempt < 3) {
        const delay = attempt * 15000;
        logger.warn(`Gemini API error (attempt ${attempt}/3): ${error.message}. Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Generate a weekly meal plan based on the scraped vegetable list.
 *
 * @param {string[]} vegetables - Array of vegetable names from the groentetas
 * @returns {Promise<string>} Formatted meal plan + shopping list
 */
async function generateMealPlan(vegetables) {
  logger.info('Generating meal plan with Gemini AI...');

  const userPrompt = `De groentetas van deze week bevat de volgende groenten:\n\n${vegetables.map((v) => `• ${v}`).join('\n')}\n\nMaak het weekmenu en de boodschappenlijst.`;

  const response = await callGemini(SYSTEM_PROMPT, userPrompt);
  logger.info('Meal plan generated successfully');
  return response;
}

/**
 * Generate a full recipe for a specific dish.
 */
async function generateRecipe(dishName, dishDescription, vegetables) {
  logger.info(`Generating recipe for: ${dishName}`);

  const userPrompt = `Geef een volledig recept voor dit gerecht:\n\n${dishName}\n${dishDescription}\n\nBeschikbare groenten uit de groentetas: ${vegetables.join(', ')}.\nGebruik deze waar relevant.`;

  const response = await callGemini(RECIPE_PROMPT, userPrompt);
  logger.info('Recipe generated successfully');
  return response;
}

/**
 * Generate a replacement dish for the menu.
 */
async function generateReplacementDish(currentDishes, vegetables, dayNum) {
  logger.info(`Generating replacement for day ${dayNum}`);

  const otherDishes = currentDishes
    .filter((d) => d.dayNum !== dayNum && !d.isLeftover)
    .map((d) => `- ${d.name}`)
    .join('\n');

  const userPrompt = `Vervang het gerecht voor Dag ${dayNum} in het weekmenu.\n\nBeschikbare groenten: ${vegetables.join(', ')}\n\nAndere gerechten in het menu (mag NIET hetzelfde zijn):\n${otherDishes}\n\nGeef het nieuwe gerecht in het gevraagde formaat.`;

  const response = await callGemini(REPLACE_PROMPT, userPrompt);
  logger.info('Replacement dish generated successfully');
  return response;
}

module.exports = { generateMealPlan, generateRecipe, generateReplacementDish, SYSTEM_PROMPT };
