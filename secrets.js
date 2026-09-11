/**
 * Leaf Ledger Pro - Dynamic Secrets Store (Auto-generated)
 * Protected with 32-byte cyclic XOR masking. Decoded in RAM on-demand.
 */

const XOR_KEY = Buffer.from('1d99524364ea9714b130d1029db49066eb5c796d9c911b110fc3d39ab2b59ea1', 'hex');

const ENCODED_SECRETS = {
  "SUPABASE_URL": [
    117,
    237,
    38,
    51,
    23,
    208,
    184,
    59,
    197,
    92,
    168,
    116,
    241,
    210,
    248,
    12,
    128,
    62,
    24,
    8,
    246,
    226,
    125,
    101,
    98,
    177,
    165,
    233,
    156,
    198,
    235,
    209,
    124,
    251,
    51,
    48,
    1,
    196,
    244,
    123
  ],
  "SUPABASE_KEY": [
    110,
    251,
    13,
    51,
    17,
    136,
    251,
    125,
    194,
    88,
    176,
    96,
    241,
    209,
    207,
    28,
    186,
    53,
    38,
    12,
    217,
    194,
    111,
    93,
    55,
    177,
    169,
    219,
    225,
    194,
    217,
    228,
    101,
    204,
    106,
    119,
    3,
    181,
    239,
    114,
    195,
    105,
    229,
    59,
    228,
    192
  ],
  "VAULT_SALT": [
    81,
    213,
    2,
    28,
    55,
    171,
    209,
    81,
    238,
    102,
    144,
    87,
    209,
    224,
    207,
    53,
    170,
    16,
    45,
    50,
    174,
    161,
    41,
    39
  ],
  "HARDWARE_SEED": [
    81,
    213,
    2,
    28,
    48,
    163,
    195,
    85,
    255,
    111,
    227,
    50,
    175,
    130
  ]
};

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
};
