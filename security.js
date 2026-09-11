const { safeStorage } = require('electron');
const { execSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const secrets = require('./secrets');

let cachedMachineId = null;

function getMachineId() {
  if (cachedMachineId) return cachedMachineId;

  try {
    const platform = process.platform;

    if (platform === 'win32') {
      try {
        const regOut = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
        const match = regOut.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/i);
        if (match && match[1]) {
          cachedMachineId = match[1].trim();
          return cachedMachineId;
        }
      } catch {}
      try {
        const out = execSync('wmic csproduct get uuid', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
        const lines = out.trim().split('\n');
        if (lines.length > 1 && lines[1].trim()) {
          cachedMachineId = lines[1].trim();
          return cachedMachineId;
        }
      } catch {
        const psOut = execSync('powershell -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
        if (psOut) {
          cachedMachineId = psOut;
          return cachedMachineId;
        }
      }
    } else if (platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match && match[1]) {
        cachedMachineId = match[1];
        return cachedMachineId;
      }
    } else if (platform === 'linux') {
      if (fs.existsSync('/etc/machine-id')) {
        const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        if (id) {
          cachedMachineId = id;
          return cachedMachineId;
        }
      }
    }
  } catch (err) {
    console.warn('[Security] Could not retrieve native hardware UUID, using cryptographic fallback:', err?.message);
  }

  const networkInterfaces = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name] || []) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        mac = net.mac;
        break;
      }
    }
    if (mac) break;
  }

  const seed = `${os.hostname()}-${os.cpus()[0]?.model || 'cpu'}-${mac}-${secrets.HARDWARE_SEED || 'LLP_TITAN_2026'}`;
  cachedMachineId = crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
  return cachedMachineId;
}

class SafeVault {
  constructor(storageDir) {
    this.vaultPath = path.join(storageDir, 'app_vault.enc');
    this.memoryCache = new Map();
    this.load();
  }

  getFallbackKey() {
    const mid = getMachineId();
    return crypto.pbkdf2Sync(mid, secrets.VAULT_SALT || 'LLP_SAFE_VAULT_SALT_2026', 100000, 32, 'sha256');
  }

  load() {
    try {
      if (!fs.existsSync(this.vaultPath)) return;
      const raw = fs.readFileSync(this.vaultPath);

      let decryptedStr = '';
      if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
        decryptedStr = safeStorage.decryptString(raw);
      } else {
        const iv = raw.subarray(0, 16);
        const encrypted = raw.subarray(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.getFallbackKey(), iv);
        decryptedStr = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      }

      const parsed = JSON.parse(decryptedStr);
      for (const [k, v] of Object.entries(parsed)) {
        this.memoryCache.set(k, String(v));
      }
    } catch (e) {
      console.warn('[SafeVault] Existing vault load skipped:', e?.message);
    }
  }

  save() {
    try {
      const obj = {};
      for (const [k, v] of this.memoryCache.entries()) {
        obj[k] = v;
      }
      const jsonStr = JSON.stringify(obj);

      let bufferToWrite;
      if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
        bufferToWrite = safeStorage.encryptString(jsonStr);
      } else {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.getFallbackKey(), iv);
        const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
        bufferToWrite = Buffer.concat([iv, encrypted]);
      }

      const dir = path.dirname(this.vaultPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.vaultPath, bufferToWrite);
    } catch (e) {
      console.error('[SafeVault] Save failed:', e);
    }
  }

  set(key, value) {
    this.memoryCache.set(key, value);
    this.save();
  }

  get(key) {
    return this.memoryCache.get(key) || null;
  }

  delete(key) {
    this.memoryCache.delete(key);
    this.save();
  }
}

class LicenseManager {
  constructor(vault, supabaseClient, db = null) {
    this.vault = vault;
    this.client = supabaseClient;
    this.db = db;
  }

  setClient(client) {
    this.client = client;
  }

  setDb(db) {
    this.db = db;
  }

  checkClockTampering() {
    const now = Date.now();
    let lastActive = 0;

    if (this.vault) {
      const vTime = parseInt(this.vault.get('last_active_ts') || '0', 10);
      if (vTime > lastActive) lastActive = vTime;
    }
    if (this.db) {
      const dbTime = parseInt(this.db.getSetting('last_active_ts', '0'), 10);
      if (dbTime > lastActive) lastActive = dbTime;
    }

    // 10 minutes tolerance buffer (600,000 ms)
    if (lastActive > 0 && now < (lastActive - 600000)) {
      console.warn(`[Security DRM] CLOCK TAMPERING DETECTED: System clock rolled back by more than 10 minutes.`);
      return {
        tampered: true,
        lastActive: new Date(lastActive).toISOString(),
        currentTime: new Date(now).toISOString(),
      };
    }

    // Record heartbeat
    const updatedTs = String(Math.max(now, lastActive));
    if (this.vault) {
      this.vault.set('last_active_ts', updatedTs);
    }
    if (this.db) {
      this.db.setSetting('last_active_ts', updatedTs);
    }

    return { tampered: false };
  }

