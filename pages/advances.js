/**
 * Leaf Ledger Pro - Advances Management Module
 * Mirrors Python ui/advances.py logic and master/detail ledger
 */

const advancesModule = {
  currentFilter: 'All',
  cachedOwners: [],
  ownerBalances: new Map(),
  currentDetailOwnerId: null,
  editingId: null,

  async init() {
    await this.loadOwners();
    await this.refresh();

    // Keyboard shortcut: N = open modal
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('view-advances')?.classList.contains('active')) {
        if (e.key === 'n' || e.key === 'N') {
          const tag = document.activeElement?.tagName?.toLowerCase();
          if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            e.preventDefault();
            this.openNewEntryModal();
          }
        }
      }
    });

    // Enter key in notes = save
    document.getElementById('advNotesInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.saveAdvance(); }
    });
    document.getElementById('advAmountInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('advNotesInput')?.focus(); }
    });
  },

  async openNewEntryModal() {
    this.editingId = null;
    // Reset form
    const dateInput = document.getElementById('advDateInput');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const amtInput = document.getElementById('advAmountInput');
    if (amtInput) amtInput.value = '';
    const notesInput = document.getElementById('advNotesInput');
    if (notesInput) notesInput.value = '';
    const ownerSel = document.getElementById('advOwnerSelect');
    if (ownerSel) ownerSel.value = '';
    const modeSel = document.getElementById('advModeSelect');
    if (modeSel) modeSel.value = 'Cash';

    const title = document.getElementById('advModalTitle');
    if (title) title.innerText = 'Record New Advance';

    const saveBtn = document.getElementById('advSaveBtn');
    if (saveBtn) saveBtn.innerHTML = '💰 &nbsp;Record Advance';

    app.openModal('modalAdvanceEntry');
    setTimeout(() => document.getElementById('advOwnerSelect')?.focus(), 100);
  },

  async loadOwners() {
    try {
      const res = await window.electronAPI.db.query("SELECT * FROM owners WHERE is_active = 1 ORDER BY name ASC");
      this.cachedOwners = res?.data || [];

      const select = document.getElementById('advOwnerSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Select Garden Owner --</option>' +
          this.cachedOwners.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
      }
    } catch (e) {
      console.error('[AdvancesModule] Load owners error:', e);
    }
  },

  async refresh() {
    try {
      // 1. Calculate overall stats (scoped strictly to current active owners)
      const totalRes = await window.electronAPI.db.getOne(`
        SELECT COALESCE(SUM(a.amount), 0) as total 
        FROM advances a 
        INNER JOIN owners o ON a.owner_id = o.id 
        WHERE o.is_active = 1
      `);
      const recRes = await window.electronAPI.db.getOne(`
        SELECT COALESCE(SUM(m.advance_deducted), 0) as recovered 
        FROM monthly_payments m 
        INNER JOIN owners o ON m.owner_id = o.id 
        WHERE o.is_active = 1
      `);

      const totalAdv = totalRes?.data?.total || 0;
      const totalRec = recRes?.data?.recovered || 0;
      const pendingAdv = Math.max(0, totalAdv - totalRec);

      const sTotal = document.getElementById('advStatTotal');
      const sPending = document.getElementById('advStatPending');
      const sCleared = document.getElementById('advStatCleared');

      if (sTotal) sTotal.innerText = `Rs. ${Math.round(totalAdv).toLocaleString('en-IN')}`;
      if (sPending) sPending.innerText = `Rs. ${Math.round(pendingAdv).toLocaleString('en-IN')}`;
      if (sCleared) sCleared.innerText = `Rs. ${Math.round(totalRec).toLocaleString('en-IN')}`;

      // 2. Fetch owner-wise advance and recovery sums
      const advMapRes = await window.electronAPI.db.query("SELECT owner_id, COALESCE(SUM(amount), 0) as adv FROM advances GROUP BY owner_id");
      const recMapRes = await window.electronAPI.db.query("SELECT owner_id, COALESCE(SUM(advance_deducted), 0) as rec FROM monthly_payments GROUP BY owner_id");

      const advMap = new Map((advMapRes?.data || []).map(r => [r.owner_id, r.adv]));
      const recMap = new Map((recMapRes?.data || []).map(r => [r.owner_id, r.rec]));

      this.ownerBalances.clear();
      this.cachedOwners.forEach(o => {
        const a = advMap.get(o.id) || 0;
        const r = recMap.get(o.id) || 0;
        const bal = Math.max(0, a - r);
        this.ownerBalances.set(o.id, { totalAdv: a, recovered: r, balance: bal });
      });

      this.renderMasterList();

      if (this.currentDetailOwnerId) {
        this.showDetailView(this.currentDetailOwnerId);
      }
    } catch (e) {
      console.error('[AdvancesModule] Refresh error:', e);
    }
  },

  setFilter(filter, btn) {
    this.currentFilter = filter;
    document.querySelectorAll('.adv-filter-tab').forEach(b => {
      b.style.background = 'transparent';
      b.style.color = 'var(--text-secondary)';
    });
    if (btn) {
      btn.style.background = 'var(--accent-dark)';
      btn.style.color = '#ffffff';
    }
    this.renderMasterList();
  },

  filterMasterList() {
    this.renderMasterList();
  },

  renderMasterList() {
    const listEl = document.getElementById('advMasterScrollList');
    if (!listEl) return;

    const searchTerm = (document.getElementById('advancesSearchInput')?.value || '').toLowerCase().trim();

    let owners = this.cachedOwners.filter(o => {
      const nameMatch = (o.name || '').toLowerCase().includes(searchTerm);
      const bInfo = this.ownerBalances.get(o.id) || { balance: 0 };

      if (this.currentFilter === 'Pending') return nameMatch && bInfo.balance > 0;
      if (this.currentFilter === 'Cleared') return nameMatch && bInfo.balance === 0;
      return nameMatch;
    });

    if (owners.length === 0) {
      listEl.innerHTML = app.getEmptyStateHtml({
        title: 'No Planters Found',
        message: 'No owner ledger entries match this criteria.'
      });
      return;
    }

    const AVATAR_COLORS = ["#4A90E2", "#50E3C2", "#B8E986", "#F5A623", "#D0021B", "#BD10E0", "#9013FE"];

    listEl.innerHTML = owners.map((o, idx) => {
      const initials = (o.name || 'G').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
      const bInfo = this.ownerBalances.get(o.id) || { balance: 0 };
      const balStr = bInfo.balance > 0 ? `Outstanding: Rs.${Math.round(bInfo.balance).toLocaleString('en-IN')}` : 'Cleared (Rs.0)';
      const balColor = bInfo.balance > 0 ? '#ff9800' : '#4caf50';

      return `
        <div style="background: var(--bg-input); border-radius: 12px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border-subtle);">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: ${color}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px;">
              ${initials}
            </div>
            <div>
              <div style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${o.name}</div>
              <div style="font-size: 12px; font-weight: 600; color: ${balColor};">${balStr}</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-primary btn-sm" style="font-size: 12px; font-weight: 700;" onclick="advancesModule.openNewEntryModalForOwner('${o.id}')">
              ＋ Advance
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="background: var(--accent-dark); color: #ffffff; font-size: 12px; font-weight: 700;" onclick="advancesModule.showDetailView('${o.id}')">
              📂 Ledger
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  openNewEntryModalForOwner(ownerId) {
    this.openNewEntryModal();
    setTimeout(() => {
      const sel = document.getElementById('advOwnerSelect');
      if (sel) sel.value = ownerId;
    }, 120);
  },

  async showDetailView(ownerId) {
    this.currentDetailOwnerId = ownerId;
    const owner = this.cachedOwners.find(o => o.id === ownerId);
    if (!owner) return;

    const masterView = document.getElementById('advMasterView');
    const detailView = document.getElementById('advDetailView');
    const titleEl = document.getElementById('advDetailOwnerTitle');
    const badgeEl = document.getElementById('advDetailOutstandingBadge');
    const tbody = document.getElementById('advDetailTableBody');

    if (masterView) masterView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    if (titleEl) titleEl.innerText = `Ledger: ${owner.name}`;

    const bInfo = this.ownerBalances.get(ownerId) || { balance: 0 };
    if (badgeEl) {
      badgeEl.innerText = `Outstanding: Rs. ${bInfo.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      badgeEl.style.color = bInfo.balance > 0 ? '#ff9800' : '#4caf50';
    }

    try {
      const advRows = await window.electronAPI.db.query(
        "SELECT id, date, amount, payment_mode, notes, 'GIVEN' as type FROM advances WHERE owner_id = ? ORDER BY date DESC",
        [ownerId]
      );

      const recRows = await window.electronAPI.db.query(
        "SELECT id, payment_date as date, advance_deducted as amount, payment_mode, notes, 'RECOVERED' as type FROM monthly_payments WHERE owner_id = ? AND advance_deducted > 0 ORDER BY payment_date DESC",
        [ownerId]
      );

      const combined = [...(advRows?.data || []), ...(recRows?.data || [])];
      combined.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      if (!tbody) return;

      if (combined.length === 0) {
        tbody.innerHTML = app.getEmptyStateTableRow(5, {
          title: 'No Advance Records',
          message: 'No advance transactions recorded for this owner.'
        });
        return;
      }

      tbody.innerHTML = combined.map(r => {
        const isRec = r.type === 'RECOVERED';
        const typeColor = isRec ? '#4caf50' : '#ff9800';
        const amtColor = isRec ? '#4caf50' : '#f44336';
        const amtPrefix = isRec ? '-' : '+';

        return `
          <tr>
            <td class="mono">${r.date || '—'}</td>
            <td style="color: ${typeColor}; font-weight: 700;">${r.type}</td>
            <td class="mono" style="color: ${amtColor}; font-weight: 700;">${amtPrefix}Rs. ${Math.round(r.amount).toLocaleString('en-IN')}</td>
            <td>${r.payment_mode || 'Cash'} ${r.notes ? `• ${r.notes}` : ''}</td>
            <td style="text-align: right;">
              ${!isRec ? `
                <button type="button" class="btn btn-danger btn-sm" style="padding: 2px 8px; font-size: 11px;" onclick="advancesModule.deleteAdvance('${r.id}')">✕</button>
              ` : '—'}
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error('[AdvancesModule] Detail ledger error:', e);
    }
  },

  showMasterView() {
    this.currentDetailOwnerId = null;
    const masterView = document.getElementById('advMasterView');
    const detailView = document.getElementById('advDetailView');
    if (masterView) masterView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
  },

  async saveAdvance() {
    // Strict license check
    const isAct = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
    if (!isAct) {
      app.showToast('Active license required to issue planter advances.', 'error');
      return;
    }

    const ownerId = document.getElementById('advOwnerSelect')?.value;
    const amount = parseFloat(document.getElementById('advAmountInput')?.value);
    const date = document.getElementById('advDateInput')?.value || new Date().toISOString().split('T')[0];
    const mode = document.getElementById('advModeSelect')?.value || 'Cash';
    const notes = document.getElementById('advNotesInput')?.value.trim() || '';

    if (!ownerId) {
      app.showToast('Please select a garden owner.', 'warning');
      return;
    }

    if (!amount || amount <= 0) {
      app.showToast('Please enter a valid advance amount.', 'warning');
      document.getElementById('advAmountInput')?.focus();
      return;
    }

    const btn = document.getElementById('advSaveBtn');
    if (btn) btn.disabled = true;

    try {
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('adv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
      const sid = app.getSessionIdForDate(date);
      await window.electronAPI.db.run(`
        INSERT INTO advances (id, app_user_id, owner_id, session_id, amount, date, payment_mode, notes, sync_id, sync_status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      `, [id, currentUid, ownerId, sid, amount, date, mode, notes, id]);

      app.closeModal('modalAdvanceEntry');
      app.showToast(`Advance of Rs. ${amount} recorded!`, 'success');
      await this.refresh();
      window.electronAPI.sync.smartSync('advances');
    } catch (e) {
      console.error('[AdvancesModule] Save advance error:', e);
      app.showToast(`Error saving advance: ${e.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async deleteAdvance(id) {
    if (!confirm('Are you sure you want to remove this advance entry?')) return;

    try {
      const row = await window.electronAPI.db.getOne("SELECT sync_id, cloud_id FROM advances WHERE id = ?", [id]);
      const syncId = row?.sync_id || row?.cloud_id || id;
      await window.electronAPI.db.run("INSERT OR REPLACE INTO deleted_tombstones (sync_id, table_name) VALUES (?, 'advances')", [syncId]);
      await window.electronAPI.db.run("DELETE FROM advances WHERE id = ?", [id]);
      app.showToast('Advance entry removed.', 'info');
      await this.refresh();
      window.electronAPI.sync.smartSync('advances');
    } catch (e) {
      console.error('[AdvancesModule] Delete advance error:', e);
      app.showToast(`Error deleting advance: ${e.message}`, 'error');
    }
  },

  cancelEdit() {
    this.editingId = null;
    app.closeModal('modalAdvanceEntry');
  },

  load() {
    return this.refresh();
  }
};

window.advancesModule = advancesModule;
