/**
 * Leaf Ledger Pro - Cloud Synchronization Engine
 * High-performance, low-bandwidth, 2-way data sync with Supabase
 * Features:
 *  - Supabase Realtime WebSocket for instant mobile -> desktop reactivity
 *  - Checkpoint-based Delta Sync (gt('updated_at', last_sync)) for minimal API usage
 *  - Debounced Batch Push for fast desktop -> cloud sync
 *  - True Latest-Wins conflict resolution (Zero Data Loss)
 *  - Deleted Tombstone shields to prevent deleted record resurrection
 *  - Sequential Parent-Child syncing for foreign key integrity
 */

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const PARENT_TABLES = ['sessions', 'factories', 'owners', 'staff_accounts'];
const CHILD_TABLES = [
  'daily_collections',
  'advances',
  'expenses',
  'factory_collections',
  'factory_payments',
  'monthly_payments',
];

const FK_MAP = {
  owner_id: 'owners',
  session_id: 'sessions',
  staff_id: 'staff_accounts',
  factory_id: 'factories',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TABLE_SCHEMAS = {
  factories: ['id', 'app_user_id', 'name', 'address', 'phone', 'is_active', 'sync_id', 'created_at', 'updated_at'],
  owners: ['id', 'app_user_id', 'name', 'phone', 'address', 'bank_name', 'account_holder_name', 'bank_acc', 'bank_ifsc', 'notes', 'agreement_date', 'portal_pin', 'is_active', 'sync_id', 'created_at', 'updated_at'],
  daily_collections: ['id', 'app_user_id', 'owner_id', 'session_id', 'date', 'gross_weight_kg', 'bag_weight_kg', 'net_weight_kg', 'rate_per_kg', 'amount', 'notes', 'meta', 'collector_name', 'staff_id', 'sync_id', 'created_at', 'updated_at'],
  factory_collections: ['id', 'app_user_id', 'session_id', 'factory_name', 'factory_id', 'date', 'gross_weight_kg', 'bag_weight_kg', 'net_weight_kg', 'rate_per_kg', 'amount', 'notes', 'sync_id', 'created_at', 'updated_at'],
  expenses: ['id', 'app_user_id', 'session_id', 'date', 'category', 'amount', 'notes', 'sync_id', 'created_at', 'updated_at'],
  advances: ['id', 'app_user_id', 'owner_id', 'session_id', 'date', 'amount', 'payment_mode', 'notes', 'sync_id', 'created_at', 'updated_at'],
  monthly_payments: ['id', 'app_user_id', 'owner_id', 'session_id', 'month', 'year', 'total_gross_kg', 'total_net_kg', 'total_amount', 'advance_deducted', 'net_paid', 'payment_mode', 'notes', 'is_paid', 'payment_date', 'sync_id', 'created_at', 'updated_at'],
  factory_payments: ['id', 'app_user_id', 'session_id', 'factory_name', 'factory_id', 'month', 'year', 'total_weight_kg', 'total_amount', 'amount_received', 'payment_mode', 'payment_date', 'reference_no', 'notes', 'sync_id', 'created_at', 'updated_at'],
  staff_accounts: ['id', 'owner_id', 'username', 'full_name', 'mobile_number', 'is_active', 'allow_collector', 'password', 'display_mpin', 'sync_id', 'created_at', 'updated_at'],
  sessions: ['id', 'app_user_id', 'name', 'is_active', 'start_date', 'sync_id', 'created_at'],
};

class SyncEngine extends EventEmitter {
  constructor(localDb, supabaseUrl, supabaseAnonKey) {
    super();
    this.localDb = localDb;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseAnonKey;
    this.client = null;
    this.realtimeChannel = null;
    this.isSyncing = false;
    this._debounceTimer = null;
    this._heartbeatTimer = null;

    if (supabaseUrl && supabaseAnonKey) {
      this.initClient(supabaseUrl, supabaseAnonKey);
    }
  }

  initClient(url, key) {
    this.supabaseUrl = url;
    this.supabaseKey = key;
    try {
      this.client = createClient(url, key, {
        auth: { persistSession: false },
        realtime: {
          params: {
            eventsPerSecond: 20,
          },
        },
      });
      console.log('[SyncEngine] Supabase client initialized.');
    } catch (e) {
      console.error('[SyncEngine] Failed to initialize Supabase client:', e);
      this.client = null;
    }
  }

  async testConnection() {
    if (!this.client) return { success: false, message: 'Supabase client not initialized' };
    try {
      const { data, error } = await this.client.from('app_users').select('id').limit(1);
      if (error) throw error;
      return { success: true, message: 'Cloud connection verified' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async ensureAuthenticated() {
    if (!this.client) return false;
    try {
      const { data: sessionData } = await this.client.auth.getSession();
      if (sessionData?.session) {
        return true;
      }

      // Try saved token first
      const accessToken = this.localDb.getSetting('sb_access_token', '');
      const refreshToken = this.localDb.getSetting('sb_refresh_token', '');
      if (accessToken && refreshToken) {
        const { data: tokenData, error: tokenErr } = await this.client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!tokenErr && tokenData?.session) {
          return true;
        }
      }

      // Fallback: re-authenticate using saved credentials
      const savedPhone =
        this.localDb.getSetting('last_login_username', '') ||
        this.localDb.getSetting('agent_phone', '');
      const savedPwd = this.localDb.getSetting('app_password', '');
      if (savedPhone && savedPwd) {
        const cleanPhone = String(savedPhone).replace(/\D/g, '');
        const email = this._phoneToEmail(cleanPhone);
        const { data: authData, error: authErr } = await this.client.auth.signInWithPassword({
          email,
          password: String(savedPwd),
        });
        if (!authErr && authData?.session) {
          this.localDb.setSetting('sb_access_token', authData.session.access_token);
          this.localDb.setSetting('sb_refresh_token', authData.session.refresh_token);
          console.log('[SyncEngine] Re-authenticated cloud session successfully.');
          return true;
        }
      }

      return false;
    } catch (_) {
      return false;
    }
  }

  _phoneToEmail(phone) {
    const clean = String(phone).replace(/\D/g, '');
    return `${clean}@llpro.com`;
  }

  // ==========================================================================
  // Authentication & Licensing
  // ==========================================================================
  async checkUserExists(phone) {
    if (!this.client) return { exists: false, error: 'Cloud service unconfigured' };
    try {
      const clean = String(phone).replace(/\D/g, '');
      const { data, error } = await this.client
        .from('app_users')
        .select('id, full_name, mobile_number')
        .eq('mobile_number', clean)
        .maybeSingle();

      if (error) return { exists: false, error: error.message };
      return { exists: Boolean(data), user: data };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  }

  async signIn(phone, password) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const email = this._phoneToEmail(cleanPhone);

    if (this.client) {
      try {
        const { data: authData, error: authErr } = await this.client.auth.signInWithPassword({
          email,
          password: String(password),
        });

        if (authErr) {
          return this._offlineVerify(cleanPhone, password, authErr.message);
        }

        const authUser = authData?.user;
        if (!authUser) {
          return { success: false, message: 'Authentication failed' };
        }

        let { data: profile } = await this.client
          .from('app_users')
          .select('*')
          .eq('auth_id', authUser.id)
          .maybeSingle();

        if (!profile) {
          const { data: p2 } = await this.client
            .from('app_users')
            .select('*')
            .eq('mobile_number', cleanPhone)
            .maybeSingle();
          profile = p2;
        }

        if (!profile) {
          return { success: false, message: 'User profile not found. Please contact support.' };
        }

        if (profile.is_active === false) {
          return { success: false, message: 'Account deactivated. Contact Support.' };
        }

        if (profile.allow_desktop === false) {
          return { success: false, message: 'Desktop access not permitted for this account.' };
        }

        // Mount private SQLite database for this user
        this.localDb.switchUser(profile.id);

        // Save local session in SQLite
        this.localDb.setSetting('current_app_user_id', profile.id);
        this.localDb.setSetting('last_login_username', cleanPhone);
        this.localDb.setSetting('agent_name', profile.full_name || 'Agent');
        this.localDb.setSetting('agent_phone', cleanPhone);
        this.localDb.setSetting('app_password', password);

        if (authData?.session) {
          this.localDb.setSetting('sb_access_token', authData.session.access_token);
          this.localDb.setSetting('sb_refresh_token', authData.session.refresh_token);
        }

        // Check activation
        const actRes = await this.checkUserActivation(profile.id);

        // Start real-time subscription and background sync
        this.initRealtimeSubscription(profile.id);
        this.startBackgroundSync(60000);

        // Run fresh full sync for this user to align records
        setTimeout(() => this.runFullSync(true), 500);

        return {
          success: true,
          status: 'success',
          mode: 'cloud',
          user: profile,
          activation: actRes,
        };
      } catch (err) {
        return this._offlineVerify(cleanPhone, password, err?.message);
      }
    }

    return this._offlineVerify(cleanPhone, password, 'Cloud offline');
  }

  async autoRestoreSession() {
    if (!this.client) return false;
    try {
      const accessToken = this.localDb.getSetting('sb_access_token', '');
      const refreshToken = this.localDb.getSetting('sb_refresh_token', '');

      if (accessToken && refreshToken) {
        const { data, error } = await this.client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (!error && data?.user) {
          let uid = this.localDb.getSetting('current_app_user_id', '');
          if (!uid) {
            const { data: profile } = await this.client
              .from('app_users')
              .select('id')
              .eq('auth_id', data.user.id)
              .maybeSingle();
            if (profile?.id) {
              uid = profile.id;
              this.localDb.setSetting('current_app_user_id', uid);
            }
          }
          if (uid) {
            this.localDb.switchUser(uid);
            this.initRealtimeSubscription(uid);
            this.startBackgroundSync(60000);
            return true;
          }
        }
      }

      // Fallback: authenticate with saved phone & password
      const savedPhone =
        this.localDb.getSetting('last_login_username', '') ||
        this.localDb.getSetting('agent_phone', '');
      const savedPwd = this.localDb.getSetting('app_password', '');

      if (savedPhone && savedPwd) {
        console.log('[SyncEngine] Restoring session via saved credentials for:', savedPhone);
        const res = await this.signIn(savedPhone, savedPwd);
        return Boolean(res?.success);
      }

      return false;
    } catch (e) {
      console.warn('[SyncEngine] autoRestoreSession error:', e.message);
      return false;
    }
  }

  _offlineVerify(phone, password, cloudError) {
    const savedPhone = this.localDb.getSetting('last_login_username', '');
    const savedPwd = this.localDb.getSetting('app_password', '');

    if (savedPhone && savedPhone === phone && savedPwd && savedPwd === password) {
      const name = this.localDb.getSetting('agent_name', 'Agent');
      const uid = this.localDb.getSetting('current_app_user_id', 'local_user');
      return {
        success: true,
        status: 'success',
        mode: 'offline',
        message: 'Logged in using local credentials cache',
        user: { id: uid, full_name: name, mobile_number: phone },
      };
    }

    return { success: false, message: cloudError || 'Invalid phone number or 6-digit MPIN' };
  }

  async signUp(bizName, phone, password) {
    if (!this.client) return { success: false, message: 'Cloud service unconfigured' };
    try {
      const cleanPhone = String(phone).replace(/\D/g, '');
      const email = this._phoneToEmail(cleanPhone);

      const { data: existing } = await this.client
        .from('app_users')
        .select('id')
        .eq('mobile_number', cleanPhone)
        .maybeSingle();

      if (existing) {
        return { success: false, message: 'This phone number is already registered. Please login.' };
      }

      const { data: authData, error: authErr } = await this.client.auth.signUp({
        email,
        password: String(password),
      });

      if (authErr) {
        return { success: false, message: authErr.message };
      }

      const authId = authData?.user?.id;
      if (!authId) {
        return { success: false, message: 'Failed to create auth credentials' };
      }

      const { data: newUser, error: profileErr } = await this.client
        .from('app_users')
        .insert({
          auth_id: authId,
          mobile_number: cleanPhone,
          full_name: bizName,
          is_active: true,
          allow_desktop: true,
        })
        .select()
        .single();

      if (profileErr) {
        return { success: false, message: 'Profile creation failed: ' + profileErr.message };
      }

      this.localDb.setSetting('agent_name', bizName);
      this.localDb.setSetting('agent_phone', cleanPhone);
      this.localDb.setSetting('app_password', password);

      return { success: true, status: 'success', message: 'Registration successful! You can now log in.', user: newUser };
    } catch (err) {
      return { success: false, message: err?.message || 'Registration failed' };
    }
  }

  async checkUserActivation(userId) {
    if (!this.client || !userId) {
      const isAct = this.localDb.getSetting('is_activated', '0') === '1';
      return { isActivated: isAct };
    }

    try {
      const { data: keys, error } = await this.client
        .from('activation_keys')
        .select('*')
        .eq('used_by', userId);

      if (error || !keys || keys.length === 0) {
        this.localDb.setSetting('is_activated', '0');
        return { isActivated: false, message: 'No active license found' };
      }

      const activeKey = keys[0];
      const now = new Date();
      let isValid = true;

      if (activeKey.expiry_date) {
        isValid = new Date(activeKey.expiry_date) >= now;
      }

      if (!isValid) {
        this.localDb.setSetting('is_activated', '0');
        return { isActivated: false, expired: true, message: 'Activation key has expired' };
      }

      this.localDb.setSetting('is_activated', '1');
      this.localDb.setSetting('active_license', activeKey.key || '');
      this.localDb.setSetting('expiry_date', activeKey.expiry_date || '');

      return { isActivated: true, key: activeKey.key, expiryDate: activeKey.expiry_date };
    } catch {
      const isAct = this.localDb.getSetting('is_activated', '0') === '1';
      return { isActivated: isAct };
    }
  }

  async verifyActivationKey(key, userId) {
    if (!this.client) return { success: false, message: 'Cloud service not configured' };
    try {
      const cleanKey = String(key).trim().toUpperCase();
      const { data: records, error } = await this.client
        .from('activation_keys')
        .select('*')
        .eq('key', cleanKey)
        .limit(1);

      if (error || !records || records.length === 0) {
        return { success: false, message: 'Invalid or unrecognized activation key' };
      }

      const license = records[0];
      if (license.used_by && license.used_by !== userId) {
        return { success: false, message: 'This key has already been registered to another account' };
      }

      if (license.expiry_date && new Date(license.expiry_date) < new Date()) {
        return { success: false, message: 'This activation key has expired' };
      }

      const now = new Date();
      const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const updatePayload = {
        used_by: userId,
        activation_date: license.activation_date || now.toISOString(),
        expiry_date: license.expiry_date || oneYear.toISOString(),
      };

      await this.client.from('activation_keys').update(updatePayload).eq('key', cleanKey);

      this.localDb.setSetting('is_activated', '1');
      this.localDb.setSetting('active_license', cleanKey);
      this.localDb.setSetting('expiry_date', updatePayload.expiry_date);

      return { success: true, message: 'Product successfully activated!' };
    } catch (err) {
      return { success: false, message: err?.message || 'Verification error' };
    }
  }

  // ==========================================================================
  // Real-Time WebSocket Channel (Instant Downstream Reactivity from Mobile)
  // ==========================================================================
  initRealtimeSubscription(appUserId) {
    if (!this.client || !appUserId) return;
    if (this.realtimeChannel) {
      this.stopRealtimeSubscription();
    }

    try {
      const channelName = `llp_realtime_${appUserId}`;
      console.log(`[SyncEngine] Subscribing to Supabase Realtime channel: ${channelName}`);

      this.realtimeChannel = this.client
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public' },
          async (payload) => {
            await this._handleRealtimeEvent(payload, appUserId);
          }
        )
        .subscribe((status, err) => {
          console.log(`[SyncEngine] Realtime channel status: ${status}`);
          if (err) {
            console.error('[SyncEngine] Realtime subscription error:', err);
          }
        });
    } catch (err) {
      console.error('[SyncEngine] Failed to setup realtime subscription:', err);
    }
  }

  stopRealtimeSubscription() {
    if (this.realtimeChannel && this.client) {
      try {
        this.client.removeChannel(this.realtimeChannel);
      } catch (_) {}
      this.realtimeChannel = null;
    }
  }

  async _handleRealtimeEvent(payload, appUserId) {
    try {
      const { table, eventType, new: newRec, old: oldRec } = payload;
      const allSupported = [...PARENT_TABLES, ...CHILD_TABLES];
      if (!allSupported.includes(table)) return;

      console.log(`[SyncEngine Realtime] ⚡ Event ${eventType} on ${table}`);

      if (eventType === 'DELETE') {
        const delId = oldRec?.id || oldRec?.sync_id;
        if (delId) {
          this.localDb.run(
            `DELETE FROM ${table} WHERE cloud_id = ? OR id = ? OR sync_id = ?`,
            [delId, delId, delId]
          );
          this.localDb.recordTombstone(table, delId);
          this.emit('data-changed', { table, action: 'DELETE', id: delId });
        }
        return;
      }

      // INSERT or UPDATE
      if (!newRec) return;

      // Ownership filter
      const ownerCol = table === 'staff_accounts' ? 'owner_id' : 'app_user_id';
      if (newRec[ownerCol] && newRec[ownerCol] !== appUserId) {
        return; // Belongs to a different agent/tenant
      }

      const cache = this._warmTranslationCache();
      const cleanRow = this._translateFksForPull(table, newRec, cache);
      const updated = this.localDb.upsertFromCloud(table, cleanRow);

      if (updated) {
        // Advance sync checkpoint timestamp
        const ts = newRec.updated_at || newRec.created_at;
        if (ts) {
          const lastSync = this.localDb.getSetting(`last_sync_${table}`, '1970-01-01T00:00:00.000Z');
          if (new Date(ts).getTime() > new Date(lastSync).getTime()) {
            this.localDb.setSetting(`last_sync_${table}`, ts);
          }
        }
        console.log(`[SyncEngine Realtime] ✅ Applied ${eventType} on ${table} locally.`);
        this.emit('data-changed', { table, action: eventType, row: cleanRow });
      }
    } catch (err) {
      console.error('[SyncEngine Realtime] Error handling event:', err);
    }
  }

  // ==========================================================================
  // Foreign Key Translation Cache (O(1) in-memory resolution)
  // ==========================================================================
  _warmTranslationCache() {
    const cache = {};
    const tables = ['owners', 'sessions', 'staff_accounts', 'factories'];
    for (const t of tables) {
      const rows = this.localDb.query(
        `SELECT id, cloud_id FROM ${t} WHERE cloud_id IS NOT NULL AND cloud_id != ''`
      );
      cache[t] = {};
      cache[`${t}_rev`] = {};
      for (const r of rows) {
        if (r.id && r.cloud_id) {
          cache[t][r.id] = r.cloud_id;
          cache[`${t}_rev`][r.cloud_id] = r.id;
        }
      }
    }
    return cache;
  }

  _translateFksForPush(tableName, rowData, cache) {
    const translated = { ...rowData };
    if (tableName === 'staff_accounts') {
      if (translated.app_user_id) {
        translated.owner_id = translated.app_user_id;
        delete translated.app_user_id;
      }
      if (!translated.password) {
        if (translated.mpin_hash && String(translated.mpin_hash).length === 64) {
          translated.password = translated.mpin_hash;
        } else if (translated.display_mpin) {
          translated.password = crypto.createHash('sha256').update(String(translated.display_mpin).trim()).digest('hex');
        } else if (translated.mpin_hash) {
          translated.password = crypto.createHash('sha256').update(String(translated.mpin_hash).trim()).digest('hex');
        }
      }
      if (translated.is_active !== undefined) {
        translated.is_active = translated.is_active != 0;
      }
      if (translated.allow_collector !== undefined) {
        translated.allow_collector = translated.allow_collector != 0;
      }
    }

    for (const [col, refTable] of Object.entries(FK_MAP)) {
      if (translated[col]) {
        const localVal = translated[col];
        if (cache && cache[refTable] && cache[refTable][localVal]) {
          translated[col] = cache[refTable][localVal];
        } else {
          const refRow = this.localDb.getOne(
            `SELECT cloud_id FROM ${refTable} WHERE id = ?`,
            [localVal]
          );
          if (refRow && refRow.cloud_id) {
            translated[col] = refRow.cloud_id;
          }
        }
      }
    }
    return translated;
  }

  _translateFksForPull(tableName, rowData, cache) {
    const translated = { ...rowData };
    if (tableName === 'staff_accounts') {
      if (translated.owner_id) {
        translated.app_user_id = translated.owner_id;
      }
      if (translated.password && !translated.mpin_hash) {
        translated.mpin_hash = translated.password;
      }
    }
    if (tableName === 'factory_payments') {
      if (translated.amount === undefined && translated.amount_received !== undefined) {
        translated.amount = translated.amount_received;
      }
    }
    if (tableName === 'factory_collections') {
      if (translated.deduction_pct === undefined && translated.bag_weight_kg !== undefined) {
        translated.deduction_pct = translated.bag_weight_kg;
      }
      if (translated.notes) {
        const matchChallan = translated.notes.match(/Challan:\s*([^|\]]+)/i);
        if (matchChallan && !translated.challan_no) {
          translated.challan_no = matchChallan[1].trim();
        }
        const matchBy = translated.notes.match(/By:\s*([^|\]]+)/i);
        if (matchBy && !translated.delivered_by) {
          translated.delivered_by = matchBy[1].trim();
        }
      }
    }

    for (const [col, refTable] of Object.entries(FK_MAP)) {
      if (translated[col]) {
        const cloudVal = translated[col];
        if (cache && cache[`${refTable}_rev`] && cache[`${refTable}_rev`][cloudVal]) {
          translated[col] = cache[`${refTable}_rev`][cloudVal];
        } else {
          const refRow = this.localDb.getOne(
            `SELECT id FROM ${refTable} WHERE cloud_id = ? OR id = ?`,
            [cloudVal, cloudVal]
          );
          if (refRow && refRow.id) {
            translated[col] = refRow.id;
          }
        }
      }
    }
    return translated;
  }

  // ==========================================================================
  // Delta Sync & Batch Push Core Engines
  // ==========================================================================
  async _syncTableDelta(tableName, appUserId, cache, force = false) {
    if (!this.client) return 0;
    try {
      const lastSync = force
        ? '1970-01-01T00:00:00.000Z'
        : this.localDb.getSetting(`last_sync_${tableName}`, '1970-01-01T00:00:00.000Z');

      const ownerCol = tableName === 'staff_accounts' ? 'owner_id' : 'app_user_id';

      let query = this.client.from(tableName).select('*').eq(ownerCol, appUserId);
      if (tableName !== 'sessions') {
        query = query.gt('updated_at', lastSync);
      }

      let { data: cloudRecords, error } = await query;
      if (error) {
        // Fallback to created_at if updated_at is missing on the remote table
        const fallbackQuery = this.client
          .from(tableName)
          .select('*')
          .eq(ownerCol, appUserId)
          .gt('created_at', lastSync);
        const fbRes = await fallbackQuery;
        if (!fbRes.error && fbRes.data) {
          cloudRecords = fbRes.data;
        } else {
          console.warn(`[SyncEngine] Delta fetch for ${tableName} failed:`, error.message);
          return 0;
        }
      }

      if (!cloudRecords || cloudRecords.length === 0) return 0;

      let pullCount = 0;
      let maxTs = lastSync;

      for (const remote of cloudRecords) {
        const syncId = remote.sync_id || `supa_${remote.id}`;

        // Ghost shield check: Never resurrect deleted records
        if (
          this.localDb.getOne('SELECT sync_id FROM deleted_tombstones WHERE sync_id = ?', [syncId])
        ) {
          continue;
        }

        const cleanRow = this._translateFksForPull(tableName, remote, cache);
        const changed = this.localDb.upsertFromCloud(tableName, cleanRow);
        if (changed) pullCount++;

        const recTs = remote.updated_at || remote.created_at;
        if (recTs && new Date(recTs).getTime() > new Date(maxTs).getTime()) {
          maxTs = recTs;
        }
      }

      // Advance sync checkpoint if records were retrieved
      if (maxTs !== lastSync) {
        this.localDb.setSetting(`last_sync_${tableName}`, maxTs);
      }

      return pullCount;
    } catch (err) {
      console.error(`[SyncEngine] _syncTableDelta error for ${tableName}:`, err);
      return 0;
    }
  }

  _sanitizeForCloudPush(tableName, rowData) {
    const allowed = TABLE_SCHEMAS[tableName];
    const clean = {};
    if (allowed && Array.isArray(allowed)) {
      for (const col of allowed) {
        if (rowData[col] !== undefined) {
          clean[col] = rowData[col];
        }
      }
    } else {
      Object.assign(clean, rowData);
    }
    // Hard-strip internal SQLite tracking columns
    delete clean.cloud_id;
    delete clean.sync_status;
    delete clean.is_dirty;
    delete clean.local_id;
    if (tableName === 'staff_accounts') {
      delete clean.phone;
      if (clean.is_active !== undefined) clean.is_active = clean.is_active != 0;
      if (clean.allow_collector !== undefined) clean.allow_collector = clean.allow_collector != 0;
      if (!clean.password) {
        if (rowData.password) {
          clean.password = rowData.password;
        } else if (rowData.mpin_hash && String(rowData.mpin_hash).length === 64) {
          clean.password = rowData.mpin_hash;
        } else if (rowData.display_mpin) {
          clean.password = crypto.createHash('sha256').update(String(rowData.display_mpin).trim()).digest('hex');
        } else if (rowData.mpin_hash) {
          clean.password = crypto.createHash('sha256').update(String(rowData.mpin_hash).trim()).digest('hex');
        }
        if (!clean.password) {
          clean.password = crypto.createHash('sha256').update(String(rowData.mobile_number || '123456')).digest('hex');
        }
      }
    }
    if (tableName === 'daily_collections') {
      if (clean.meta && typeof clean.meta === 'string') {
        try {
          clean.meta = JSON.parse(clean.meta);
        } catch (_) {
          clean.meta = null;
        }
      }
    }
    if (tableName === 'factory_payments') {
      if (clean.amount_received === undefined && rowData.amount !== undefined) {
        clean.amount_received = rowData.amount;
      }
      if (clean.total_amount === undefined && rowData.amount !== undefined) {
        clean.total_amount = rowData.amount;
      }
    }
    if (tableName === 'factory_collections') {
      if (clean.bag_weight_kg === undefined && rowData.deduction_pct !== undefined) {
        clean.bag_weight_kg = rowData.deduction_pct;
      }
      if (!clean.factory_name) {
        if (rowData.factory_name) {
          clean.factory_name = rowData.factory_name;
        } else if (rowData.factory_id) {
          const fact = this.localDb.getOne('SELECT name FROM factories WHERE id = ? OR cloud_id = ?', [rowData.factory_id, rowData.factory_id]);
          if (fact && fact.name) {
            clean.factory_name = fact.name;
          }
        }
      }
      const extras = [];
      if (rowData.challan_no && (!clean.notes || !clean.notes.includes(rowData.challan_no))) {
        extras.push(`Challan: ${rowData.challan_no}`);
      }
      if (rowData.delivered_by && (!clean.notes || !clean.notes.includes(rowData.delivered_by))) {
        extras.push(`By: ${rowData.delivered_by}`);
      }
      if (extras.length > 0) {
        const metaPrefix = `[${extras.join(' | ')}]`;
        clean.notes = clean.notes ? `${metaPrefix} ${clean.notes}` : metaPrefix;
      }
    }
    return clean;
  }

  async _pushDirtyRecords(tableName, appUserId, cache) {
    if (!this.client) return 0;
    try {
      const dirtyRecords = this.localDb.getDirtyRecords(tableName, 500);
      if (!dirtyRecords || dirtyRecords.length === 0) return 0;

      let pushedCount = 0;
      const CHUNK_SIZE = 50;

      for (let i = 0; i < dirtyRecords.length; i += CHUNK_SIZE) {
        const chunk = dirtyRecords.slice(i, i + CHUNK_SIZE);
        const batchPayload = [];
        const processedIds = [];

        for (const row of chunk) {
          const data = { ...row };
          const localId = data.id;
          const cloudId = data.cloud_id;

          // Remote primary key must be a valid UUID for PostgreSQL
          if (cloudId && UUID_REGEX.test(cloudId)) {
            data.id = cloudId;
          } else if (localId && UUID_REGEX.test(localId)) {
            data.id = localId;
          } else {
            const newUuid = crypto.randomUUID();
            data.id = newUuid;
            try {
              this.localDb.run(`UPDATE ${tableName} SET cloud_id = ? WHERE id = ?`, [newUuid, localId]);
            } catch (_) {}
          }

          data.sync_id = data.sync_id || localId;

          const pushData = this._translateFksForPush(tableName, data, cache);

          if (tableName === 'staff_accounts') {
            if (!pushData.owner_id) pushData.owner_id = appUserId;
          } else {
            pushData.app_user_id = pushData.app_user_id || appUserId;
          }

          const sanitized = this._sanitizeForCloudPush(tableName, pushData);
          batchPayload.push(sanitized);
          processedIds.push(localId);
        }

        const { data: upsertedData, error } = await this.client
          .from(tableName)
          .upsert(batchPayload, { onConflict: 'id' })
          .select('id, sync_id');

        if (error) {
          console.warn(`[SyncEngine] Batch push failed for ${tableName}: ${error.message}. Retrying individually...`);
          // Resilient individual retry with sanitized payload
          for (let j = 0; j < batchPayload.length; j++) {
            const item = batchPayload[j];
            const lid = processedIds[j];
            try {
              const cleanItem = this._sanitizeForCloudPush(tableName, item);
              const indRes = await this.client
                .from(tableName)
                .upsert(cleanItem, { onConflict: 'id' })
                .select('id');

              if (!indRes.error) {
                const resId = indRes.data?.[0]?.id || item.id;
                this.localDb.markRecordsSynced(tableName, [lid]);
                this.localDb.run(`UPDATE ${tableName} SET cloud_id = ? WHERE id = ?`, [resId, lid]);
                pushedCount++;
              } else if (
                indRes.error.message &&
                indRes.error.message.toLowerCase().includes("could not find the 'meta' column")
              ) {
                // Graceful backward compatibility until user runs supabase_scale_migration.sql
                const fallbackItem = { ...cleanItem };
                delete fallbackItem.meta;
                const fbRes = await this.client.from(tableName).upsert(fallbackItem, { onConflict: 'id' }).select('id');
                if (!fbRes.error) {
                  const resId = fbRes.data?.[0]?.id || fallbackItem.id;
                  this.localDb.markRecordsSynced(tableName, [lid]);
                  this.localDb.run(`UPDATE ${tableName} SET cloud_id = ? WHERE id = ?`, [resId, lid]);
                  pushedCount++;
                }
              } else if (
                indRes.error.message &&
                indRes.error.message.toLowerCase().includes('duplicate key')
              ) {
                this.localDb.markRecordsSynced(tableName, [lid]);
                pushedCount++;
              }
            } catch (indErr) {
              console.error(`[SyncEngine] Individual retry failed for ${tableName} id ${lid}:`, indErr);
            }
          }
        } else {
          // Success: Mark chunk clean and update cloud_id
          if (upsertedData && Array.isArray(upsertedData)) {
            for (const item of upsertedData) {
              if (item.id) {
                this.localDb.run(
                  `UPDATE ${tableName} SET sync_status = 1, cloud_id = ? WHERE id = ? OR sync_id = ?`,
                  [item.id, item.id, item.sync_id || item.id]
                );
              }
            }
          }
          this.localDb.markRecordsSynced(tableName, processedIds);
          pushedCount += chunk.length;
        }
      }

      return pushedCount;
    } catch (err) {
      console.error(`[SyncEngine] _pushDirtyRecords error for ${tableName}:`, err);
      return 0;
    }
  }

  async _processPendingDeletions() {
    if (!this.client) return;
    try {
      const tombstones = this.localDb.query(
        `SELECT sync_id, table_name FROM deleted_tombstones WHERE deleted_at > datetime('now', '-7 days')`
      );
      if (!tombstones || tombstones.length === 0) return;

      const byTable = {};
      for (const t of tombstones) {
        if (!byTable[t.table_name]) byTable[t.table_name] = [];
        byTable[t.table_name].push(t.sync_id);
      }

      for (const [table, syncIds] of Object.entries(byTable)) {
        if (syncIds.length === 0) continue;
        for (let i = 0; i < syncIds.length; i += 50) {
          const chunk = syncIds.slice(i, i + 50);
          try {
            await this.client.from(table).delete().in('id', chunk);
            await this.client.from(table).delete().in('sync_id', chunk);
          } catch (delErr) {
            console.error(`[SyncEngine] Deletion error on ${table}:`, delErr);
          }
        }
      }
    } catch (err) {
      console.error('[SyncEngine] _processPendingDeletions error:', err);
    }
  }

  // ==========================================================================
  // Public High-Level Sync Orchestrators
  // ==========================================================================
  async runFullSync(force = false) {
    if (this.isSyncing) return { status: 'in_progress' };
    this.isSyncing = true;
    this.emit('status-changed', { status: 'syncing' });

    try {
      const appUserId = this.localDb.getSetting('current_app_user_id', '');
      if (!appUserId || !this.client) {
        this.emit('status-changed', { status: 'offline' });
        return { status: 'offline', message: 'No active session or client unconfigured' };
      }

      // Ensure cloud client has valid authenticated session for RLS authorization
      const isAuth = await this.ensureAuthenticated();
      if (!isAuth) {
        this.emit('status-changed', { status: 'offline' });
        return { status: 'offline', message: 'Client not authenticated or offline' };
      }

      // 1. Process pending cloud deletions first
      await this._processPendingDeletions();

      let totalPulled = 0;
      let totalPushed = 0;
      const changedTables = [];

      // 2. Sequential Parent Sync (PULL BEFORE PUSH to guarantee FK validity)
      for (const p of PARENT_TABLES) {
        const pulled = await this._syncTableDelta(p, appUserId, null, force);
        const pushed = await this._pushDirtyRecords(p, appUserId, null);
        if (pulled > 0) changedTables.push(p);
        totalPulled += pulled;
        totalPushed += pushed;
      }

      // 3. Pre-warm Foreign Key Translation Cache
      const cache = this._warmTranslationCache();

      // 4. Sequential Child Sync (PULL BEFORE PUSH to resolve True Latest-Wins conflicts)
      for (const c of CHILD_TABLES) {
        const pulled = await this._syncTableDelta(c, appUserId, cache, force);
        const pushed = await this._pushDirtyRecords(c, appUserId, cache);
        if (pulled > 0) changedTables.push(c);
        totalPulled += pulled;
        totalPushed += pushed;
      }

      // 5. Self-heal any foreign key mappings from concurrent syncs
      this.localDb.healForeignKeys();

      if (totalPulled > 0 || totalPushed > 0) {
        this.emit('data-changed', { tables: changedTables, totalPulled, totalPushed });
      }

      this.emit('status-changed', { status: 'synced', totalPulled, totalPushed });
      return {
        status: 'ok',
        flushed: totalPushed,
        pulled: totalPulled,
        changedTables,
      };
    } catch (err) {
      console.error('[SyncEngine] runFullSync error:', err);
      this.emit('status-changed', { status: 'error', error: err.message });
      return { status: 'error', error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  smartSync(tableName = null) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(async () => {
      try {
        const appUserId = this.localDb.getSetting('current_app_user_id', '');
        if (!appUserId || !this.client) return;

        const isAuth = await this.ensureAuthenticated();
        if (!isAuth) return;

        if (tableName) {
          // Targeted rapid sync for the modified table
          const cache = this._warmTranslationCache();
          // Push dirty records first so local modifications land in cloud immediately!
          const pushed = await this._pushDirtyRecords(tableName, appUserId, cache);
          // Then pull delta
          const pulled = await this._syncTableDelta(tableName, appUserId, cache, false);

          if (pulled > 0 || pushed > 0) {
            this.emit('data-changed', {
              table: tableName,
              totalPulled: pulled,
              totalPushed: pushed,
            });
          }
        } else {
          await this.runFullSync(false);
        }
      } catch (err) {
        console.error('[SyncEngine] smartSync error:', err);
      }
    }, 100);
  }

  startBackgroundSync(intervalMs = 60000) {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      try {
        if (!this.localDb || !this.localDb.db) return;
        const uid = this.localDb.getSetting('current_app_user_id', '');
        if (uid && this.client && !this.isSyncing) {
          this.runFullSync(false).catch((err) =>
            console.error('[SyncEngine] Heartbeat sync error:', err)
          );
        }
      } catch (_) {}
    }, intervalMs);
  }

  stopBackgroundSync() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Fetches dynamic mobile app APK download URL and version from Supabase app_metadata
   * Eliminates need to update desktop software whenever mobile app APK updates.
   */
  async getMobileAppDownloadInfo() {
    let resultUrl = null;
    let resultVersion = null;

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('app_metadata')
          .select('key, value');

        if (!error && Array.isArray(data) && data.length > 0) {
          for (const item of data) {
            const k = (item.key || '').trim().toLowerCase();
            const v = item.value;
            if (!v) continue;

            if (['mobile_apk_url', 'mobile_app_url', 'mobile_drive_url', 'mobile_url', 'apk_url'].includes(k)) {
              resultUrl = String(v).trim();
            } else if (['mobile_version', 'mobile_app_version', 'app_version'].includes(k)) {
              resultVersion = String(v).trim();
            } else if (k === 'mobile_app' || k === 'mobile_config' || k === 'mobile_info') {
              try {
                const parsed = typeof v === 'string' ? JSON.parse(v) : v;
                if (parsed.url || parsed.apk_url || parsed.download_url || parsed.mobile_url) {
                  resultUrl = parsed.url || parsed.apk_url || parsed.download_url || parsed.mobile_url;
                }
                if (parsed.version || parsed.mobile_version) {
                  resultVersion = parsed.version || parsed.mobile_version;
                }
              } catch (_) {}
            }
          }
        }
      } catch (err) {
        console.warn('[SyncEngine] Error querying app_metadata for mobile app:', err.message);
      }
    }

    if (resultUrl && this.localDb) {
      try {
        this.localDb.setSetting('cached_mobile_apk_url', resultUrl);
        if (resultVersion) this.localDb.setSetting('cached_mobile_apk_version', resultVersion);
      } catch (_) {}
      return { url: resultUrl, version: resultVersion, source: 'supabase' };
    }

    // Check cached value from local SQLite
    if (this.localDb) {
      try {
        const cachedUrl = this.localDb.getSetting('cached_mobile_apk_url', '');
        const cachedVersion = this.localDb.getSetting('cached_mobile_apk_version', '');
        if (cachedUrl) {
          return { url: cachedUrl, version: cachedVersion, source: 'cache' };
        }
      } catch (_) {}
    }

    // Ultimate fallback default
    return {
      url: 'https://drive.google.com/uc?export=download&id=1VXKZ0t7IMsevOAA1uBytAJqmuAKTO62E',
      version: '2.0.7',
      source: 'default',
    };
  }
}

module.exports = { SyncEngine };
