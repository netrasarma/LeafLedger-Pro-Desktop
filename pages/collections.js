/**
 * Leaf Ledger Pro - Daily Leaf Collection Module
 * Mirrors Python ui/collections.py logic, calculations, and cards
 */

const collectionsModule = {
  currentDate: new Date().toISOString().split('T')[0],
  editingId: null,
  cachedOwners: [],
  cachedCollections: [],
  defaultRate: 0,

  async init() {
    const dateInput = document.getElementById('collDateInput');
    if (dateInput) dateInput.value = this.currentDate;

    // Keyboard shortcuts: 'N' to open modal, Enter to save anywhere within modal
    if (!this._hasKeyboardListeners) {
      this._hasKeyboardListeners = true;
      window.addEventListener('keydown', (e) => {
        const modal = document.getElementById('modalCollectionEntry');
        const isModalOpen = modal && modal.classList.contains('active');

        if (!isModalOpen && (e.key === 'n' || e.key === 'N')) {
          const tag = document.activeElement?.tagName?.toLowerCase();
          if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            e.preventDefault();
            this.openNewEntryModal();
          }
        } else if (isModalOpen && e.key === 'Enter') {
          const tag = document.activeElement?.tagName?.toLowerCase();
          if (tag !== 'textarea') {
            e.preventDefault();
            this.saveEntry();
          }
        }
      });
    }

    await this.loadOwners();
    await this.loadCollectors();
    await this.loadDayList();
  },

  async loadOwners() {
    try {
      const res = await window.electronAPI.db.query(
        "SELECT * FROM owners WHERE is_active = 1 ORDER BY name ASC"
      );
      this.cachedOwners = res?.data || [];

      const select = document.getElementById('collOwnerSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Select Garden Owner --</option>' +
          this.cachedOwners.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
      }
    } catch (e) {
      console.error('[CollectionsModule] Load owners error:', e);
    }
  },

  async loadCollectors() {
    try {
      const res = await window.electronAPI.db.query("SELECT DISTINCT collector_name FROM daily_collections WHERE collector_name IS NOT NULL");
      const collectors = new Set(['Agent-Computer']);
      if (res?.data) {
        res.data.forEach(r => { if (r.collector_name) collectors.add(r.collector_name); });
      }

      const staffSelect = document.getElementById('collStaffSelect');
      const filterSelect = document.getElementById('collCollectorFilter');

      if (staffSelect) {
        staffSelect.innerHTML = Array.from(collectors).map(c => `<option value="${c}">${c}</option>`).join('');
      }

      if (filterSelect) {
        filterSelect.innerHTML = '<option value="ALL">All Collectors</option>' +
          Array.from(collectors).map(c => `<option value="${c}">${c}</option>`).join('');
      }
    } catch (e) {
      console.error('[CollectionsModule] Load collectors error:', e);
    }
  },

  prevDay() {
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() - 1);
    this.currentDate = d.toISOString().split('T')[0];
    const dateInput = document.getElementById('collDateInput');
    if (dateInput) dateInput.value = this.currentDate;
    this.loadDayList();
  },

  nextDay() {
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() + 1);
    this.currentDate = d.toISOString().split('T')[0];
    const dateInput = document.getElementById('collDateInput');
    if (dateInput) dateInput.value = this.currentDate;
    this.loadDayList();
  },

  onOwnerChange() {
    const ownerId = document.getElementById('collOwnerSelect')?.value;
    const owner = this.cachedOwners.find(o => o.id === ownerId);
    const infoLbl = document.getElementById('collOwnerInfoLabel');

    if (owner) {
      const phone = owner.phone || 'No mobile';
      const addr = owner.address || owner.village || 'No address';
      if (infoLbl) infoLbl.innerText = `📍 ${addr}  •  📞 ${phone}`;

      const dedInput = document.getElementById('collDeducInput');
      if (dedInput && !this.editingId) {
        dedInput.value = owner.default_deduction_pct || 0;
      }

      const rateInput = document.getElementById('collRateInput');
      if (rateInput && !this.editingId) {
        rateInput.value = this.defaultRate;
      }

      this.loadOwnerRecentHistory(ownerId);
    } else {
      if (infoLbl) infoLbl.innerText = '';
      const histBody = document.getElementById('collOwnerHistoryBody');
      if (histBody) histBody.innerText = 'Select an owner to view recent collections.';
    }

    this.updateCalc();
  },

  updateCalc() {
    const gross = parseFloat(document.getElementById('collGrossInput')?.value) || 0;
    const ded = parseFloat(document.getElementById('collDeducInput')?.value) || 0;
    const rate = parseFloat(document.getElementById('collRateInput')?.value) || 0;

    const net = Math.max(0, Math.round(gross * (1 - ded / 100)));
    const total = Math.round(net * rate);

    const netLbl = document.getElementById('collCalcNetLabel');
    const amtLbl = document.getElementById('collCalcAmountLabel');
    const sumBadge = document.getElementById('collModalSummaryBadge');
    const sumNet = document.getElementById('collModalSummaryNet');
    const sumAmt = document.getElementById('collModalSummaryAmt');

    if (netLbl) netLbl.innerText = `Net: ${net} kg`;
    if (amtLbl) amtLbl.innerText = `Total: Rs. ${total.toLocaleString('en-IN')}`;
    if (sumBadge) sumBadge.innerText = `${net} kg • ₹${total.toLocaleString('en-IN')}`;
    if (sumNet) sumNet.innerText = `${net} KG`;
    if (sumAmt) sumAmt.innerText = `₹${total.toLocaleString('en-IN')}`;
  },

  toggleDeductionChip(btn) {
    if (btn) btn.classList.toggle('active');
  },

  async openNewEntryModal() {
    this.editingId = null;
    const title = document.getElementById('collModalTitle');
    const saveBtn = document.getElementById('collSaveBtn');
    if (title) title.innerText = 'Add Collection Entry';
    if (saveBtn) saveBtn.innerHTML = '💾 Save Entry';

    this.clearForm();
    const modalDateIn = document.getElementById('collModalDateInput');
    if (modalDateIn) {
      modalDateIn.value = this.currentDate || new Date().toISOString().split('T')[0];
    }

    document.querySelectorAll('#collDeductionChips .leaf-chip').forEach(c => c.classList.remove('active'));

    app.openModal('modalCollectionEntry');

    setTimeout(() => {
      const ownerSel = document.getElementById('collOwnerSelect');
      if (ownerSel) ownerSel.focus();
    }, 150);
  },

  closeEntryModal() {
    this.editingId = null;
    app.closeModal('modalCollectionEntry');
  },

  async loadDayList() {
    const dateInput = document.getElementById('collDateInput');
    if (dateInput && dateInput.value) {
      this.currentDate = dateInput.value;
    }

    const tbody = document.getElementById('collTableBody');
    if (tbody) tbody.innerHTML = app.getLoadingStateTableRow(10, 'Loading leaf collections...');

    try {
      const collsRes = await window.electronAPI.db.query(`
        SELECT dc.*, o.name as owner_name, o.phone as owner_phone
        FROM daily_collections dc
        JOIN owners o ON dc.owner_id = o.id
        WHERE dc.date = ?
        ORDER BY dc.created_at DESC
      `, [this.currentDate]);

      this.cachedCollections = collsRes?.data || [];

      // Update Stat Cards
      let gross = 0, net = 0, payout = 0;
      this.cachedCollections.forEach(c => {
        gross += (c.gross_weight_kg || 0);
        net += (c.net_weight_kg || 0);
        payout += (c.amount || 0);
      });

      const sGross = document.getElementById('collStatGross');
      const sNet = document.getElementById('collStatNet');
      const sPayout = document.getElementById('collStatPayout');
      const sFactory = document.getElementById('collStatFactory');

      if (sGross) sGross.innerText = `${Math.round(gross)} kg`;
      if (sNet) sNet.innerText = `${Math.round(net)} kg`;
      if (sPayout) sPayout.innerText = `Rs. ${Math.round(payout).toLocaleString('en-IN')}`;

      // Factory weight on this date
      const factRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(net_weight_kg), 0) as total_factory FROM factory_collections WHERE date = ?",
        [this.currentDate]
      );
      const factNet = Math.round(factRes?.data?.total_factory || 0);
      if (sFactory) sFactory.innerText = factNet > 0 ? `${factNet} kg` : '— kg';

      this.applyFilter();
    } catch (e) {
      console.error('[CollectionsModule] Load day list error:', e);
    }
  },

  applyFilter() {
    const filter = document.getElementById('collCollectorFilter')?.value || 'ALL';
    const search = (document.getElementById('collSearchInput')?.value || '').trim().toLowerCase();
    const tbody = document.getElementById('collTableBody');
    const badge = document.getElementById('collCountBadge');
    if (!tbody) return;

    let filtered = this.cachedCollections;
    if (filter !== 'ALL') {
      filtered = filtered.filter(c => c.collector_name === filter);
    }
    if (search) {
      filtered = filtered.filter(c => {
        const name = (c.owner_name || '').toLowerCase();
        const phone = (c.owner_phone || '').toLowerCase();
        const staff = (c.collector_name || '').toLowerCase();
        return name.includes(search) || phone.includes(search) || staff.includes(search);
      });
    }

    if (badge) badge.innerText = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`;

    if (filtered.length === 0) {
      tbody.innerHTML = app.getEmptyStateTableRow(10, {
        title: 'No Leaf Collections Recorded',
        message: 'No collection entries match your date or staff filter selection.'
      });
      return;
    }

    const AVATAR_COLORS = ["#4A90E2", "#50E3C2", "#B8E986", "#F5A623", "#D0021B", "#BD10E0", "#9013FE"];

    tbody.innerHTML = filtered.map((row, idx) => {
      const name = row.owner_name || 'Grower';
      const phone = row.owner_phone || '';
      const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const avColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
      const timeStr = row.created_at ? new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
      const gross = Math.round(row.gross_weight_kg || 0);
      const ded = Math.round(row.bag_weight_kg || 0);
      const net = Math.round(row.net_weight_kg || 0);
      const rate = row.rate_per_kg || 0;
      const amount = Math.round(row.amount || 0);
      const staff = row.collector_name || 'Agent-Computer';
      
      // Parse deductions from notes (Wet leaves, Long Leaves, Hard Leaves)
      let dedBadges = '';
      const rowNotes = row.notes || '';
      const detectedDeductions = [];

      if (rowNotes.includes('Deductions: [')) {
        const dedContent = rowNotes.split('Deductions: [')[1].split(']')[0];
        dedContent.split(', ').forEach(t => {
          const clean = t.trim();
          if (clean && !detectedDeductions.includes(clean)) {
            detectedDeductions.push(clean);
          }
        });
      } else if (rowNotes) {
        const lower = rowNotes.toLowerCase();
        if (lower.includes('wet') && !detectedDeductions.some(d => d.toLowerCase().includes('wet'))) {
          detectedDeductions.push('Wet leaves');
        }
        if (lower.includes('hard') && !detectedDeductions.some(d => d.toLowerCase().includes('hard'))) {
          detectedDeductions.push('Hard Leaves');
        }
        if (lower.includes('long') && !detectedDeductions.some(d => d.toLowerCase().includes('long'))) {
          detectedDeductions.push('Long Leaves');
        }
      }

      if (detectedDeductions.length > 0) {
        dedBadges = detectedDeductions.map(t => {
          const tClean = t.trim();
          let cls = 'long';
          let icon = '<i class="fa-solid fa-leaf"></i>';
          if (tClean.toLowerCase().includes('wet')) {
            cls = 'wet';
            icon = '<i class="fa-solid fa-droplet"></i>';
          } else if (tClean.toLowerCase().includes('hard')) {
            cls = 'hard';
            icon = '<i class="fa-solid fa-shield-halved"></i>';
          }
          return `<span class="deduction-pill ${cls}" style="font-size: 10px; padding: 2px 7px;">${icon} ${tClean}</span>`;
        }).join(' ');
      }

      return `
        <tr>
          <td class="mono" style="color: var(--text-muted); font-size: 12px;">${timeStr}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 50%; background: ${avColor}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0;">
                ${initials}
              </div>
              <div>
                <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${name}</div>
                ${phone ? `<div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top: 1px;">${phone}</div>` : ''}
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
              ${dedBadges || '<span style="color: var(--text-muted); font-size: 11px;">Standard</span>'}
            </div>
          </td>
          <td class="mono" style="text-align: right; font-weight: 600;">${gross} kg</td>
          <td class="mono" style="text-align: right; color: #ef4444;">${ded}%</td>
          <td class="mono font-bold" style="text-align: right; color: var(--accent-emerald-light); font-size: 14px;">${net} kg</td>
          <td class="mono" style="text-align: right; color: var(--accent-amber);">₹${rate}</td>
          <td class="mono font-bold" style="text-align: right; color: #10b981; font-size: 14px;">₹${amount.toLocaleString('en-IN')}</td>
          <td>
            <span class="badge" style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle); color: var(--text-secondary); font-size: 11px; border-radius: 6px;">
              ${staff}
            </span>
          </td>
          <td style="text-align: center;">
            <div style="display: inline-flex; align-items: center; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 12px;" title="Edit" onclick="collectionsModule.editEntry('${row.id}')">
                ✏️
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 12px;" title="Print Receipt" onclick="collectionsModule.printReceipt('${row.id}')">
                🖨️
              </button>
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 12px; color: #ef4444;" title="Delete" onclick="collectionsModule.deleteEntry('${row.id}')">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  async loadOwnerRecentHistory(ownerId) {
    try {
      const res = await window.electronAPI.db.query(
        "SELECT date, gross_weight_kg, bag_weight_kg, net_weight_kg, rate_per_kg, amount FROM daily_collections WHERE owner_id = ? ORDER BY date DESC LIMIT 4",
        [ownerId]
      );
      const rows = res?.data || [];
      const body = document.getElementById('collOwnerHistoryBody');
      if (!body) return;

      if (rows.length === 0) {
        body.innerHTML = '<div>No prior collections recorded for this owner.</div>';
        return;
      }

      body.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
          <thead>
            <tr style="color: var(--text-muted); border-bottom: 1px solid var(--border-subtle);">
              <th style="padding: 4px 0;">Date</th>
              <th>Gross</th>
              <th>Net</th>
              <th>Rate</th>
              <th style="text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-secondary);">
                <td style="padding: 4px 0;">${r.date}</td>
                <td>${Math.round(r.gross_weight_kg)}kg</td>
                <td style="color: var(--accent-emerald);">${Math.round(r.net_weight_kg)}kg</td>
                <td>₹${r.rate_per_kg}</td>
                <td style="text-align: right; color: var(--accent-amber); font-weight: 600;">₹${Math.round(r.amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      console.error('[CollectionsModule] History error:', e);
    }
  },

  async saveEntry() {
    // Strict license check
    const isAct = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
    if (!isAct) {
      app.showToast('Active license required to record leaf collections.', 'error');
      return;
    }

    const ownerId = document.getElementById('collOwnerSelect')?.value;
    const entryDate = document.getElementById('collModalDateInput')?.value || this.currentDate || new Date().toISOString().split('T')[0];
    const gross = parseFloat(document.getElementById('collGrossInput')?.value) || 0;
    const ded = parseFloat(document.getElementById('collDeducInput')?.value) || 0;
    const rate = parseFloat(document.getElementById('collRateInput')?.value) || 0;
    const notes = document.getElementById('collNotesInput')?.value.trim() || '';
    const staff = document.getElementById('collStaffSelect')?.value || 'Agent-Computer';

    if (!ownerId) {
      app.showToast('Please select a garden owner.', 'warning');
      return;
    }

    if (gross <= 0) {
      app.showToast('Please enter a valid gross weight.', 'warning');
      document.getElementById('collGrossInput')?.focus();
      return;
    }

    // Extract active leaf deduction chips (Mobile Parity: Wet leaves, Long Leaves, Hard Leaves)
    const activeChips = Array.from(document.querySelectorAll('#collDeductionChips .leaf-chip.active'))
      .map(c => c.getAttribute('data-val') || c.innerText.trim());

    let finalNotes = notes;
    if (activeChips.length > 0) {
      finalNotes = `Deductions: [${activeChips.join(', ')}]${notes ? ' | ' + notes : ''}`;
    }

    const net = Math.max(0, Math.round(gross * (1 - ded / 100)));
    const amount = Math.round(net * rate);

    const btn = document.getElementById('collSaveBtn');
    if (btn) btn.disabled = true;

    try {
      if (this.editingId) {
        await window.electronAPI.db.run(`
          UPDATE daily_collections 
          SET owner_id = ?, date = ?, gross_weight_kg = ?, bag_weight_kg = ?, net_weight_kg = ?, rate_per_kg = ?, amount = ?, collector_name = ?, notes = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [ownerId, entryDate, gross, ded, net, rate, amount, staff, finalNotes, this.editingId]);

        app.showToast('Collection entry updated successfully!', 'success');
      } else {
        const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('col_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
        const syncId = id;
        const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
        const sid = app.getSessionIdForDate(entryDate);
        await window.electronAPI.db.run(`
          INSERT INTO daily_collections (id, app_user_id, owner_id, session_id, date, gross_weight_kg, bag_weight_kg, net_weight_kg, rate_per_kg, amount, collector_name, notes, sync_id, sync_status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `, [id, currentUid, ownerId, sid, entryDate, gross, ded, net, rate, amount, staff, finalNotes, syncId]);

        app.showToast('Collection entry saved!', 'success');
      }

      this.closeEntryModal();
      this.currentDate = entryDate;
      const collDateInput = document.getElementById('collDateInput');
      if (collDateInput) collDateInput.value = entryDate;
      await this.loadDayList();
      window.electronAPI.sync.smartSync('daily_collections');
    } catch (e) {
      console.error('[CollectionsModule] Save error:', e);
      app.showToast(`Error saving entry: ${e.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  editEntry(id) {
    const entry = this.cachedCollections.find(c => c.id === id);
    if (!entry) return;

    this.editingId = id;
    const title = document.getElementById('collModalTitle');
    const saveBtn = document.getElementById('collSaveBtn');

    if (title) title.innerText = 'Edit Collection Entry';
    if (saveBtn) saveBtn.innerHTML = '💾 Update Entry';

    const modalDateIn = document.getElementById('collModalDateInput');
    const ownerSelect = document.getElementById('collOwnerSelect');
    const grossInput = document.getElementById('collGrossInput');
    const dedInput = document.getElementById('collDeducInput');
    const rateInput = document.getElementById('collRateInput');
    const notesInput = document.getElementById('collNotesInput');
    const staffSelect = document.getElementById('collStaffSelect');

    if (modalDateIn) modalDateIn.value = entry.date;
    if (ownerSelect) ownerSelect.value = entry.owner_id;
    if (grossInput) grossInput.value = entry.gross_weight_kg;
    if (dedInput) dedInput.value = entry.bag_weight_kg;
    if (rateInput) rateInput.value = entry.rate_per_kg;

    // Peel Deductions from notes and activate corresponding chips
    const activeDeductions = [];
    let cleanNotes = entry.notes || '';
    if (cleanNotes.includes('Deductions: [')) {
      const parts = cleanNotes.split('Deductions: [');
      const dedContent = parts[1].split(']')[0];
      dedContent.split(', ').forEach(t => activeDeductions.push(t.trim()));
      cleanNotes = cleanNotes.replace(/Deductions: \[.*?\]( \| )?/, '');
    }

    document.querySelectorAll('#collDeductionChips .leaf-chip').forEach(chip => {
      const val = chip.getAttribute('data-val');
      if (activeDeductions.includes(val)) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    if (notesInput) notesInput.value = cleanNotes.trim();
    if (staffSelect) staffSelect.value = entry.collector_name || 'Agent-Computer';

    this.onOwnerChange();
    app.openModal('modalCollectionEntry');

    setTimeout(() => {
      document.getElementById('collGrossInput')?.focus();
    }, 150);
  },

  async deleteEntry(id) {
    const row = this.cachedCollections.find(c => c.id === id);
    if (!row) return;

    const confirmMsg = `Delete collection entry of ${Math.round(row.gross_weight_kg)} kg for "${row.owner_name}"?`;
    if (!confirm(confirmMsg)) return;

    try {
      const syncId = row.sync_id || row.id;
      await window.electronAPI.db.run(
        "INSERT OR REPLACE INTO deleted_tombstones (sync_id, table_name) VALUES (?, 'daily_collections')",
        [syncId]
      );
      await window.electronAPI.db.run("DELETE FROM daily_collections WHERE id = ?", [id]);

      app.showToast('Collection entry deleted.', 'info');
      await this.loadDayList();
      window.electronAPI.sync.smartSync('daily_collections');
    } catch (e) {
      console.error('[CollectionsModule] Delete error:', e);
      app.showToast(`Delete failed: ${e.message}`, 'error');
    }
  },

  clearForm() {
    const grossInput = document.getElementById('collGrossInput');
    const dedInput = document.getElementById('collDeducInput');
    const rateInput = document.getElementById('collRateInput');
    const notesInput = document.getElementById('collNotesInput');

    if (grossInput) grossInput.value = '';
    if (dedInput) dedInput.value = '0';
    if (rateInput) rateInput.value = '0';
    if (notesInput) notesInput.value = '';
    document.querySelectorAll('#collDeductionChips .leaf-chip').forEach(c => c.classList.remove('active'));

    this.updateCalc();
  },

  // =========================================================================
  // MONTHLY RATE MANAGER (Redirects to Dedicated Rates Screen)
  // =========================================================================
  openMonthlyRateManager() {
    app.navTo('rates');
  },

  openFullScreenView() {
    const title = document.getElementById('fullLogModalTitle');
    const body = document.getElementById('fullLogTableBody');

    if (title) title.innerText = `Daily Collections Log (${this.currentDate})`;
    if (body) {
      if (this.cachedCollections.length === 0) {
        body.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 30px; color: var(--text-muted);">No collections recorded on this date.</td></tr>';
      } else {
        body.innerHTML = this.cachedCollections.map(row => {
          const time = row.created_at ? new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
          let dedBadges = '';
          const rowNotes = row.notes || '';
          const detectedDeductions = [];

          if (rowNotes.includes('Deductions: [')) {
            const dedContent = rowNotes.split('Deductions: [')[1].split(']')[0];
            dedContent.split(', ').forEach(t => {
              const clean = t.trim();
              if (clean && !detectedDeductions.includes(clean)) detectedDeductions.push(clean);
            });
          } else if (rowNotes) {
            const lower = rowNotes.toLowerCase();
            if (lower.includes('wet') && !detectedDeductions.some(d => d.toLowerCase().includes('wet'))) detectedDeductions.push('Wet leaves');
            if (lower.includes('hard') && !detectedDeductions.some(d => d.toLowerCase().includes('hard'))) detectedDeductions.push('Hard Leaves');
            if (lower.includes('long') && !detectedDeductions.some(d => d.toLowerCase().includes('long'))) detectedDeductions.push('Long Leaves');
          }

          if (detectedDeductions.length > 0) {
            dedBadges = detectedDeductions.map(t => {
              const tClean = t.trim();
              let cls = 'long';
              let icon = '<i class="fa-solid fa-leaf"></i>';
              if (tClean.toLowerCase().includes('wet')) { cls = 'wet'; icon = '<i class="fa-solid fa-droplet"></i>'; }
              else if (tClean.toLowerCase().includes('hard')) { cls = 'hard'; icon = '<i class="fa-solid fa-shield-halved"></i>'; }
              return `<span class="deduction-pill ${cls}" style="font-size: 10px; padding: 2px 7px;">${icon} ${tClean}</span>`;
            }).join(' ');
          }

          return `
            <tr>
              <td class="mono">${time}</td>
              <td>
                <div style="font-weight: 700; color: var(--text-primary);">${row.owner_name}</div>
              </td>
              <td>
                <div style="display: flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                  ${dedBadges || '<span style="color: var(--text-muted); font-size: 11px;">Standard</span>'}
                </div>
              </td>
              <td class="mono">${Math.round(row.gross_weight_kg)} kg</td>
              <td class="mono" style="color: #ef4444;">${Math.round(row.bag_weight_kg)}%</td>
              <td class="mono" style="color: var(--accent-emerald); font-weight: 700;">${Math.round(row.net_weight_kg)} kg</td>
              <td class="mono">₹${row.rate_per_kg}</td>
              <td class="mono" style="color: var(--accent-amber); font-weight: 700;">₹${Math.round(row.amount).toLocaleString('en-IN')}</td>
              <td>${row.collector_name || 'Agent-Computer'}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" onclick="collectionsModule.printReceipt('${row.id}')">🖨️ Print</button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    app.openModal('modalFullScreenLog');
  },

  // ─── Print Preview ──────────────────────────────────────────────────

  _currentPrintFormat: localStorage.getItem('llp_print_format') || 'thermal58',
  _currentReceiptData: null,
  _currentPrintConfig: null,

  async printReceipt(id) {
    const row = this.cachedCollections.find(c => c.id === id);
    if (!row) return;

    try {
      const agentName = await window.electronAPI.db.getSetting('agent_name', 'Leaf Ledger Pro');
      const agentPhone = await window.electronAPI.db.getSetting('agent_phone', '');
      const agentAddress = await window.electronAPI.db.getSetting('agent_address', '');
      const signatureDataUrl = await window.electronAPI.db.getSetting('authority_signature', '');
      const authorityName = await window.electronAPI.db.getSetting('authority_name', '');

      this._currentReceiptData = {
        id: row.id.slice(-6).toUpperCase(),
        date: row.date,
        time: row.created_at ? new Date(row.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        planterName: row.owner_name,
        grossWeight: row.gross_weight_kg,
        bagDeduction: parseFloat((row.gross_weight_kg * ((row.bag_weight_kg || 0) / 100)).toFixed(2)),
        waterDeduction: 0,
        netWeight: row.net_weight_kg,
        rate: row.rate_per_kg,
        totalAmount: row.amount,
        collectorName: row.collector_name || 'Agent-Computer',
        notes: row.notes || '',
      };

      this._currentPrintConfig = { agentName, agentPhone, agentLocation: agentAddress, signatureDataUrl, authorityName };

      // Sync the format tab buttons to the last-used format
      this._syncFormatTabButtons(this._currentPrintFormat);
      this._renderPreview(this._currentPrintFormat);
      app.openModal('modalPrintPreview');

    } catch (e) {
      console.error('[CollectionsModule] Print preview error:', e);
      app.showToast('Could not open print preview.', 'error');
    }
  },

  setPrintFormat(fmt, btn) {
    this._currentPrintFormat = fmt;
    localStorage.setItem('llp_print_format', fmt);
    this._syncFormatTabButtons(fmt);
    this._renderPreview(fmt);

    const HINTS = {
      thermal58: '58mm Thermal — optimised for 58mm POS receipt printers',
      thermal80: '80mm Thermal — optimised for 80mm POS receipt printers',
      a5:        'A5 (148×210mm) — inkjet / laser, half-sheet professional layout',
      a4:        'A4 (210×297mm) — inkjet / laser, full-page formal document',
    };
    const hintEl = document.getElementById('printFormatHint');
    if (hintEl) hintEl.innerText = HINTS[fmt] || '';
  },

  _syncFormatTabButtons(fmt) {
    document.querySelectorAll('.print-fmt-btn').forEach(b => {
      const isActive = b.getAttribute('data-fmt') === fmt;
      b.style.background = isActive ? 'var(--accent-dark)' : 'transparent';
      b.style.color = isActive ? '#fff' : 'var(--text-secondary)';
    });
  },

  _renderPreview(fmt) {
    if (!this._currentReceiptData || !this._currentPrintConfig) return;

    const isThermal = fmt === 'thermal58' || fmt === 'thermal80';
    const frame = document.getElementById('printPreviewFrame');
    if (!frame) return;

    const config = { ...this._currentPrintConfig, format: fmt };

    // Build HTML inline using the same template logic
    const html = this._buildReceiptHtml(this._currentReceiptData, config);

    // Size the iframe to match the paper proportions
    if (fmt === 'a4') {
      frame.style.width = '595px';
      frame.style.height = '842px';
    } else if (fmt === 'a5') {
      frame.style.width = '420px';
      frame.style.height = '595px';
    } else if (fmt === 'thermal80') {
      frame.style.width = '302px';
      frame.style.height = 'auto';
      frame.style.minHeight = '420px';
    } else {
      frame.style.width = '220px';
      frame.style.height = 'auto';
      frame.style.minHeight = '380px';
    }

    // Write into iframe
    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      // Auto-adjust height for thermal (variable length)
      if (isThermal) {
        setTimeout(() => {
          if (frame.contentDocument?.body) {
            frame.style.height = (frame.contentDocument.body.scrollHeight + 20) + 'px';
          }
        }, 100);
      }
    }
  },

  async confirmPrint() {
    const fmt = this._currentPrintFormat;
    const btn = document.getElementById('printPreviewConfirmBtn');
    if (btn) { btn.disabled = true; btn.innerText = '⏳  Printing...'; }

    try {
      const config = {
        ...this._currentPrintConfig,
        format: fmt,
        silent: true,
        pageSize: this._getPageSizeConfig(fmt),
        margins: fmt === 'thermal58' || fmt === 'thermal80'
          ? { marginType: 'none' }
          : { marginType: 'printableArea' },
      };

      const html = this._buildReceiptHtml(this._currentReceiptData, config);

      // Use printHtml for all formats so page size is respected
      const res = await window.electronAPI.printer.printHtml(html, { pageSize: config.pageSize, printerName: config.printerName });
      app.closeModal('modalPrintPreview');

      if (res?.success === false && res.error) {
        app.showToast(`Printer returned: ${res.error}`, 'warning');
      } else {
        app.showToast('Receipt sent to printer!', 'success');
      }
    } catch (e) {
      console.error('[CollectionsModule] confirmPrint error:', e);
      app.showToast('Error sending to printer.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '🖨️ &nbsp;Print Now'; }
    }
  },

  _getPageSizeConfig(fmt) {
    switch (fmt) {
      case 'thermal80': return { width: 80000, height: 297000 };
      case 'a5':        return 'A5';
      case 'a4':        return 'A4';
      default:          return { width: 58000, height: 297000 };
    }
  },

  // Inline HTML builder — mirrors printer.js logic in the renderer
  // (avoids IPC round-trip just for preview)
  _buildReceiptHtml(receiptData, config) {
    const {
      agentName = 'LEAF LEDGER PRO', agentPhone = '', agentLocation = '',
      signatureDataUrl = '', authorityName = '', format = 'thermal58'
    } = config;

    const {
      id = '', date = '', time = '',
      planterName = '', planterCode = '', planterPhone = '',
      grossWeight = 0, bagDeduction = 0, waterDeduction = 0,
      otherDeduction = 0, netWeight = 0, rate = 0, totalAmount = 0,
      collectorName = '', notes = ''
    } = receiptData;

    const totalDed = Number(bagDeduction || 0) + Number(waterDeduction || 0) + Number(otherDeduction || 0);
    const fmtCur = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const receiptNo = String(id).slice(-8).toUpperCase();

    const isThermal = format === 'thermal58' || format === 'thermal80';

    if (isThermal) {
      const is80 = format === 'thermal80';
      const w = is80 ? '72mm' : '52mm';
      const fs = is80 ? '12px' : '11px';
      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
@page{margin:0;size:auto}
body{font-family:'Courier New',monospace;font-size:${fs};line-height:1.35;margin:0 auto;padding:8px 6px;color:#000;background:#fff;width:${w};max-width:100%;box-sizing:border-box}
.c{text-align:center}.b{font-weight:bold}
.hdr{margin-bottom:8px;border-bottom:1px dashed #000;padding-bottom:6px}
.ttl{font-size:${is80 ? '15px' : '13px'};font-weight:bold;letter-spacing:.5px}
.div{border-top:1px dashed #000;margin:5px 0}
.dbl{border-top:2px solid #000;margin:6px 0}
.row{display:flex;justify-content:space-between;margin:2px 0}
.hi{font-size:${is80 ? '14px' : '12px'};font-weight:900}
.ftr{margin-top:8px;border-top:1px dashed #000;padding-top:6px;font-size:8px;text-align:center}
</style></head><body>
<div class="hdr c"><div class="ttl">${agentName.toUpperCase()}</div>
${agentLocation ? `<div>${agentLocation}</div>` : ''}
${agentPhone ? `<div>Ph: ${agentPhone}</div>` : ''}
<div style="margin-top:3px;font-size:8px;text-transform:uppercase">TEA LEAF INTAKE RECEIPT</div></div>
<div class="row"><span>Date/Time:</span><span class="b">${date} ${time}</span></div>
<div class="row"><span>Receipt No:</span><span class="b">#${receiptNo}</span></div>
${collectorName ? `<div class="row"><span>Collector:</span><span class="b">${collectorName}</span></div>` : ''}
<div class="div"></div>
<div class="row"><span>Planter:</span><span class="b">${planterName}</span></div>
${planterCode ? `<div class="row"><span>Code:</span><span>#${planterCode}</span></div>` : ''}
<div class="div"></div>
<div class="row"><span>Gross:</span><span class="b">${Number(grossWeight).toFixed(2)} kg</span></div>
${Number(bagDeduction) > 0 ? `<div class="row"><span>Bag Tare:</span><span>-${Number(bagDeduction).toFixed(2)} kg</span></div>` : ''}
${Number(waterDeduction) > 0 ? `<div class="row"><span>Water Ded:</span><span>-${Number(waterDeduction).toFixed(2)} kg</span></div>` : ''}
${totalDed > 0 ? `<div class="row"><span>Total Ded:</span><span>-${totalDed.toFixed(2)} kg</span></div>` : ''}
<div class="dbl"></div>
<div class="row hi"><span>NET WEIGHT:</span><span>${Number(netWeight).toFixed(2)} KG</span></div>
${Number(rate) > 0 ? `
<div class="row" style="margin-top:4px"><span>Rate/kg:</span><span>₹${Number(rate).toFixed(2)}</span></div>
<div class="row hi" style="margin-top:4px"><span>EST. AMOUNT:</span><span>${fmtCur(totalAmount)}</span></div>` : `<div class="c" style="font-size:8px;color:#555;margin:4px 0">[Monthly Rate Pending]</div>`}
${notes ? `<div class="div"></div><div style="font-size:8px">Note: ${notes}</div>` : ''}
<div class="ftr">
<div>Thank you for supplying quality leaf!</div>
${signatureDataUrl ? `<div style="margin-top:10px"><img src="${signatureDataUrl}" style="max-height:36px;max-width:100%;object-fit:contain"></div><div style="border-top:1px solid #000;padding-top:3px;font-size:8px;font-weight:bold">${authorityName || 'Authorised Signatory'}</div>` : ''}
<div style="margin-top:4px">Leaf Ledger Pro • Verified Digital Entry</div>
</div></body></html>`;

    } else {
      const isA4 = format === 'a4';
      const fs = isA4 ? '13px' : '11.5px';
      const subs = isA4 ? '11px' : '10px';

      return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
@page{size:${isA4 ? 'A4' : 'A5'};margin:12mm 14mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:${fs};color:#1a1a1a;background:#fff;line-height:1.5;padding:${isA4 ? '36px 40px' : '24px 26px'}}
@media print{body{padding:0!important}}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:3px solid #166534;margin-bottom:16px}
.bname{font-size:${isA4 ? '22px' : '18px'};font-weight:900;color:#166534;margin-bottom:3px}
.bsub{font-size:${subs};color:#555}
.rbadge{text-align:right}
.rlbl{font-size:${subs};font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:1px}
.rno{font-size:${isA4 ? '20px' : '16px'};font-weight:900;color:#1a1a1a;font-family:'Courier New',monospace}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.ibox{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 14px}
.ibl{font-size:${subs};font-weight:700;color:#166534;text-transform:uppercase;margin-bottom:3px}
.ival{font-size:${isA4 ? '15px' : '13px'};font-weight:700;color:#1a1a1a}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#166534;color:#fff;font-size:${subs};font-weight:700;text-transform:uppercase;padding:7px 12px;text-align:left}
td{padding:7px 12px;border-bottom:1px solid #e5e7eb;font-size:${fs}}
tr:nth-child(even) td{background:#f9fafb}
.ded td{color:#dc2626}
.tot td{background:#f0fdf4!important;font-weight:900;font-size:${isA4 ? '16px' : '14px'};color:#166534;border-top:2px solid #166534}
.amt{background:#166534;color:#fff;border-radius:8px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.amtl{font-size:${subs};font-weight:700;opacity:.85;text-transform:uppercase}
.amtv{font-size:${isA4 ? '26px' : '22px'};font-weight:900;font-family:'Courier New',monospace}
.ftr{display:flex;justify-content:space-between;align-items:flex-end;padding-top:12px;border-top:1px solid #d1fae5;margin-top:8px}
.fnote{font-size:${subs};color:#6b7280}
.sig{text-align:center}
.sigl{border-top:1.5px solid #1a1a1a;width:160px;margin:0 auto 3px}
.sign{font-size:${subs};font-weight:700;color:#1a1a1a}
.sigt{font-size:9px;color:#555}
</style></head><body>
<div class="hdr">
  <div>
    <div class="bname">${agentName}</div>
    ${agentLocation ? `<div class="bsub">📍 ${agentLocation}</div>` : ''}
    ${agentPhone ? `<div class="bsub">📞 ${agentPhone}</div>` : ''}
  </div>
  <div class="rbadge">
    <div class="rlbl">Leaf Intake Receipt</div>
    <div class="rno">#${receiptNo}</div>
    <div class="bsub">${date}${time ? ' | ' + time : ''}</div>
  </div>
</div>
<div class="grid">
  <div class="ibox"><div class="ibl">Garden Owner / Planter</div><div class="ival">${planterName || '—'}</div>${planterCode ? `<div class="bsub">Code: #${planterCode}</div>` : ''}</div>
  <div class="ibox"><div class="ibl">Collection Details</div>${collectorName ? `<div class="bsub">Collector: <b>${collectorName}</b></div>` : ''}<div class="bsub">Date: <b>${date}</b></div>${time ? `<div class="bsub">Time: <b>${time}</b></div>` : ''}</div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Weight (kg)</th></tr></thead>
  <tbody>
    <tr><td>Gross Weight Collected</td><td style="text-align:right;font-family:'Courier New',monospace;font-weight:700">${Number(grossWeight).toFixed(2)} kg</td></tr>
    ${Number(bagDeduction) > 0 ? `<tr class="ded"><td>(-) Bag / Container Tare</td><td style="text-align:right;font-family:'Courier New',monospace">-${Number(bagDeduction).toFixed(2)} kg</td></tr>` : ''}
    ${Number(waterDeduction) > 0 ? `<tr class="ded"><td>(-) Water / Moisture Deduction</td><td style="text-align:right;font-family:'Courier New',monospace">-${Number(waterDeduction).toFixed(2)} kg</td></tr>` : ''}
    ${Number(otherDeduction) > 0 ? `<tr class="ded"><td>(-) Other Deduction</td><td style="text-align:right;font-family:'Courier New',monospace">-${Number(otherDeduction).toFixed(2)} kg</td></tr>` : ''}
    <tr class="tot"><td>NET WEIGHT (Payable)</td><td style="text-align:right;font-family:'Courier New',monospace">${Number(netWeight).toFixed(2)} kg</td></tr>
  </tbody>
</table>
${Number(rate) > 0 ? `<div class="amt">
  <div><div class="amtl">Rate per kg</div><div style="font-size:${isA4 ? '18px' : '15px'};font-weight:800;font-family:'Courier New',monospace">₹${Number(rate).toFixed(2)}</div></div>
  <div style="text-align:right"><div class="amtl">Estimated Amount Payable</div><div class="amtv">${fmtCur(totalAmount)}</div></div>
</div>` : `<div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:${subs};color:#64748b;text-align:center">Monthly rate settlement pending</div>`}
${notes ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 12px;font-size:${subs};color:#92400e;margin-bottom:16px">📝 <b>Note:</b> ${notes}</div>` : ''}
<div class="ftr">
  <div class="fnote"><div style="font-weight:700;color:#166534">Leaf Ledger Pro</div><div>Verified Digital Entry • Thank you!</div><div style="margin-top:4px;font-size:9px">Computer-generated document.</div></div>
  <div class="sig">
    ${signatureDataUrl ? `<img src="${signatureDataUrl}" style="max-height:${isA4 ? '56px' : '44px'};max-width:160px;object-fit:contain;display:block;margin:0 auto 3px">` : `<div style="height:${isA4 ? '56px' : '44px'}"></div>`}
    <div class="sigl"></div>
    <div class="sign">${authorityName || 'Authorised Signatory'}</div>
    <div class="sigt">Authorised Agent</div>
  </div>
</div>
</body></html>`;
    }
  },
};

window.collectionsModule = collectionsModule;
