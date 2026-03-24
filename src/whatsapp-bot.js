const { Client, LocalAuth } = require('whatsapp-web.js');
const logger = require('./logger');
const config = require('./config');

let client = null;
let isReady = false;

/**
 * Initialize the WhatsApp client with local session persistence.
 * Logs a QR code URL for authentication on first run.
 *
 * @returns {Promise<void>} Resolves when the client is ready
 */
function createClient() {
  return new Client({
    authStrategy: new LocalAuth({
      dataPath: config.whatsapp.authPath,
    }),
    webVersionCache: {
      type: 'none',
    },
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--single-process',
      ],
    },
  });
}

async function destroyClient() {
  if (client) {
    try {
      await client.destroy();
    } catch {
      // ignore destroy errors
    }
    client = null;
    isReady = false;
  }
}

function initWhatsApp() {
  return new Promise((resolve, reject) => {
    if (isReady && client) {
      logger.info('WhatsApp client already initialized');
      resolve();
      return;
    }

    client = createClient();

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
    client.initialize().catch((err) => {
      logger.error(`Client initialize error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Initialize with automatic retry on failure.
 * Catches both promise rejections AND unhandled rejections from
 * whatsapp-web.js internal event handlers (e.g. "Execution context was destroyed").
 *
 * @param {number} maxRetries - Maximum number of retries
 * @returns {Promise<void>}
 */
async function initWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await initWhatsAppGuarded();
      return;
    } catch (err) {
      logger.error(`WhatsApp init attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      await destroyClient();
      if (attempt < maxRetries) {
        const delay = attempt * 10000;
        logger.info(`Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        throw new Error(`WhatsApp init failed after ${maxRetries} attempts: ${err.message}`);
      }
    }
  }
}

/**
 * Wraps initWhatsApp() so that unhandled rejections thrown by whatsapp-web.js
 * internals (outside the initialize() promise) are caught and treated as init failures.
 */
function initWhatsAppGuarded() {
  return new Promise((resolve, reject) => {
    let settled = false;

    function onUnhandledRejection(reason) {
      const msg = reason?.message || String(reason);
      if (!settled && msg.includes('Execution context was destroyed')) {
        settled = true;
        logger.error(`Caught unhandled rejection during init: ${msg}`);
        process.removeListener('unhandledRejection', onUnhandledRejection);
        reject(new Error(msg));
      }
    }

    process.on('unhandledRejection', onUnhandledRejection);

    initWhatsApp()
      .then(() => {
        if (!settled) {
          settled = true;
          // Keep the listener active for a bit longer — the crash can happen
          // a few seconds after 'ready' fires, during post-init injection.
          setTimeout(() => {
            process.removeListener('unhandledRejection', onUnhandledRejection);
          }, 30000);
          resolve();
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          process.removeListener('unhandledRejection', onUnhandledRejection);
          reject(err);
        }
      });
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

module.exports = { initWhatsApp, initWithRetry, sendToGroup, getStatus, getClient };
