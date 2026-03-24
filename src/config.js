const path = require('path');

// Load .env file from project root
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash',
  },
  whatsapp: {
    groupName: process.env.WHATSAPP_GROUP_NAME || 'Boodschappen',
    authPath: path.resolve(__dirname, '..', '.wwebjs_auth'),
  },
  scraper: {
    url: process.env.TUINDERIJ_URL || 'https://www.tuinderijdelijsterbes.nl/',
    timeout: 30_000,
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || '0 14 * * 1', // Monday 14:00
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