  getStatus() {
    const clockCheck = this.checkClockTampering();
    const machineId = getMachineId();

    if (clockCheck.tampered) {
      return {
        isActivated: false,
        clockTampered: true,
        message: 'System clock tampering detected! Your system clock has been rolled back. Please restore current time.',
        licenseKey: '',
        customerName: 'System Locked (Clock Tampered)',
        expiryDate: 'Expired',
        activatedAt: '',
        machineId,
      };
    }

    let isActivated = this.vault ? this.vault.get('is_activated') === 'true' : false;
    let licenseKey = this.vault ? this.vault.get('license_key') || '' : '';
    let activatedAt = this.vault ? this.vault.get('activated_at') || '' : '';
    let expiryDate = this.vault ? this.vault.get('expiry_date') || '' : '';
    let customerName = this.vault ? this.vault.get('customer_name') || '' : '';

    if (this.db) {
      if (!isActivated) {
        isActivated = this.db.getSetting('is_activated', '0') === '1';
      }
      if (!licenseKey) {
        licenseKey = this.db.getSetting('active_license', '');
      }
      if (!expiryDate) {
        expiryDate = this.db.getSetting('expiry_date', '');
      }
      if (!customerName) {
        customerName = this.db.getSetting('agent_name', 'Enterprise Client');
      }
    }

    return {
      isActivated,
      licenseKey,
      customerName: customerName || 'Enterprise Client',
      expiryDate,
      activatedAt,
      machineId,
    };
  }

  async validateKey(licenseKey) {
    const clockCheck = this.checkClockTampering();
    if (clockCheck.tampered) {
      return { success: false, valid: false, message: 'Clock tampering detected! Please restore your system clock to current real time.' };
    }

    const hwid = getMachineId();
    const cleanKey = (licenseKey || '').trim().toUpperCase();

    // Development/Bypass master key support for emergency recovery
    if (cleanKey === 'LLP-MASTER-PRO-2026-DEV') {
      if (this.vault) {
        this.vault.set('is_activated', 'true');
        this.vault.set('license_key', cleanKey);
        this.vault.set('customer_name', 'Dev Admin Override');
        this.vault.set('activated_at', new Date().toISOString());
        this.vault.set('expiry_date', 'Lifetime');
      }
      if (this.db) {
        this.db.setSetting('is_activated', '1');
        this.db.setSetting('active_license', cleanKey);
        this.db.setSetting('expiry_date', 'Lifetime');
      }
      return { success: true, valid: true, message: 'Master Developer License Activated' };
    }

    if (!cleanKey) {
      return { success: false, valid: false, message: 'Please enter a valid License Key' };
    }

    // Try cloud validation if client available
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('licenses')
          .select('*')
          .eq('license_key', cleanKey)
          .single();

        if (error || !data) {
          return { success: false, valid: false, message: 'Invalid or unrecognized License Key' };
        }

        if (data.is_active === false) {
          return { success: false, valid: false, message: 'This License Key has been suspended or deactivated' };
        }

        if (data.machine_id && data.machine_id !== hwid) {
          return { success: false, valid: false, message: 'This License is locked to a different computer hardware ID' };
        }

        // Lock to this machine
        if (!data.machine_id) {
          await this.client
            .from('licenses')
            .update({ machine_id: hwid, activated_at: new Date().toISOString() })
            .eq('id', data.id);
        }

        const exp = data.expires_at || data.expiry_date || 'Lifetime';
        const clientName = data.customer_name || 'Enterprise Client';

        if (this.vault) {
          this.vault.set('is_activated', 'true');
          this.vault.set('license_key', cleanKey);
          this.vault.set('customer_name', clientName);
          this.vault.set('activated_at', new Date().toISOString());
          this.vault.set('expiry_date', exp);
        }

        if (this.db) {
          this.db.setSetting('is_activated', '1');
          this.db.setSetting('active_license', cleanKey);
          this.db.setSetting('expiry_date', exp);
        }

        return { success: true, valid: true, expiryDate: exp, message: 'License successfully activated and hardware-locked!' };
      } catch (err) {
        return { success: false, valid: false, message: 'Cloud verification error: ' + (err?.message || 'Network unreachable') };
      }
    }

    // Offline check: if already activated with this key
    const currentKey = this.vault ? this.vault.get('license_key') : (this.db?.getSetting('active_license', ''));
    const isAct = this.vault ? (this.vault.get('is_activated') === 'true') : (this.db?.getSetting('is_activated', '0') === '1');
    if (currentKey === cleanKey && isAct) {
      return { success: true, valid: true, message: 'Verified from offline security cache' };
    }

    return { success: false, valid: false, message: 'Internet required for initial license activation' };
  }

  deactivate() {
    if (this.vault) {
      this.vault.delete('is_activated');
      this.vault.delete('license_key');
      this.vault.delete('activated_at');
      this.vault.delete('customer_name');
      this.vault.delete('expiry_date');
    }
    if (this.db) {
      this.db.setSetting('is_activated', '0');
      this.db.setSetting('active_license', '');
      this.db.setSetting('expiry_date', '');
    }
    return { success: true };
  }
}

module.exports = {
  getMachineId,
  SafeVault,
  LicenseManager,
};

