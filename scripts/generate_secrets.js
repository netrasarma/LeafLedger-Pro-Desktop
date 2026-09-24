/**
 * Leaf Ledger Pro - Cyclic XOR Dynamic Secrets Generator
 * Masks sensitive configuration strings into runtime-decoded byte arrays.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Load local .env file if running in local development
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (_) {}

const SECRETS_TO_ENCODE = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',
  VAULT_SALT: process.env.VAULT_SALT || 'LLP_SAFE_VAULT_SALT_2026',
  HARDWARE_SEED: process.env.HARDWARE_SEED || 'LLP_TITAN_2026',
  GITHUB_TOKEN: process.env.GITHUB_UPDATER_TOKEN || '',
};

function generateDynamicSecrets() {
  const key = crypto.randomBytes(32);
  const keyHex = key.toString('hex');

  const encodedMap = {};
  for (const [name, val] of Object.entries(SECRETS_TO_ENCODE)) {
    const buf = Buffer.from(val, 'utf8');
    const masked = [];
    for (let i = 0; i < buf.length; i++) {
      masked.push(buf[i] ^ key[i % 32]);
    }
    encodedMap[name] = masked;
  }

  const fileContent = `/**
 * Leaf Ledger Pro - Dynamic Secrets Store (Auto-generated)
 * Protected with 32-byte cyclic XOR masking. Decoded in RAM on-demand.
 */

const XOR_KEY = Buffer.from('${keyHex}', 'hex');

const ENCODED_SECRETS = ${JSON.stringify(encodedMap, null, 2)};

function getSecret(name) {
  const bytes = ENCODED_SECRETS[name];
  if (!bytes) return '';
  const buf = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    buf[i] = bytes[i] ^ XOR_KEY[i % 32];
  }
  return buf.toString('utf8');
}

module.exports = {
  getSecret,
  get SUPABASE_URL() { return getSecret('SUPABASE_URL'); },
  get SUPABASE_KEY() { return getSecret('SUPABASE_KEY'); },
  get VAULT_SALT() { return getSecret('VAULT_SALT'); },
  get HARDWARE_SEED() { return getSecret('HARDWARE_SEED'); },
  get GITHUB_TOKEN() { return getSecret('GITHUB_TOKEN'); },
};
`;

  const outputPath = path.join(__dirname, '..', 'secrets.js');
  fs.writeFileSync(outputPath, fileContent, 'utf8');
  console.log(`[Secrets] Generated cyclic XOR dynamic secrets store at: ${outputPath}`);
}

if (require.main === module) {
  generateDynamicSecrets();
}

module.exports = { generateDynamicSecrets };
