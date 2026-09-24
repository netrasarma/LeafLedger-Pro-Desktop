/**
 * Leaf Ledger Pro - Garden Owners Management Module
 * Mirrors Python ui/owners.py logic, dialogs, and balance calculations
 */

const ownersModule = {
  ownersList: [],
  editingId: null,
  statusFilter: 'all', // 'all', 'active', 'disabled'

  async init() {
    await this.loadOwners();

    const phoneInput = document.getElementById('ownerPhoneInput');
    if (phoneInput) {
      phoneInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
      });
    }

    const pinInput = document.getElementById('ownerPinInput');
    if (pinInput) {
      pinInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      });
    }
  },

  async loadOwners() {
    const container = document.getElementById('ownersListContainer');
    if (container) container.innerHTML = app.getLoadingStateHtml('Loading garden owners...');

    try {
      // 1. Fetch all owners (both active and disabled)
      const ownersRes = await window.electronAPI.db.query(
        "SELECT * FROM owners ORDER BY is_active DESC, name ASC"
      );
      const owners = Array.isArray(ownersRes) ? ownersRes : (ownersRes?.data || []);

      // 2. Fetch advance balances for all owners
      const advTotalRes = await window.electronAPI.db.query(
        "SELECT owner_id, COALESCE(SUM(amount), 0) as total_adv FROM advances GROUP BY owner_id"
      );
      const advRecRes = await window.electronAPI.db.query(
        "SELECT owner_id, COALESCE(SUM(advance_deducted), 0) as total_rec FROM monthly_payments GROUP BY owner_id"
      );

      const totalMap = new Map((Array.isArray(advTotalRes) ? advTotalRes : (advTotalRes?.data || [])).map(r => [r.owner_id, r.total_adv]));
      const recMap = new Map((Array.isArray(advRecRes) ? advRecRes : (advRecRes?.data || [])).map(r => [r.owner_id, r.total_rec]));

      this.ownersList = owners.map(o => {
        const adv = totalMap.get(o.id) || 0;
        const rec = recMap.get(o.id) || 0;
        const balance = Math.max(0, adv - rec);
        return { ...o, advance_balance: balance };
      });

      // Update filter counts
      const activeCount = this.ownersList.filter(o => o.is_active === 1 || o.is_active === '1').length;
      const disabledCount = this.ownersList.length - activeCount;
      
      const elAll = document.getElementById('cntAll');
      if (elAll) elAll.innerText = String(this.ownersList.length);
      const elAct = document.getElementById('cntActive');
      if (elAct) elAct.innerText = String(activeCount);
      const elDis = document.getElementById('cntDisabled');
      if (elDis) elDis.innerText = String(disabledCount);

      this.filterOwners();
    } catch (e) {
      console.error('[OwnersModule] Load owners error:', e);
      if (container) container.innerHTML = `<div style="text-align: center; color: var(--accent-red); padding: 30px;">Error loading owners: ${e.message}</div>`;
    }
  },

  setStatusFilter(filter) {
    this.statusFilter = filter;
    
    // Update button styles
    ['tabFilterAll', 'tabFilterActive', 'tabFilterDisabled'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const isActive = (id === 'tabFilterAll' && filter === 'all') ||
                       (id === 'tabFilterActive' && filter === 'active') ||
                       (id === 'tabFilterDisabled' && filter === 'disabled');
      btn.style.background = isActive ? 'var(--bg-card)' : 'transparent';
      btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      btn.style.boxShadow = isActive ? '0 1px 2px rgba(0,0,0,0.06)' : 'none';
    });

    this.filterOwners();
  },

  filterOwners() {
    const term = (document.getElementById('ownerSearchInput')?.value || '').toLowerCase().trim();
    
    let filtered = this.ownersList;

    // Apply status filter
    if (this.statusFilter === 'active') {
      filtered = filtered.filter(o => o.is_active === 1 || o.is_active === '1');
    } else if (this.statusFilter === 'disabled') {
      filtered = filtered.filter(o => o.is_active === 0 || o.is_active === '0');
    }

    // Apply search filter
    if (term) {
      filtered = filtered.filter(o => 
        (o.name || '').toLowerCase().includes(term) ||
        (o.phone || '').includes(term) ||
        (o.address || '').toLowerCase().includes(term)
      );
    }

    this.renderOwners(filtered);
  },

  renderOwners(list) {
    const container = document.getElementById('ownersListContainer');
    const countLbl = document.getElementById('ownersCountLabel');

    if (countLbl) {
      const activeTotal = this.ownersList.filter(o => o.is_active === 1 || o.is_active === '1').length;
      countLbl.innerText = `${activeTotal} active · ${this.ownersList.length} total`;
    }

    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = app.getEmptyStateHtml({
        title: 'No Planters Found',
        message: 'No registered garden owners match your filter or search query.'
      });
      return;
    }

    const AVATAR_COLORS = ["#4A90E2", "#50E3C2", "#B8E986", "#F5A623", "#D0021B", "#BD10E0", "#9013FE"];

    container.innerHTML = list.map((o, idx) => {
      const initials = (o.name || 'G').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
      const bal = o.advance_balance || 0;
      const balColor = bal > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
      const balBg = bal > 0 ? 'var(--accent-amber-dim)' : 'var(--accent-emerald-dim)';
      const balBorder = bal > 0 ? 'rgba(217, 119, 6, 0.25)' : 'rgba(22, 163, 74, 0.25)';
      const agrDate = o.agreement_date || '—';
      const isActive = (o.is_active === 1 || o.is_active === '1');
      const safeName = (o.name || '').replace(/'/g, "\\'");

      return `
        <div style="background: var(--bg-card); border-radius: 10px; padding: 12px 18px; border: 1px solid var(--border-subtle); display: grid; grid-template-columns: 2fr 1.3fr 1.6fr 1.2fr 1.2fr 1fr 1.6fr; gap: 10px; align-items: center; font-size: 13px; opacity: ${isActive ? '1' : '0.72'};">
          
          <!-- Owner & Avatar -->
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${isActive ? color : '#94a3b8'}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex-shrink: 0;">
              ${initials}
            </div>
            <div>
              <div style="font-weight: 700; color: var(--text-primary);">${o.name}</div>
              ${!isActive ? '<div style="font-size: 10.5px; color: #d97706; font-weight: 600;">Hidden from Dropdowns</div>' : ''}
            </div>
          </div>

          <!-- Phone -->
          <div class="mono" style="color: var(--text-secondary);">${o.phone || '—'}</div>

          <!-- Address -->
          <div style="color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${o.address || o.village || '—'}</div>

          <!-- Agreement -->
          <div class="mono" style="color: var(--text-muted); font-size: 12px;">${agrDate}</div>

          <!-- Adv Balance Chip -->
          <div>
            <span style="display: inline-block; padding: 3px 10px; border-radius: 6px; background: ${balBg}; color: ${balColor}; border: 1px solid ${balBorder}; font-weight: 700; font-family: var(--font-mono); font-size: 12px;">
              ₹${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>

          <!-- Status Badge -->
          <div>
            ${isActive 
              ? '<span class="badge badge-success" style="font-size: 11px; padding: 2px 8px;">Active</span>' 
              : '<span style="display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3);">Disabled</span>'}
          </div>

          <!-- Actions: View, Edit, Disable/Enable (NO DELETE) -->
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; color: var(--accent-emerald);" onclick="ownersModule.openViewDialog('${o.id}')" title="View Ledger & Receipts">View</button>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; color: var(--accent-blue);" onclick="ownersModule.openEditDialog('${o.id}')" title="Edit Profile Details">Edit</button>
            ${isActive 
              ? `<button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; color: #d97706; border-color: rgba(217, 119, 6, 0.3);" onclick="ownersModule.toggleStatus('${o.id}', '${safeName}', 1)" title="Disable planter from dropdowns">Disable</button>`
              : `<button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px; color: var(--accent-emerald); border-color: rgba(16, 185, 129, 0.3);" onclick="ownersModule.toggleStatus('${o.id}', '${safeName}', 0)" title="Re-enable planter in dropdowns">Enable</button>`}
          </div>

        </div>
      `;
    }).join('');
  },

  openAddDialog() {
    this.editingId = null;
    const title = document.getElementById('modalOwnerTitle');
    if (title) title.innerText = 'Add New Garden Owner';

    document.getElementById('ownerNameInput').value = '';
    document.getElementById('ownerPhoneInput').value = '';
    document.getElementById('ownerAddressInput').value = '';
    document.getElementById('ownerAgreementInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('ownerPinInput').value = '';
    document.getElementById('ownerBankNameInput').value = '';
    document.getElementById('ownerBankAccInput').value = '';
    document.getElementById('ownerBankHolderInput').value = '';
    document.getElementById('ownerBankIfscInput').value = '';
    document.getElementById('ownerNotesInput').value = '';

    app.openModal('modalAddOwner');
  },

  openEditDialog(id) {
    const owner = this.ownersList.find(o => o.id === id);
    if (!owner) return;

    this.editingId = id;
    const title = document.getElementById('modalOwnerTitle');
    if (title) title.innerText = `Edit Owner — ${owner.name}`;

    document.getElementById('ownerNameInput').value = owner.name || '';
    document.getElementById('ownerPhoneInput').value = owner.phone || '';
    document.getElementById('ownerAddressInput').value = owner.address || owner.village || '';
    document.getElementById('ownerAgreementInput').value = owner.agreement_date || '';
    document.getElementById('ownerPinInput').value = owner.portal_pin || '';
    document.getElementById('ownerBankNameInput').value = owner.bank_name || '';
    document.getElementById('ownerBankAccInput').value = owner.bank_acc || '';
    document.getElementById('ownerBankHolderInput').value = owner.account_holder_name || '';
    document.getElementById('ownerBankIfscInput').value = owner.bank_ifsc || '';
    document.getElementById('ownerNotesInput').value = owner.notes || '';

    app.openModal('modalAddOwner');
  },

  async saveOwner() {
    // Strict commercial license verification
    const isAct = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
    if (!isAct) {
      app.showToast('Active license key required to register or edit garden owners.', 'error');
      return;
    }

    const name = document.getElementById('ownerNameInput')?.value.trim();
    const phone = document.getElementById('ownerPhoneInput')?.value.trim().replace(/\D/g, '').slice(0, 10);
    const address = document.getElementById('ownerAddressInput')?.value.trim();
    const agreement = document.getElementById('ownerAgreementInput')?.value;
    const pin = document.getElementById('ownerPinInput')?.value.trim();
    const bankName = document.getElementById('ownerBankNameInput')?.value.trim();
    const bankAcc = document.getElementById('ownerBankAccInput')?.value.trim();
    const bankHolder = document.getElementById('ownerBankHolderInput')?.value.trim();
    const bankIfsc = document.getElementById('ownerBankIfscInput')?.value.trim();
    const notes = document.getElementById('ownerNotesInput')?.value.trim();

    if (!name) {
      app.showToast('Please enter the owner full name.', 'warning');
      document.getElementById('ownerNameInput')?.focus();
      return;
    }

    if (!phone || phone.length !== 10) {
      app.showToast('Please enter a valid 10-digit mobile number.', 'warning');
      document.getElementById('ownerPhoneInput')?.focus();
      return;
    }

    try {
      if (this.editingId) {
        await window.electronAPI.db.run(`
          UPDATE owners 
          SET name = ?, phone = ?, address = ?, agreement_date = ?, portal_pin = ?,
              bank_name = ?, bank_acc = ?, account_holder_name = ?, bank_ifsc = ?, notes = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [name, phone, address, agreement, pin, bankName, bankAcc, bankHolder, bankIfsc, notes, this.editingId]);

        app.showToast('Garden owner updated successfully!', 'success');
      } else {
        const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('own_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
        const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
        await window.electronAPI.db.run(`
          INSERT INTO owners (id, app_user_id, name, phone, address, agreement_date, portal_pin, bank_name, bank_acc, account_holder_name, bank_ifsc, notes, is_active, sync_id, sync_status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, CURRENT_TIMESTAMP)
        `, [id, currentUid, name, phone, address, agreement, pin, bankName, bankAcc, bankHolder, bankIfsc, notes, id]);

        app.showToast('New garden owner registered!', 'success');
      }

      app.closeModal('modalAddOwner');
      await this.loadOwners();

      // Refresh intake & advance dropdowns across the application
      if (window.app?.loadPlanters) {
        await window.app.loadPlanters();
      }

      window.electronAPI.sync.smartSync('owners');
    } catch (e) {
      console.error('[OwnersModule] Save owner error:', e);
      app.showToast(`Error saving owner: ${e.message}`, 'error');
    }
  },

  async toggleStatus(id, name, currentActive) {
    const isAct = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
    if (!isAct) {
      app.showToast('Active license required to modify garden owner status.', 'error');
      return;
    }

    const newStatus = currentActive ? 0 : 1;
    const actionText = currentActive ? 'disabled' : 'enabled';
    const confirmMsg = currentActive
      ? `Disable ${name}?\n\n• They will be hidden from Daily Leaf Intake & Advance dropdowns.\n• All existing leaf receipts and advance history are safely preserved.\n• You can re-enable them anytime from the Disabled tab.`
      : `Re-enable ${name}?\n\n• They will reappear in Daily Leaf Intake & Advance dropdowns.`;

    if (!confirm(confirmMsg)) return;

    try {
      await window.electronAPI.db.run(
        "UPDATE owners SET is_active = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", 
        [newStatus, id]
      );
      app.showToast(`Owner ${name} ${actionText} successfully.`, 'info');
      await this.loadOwners();

      // Refresh in-memory planters cache for intake & advance dropdowns
      if (window.app?.loadPlanters) {
        await window.app.loadPlanters();
      }

      // Sync status to cloud immediately so it never reverts
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('owners');
      }
    } catch (e) {
      console.error('[OwnersModule] Toggle status error:', e);
      app.showToast(`Error: ${e.message}`, 'error');
    }
  },

  async openViewDialog(id) {
    const owner = this.ownersList.find(o => o.id === id);
    if (!owner) return;

    const initials = (owner.name || 'G').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const bal = owner.advance_balance || 0;

    const av = document.getElementById('viewOwnerAvatar');
    const nameEl = document.getElementById('viewOwnerName');
    const phoneEl = document.getElementById('viewOwnerPhone');
    const editBtn = document.getElementById('viewOwnerEditBtn');
    const detailsEl = document.getElementById('viewOwnerDetails');
    const chipEl = document.getElementById('viewOwnerBalanceChip');
    const noteEl = document.getElementById('viewOwnerBalanceNote');

    if (av) av.innerText = initials;
    if (nameEl) nameEl.innerText = owner.name;
    if (phoneEl) phoneEl.innerText = `📞 +91 ${owner.phone || 'No phone'}`;
    if (editBtn) editBtn.onclick = () => { app.closeModal('modalViewOwner'); ownersModule.openEditDialog(id); };

    if (detailsEl) {
      detailsEl.innerHTML = `
        <div><b>📍 Address:</b> ${owner.address || owner.village || '—'}</div>
        <div><b>📅 Agreement:</b> ${owner.agreement_date || '—'}</div>
        <div><b>🔐 Portal PIN:</b> ${owner.portal_pin || '—'}</div>
        <div><b>📝 Notes:</b> ${owner.notes || '—'}</div>
        <hr style="border: none; border-top: 1px solid var(--border-subtle); margin: 8px 0;">
        <div><b>🏦 Bank:</b> ${owner.bank_name || '—'}</div>
        <div><b>A/c Name:</b> ${owner.account_holder_name || '—'}</div>
        <div><b>A/c No:</b> ${owner.bank_acc || '—'}</div>
        <div><b>IFSC:</b> ${owner.bank_ifsc || '—'}</div>
      `;
    }

    if (chipEl) {
      chipEl.innerText = `₹${bal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      chipEl.style.background = bal > 0 ? 'var(--accent-amber-dim)' : 'var(--accent-emerald-dim)';
      chipEl.style.color = bal > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
      chipEl.style.border = bal > 0 ? '1px solid rgba(217, 119, 6, 0.25)' : '1px solid rgba(22, 163, 74, 0.25)';
    }

    if (noteEl) {
      noteEl.innerText = bal > 0 ? 'Outstanding advance balance' : '✔ No outstanding advance';
    }

    // Load Advances and Monthly Collections history for this owner
    try {
      const advHistRes = await window.electronAPI.db.query(
        "SELECT * FROM advances WHERE owner_id = ? ORDER BY date DESC LIMIT 6",
        [id]
      );
      const advHistoryEl = document.getElementById('viewOwnerAdvanceHistory');
      if (advHistoryEl) {
        const rows = advHistRes?.data || [];
        if (rows.length === 0) {
          advHistoryEl.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">No advance history recorded.</div>';
        } else {
          advHistoryEl.innerHTML = rows.map(r => `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">
              <div>
                <span class="mono">${r.date}</span>
                <span style="color: var(--text-muted); margin-left: 10px;">${r.payment_mode || 'Cash'} ${r.notes ? `• ${r.notes}` : ''}</span>
              </div>
              <div class="mono" style="font-weight: 700; color: #ef4444;">₹${Math.round(r.amount).toLocaleString('en-IN')}</div>
            </div>
          `).join('');
        }
      }

      // Load Monthly Collections History
      const collHistRes = await window.electronAPI.db.query(`
        SELECT strftime('%Y-%m', date) as period, SUM(gross_weight_kg) as gross, SUM(net_weight_kg) as net, SUM(amount) as amt
        FROM daily_collections
        WHERE owner_id = ?
        GROUP BY period
        ORDER BY period DESC
        LIMIT 6
      `, [id]);

      const collHistoryEl = document.getElementById('viewOwnerCollectionHistory');
      if (collHistoryEl) {
        const crows = collHistRes?.data || [];
        if (crows.length === 0) {
          collHistoryEl.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">No collection history for this owner.</div>';
        } else {
          collHistoryEl.innerHTML = crows.map(c => `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">
              <div style="font-weight: 700; color: var(--text-primary);">${c.period}</div>
              <div class="mono" style="color: var(--text-secondary);">Gross: ${Math.round(c.gross)}kg</div>
              <div class="mono" style="color: var(--accent-emerald);">Net: ${Math.round(c.net)}kg</div>
              <div class="mono" style="font-weight: 700; color: var(--accent-amber);">₹${Math.round(c.amt).toLocaleString('en-IN')}</div>
            </div>
          `).join('');
        }
      }

    } catch (e) {
      console.error('[OwnersModule] History load error:', e);
    }

    app.openModal('modalViewOwner');
  },

  load() {
    return this.loadOwners();
  },

  refresh() {
    return this.loadOwners();
  }
};

window.ownersModule = ownersModule;
