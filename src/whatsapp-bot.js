const { Client, LocalAuth } = require('whatsapp-web.js');
const logger = require('./logger');
const config = require('./config');

let client = null;
let isReady = false;

/**
 * Initialize the WhatsApp client with local session persistence.
 * Displays a QR code in the terminal on first run for authentication.
 *
 * @returns {Promise<void>} Resolves when the client is ready
 */
function initWhatsApp() {
  return new Promise((resolve, reject) => {
    if (isReady && client) {
      logger.info('WhatsApp client already initialized');
      resolve();
      return;
    }

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: config.whatsapp.authPath,
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      },
    });

    client.on('qr', (qr) => {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
      logger.info('Scan the QR code to link WhatsApp. Open this URL in your browser:');
      logger.info(qrUrl);
    });

    client.on('authenticated', () => {
      logger.info('WhatsApp authentication successful');
    });

    client.on('auth_failure', (msg) => {
      logger.error(`WhatsApp authentication failed: ${msg}`);
      reject(new Error(`Auth failed: ${msg}`));
    });

    client.on('ready', () => {
      isReady = true;
      logger.info('WhatsApp client is ready');
      resolve();
    });

    client.on('disconnected', (reason) => {
      isReady = false;
      logger.warn(`WhatsApp disconnected: ${reason}`);
    });

    logger.info('Initializing WhatsApp client...');
    client.initialize();
  });
}

/**
 * Send a message to the configured WhatsApp group.
 * Splits long messages into chunks of ~4000 chars to avoid WhatsApp limits.
 *
 * @param {string} message - The message to send
 * @returns {Promise<void>}
 */
async function sendToGroup(message) {
  if (!isReady || !client) {
    throw new Error('WhatsApp client is niet geïnitialiseerd. Start de bot eerst.');
  }

  const groupName = config.whatsapp.groupName;
  logger.info(`Looking for WhatsApp group: "${groupName}"`);

  const chats = await client.getChats();
  const group = chats.find(
    (chat) => chat.isGroup && chat.name === groupName
  );

  if (!group) {
    const availableGroups = chats
      .filter((c) => c.isGroup)
      .map((c) => c.name)
      .join(', ');
    throw new Error(
      `Groep "${groupName}" niet gevonden. Beschikbare groepen: ${availableGroups}`
    );
  }

  // Split into chunks if message is too long for WhatsApp
  const MAX_LENGTH = 4000;
  if (message.length <= MAX_LENGTH) {
    await group.sendMessage(message);
    logger.info(`Message sent to group "${groupName}"`);
  } else {
    const chunks = splitMessage(message, MAX_LENGTH);
    for (let i = 0; i < chunks.length; i++) {
      await group.sendMessage(chunks[i]);
      logger.info(`Sent chunk ${i + 1}/${chunks.length} to group "${groupName}"`);
      // Small delay between chunks to avoid rate-limiting
      if (i < chunks.length - 1) {
        await sleep(1000);
      }
    }
  }
}

/**
 * Split a message into chunks, preferring to break at section boundaries.
 */
function splitMessage(text, maxLength) {
  const chunks = [];
  const sections = text.split(/\n(?=(?:📦|🍽️|🛒))/);

  let current = '';
  for (const section of sections) {
    if (current.length + section.length + 1 > maxLength && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n' : '') + section;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the WhatsApp client status.
 */
function getStatus() {
  return { isReady, hasClient: !!client };
}

/**
 * Get the underlying WhatsApp client instance (for event listeners).
 */
function getClient() {
  return client;
}

module.exports = { initWhatsApp, sendToGroup, getStatus, getClient };
