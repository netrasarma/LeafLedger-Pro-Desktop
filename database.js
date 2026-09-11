const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

class LocalDatabase {
  constructor(dataDir) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataDir = dataDir;
    this.globalDbPath = path.join(dataDir, 'leaf_ledger_global.sqlite');
    this.globalDb = new DatabaseSync(this.globalDbPath);
    this.initGlobalTables();

    this.currentUserId = null;
    this.db = null;
    this.dbPath = null;

    this._migrateLegacyData();

    const savedUid = this.getSetting('current_app_user_id', '');
    this.switchUser(savedUid || null);
  }

  initGlobalTables() {
    this.globalDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  _migrateLegacyData() {
    const legacyPath = path.join(this.dataDir, 'leaf_ledger_desktop.sqlite');
    if (!fs.existsSync(legacyPath)) return;

    try {
      // Check if global settings are already populated
      const hasSettings = this.globalDb.prepare('SELECT count(*) as c FROM settings').get();
      if (!hasSettings || hasSettings.c === 0) {
        const legacyDb = new DatabaseSync(legacyPath);
        const rows = legacyDb.prepare('SELECT key, value FROM settings').all();
        const insertStmt = this.globalDb.prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
        );
        for (const r of rows) {
          insertStmt.run(r.key, String(r.value));
        }
        legacyDb.close();
        console.log(`[DB] Migrated ${rows.length} global settings from legacy database.`);
      }

      // Preserve data for initial user 2e45613e-6514-4070-a459-398c73b05344
      const user1Path = path.join(this.dataDir, 'leaf_ledger_user_2e45613e-6514-4070-a459-398c73b05344.sqlite');
      if (!fs.existsSync(user1Path)) {
        fs.copyFileSync(legacyPath, user1Path);
        console.log('[DB] Preserved initial user dataset to leaf_ledger_user_2e45613e-6514-4070-a459-398c73b05344.sqlite');
      }
    } catch (err) {
      console.warn('[DB] Legacy migration check notice:', err.message);
    }
  }

  switchUser(userId) {
    const cleanId = userId ? String(userId).trim() : null;
    if (this.currentUserId === cleanId && this.db) {
      return;
    }

    this.currentUserId = cleanId;
    if (this.db) {
      try {
        this.db.close();
      } catch (e) {
        console.warn('[DB] Error closing previous DB:', e.message);
      }
      this.db = null;
    }

    const safeId = cleanId ? cleanId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'guest';
    this.dbPath = path.join(this.dataDir, `leaf_ledger_user_${safeId}.sqlite`);
    this.db = new DatabaseSync(this.dbPath);
    this.initTables();
    this.autoMigrateLegacyNotes();
    this.purgeForeignTenantData(cleanId);
    console.log(`[DB] Switched active database to: ${path.basename(this.dbPath)} (User: ${cleanId || 'guest'})`);
  }

  initTables() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -64000;
      PRAGMA busy_timeout = 10000;
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        name TEXT,
        start_date TEXT,
        end_date TEXT,
        is_active INTEGER DEFAULT 1,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS owners (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        agreement_date TEXT,
        bank_name TEXT,
        bank_acc TEXT,
        account_holder_name TEXT,
        bank_ifsc TEXT,
        notes TEXT,
        is_active INTEGER DEFAULT 1,
        portal_pin TEXT,
        default_deduction_pct REAL DEFAULT 0.0,
        is_variable_pct INTEGER DEFAULT 0,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS daily_collections (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        owner_id TEXT NOT NULL,
        session_id TEXT,
        date TEXT NOT NULL,
        gross_weight_kg REAL NOT NULL,
        bag_weight_kg REAL DEFAULT 0.0,
        net_weight_kg REAL NOT NULL,
        rate_per_kg REAL DEFAULT 0.0,
        amount REAL DEFAULT 0.0,
        collector_name TEXT,
        staff_id TEXT,
        notes TEXT,
        meta TEXT,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS factories (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        default_rate REAL DEFAULT 0.0,
        is_active INTEGER DEFAULT 1,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS factory_collections (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        factory_id TEXT,
        session_id TEXT,
        date TEXT NOT NULL,
        challan_no TEXT,
        gross_weight_kg REAL NOT NULL,
        tare_weight_kg REAL DEFAULT 0.0,
        net_weight_kg REAL NOT NULL,
        deduction_pct REAL DEFAULT 0.0,
        rate_per_kg REAL DEFAULT 0.0,
        amount REAL DEFAULT 0.0,
        delivered_by TEXT,
        notes TEXT,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS factory_payments (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        session_id TEXT,
        factory_id TEXT NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        payment_date TEXT,
        amount REAL NOT NULL DEFAULT 0.0,
        payment_mode TEXT DEFAULT 'Bank Transfer',
        notes TEXT,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advances (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        owner_id TEXT NOT NULL,
        session_id TEXT,
        date TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        payment_mode TEXT DEFAULT 'Cash',
        notes TEXT,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        session_id TEXT,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS monthly_payments (
        id TEXT PRIMARY KEY,
        app_user_id TEXT,
        session_id TEXT,
        owner_id TEXT NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        payment_date TEXT,
        total_gross_kg REAL DEFAULT 0.0,
        total_net_kg REAL DEFAULT 0.0,
        rate_per_kg REAL DEFAULT 0.0,
        total_amount REAL DEFAULT 0.0,
        advance_deducted REAL DEFAULT 0.0,
        final_paid_amount REAL DEFAULT 0.0,
        payment_mode TEXT DEFAULT 'Cash',
        is_paid INTEGER DEFAULT 0,
        notes TEXT,
        sync_id TEXT UNIQUE,
        cloud_id TEXT,
        sync_status INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS staff_accounts (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        mobile_number TEXT,
        mpin_hash TEXT,
        is_active INTEGER DEFAULT 1,
        allow_collector INTEGER DEFAULT 1,
        allow_collector_mobile INTEGER DEFAULT 1,
        sync_id TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS offline_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS deleted_tombstones (
        sync_id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        deleted_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Safe column migrations for pre-existing sqlite files
    const safeAddColumn = (tbl, col, def) => {
      try {
        const colDef = def.includes('CURRENT_TIMESTAMP') ? 'TEXT' : def;
        this.db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${colDef};`);
        if (def.includes('CURRENT_TIMESTAMP')) {
          this.db.exec(`UPDATE ${tbl} SET ${col} = CURRENT_TIMESTAMP WHERE ${col} IS NULL;`);
        }
      } catch (_) {}
    };

    safeAddColumn('sessions', 'start_date', 'TEXT');
    safeAddColumn('sessions', 'end_date', 'TEXT');
    safeAddColumn('sessions', 'app_user_id', 'TEXT');
    safeAddColumn('sessions', 'name', 'TEXT');
    safeAddColumn('sessions', 'is_active', 'INTEGER DEFAULT 1');
    safeAddColumn('sessions', 'cloud_id', 'TEXT');
    safeAddColumn('sessions', 'sync_id', 'TEXT');
    safeAddColumn('sessions', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('sessions', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    try {
      this.db.exec("UPDATE sessions SET is_active = 1 WHERE status = 'active' OR is_active IS NULL;");
    } catch (_) {}

    safeAddColumn('owners', 'app_user_id', 'TEXT');
    safeAddColumn('owners', 'address', 'TEXT');
    safeAddColumn('owners', 'agreement_date', 'TEXT');
    safeAddColumn('owners', 'bank_name', 'TEXT');
    safeAddColumn('owners', 'bank_acc', 'TEXT');
    safeAddColumn('owners', 'account_holder_name', 'TEXT');
    safeAddColumn('owners', 'bank_ifsc', 'TEXT');
    safeAddColumn('owners', 'notes', 'TEXT');
    safeAddColumn('owners', 'portal_pin', 'TEXT');
    safeAddColumn('owners', 'cloud_id', 'TEXT');
    safeAddColumn('owners', 'sync_id', 'TEXT');
    safeAddColumn('owners', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('owners', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('daily_collections', 'app_user_id', 'TEXT');
    safeAddColumn('daily_collections', 'cloud_id', 'TEXT');
    safeAddColumn('daily_collections', 'sync_id', 'TEXT');
    safeAddColumn('daily_collections', 'meta', 'TEXT');
    safeAddColumn('daily_collections', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('daily_collections', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('advances', 'app_user_id', 'TEXT');
    safeAddColumn('advances', 'cloud_id', 'TEXT');
    safeAddColumn('advances', 'sync_id', 'TEXT');
    safeAddColumn('advances', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('advances', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('expenses', 'app_user_id', 'TEXT');
    safeAddColumn('expenses', 'cloud_id', 'TEXT');
    safeAddColumn('expenses', 'sync_id', 'TEXT');
    safeAddColumn('expenses', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('expenses', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('factories', 'app_user_id', 'TEXT');
    safeAddColumn('factories', 'cloud_id', 'TEXT');
    safeAddColumn('factories', 'sync_id', 'TEXT');
    safeAddColumn('factories', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('factories', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('factory_collections', 'app_user_id', 'TEXT');
    safeAddColumn('factory_collections', 'factory_name', 'TEXT');
    safeAddColumn('factory_collections', 'delivered_by', 'TEXT');
    safeAddColumn('factory_collections', 'cloud_id', 'TEXT');
    safeAddColumn('factory_collections', 'sync_id', 'TEXT');
    safeAddColumn('factory_collections', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('factory_collections', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('factory_payments', 'app_user_id', 'TEXT');
    safeAddColumn('factory_payments', 'cloud_id', 'TEXT');
    safeAddColumn('factory_payments', 'sync_id', 'TEXT');
    safeAddColumn('factory_payments', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('factory_payments', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');

    safeAddColumn('monthly_payments', 'app_user_id', 'TEXT');
    safeAddColumn('monthly_payments', 'session_id', 'TEXT');
    safeAddColumn('monthly_payments', 'cloud_id', 'TEXT');
    safeAddColumn('monthly_payments', 'sync_id', 'TEXT');
    safeAddColumn('monthly_payments', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('monthly_payments', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    safeAddColumn('monthly_payments', 'total_gross_kg', 'REAL DEFAULT 0.0');
    safeAddColumn('monthly_payments', 'total_net_kg', 'REAL DEFAULT 0.0');
    safeAddColumn('monthly_payments', 'total_amount', 'REAL DEFAULT 0.0');
    safeAddColumn('monthly_payments', 'advance_deducted', 'REAL DEFAULT 0.0');
    safeAddColumn('monthly_payments', 'final_paid_amount', 'REAL DEFAULT 0.0');
    safeAddColumn('monthly_payments', 'net_paid', 'REAL DEFAULT 0.0');
    safeAddColumn('monthly_payments', 'payment_mode', "TEXT DEFAULT 'Cash'");

    safeAddColumn('staff_accounts', 'owner_id', 'TEXT');
    safeAddColumn('staff_accounts', 'cloud_id', 'TEXT');
    safeAddColumn('staff_accounts', 'sync_id', 'TEXT');
    safeAddColumn('staff_accounts', 'sync_status', 'INTEGER DEFAULT 1');
    safeAddColumn('staff_accounts', 'updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP');
    safeAddColumn('staff_accounts', 'display_mpin', 'TEXT');
    safeAddColumn('staff_accounts', 'password', 'TEXT');
    try {
      this.db.exec("UPDATE staff_accounts SET password = COALESCE(password, mpin_hash, '123456') WHERE password IS NULL OR password = '';");
    } catch (_) {}

    // Safe index creation after all columns are guaranteed to exist
    const safeCreateIndex = (sql) => {
      try {
        this.db.exec(sql);
      } catch (_) {}
    };

    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_col_date ON daily_collections(date);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_col_owner ON daily_collections(owner_id);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_col_owner_date ON daily_collections(owner_id, date DESC);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_col_session_date ON daily_collections(session_id, date DESC);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_col_updated_at ON daily_collections(updated_at DESC);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_adv_owner ON advances(owner_id);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_adv_owner_date ON advances(owner_id, date DESC);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(date);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_fact_col_date ON factory_collections(factory_id, date DESC);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_month_owner ON monthly_payments(owner_id, year, month);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_col_sync ON daily_collections(sync_status);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_owners_sync ON owners(sync_status);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_adv_sync ON advances(sync_status);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_exp_sync ON expenses(sync_status);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_fact_sync ON factory_collections(sync_status);');
    safeCreateIndex('CREATE INDEX IF NOT EXISTS idx_tomb_table ON deleted_tombstones(table_name);');
  }

  query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  getOne(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params);
  }

  run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  getSetting(key, defaultValue = '') {
    if (this.db) {
      try {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row && row.value !== undefined) return row.value;
      } catch (_) {}
    }
    try {
      const gRow = this.globalDb.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (gRow && gRow.value !== undefined) return gRow.value;
    } catch (_) {}
    return defaultValue;
  }

  setSetting(key, value) {
    const valStr = value !== undefined && value !== null ? String(value) : '';
    try {
      this.globalDb.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
      ).run(key, valStr);
    } catch (e) {
      console.error('[DB] Failed to write global setting:', key, e);
    }

    if (this.db) {
      try {
        this.db.prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
        ).run(key, valStr);
      } catch (_) {}
    }
  }

  queueMutation(tableName, action, payload) {
    this.run(
      'INSERT INTO offline_sync_queue (table_name, action, payload_json) VALUES (?, ?, ?)',
      [tableName, action, JSON.stringify(payload)]
    );
  }

  getPendingQueue() {
    return this.query('SELECT * FROM offline_sync_queue WHERE status = ? ORDER BY id ASC LIMIT 50', ['pending']);
  }

  markQueueItem(id, status, error = null) {
    this.run(
      'UPDATE offline_sync_queue SET status = ?, attempts = attempts + 1, error_message = ? WHERE id = ?',
      [status, error, id]
    );
  }

  // =========================================================================
  // Enterprise Two-Way Sync Helpers
  // =========================================================================
  recordTombstone(tableName, syncId) {
    if (!syncId) return;
    this.run(
      'INSERT INTO deleted_tombstones (sync_id, table_name, deleted_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(sync_id) DO UPDATE SET deleted_at = CURRENT_TIMESTAMP',
      [syncId, tableName]
    );
  }

  getTombstones(tableName = null) {
    if (tableName) {
      return this.query('SELECT sync_id, table_name, deleted_at FROM deleted_tombstones WHERE table_name = ?', [tableName]);
    }
    return this.query('SELECT sync_id, table_name, deleted_at FROM deleted_tombstones');
  }

  clearTombstone(syncId) {
    this.run('DELETE FROM deleted_tombstones WHERE sync_id = ?', [syncId]);
  }

  getDirtyRecords(tableName, limit = 500) {
    return this.query(`SELECT * FROM ${tableName} WHERE sync_status = 0 LIMIT ?`, [limit]);
  }

  markRecordsSynced(tableName, ids) {
    if (!ids || ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.run(`UPDATE ${tableName} SET sync_status = 1 WHERE id IN (${placeholders})`, ids);
  }

  getTableColumns(tableName) {
    const info = this.query(`PRAGMA table_info(${tableName})`);
    return info.map((col) => col.name);
  }

  /**
   * True Latest-Wins Cloud Upsert:
   * 1. Checks if sync_id is tombstoned (never resurrect deleted items).
   * 2. Checks if local record is dirty (sync_status = 0) and compares timestamps.
   * 3. Performs type-safe upsert and sets sync_status = 1.
   */
  upsertFromCloud(tableName, rowData) {
    const syncId = rowData.sync_id || rowData.id;
    const cloudId = rowData.id;
    if (!syncId && !cloudId) return false;

    // 1. Tombstone check
    const tombstone = this.getOne('SELECT sync_id FROM deleted_tombstones WHERE sync_id = ? OR sync_id = ?', [syncId, cloudId]);
    if (tombstone) return false;

    // 2. Locate existing local record
    let existing = null;
    if (cloudId) {
      existing = this.getOne(`SELECT * FROM ${tableName} WHERE cloud_id = ? OR id = ?`, [cloudId, cloudId]);
    }
    if (!existing && syncId) {
      existing = this.getOne(`SELECT * FROM ${tableName} WHERE sync_id = ?`, [syncId]);
    }

    const localCols = this.getTableColumns(tableName);
    if (!localCols || localCols.length === 0) return false;

    // 3. True Latest-Wins conflict resolution for locally-dirty records
    if (existing && existing.sync_status === 0) {
      const parseUtcTime = (d) => {
        if (!d) return 0;
        let s = String(d).trim();
        if (!s) return 0;
        if (!s.endsWith('Z') && !/[+-]\d{2}(:?\d{2})?$/.test(s)) {
          s = s.replace(' ', 'T') + 'Z';
        }
        const t = new Date(s).getTime();
        return isNaN(t) ? 0 : t;
      };

      const localUpdated = existing.updated_at || existing.created_at;
      const cloudUpdated = rowData.updated_at || rowData.created_at;
      const lTime = parseUtcTime(localUpdated);
      const cTime = parseUtcTime(cloudUpdated);
      if (lTime >= cTime) {
        // Local edit is newer or identical: client wins, do not overwrite!
        return false;
      }
    }

    // 4. Build sanitized clean payload matching local schema
    const payload = {};
    for (const col of localCols) {
      if (col === 'cloud_id') {
        payload.cloud_id = cloudId;
      } else if (col === 'sync_status') {
        payload.sync_status = 1; // Clean
      } else if (col in rowData) {
        let val = rowData[col];
        if (typeof val === 'boolean') val = val ? 1 : 0;
        if (col === 'meta' && typeof val === 'object' && val !== null) {
          try { val = JSON.stringify(val); } catch(_) {}
        }
        payload[col] = val;
      }
    }

    // Fallback for legacy local schemas with NOT NULL constraints
    if (tableName === 'sessions') {
      if (localCols.includes('date') && !payload.date) {
        payload.date = rowData.start_date || (rowData.created_at ? String(rowData.created_at).split('T')[0] : null) || new Date().toISOString().split('T')[0];
      }
      if (localCols.includes('start_date') && !payload.start_date) {
        payload.start_date = payload.date || new Date().toISOString().split('T')[0];
      }
    }

    // Ensure primary key `id` preserves local existing id if matched, or uses cloudId/syncId
    if (existing) {
      payload.id = existing.id;
    } else if (!payload.id) {
      payload.id = cloudId || syncId;
    }
    if (!payload.sync_id) {
      payload.sync_id = syncId || payload.id;
    }

    const cols = Object.keys(payload);
    const placeholders = cols.map(() => '?').join(', ');
    const updateClauses = cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ');

    const sql = `
      INSERT INTO ${tableName} (${cols.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updateClauses}
    `;

    try {
      this.run(sql, Object.values(payload));
      return true;
    } catch (err) {
      console.error(`[DB] upsertFromCloud failed for ${tableName}:`, err.message);
      return false;
    }
  }

  getMonthlyCollectionSummary(month, year) {
    const mStr = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${year}-${mStr}-01`;
    const endDate = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;

    const collections = this.query(
      `SELECT date, gross_weight_kg, bag_weight_kg, net_weight_kg, rate_per_kg, amount
       FROM daily_collections
       WHERE date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [startDate, endDate]
    );

    let totalGross = 0;
    let totalNet = 0;
    let totalAmt = 0;
    const dayMap = {};

    for (const r of collections) {
      totalGross += r.gross_weight_kg || 0;
      totalNet += r.net_weight_kg || 0;
      totalAmt += r.amount || 0;

      const d = r.date;
      if (!dayMap[d]) {
        dayMap[d] = {
          date: d,
          gross: 0,
          deduction: 0,
          net: 0,
          amount: 0,
          entries: 0,
          standard_deduction_pct: r.bag_weight_kg || 0,
          rate: r.rate_per_kg || 0,
        };
      }

      dayMap[d].gross += r.gross_weight_kg || 0;
      dayMap[d].deduction += (r.gross_weight_kg || 0) - (r.net_weight_kg || 0);
      dayMap[d].net += r.net_weight_kg || 0;
      dayMap[d].amount += r.amount || 0;
      dayMap[d].entries += 1;
    }

    for (const d of Object.keys(dayMap)) {
      const dm = dayMap[d];
      dm.rate = dm.net > 0 ? dm.amount / dm.net : dm.rate;
    }

    // Factory summary map for the same period
    const factoryRows = this.query(
      `SELECT date, rate_per_kg, deduction_pct
       FROM factory_collections
       WHERE date BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    const factoryMap = {};
    for (const f of factoryRows) {
      if (!factoryMap[f.date]) {
        factoryMap[f.date] = {
          rate: f.rate_per_kg || 0,
          water_deduction_pct: f.deduction_pct || 0,
        };
      }
    }

    const daysList = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
      gross: totalGross,
      net: totalNet,
      amount: totalAmt,
      days: daysList,
      factoryMap,
    };
  }

  updateDailyBulk(dateStr, rate, waterPct) {
    const rows = this.query(
      `SELECT id, gross_weight_kg, bag_weight_kg, rate_per_kg FROM daily_collections WHERE date = ?`,
      [dateStr]
    );

    let count = 0;
    for (const r of rows) {
      const nPct = waterPct !== null && waterPct !== undefined && waterPct !== '' ? Number(waterPct) : (r.bag_weight_kg || 0);
      const nRate = rate !== null && rate !== undefined && rate !== '' ? Number(rate) : (r.rate_per_kg || 0);
      const newNet = Math.round((r.gross_weight_kg || 0) * (1 - nPct / 100));
      const newAmt = Math.round(newNet * nRate);

      this.run(
        `UPDATE daily_collections
         SET bag_weight_kg = ?, net_weight_kg = ?, rate_per_kg = ?, amount = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nPct, newNet, nRate, newAmt, r.id]
      );
      count++;
    }
    return { success: true, updatedCount: count };
  }

  updateRangeBulk(month, year, fromDay, toDay, rate, waterPct, excludeSundays) {
    const mStr = String(month).padStart(2, '0');
    const startDate = `${year}-${mStr}-${String(fromDay).padStart(2, '0')}`;
    const endDate = `${year}-${mStr}-${String(toDay).padStart(2, '0')}`;

    const rows = this.query(
      `SELECT id, date, gross_weight_kg, bag_weight_kg, rate_per_kg
       FROM daily_collections
       WHERE date BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    let count = 0;
    for (const r of rows) {
      if (excludeSundays) {
        // Exclude sundays (split date YYYY-MM-DD to avoid timezone shifts)
        const [y, m, d] = r.date.split('-').map(Number);
        const dayOfWeek = new Date(y, m - 1, d).getDay();
        if (dayOfWeek === 0) continue; // Sunday
      }

      const nPct = waterPct !== null && waterPct !== undefined && waterPct !== '' ? Number(waterPct) : (r.bag_weight_kg || 0);
      const nRate = rate !== null && rate !== undefined && rate !== '' ? Number(rate) : (r.rate_per_kg || 0);
      const newNet = Math.round((r.gross_weight_kg || 0) * (1 - nPct / 100));
      const newAmt = Math.round(newNet * nRate);

      this.run(
        `UPDATE daily_collections
         SET bag_weight_kg = ?, net_weight_kg = ?, rate_per_kg = ?, amount = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nPct, newNet, nRate, newAmt, r.id]
      );
      count++;
    }
    return { success: true, updatedCount: count };
  }

  healForeignKeys() {
    const hasColumn = (tbl, col) => {
      try {
        const info = this.db.prepare(`PRAGMA table_info(${tbl})`).all();
        return info.some(c => c.name === col);
      } catch (_) {
        return false;
      }
    };

    // Heal Sessions
    const tablesWithSession = ['daily_collections', 'advances', 'expenses', 'factory_collections', 'factory_payments', 'monthly_payments'];
    for (const t of tablesWithSession) {
      if (!hasColumn(t, 'session_id')) continue;
      try {
        this.db.exec(`
          UPDATE ${t} 
          SET session_id = (SELECT id FROM sessions WHERE cloud_id = ${t}.session_id OR id = ${t}.session_id LIMIT 1) 
          WHERE session_id IN (SELECT cloud_id FROM sessions WHERE cloud_id IS NOT NULL AND cloud_id != '')
        `);
      } catch (_) {}
    }

    // Heal Owners
    const tablesWithOwner = ['daily_collections', 'advances', 'monthly_payments'];
    for (const t of tablesWithOwner) {
      if (!hasColumn(t, 'owner_id')) continue;
      try {
        this.db.exec(`
          UPDATE ${t} 
          SET owner_id = (SELECT id FROM owners WHERE cloud_id = ${t}.owner_id OR id = ${t}.owner_id LIMIT 1) 
          WHERE owner_id IN (SELECT cloud_id FROM owners WHERE cloud_id IS NOT NULL AND cloud_id != '')
        `);
      } catch (_) {}
    }

    // Heal Factories
    const tablesWithFactory = ['factory_collections', 'factory_payments'];
    for (const t of tablesWithFactory) {
      if (!hasColumn(t, 'factory_id')) continue;
      try {
        this.db.exec(`
          UPDATE ${t} 
          SET factory_id = (SELECT id FROM factories WHERE cloud_id = ${t}.factory_id OR id = ${t}.factory_id LIMIT 1) 
          WHERE factory_id IN (SELECT cloud_id FROM factories WHERE cloud_id IS NOT NULL AND cloud_id != '')
        `);
      } catch (_) {}
    }
  }

  /**
   * Parse legacy overloaded notes string into clean notes and structured meta object
   */
  parseLegacyNotes(notesStr) {
    if (!notesStr || typeof notesStr !== 'string') return { notes: '', meta: null };
    let cleanNotes = notesStr;
    const meta = {};
    let hasMeta = false;

    if (cleanNotes.includes('Deductions: [')) {
      const match = cleanNotes.match(/Deductions:\s*\[([^\]]*)\]/);
      if (match && match[1]) {
        meta.deductions = match[1].split(',').map(s => s.trim()).filter(Boolean);
        cleanNotes = cleanNotes.replace(/Deductions:\s*\[[^\]]*\](\s*\|\s*)?/, '').trim();
        hasMeta = true;
      }
    }

    if (cleanNotes.includes('Weights: [')) {
      const match = cleanNotes.match(/Weights:\s*\[([^\]]*)\]/);
      if (match && match[1]) {
        meta.workers = [];
        const rawWorkers = match[1].split(',');
        for (const rw of rawWorkers) {
          const parts = rw.trim().split(':');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const wtStr = parts[1].trim();
            meta.workers.push({ worker: name, weight_raw: wtStr });
          }
        }
        cleanNotes = cleanNotes.replace(/Weights:\s*\[[^\]]*\](\s*\|\s*)?/, '').trim();
        hasMeta = true;
      }
    }

    if (cleanNotes.includes('Math breakdown:')) {
      const match = cleanNotes.match(/Math breakdown:\s*([^|]+)/);
      if (match && match[1]) {
        meta.math_breakdown = match[1].trim();
        cleanNotes = cleanNotes.replace(/Math breakdown:\s*[^|]+(\s*\|\s*)?/, '').trim();
        hasMeta = true;
      }
    }

    cleanNotes = cleanNotes.replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim();

    return {
      notes: cleanNotes,
      meta: hasMeta ? meta : null
    };
  }

  /**
   * Safe one-time auto-migration: Extracts deductions/workers from bloated notes into meta column
   */
  autoMigrateLegacyNotes() {
    if (!this.db) return 0;
    try {
      const rows = this.query(`
        SELECT id, notes FROM daily_collections 
        WHERE (notes LIKE '%Weights: [%' OR notes LIKE '%Deductions: [%' OR notes LIKE '%Math breakdown:%')
          AND (meta IS NULL OR meta = '' OR meta = '{}')
        LIMIT 500
      `);

      if (!rows || rows.length === 0) return 0;

      const updateStmt = this.db.prepare(`
        UPDATE daily_collections 
        SET notes = ?, meta = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);

      let migrated = 0;
      for (const r of rows) {
        const parsed = this.parseLegacyNotes(r.notes);
        if (parsed.meta) {
          updateStmt.run(parsed.notes, JSON.stringify(parsed.meta), r.id);
          migrated++;
        }
      }

      if (migrated > 0) {
        console.log(`[DB] Successfully migrated ${migrated} legacy daily_collections notes into structured meta.`);
      }
      return migrated;
    } catch (e) {
      console.warn('[DB] autoMigrateLegacyNotes notice:', e.message);
      return 0;
    }
  }

  /**
   * Enforce tenant isolation by removing residue records from other accounts or orphaned FKs
   */
  purgeForeignTenantData(userId) {
    if (!this.db || !userId || userId === 'guest') return;
    try {
      const tables = [
        'daily_collections',
        'advances',
        'expenses',
        'factory_collections',
        'factory_payments',
        'monthly_payments',
        'owners',
        'factories',
        'sessions'
      ];
      for (const t of tables) {
        try {
          this.db.exec(`DELETE FROM ${t} WHERE app_user_id IS NOT NULL AND app_user_id != '' AND app_user_id != '${userId}';`);
        } catch (_) {}
      }

      // Clean orphaned records with non-existent owner_ids
      try {
        this.db.exec(`DELETE FROM advances WHERE owner_id NOT IN (SELECT id FROM owners);`);
      } catch (_) {}
      try {
        this.db.exec(`DELETE FROM daily_collections WHERE owner_id NOT IN (SELECT id FROM owners);`);
      } catch (_) {}
      try {
        this.db.exec(`DELETE FROM monthly_payments WHERE owner_id NOT IN (SELECT id FROM owners);`);
      } catch (_) {}
    } catch (e) {
      console.warn('[DB] purgeForeignTenantData notice:', e.message);
    }
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) {}
      this.db = null;
    }
    if (this.globalDb) {
      try { this.globalDb.close(); } catch (_) {}
      this.globalDb = null;
    }
  }
}

module.exports = {
  LocalDatabase,
};
