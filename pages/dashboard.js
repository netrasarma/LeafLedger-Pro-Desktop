/**
 * Leaf Ledger Pro - Dashboard Screen Module
 * Mirrors Python ui/dashboard.py calculation and display logic
 */

const dashboardModule = {
  async init() {
    this.updateHeaderDate();
    this.checkLicenseAlert();
    await this.refresh();
  },

  updateHeaderDate() {
    const dateEl = document.getElementById('dashDateLabel');
    if (dateEl) {
      const now = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      dateEl.innerText = `${days[now.getDay()]}, ${String(now.getDate()).padStart(2, '0')} ${months[now.getMonth()]} ${now.getFullYear()}`;
    }
  },

  async refresh() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const curMonth = today.slice(0, 7); // 'YYYY-MM'

      // 1. Session Info
      const activeSession = await app.getActiveSession();
      const sessionLabel = document.getElementById('dashSessionLabel');
      if (sessionLabel) {
        sessionLabel.innerText = `📍 Session: ${activeSession?.name || 'Main Season'}`;
      }

      // 2. Garden Owners Count
      const ownersRes = await window.electronAPI.db.getOne(
        "SELECT COUNT(*) as count FROM owners WHERE is_active = 1"
      );
      const totalOwners = ownersRes?.data?.count || 0;
      const ownersVal = document.getElementById('dashStatOwnersVal');
      if (ownersVal) ownersVal.innerText = totalOwners.toLocaleString('en-IN');

      // 3. Today's Collections
      const todayRes = await window.electronAPI.db.getOne(
        "SELECT COUNT(DISTINCT owner_id) as unique_owners, COALESCE(SUM(net_weight_kg), 0) as net, COALESCE(SUM(gross_weight_kg), 0) as gross FROM daily_collections WHERE date = ?",
        [today]
      );
      const todayNet = Math.round(todayRes?.data?.net || 0);
      const todayGross = Math.round(todayRes?.data?.gross || 0);
      const todayUnique = todayRes?.data?.unique_owners || 0;

      const todayVal = document.getElementById('dashStatTodayVal');
      const todayGrossEl = document.getElementById('dashStatTodayGross');
      const todaySubEl = document.getElementById('dashStatTodaySub');
      if (todayVal) todayVal.innerText = `${todayNet.toLocaleString('en-IN')} kg`;
      if (todayGrossEl) todayGrossEl.innerText = `Gross: ${todayGross.toLocaleString('en-IN')} kg`;
      if (todaySubEl) {
        const todayDateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        todaySubEl.innerText = `${todayUnique} owners • ${todayDateStr}`;
      }

      // 4. Monthly Weight
      const monthRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(net_weight_kg), 0) as net, COALESCE(SUM(gross_weight_kg), 0) as gross, COALESCE(SUM(amount), 0) as payout FROM daily_collections WHERE date LIKE ?",
        [`${curMonth}%`]
      );
      const monthNet = Math.round(monthRes?.data?.net || 0);
      const monthGross = Math.round(monthRes?.data?.gross || 0);
      const monthPayout = monthRes?.data?.payout || 0;

      const monthVal = document.getElementById('dashStatMonthVal');
      const monthGrossEl = document.getElementById('dashStatMonthGross');
      const monthSubEl = document.getElementById('dashStatMonthSub');
      if (monthVal) monthVal.innerText = `${monthNet.toLocaleString('en-IN')} kg`;
      if (monthGrossEl) monthGrossEl.innerText = `Gross: ${monthGross.toLocaleString('en-IN')} kg`;
      if (monthSubEl) {
        const monthStr = new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        monthSubEl.innerText = monthStr;
      }

      // 5. Net Profits (Estimated from Factory collections vs Payout)
      const factoryMonthRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(amount), 0) as total_factory FROM factory_collections WHERE date LIKE ?",
        [`${curMonth}%`]
      );
      const factoryReceipt = factoryMonthRes?.data?.total_factory || 0;
      const netProfit = factoryReceipt > 0 ? (factoryReceipt - monthPayout) : (monthNet * 2.5); // Fallback estimate

      const profitVal = document.getElementById('dashStatProfitVal');
      if (profitVal) profitVal.innerText = `₹${Math.max(0, netProfit).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // 6. Pending Advances
      const advTotalRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(amount), 0) as total_adv FROM advances"
      );
      const advRecoveredRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(advance_deducted), 0) as total_rec FROM monthly_payments WHERE is_paid = 1"
      );
      const totalAdv = advTotalRes?.data?.total_adv || 0;
      const totalRec = advRecoveredRes?.data?.total_rec || 0;
      const pendingAdv = Math.max(0, totalAdv - totalRec);

      const advVal = document.getElementById('dashStatAdvancesVal');
      if (advVal) advVal.innerText = `₹${pendingAdv.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // 7. Today's Collections List
      const todayListRes = await window.electronAPI.db.query(`
        SELECT dc.*, o.name as owner_name 
        FROM daily_collections dc
        JOIN owners o ON dc.owner_id = o.id
        WHERE dc.date = ?
        ORDER BY dc.created_at DESC
      `, [today]);

      this.renderTodayCollections(todayListRes?.data || []);
    } catch (err) {
      console.error('[DashboardModule] Refresh error:', err);
    }
  },

  renderTodayCollections(collections) {
    const listContainer = document.getElementById('dashTodayCollectionsList');
    if (!listContainer) return;

    if (!collections || collections.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 50px 0; font-size: 14px;">
          No collections recorded today.
        </div>
      `;
      return;
    }

    const AVATAR_COLORS = ['#4A90E2', '#50E3C2', '#B8E986', '#F5A623', '#D0021B', '#BD10E0', '#9013FE'];

    listContainer.innerHTML = collections.map((row, idx) => {
      const name = row.owner_name || 'Grower';
      const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
      const collector = row.collector_name || 'Self';
      const gross = Math.round(row.gross_weight_kg || 0);
      const ded = Math.round(row.bag_weight_kg || 0);
      const net = Math.round(row.net_weight_kg || 0);
      const amount = Math.round(row.amount || 0);

      return `
        <div style="background: var(--bg-input); border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border-subtle);">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${color}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px;">
              ${initials}
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${name}</div>
              <div style="font-size: 11px; color: var(--accent-emerald); font-weight: 600;">👤 ${collector}</div>
            </div>
          </div>

          <div style="text-align: right;">
            <div style="font-size: 14px; font-weight: 800; color: var(--accent-amber);">Rs.${amount.toLocaleString('en-IN')}</div>
            <div style="font-size: 12px; font-weight: 600; color: var(--accent-emerald-light); font-family: var(--font-mono);">
              ⚖️ ${gross} &nbsp;👜 ${ded}% &nbsp;🌿 ${net} kg
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  async checkLicenseAlert() {
    try {
      const banner = document.getElementById('dashLicenseWarnBanner');
      if (!banner) return;
      let status = {};
      try {
        status = await window.electronAPI.security.getLicenseStatus();
      } catch (e) {
        console.warn('[Dashboard] getLicenseStatus failed:', e);
      }
      const isActDb = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
      const expiryDateDb = await window.electronAPI.db.getSetting('expiry_date', '');
      const isActivated = Boolean(status?.isActivated || isActDb);
      const rawExp = status?.expiryDate || expiryDateDb || '';

      if (!isActivated) {
        banner.style.display = 'block';
        banner.style.background = '#e11d48';
        banner.innerHTML = `⚠️ <strong>Evaluation Mode:</strong> Leaf Ledger Pro is running in evaluation mode. Enter an active license key in Settings &rarr; Activation.`;
        return;
      }
      if (rawExp) {
        const s = String(rawExp).trim().toLowerCase();
        if (!s.includes('life')) {
          const exp = new Date(rawExp);
          if (!isNaN(exp.getTime())) {
            const days = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (days < 0) {
              banner.style.display = 'block';
              banner.style.background = '#dc2626';
              banner.innerHTML = `🚨 <strong>License Expired:</strong> Your software license expired on ${exp.toLocaleDateString('en-IN')}. Please renew to continue uninterrupted service.`;
              return;
            } else if (days <= 15) {
              banner.style.display = 'block';
              banner.style.background = '#d97706';
              banner.innerHTML = `⚠️ <strong>License Expiring Soon:</strong> Your software license expires on ${exp.toLocaleDateString('en-IN')} (${days} days remaining).`;
              return;
            }
          }
        }
      }
      banner.style.display = 'none';
    } catch (e) {
      console.warn('[Dashboard] License alert check failed:', e);
    }
  },

  load() {
    return this.refresh();
  }
};

window.dashboardModule = dashboardModule;
