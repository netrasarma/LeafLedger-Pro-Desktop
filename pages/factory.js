/**
 * Leaf Ledger Pro - Factory Records Module
 * Mirrors Python ui/factory.py: Daily Weight, Monthly Payments, Bulk Rate Entry & Factory Manager
 */

const factoryModule = {
  currentTab: 'daily',
  currentDate: new Date().toISOString().split('T')[0],
  cachedFactories: [],
  cachedDailyDeliveries: [],
  selectedFactoryWorkspace: null,
  bulkRows: [],
  editingFactoryId: null,

  async init() {
    const dateInput = document.getElementById('factDateInput');
    if (dateInput) dateInput.value = this.currentDate;

    await this.loadFactories();
    await this.loadDailyData();

    // Keyboard shortcut: N = open modal (daily tab only)
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('view-factory')?.classList.contains('active') && this.currentTab === 'daily') {
        if (e.key === 'n' || e.key === 'N') {
          const tag = document.activeElement?.tagName?.toLowerCase();
          if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            e.preventDefault();
            this.openNewEntryModal();
          }
        }
      }
    });
  },

  async openNewEntryModal() {
    // Reset modal form fields
    const fields = ['factChallanInput', 'factGrossInput', 'factDeliveredByInput', 'factNotesInput'];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const dedInput = document.getElementById('factDeducInput');
    if (dedInput) dedInput.value = '0';
    const rateInput = document.getElementById('factRateInput');
    if (rateInput) rateInput.value = '';
    const factSel = document.getElementById('factSelect');
    if (factSel) factSel.value = '';

    // Reset live calc labels
    const amtLbl = document.getElementById('factCalcAmountLabel');
    if (amtLbl) amtLbl.innerText = 'Amount: Rs. 0';

    // Synchronize current date and load actual garden total weight
    const dateInput = document.getElementById('factDateInput');
    if (dateInput && dateInput.value) {
      this.currentDate = dateInput.value;
    }
    const gardenRes = await window.electronAPI.db.getOne(
      "SELECT COALESCE(SUM(net_weight_kg), 0) as total FROM daily_collections WHERE date = ?",
      [this.currentDate]
    );
    const gardenTotal = Math.round(gardenRes?.data?.total || 0);
    const gardenLbl = document.getElementById('factAgentTotalLabel');
    if (gardenLbl) gardenLbl.innerText = `Garden: ${gardenTotal.toLocaleString('en-IN')} kg`;

    // Setup Delivered By options (Company, Staff, Custom)
    await this.setupDeliveredByOptions();

    // Show the modal
    app.openModal('modalFactoryEntry');
    setTimeout(() => document.getElementById('factSelect')?.focus(), 100);
  },

  async setupDeliveredByOptions() {
    try {
      const companyName = (await window.electronAPI.db.getSetting('agent_name', 'Leaf Ledger Pro')) || 'Leaf Ledger Pro';
      
      const staffRes = await window.electronAPI.db.query(
        "SELECT id, username, full_name FROM staff_accounts WHERE is_active = 1 ORDER BY full_name ASC"
      );
      const staffList = staffRes?.data || [];

      // Update Company Option
      const compOpt = document.getElementById('factOptCompany');
      if (compOpt) {
        compOpt.value = companyName;
        compOpt.textContent = `🏢 ${companyName} (Company)`;
      }

      // Populate Staff OptGroup
      const staffGroup = document.getElementById('factDeliveredByStaffGroup');
      if (staffGroup) {
        staffGroup.innerHTML = staffList.map(s => {
          const name = s.full_name || s.username || 'Staff';
          return `<option value="${this.escapeHtml(name)}">👷 ${this.escapeHtml(name)} (Staff)</option>`;
        }).join('');
      }

      // Populate Quick Chips
      const chipsContainer = document.getElementById('factDeliveredByQuickChips');
      if (chipsContainer) {
        let chipsHtml = `
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 9px; border-radius: 14px; border: 1px solid var(--border-subtle); display: inline-flex; align-items: center; gap: 4px;" onclick="factoryModule.setDeliveredBy('${this.escapeHtml(companyName)}')">
            🏢 ${this.escapeHtml(companyName)}
          </button>
        `;
        staffList.forEach(s => {
          const name = s.full_name || s.username || 'Staff';
          chipsHtml += `
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 9px; border-radius: 14px; border: 1px solid var(--border-subtle); display: inline-flex; align-items: center; gap: 4px;" onclick="factoryModule.setDeliveredBy('${this.escapeHtml(name)}')">
              👷 ${this.escapeHtml(name)}
            </button>
          `;
        });
        chipsHtml += `
          <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 9px; border-radius: 14px; border: 1px dashed var(--border-subtle); display: inline-flex; align-items: center; gap: 4px;" onclick="factoryModule.setDeliveredBy('', true)">
            ✏️ Custom...
          </button>
        `;
        chipsContainer.innerHTML = chipsHtml;
      }

      const sel = document.getElementById('factDeliveredBySelect');
      if (sel) sel.value = '';
    } catch (e) {
      console.warn('[FactoryModule] Setup delivered by options error:', e);
    }
  },

  setDeliveredBy(name, isCustom = false) {
    const input = document.getElementById('factDeliveredByInput');
    const sel = document.getElementById('factDeliveredBySelect');
    if (isCustom) {
      if (input) {
        input.value = '';
        input.focus();
      }
      if (sel) sel.value = '__CUSTOM__';
    } else {
      if (input) input.value = name;
      if (sel) {
        let matched = false;
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === name) {
            sel.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched) sel.value = '__CUSTOM__';
      }
    }
  },

  onDeliveredBySelectChange(val) {
    const input = document.getElementById('factDeliveredByInput');
    if (!val) {
      if (input) input.value = '';
      return;
    }
    if (val === '__CUSTOM__') {
      if (input) {
        input.value = '';
        input.focus();
      }
    } else {
      if (input) input.value = val;
    }
  },

  switchTab(tab) {
    this.currentTab = tab;
    const btnDaily = document.getElementById('factTabBtnDaily');
    const btnPay = document.getElementById('factTabBtnPayments');
    const btnBulk = document.getElementById('factTabBtnBulk');

    const paneDaily = document.getElementById('factTabDaily');
    const panePay = document.getElementById('factTabPayments');
    const paneBulk = document.getElementById('factTabBulk');

    const resetBtn = (b) => {
      if (b) { b.style.background = 'transparent'; b.style.color = 'var(--text-secondary)'; }
    };
    const activeBtn = (b) => {
      if (b) { b.style.background = 'var(--accent-dark)'; b.style.color = '#ffffff'; }
    };

    resetBtn(btnDaily); resetBtn(btnPay); resetBtn(btnBulk);
    if (paneDaily) paneDaily.style.display = 'none';
    if (panePay) panePay.style.display = 'none';
    if (paneBulk) paneBulk.style.display = 'none';

    if (tab === 'daily') {
      activeBtn(btnDaily);
      if (paneDaily) paneDaily.style.display = 'block';
      this.loadDailyData();
    } else if (tab === 'payments') {
      activeBtn(btnPay);
      if (panePay) panePay.style.display = 'block';
      this.loadPaymentsData();
    } else if (tab === 'bulk') {
      activeBtn(btnBulk);
      if (paneBulk) paneBulk.style.display = 'block';
      this.loadBulkData();
    }
  },

  async loadFactories() {
    try {
      const res = await window.electronAPI.db.query("SELECT * FROM factories WHERE is_active = 1 ORDER BY name ASC");
      this.cachedFactories = res?.data || [];
      this.factories = this.cachedFactories;

      const select = document.getElementById('factSelect');
      const bulkSelect = document.getElementById('factBulkFactorySelect');

      if (select) {
        select.innerHTML = '<option value="">-- Select Factory --</option>' +
          this.cachedFactories.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
      }

      if (bulkSelect) {
        bulkSelect.innerHTML = '<option value="ALL">All Factories</option>' +
          this.cachedFactories.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
      }
    } catch (e) {
      console.error('[FactoryModule] Load factories error:', e);
    }
  },

  prevDay() {
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() - 1);
    this.currentDate = d.toISOString().split('T')[0];
    const dateInput = document.getElementById('factDateInput');
    if (dateInput) dateInput.value = this.currentDate;
    this.loadDailyData();
  },

  nextDay() {
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() + 1);
    this.currentDate = d.toISOString().split('T')[0];
    const dateInput = document.getElementById('factDateInput');
    if (dateInput) dateInput.value = this.currentDate;
    this.loadDailyData();
  },

  onDateChange() {
    const dateInput = document.getElementById('factDateInput');
    if (dateInput && dateInput.value) {
      this.currentDate = dateInput.value;
      this.loadDailyData();
    }
  },

  updateDailyCalc() {
    const gross = parseFloat(document.getElementById('factGrossInput')?.value) || 0;
    const ded = parseFloat(document.getElementById('factDeducInput')?.value) || 0;
    const rate = parseFloat(document.getElementById('factRateInput')?.value) || 0;

    const net = Math.max(0, Math.round(gross * (1 - ded / 100)));
    const amt = Math.round(net * rate);

    const amtLbl = document.getElementById('factCalcAmountLabel');
    if (amtLbl) amtLbl.innerText = `Net: ${net} kg | Rs. ${amt.toLocaleString('en-IN')}`;
  },

  async loadDailyData() {
    const tbody = document.getElementById('factDailyLogTableBody');
    if (tbody) tbody.innerHTML = app.getLoadingStateTableRow(9, 'Loading factory delivery records...');

    try {
      // 1. Garden Total weight for this date
      const gardenRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(net_weight_kg), 0) as total FROM daily_collections WHERE date = ?",
        [this.currentDate]
      );
      const gardenTotal = Math.round(gardenRes?.data?.total || 0);

      const agentTotalLbl = document.getElementById('factAgentTotalLabel');
      const reconGarden = document.getElementById('factReconGarden');
      if (agentTotalLbl) agentTotalLbl.innerText = `Garden: ${gardenTotal} kg`;
      if (reconGarden) reconGarden.innerText = `${gardenTotal} kg`;

      // 2. Factory deliveries on this date
      const deliveriesRes = await window.electronAPI.db.query(`
        SELECT fc.*, COALESCE(fc.factory_name, f.name, 'General') as factory_name
        FROM factory_collections fc
        LEFT JOIN factories f ON fc.factory_id = f.id
        WHERE fc.date = ?
        ORDER BY fc.created_at DESC
      `, [this.currentDate]);

      this.cachedDailyDeliveries = deliveriesRes?.data || [];

      // Calculate Total to Factory & Balance
      let factoryTotalNet = 0;
      this.cachedDailyDeliveries.forEach(d => {
        factoryTotalNet += (d.net_weight_kg || 0);
      });

      const roundedFact = Math.round(factoryTotalNet);
      const balance = roundedFact - gardenTotal; // Positive = gain, Negative = transit loss

      const reconFactory = document.getElementById('factReconFactory');
      const reconBalance = document.getElementById('factReconBalance');

      if (reconFactory) reconFactory.innerText = `${roundedFact} kg`;
      if (reconBalance) {
        reconBalance.innerText = `${balance > 0 ? '+' : ''}${balance} kg`;
        reconBalance.style.color = balance < 0 ? '#ef4444' : (balance > 0 ? '#4caf50' : 'var(--text-primary)');
      }

      this.renderDailyTable();
    } catch (e) {
      console.error('[FactoryModule] Load daily data error:', e);
    }
  },

  renderDailyTable() {
    const tbody = document.getElementById('factDailyLogTableBody');
    if (!tbody) return;

    if (this.cachedDailyDeliveries.length === 0) {
      tbody.innerHTML = app.getEmptyStateTableRow(9, {
        title: 'No Factory Deliveries Recorded',
        message: 'No industrial factory dispatches logged for this date.'
      });
      return;
    }

    tbody.innerHTML = this.cachedDailyDeliveries.map(r => {
      const deliveredBy = r.delivered_by || (r.notes?.match(/By:\s*([^|\]]+)/i)?.[1]?.trim()) || '—';
      return `
      <tr>
        <td style="font-weight: 700; color: var(--text-primary);">${this.escapeHtml(r.factory_name || 'General')}</td>
        <td class="mono">${this.escapeHtml(r.challan_no || '—')}</td>
        <td>
          <span style="font-size: 12px; font-weight: 600; color: var(--text-secondary); background: var(--bg-hover); padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
            🚚 ${this.escapeHtml(deliveredBy)}
          </span>
        </td>
        <td class="mono">${Math.round(r.gross_weight_kg)} kg</td>
        <td class="mono" style="color: #ef4444;">${Math.round(r.deduction_pct)}%</td>
        <td class="mono" style="color: var(--accent-emerald); font-weight: 700;">${Math.round(r.net_weight_kg)} kg</td>
        <td class="mono">₹${r.rate_per_kg}</td>
        <td class="mono" style="color: var(--accent-amber); font-weight: 700;">₹${Math.round(r.amount).toLocaleString('en-IN')}</td>
        <td style="text-align: right;">
          <button type="button" class="btn btn-danger btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="factoryModule.deleteDelivery('${r.id}')">✕</button>
        </td>
      </tr>
    `;}).join('');
  },

  async saveDailyRecord() {
    const factoryId = document.getElementById('factSelect')?.value;
    const challan = document.getElementById('factChallanInput')?.value.trim() || '';
    const gross = parseFloat(document.getElementById('factGrossInput')?.value) || 0;
    const ded = parseFloat(document.getElementById('factDeducInput')?.value) || 0;
    const rate = parseFloat(document.getElementById('factRateInput')?.value) || 0;
    const deliveredBy = document.getElementById('factDeliveredByInput')?.value.trim() || '';
    const notes = document.getElementById('factNotesInput')?.value.trim() || '';

    if (!factoryId) {
      app.showToast('Please select a factory.', 'warning');
      return;
    }

    if (gross <= 0) {
      app.showToast('Please enter a valid gross weight.', 'warning');
      document.getElementById('factGrossInput')?.focus();
      return;
    }

    const net = Math.max(0, Math.round(gross * (1 - ded / 100)));
    const amount = Math.round(net * rate);

    const btn = document.getElementById('factSaveBtn');
    if (btn) btn.disabled = true;

    try {
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('fcol_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      const syncId = `fcol_${id}_${Date.now()}`;
      const sid = app.getSessionIdForDate(this.currentDate);
      const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
      const factRow = (this.cachedFactories || this.factories || []).find(f => String(f.id) === String(factoryId));
      const factName = factRow?.name || '';

      await window.electronAPI.db.run(`
        INSERT INTO factory_collections (id, app_user_id, session_id, factory_id, factory_name, date, challan_no, gross_weight_kg, net_weight_kg, deduction_pct, rate_per_kg, amount, delivered_by, notes, sync_id, sync_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [id, currentUid, sid, factoryId, factName, this.currentDate, challan, gross, net, ded, rate, amount, deliveredBy, notes, syncId]);

      app.closeModal('modalFactoryEntry');
      app.showToast('Factory delivery record saved!', 'success');

      await this.loadDailyData();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('factory_collections');
      }
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[FactoryModule] Save delivery error:', e);
      app.showToast(`Error saving delivery: ${e.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async deleteDelivery(id) {
    if (!confirm('Are you sure you want to remove this delivery record?')) return;

    try {
      const row = await window.electronAPI.db.getOne("SELECT sync_id, cloud_id FROM factory_collections WHERE id = ?", [id]);
      const syncId = row?.data?.sync_id || row?.data?.cloud_id || id;
      await window.electronAPI.db.run(
        "INSERT OR REPLACE INTO deleted_tombstones (sync_id, table_name, deleted_at) VALUES (?, 'factory_collections', CURRENT_TIMESTAMP)",
        [syncId]
      );
      await window.electronAPI.db.run("DELETE FROM factory_collections WHERE id = ?", [id]);
      app.showToast('Delivery record removed.', 'info');
      await this.loadDailyData();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('factory_collections');
      }
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[FactoryModule] Delete error:', e);
      app.showToast(`Error deleting record: ${e.message}`, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // Tab 2: Monthly Payments & Settlement Workspace
  // --------------------------------------------------------------------------
  async loadPaymentsData() {
    const m = parseInt(document.getElementById('factPayMonthSelect')?.value || (new Date().getMonth() + 1));
    const y = parseInt(document.getElementById('factPayYearInput')?.value || new Date().getFullYear());
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;

    try {
      // 1. Deliveries sum per factory this month (Expected)
      const expectedRes = await window.electronAPI.db.query(`
        SELECT fc.factory_id, f.name as factory_name, COALESCE(SUM(fc.amount), 0) as expected, COALESCE(SUM(fc.net_weight_kg), 0) as total_kg
        FROM factory_collections fc
        LEFT JOIN factories f ON fc.factory_id = f.id
        WHERE fc.date LIKE ?
        GROUP BY fc.factory_id
      `, [`${monthPrefix}%`]);

      // 2. Payments received per factory this month
      const receivedRes = await window.electronAPI.db.query(`
        SELECT factory_id, COALESCE(SUM(amount), 0) as received
        FROM factory_payments
        WHERE month = ? AND year = ?
        GROUP BY factory_id
      `, [m, y]);

      const recMap = new Map((receivedRes?.data || []).map(r => [r.factory_id, r.received]));

      const cardsOuter = document.getElementById('factPaymentCardsOuter');
      let totalOutstandingGlobal = 0;

      const expectedRows = expectedRes?.data || [];

      if (cardsOuter) {
        if (expectedRows.length === 0) {
          cardsOuter.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No factory deliveries recorded for this month.</div>';
        } else {
          cardsOuter.innerHTML = expectedRows.map(r => {
            const exp = r.expected || 0;
            const rec = recMap.get(r.factory_id) || 0;
            const out = Math.max(0, exp - rec);
            totalOutstandingGlobal += out;
            const isSettled = rec >= exp && exp > 0;

            return `
              <div style="min-width: 270px; background: var(--bg-card); border-radius: 14px; padding: 18px; border: 1px solid ${isSettled ? 'var(--accent-emerald)' : 'var(--border-subtle)'}; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 14px; font-weight: 800; color: var(--accent-emerald-light);">${(r.factory_name || 'General').toUpperCase()}</span>
                    ${isSettled ? '<span style="font-size: 11px; font-weight: 700; color: #10b981;">✅ SETTLED</span>' : ''}
                  </div>

                  <div style="font-size: 11px; color: var(--text-muted);">EXPECTED</div>
                  <div class="mono" style="font-size: 16px; font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">Rs. ${Math.round(exp).toLocaleString('en-IN')}</div>

                  <div style="font-size: 11px; color: var(--text-muted);">OUTSTANDING</div>
                  <div class="mono" style="font-size: 15px; font-weight: 800; color: ${out > 0 ? '#ef4444' : '#10b981'}; margin-bottom: 12px;">Rs. ${Math.round(out).toLocaleString('en-IN')}</div>
                </div>

                <button type="button" class="btn btn-secondary btn-sm" style="width: 100%; font-weight: 700; font-size: 12px;" onclick="factoryModule.openWorkspace('${r.factory_id}', '${r.factory_name}', ${exp}, ${out})">
                  Open Workspace &rarr;
                </button>
              </div>
            `;
          }).join('');
        }
      }

      const hudOut = document.getElementById('factHudOutstanding');
      if (hudOut) hudOut.innerText = `Rs. ${Math.round(totalOutstandingGlobal).toLocaleString('en-IN')}`;
    } catch (e) {
      console.error('[FactoryModule] Load payments error:', e);
    }
  },

  async openWorkspace(factoryId, factoryName, expected, outstanding) {
    this.selectedFactoryWorkspace = { factoryId, factoryName, expected, outstanding };
    const ws = document.getElementById('factWorkspaceFrame');
    const wsTitle = document.getElementById('factWsTitle');
    const payDate = document.getElementById('factPayDateInput');
    const payAmt = document.getElementById('factPayAmountInput');
    const badge = document.getElementById('factEvPeriodBadge');

    if (ws) ws.style.display = 'block';
    if (wsTitle) wsTitle.innerText = `RECORD SETTLEMENT — ${(factoryName || 'Factory').toUpperCase()}`;
    if (payDate) payDate.value = new Date().toISOString().split('T')[0];
    if (payAmt) payAmt.value = Math.round(outstanding);

    const m = parseInt(document.getElementById('factPayMonthSelect')?.value);
    const y = parseInt(document.getElementById('factPayYearInput')?.value);
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;

    if (badge) badge.innerText = `${monthPrefix} Deliveries`;

    // Load audit deliveries
    try {
      const delivsRes = await window.electronAPI.db.query(`
        SELECT * FROM factory_collections 
        WHERE factory_id = ? AND date LIKE ?
        ORDER BY date ASC
      `, [factoryId, `${monthPrefix}%`]);

      const tbody = document.getElementById('factAuditEvidenceTableBody');
      if (tbody) {
        const rows = delivsRes?.data || [];
        tbody.innerHTML = rows.map(r => `
          <tr>
            <td class="mono">${r.date}</td>
            <td class="mono">${r.challan_no || '—'}</td>
            <td class="mono">${Math.round(r.gross_weight_kg)}</td>
            <td class="mono" style="color: #ef4444;">${Math.round(r.deduction_pct)}%</td>
            <td class="mono" style="color: var(--accent-emerald); font-weight: 700;">${Math.round(r.net_weight_kg)}</td>
            <td class="mono">₹${r.rate_per_kg}</td>
            <td class="mono" style="font-weight: 700;">₹${Math.round(r.amount).toLocaleString('en-IN')}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      console.error('[FactoryModule] Audit deliveries error:', e);
    }
  },

  async commitPayment() {
    if (!this.selectedFactoryWorkspace) return;

    const m = parseInt(document.getElementById('factPayMonthSelect')?.value);
    const y = parseInt(document.getElementById('factPayYearInput')?.value);
    const date = document.getElementById('factPayDateInput')?.value || new Date().toISOString().split('T')[0];
    const amount = parseFloat(document.getElementById('factPayAmountInput')?.value) || 0;
    const mode = document.getElementById('factPayModeSelect')?.value || 'Bank Transfer';
    const notes = document.getElementById('factPayRefInput')?.value.trim() || '';

    if (amount <= 0) {
      app.showToast('Please enter a valid payment amount.', 'warning');
      return;
    }

    try {
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('fp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      const syncId = `fp_${id}_${Date.now()}`;
      const sid = app.getSessionIdForDate(date);
      const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';

      await window.electronAPI.db.run(`
        INSERT INTO factory_payments (id, app_user_id, session_id, factory_id, month, year, payment_date, amount, payment_mode, notes, sync_id, sync_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [id, currentUid, sid, this.selectedFactoryWorkspace.factoryId, m, y, date, amount, mode, notes, syncId]);

      app.showToast(`Settlement of Rs. ${amount} saved!`, 'success');
      document.getElementById('factWorkspaceFrame').style.display = 'none';

      await this.loadPaymentsData();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('factory_payments');
      }
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[FactoryModule] Commit payment error:', e);
      app.showToast(`Error saving payment: ${e.message}`, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // Tab 3: Bulk Rate Entry
  // --------------------------------------------------------------------------
  async loadBulkData() {
    const m = parseInt(document.getElementById('factBulkMonthSelect')?.value || (new Date().getMonth() + 1));
    const y = parseInt(document.getElementById('factBulkYearInput')?.value || new Date().getFullYear());
    const factId = document.getElementById('factBulkFactorySelect')?.value || 'ALL';
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;

    try {
      let sql = `
        SELECT fc.*, f.name as factory_name
        FROM factory_collections fc
        LEFT JOIN factories f ON fc.factory_id = f.id
        WHERE fc.date LIKE ?
      `;
      const params = [`${monthPrefix}%`];

      if (factId !== 'ALL') {
        sql += " AND fc.factory_id = ?";
        params.push(factId);
      }

      sql += " ORDER BY fc.date ASC";

      const res = await window.electronAPI.db.query(sql, params);
      this.bulkRows = res?.data || [];

      let gross = 0, net = 0, rec = 0;
      this.bulkRows.forEach(r => {
        gross += (r.gross_weight_kg || 0);
        net += (r.net_weight_kg || 0);
        rec += (r.amount || 0);
      });

      const gStat = document.getElementById('factBulkGrossStat');
      const nStat = document.getElementById('factBulkNetStat');
      const rStat = document.getElementById('factBulkReceivableStat');

      if (gStat) gStat.innerText = `${Math.round(gross)} kg`;
      if (nStat) nStat.innerText = `${Math.round(net)} kg`;
      if (rStat) rStat.innerText = `Rs. ${Math.round(rec).toLocaleString('en-IN')}`;

      this.renderBulkTable();
    } catch (e) {
      console.error('[FactoryModule] Load bulk error:', e);
    }
  },

  renderBulkTable() {
    const tbody = document.getElementById('factBulkTableBody');
    if (!tbody) return;

    if (this.bulkRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">No delivery records to display for this month.</td></tr>';
      return;
    }

    tbody.innerHTML = this.bulkRows.map((r, i) => `
      <tr>
        <td class="mono">${r.date}</td>
        <td style="font-weight: 700; color: var(--text-primary);">${r.factory_name || 'General'}</td>
        <td class="mono">${Math.round(r.gross_weight_kg)} kg</td>
        <td>
          <input type="number" step="0.01" class="form-input mono" style="width: 75px; height: 28px; padding: 2px 6px;" value="${r.rate_per_kg || 0}" id="bulkRate_${i}" oninput="factoryModule.onBulkRowChange(${i})">
        </td>
        <td>
          <input type="number" step="0.1" class="form-input mono" style="width: 60px; height: 28px; padding: 2px 6px;" value="${r.deduction_pct || 0}" id="bulkDed_${i}" oninput="factoryModule.onBulkRowChange(${i})">
        </td>
        <td class="mono" style="color: var(--accent-emerald); font-weight: 700;" id="bulkNet_${i}">${Math.round(r.net_weight_kg)} kg</td>
        <td class="mono" style="color: var(--accent-amber); font-weight: 700;" id="bulkAmt_${i}">Rs. ${Math.round(r.amount).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  },

  onBulkRowChange(i) {
    const r = this.bulkRows[i];
    if (!r) return;

    const rateIn = document.getElementById(`bulkRate_${i}`);
    const dedIn = document.getElementById(`bulkDed_${i}`);
    const rRate = rateIn ? parseFloat(rateIn.value) : (r.rate_per_kg || 0);
    const rDed = dedIn ? parseFloat(dedIn.value) : (r.deduction_pct || 0);

    const gross = r.gross_weight_kg || 0;
    const rate = !isNaN(rRate) ? rRate : 0;
    const ded = !isNaN(rDed) ? rDed : 0;

    const newNet = Math.max(0, Math.round(gross * (1 - ded / 100)));
    const newAmt = Math.round(newNet * rate);

    const netEl = document.getElementById(`bulkNet_${i}`);
    if (netEl) netEl.innerText = `${newNet} kg`;

    const amtEl = document.getElementById(`bulkAmt_${i}`);
    if (amtEl) amtEl.innerText = `Rs. ${newAmt.toLocaleString('en-IN')}`;

    this.recalculateBulkSummary();
  },

  recalculateBulkSummary() {
    let totalGross = 0;
    let totalNet = 0;
    let totalAmt = 0;

    this.bulkRows.forEach((r, i) => {
      const gross = r.gross_weight_kg || 0;
      const rateIn = document.getElementById(`bulkRate_${i}`);
      const dedIn = document.getElementById(`bulkDed_${i}`);
      const rRate = rateIn ? parseFloat(rateIn.value) : (r.rate_per_kg || 0);
      const rDed = dedIn ? parseFloat(dedIn.value) : (r.deduction_pct || 0);

      const rate = !isNaN(rRate) ? rRate : 0;
      const ded = !isNaN(rDed) ? rDed : 0;

      const net = Math.max(0, Math.round(gross * (1 - ded / 100)));
      const amt = Math.round(net * rate);

      totalGross += gross;
      totalNet += net;
      totalAmt += amt;
    });

    const gStat = document.getElementById('factBulkGrossStat');
    const nStat = document.getElementById('factBulkNetStat');
    const rStat = document.getElementById('factBulkReceivableStat');

    if (gStat) gStat.innerText = `${Math.round(totalGross)} kg`;
    if (nStat) nStat.innerText = `${Math.round(totalNet)} kg`;
    if (rStat) rStat.innerText = `Rs. ${Math.round(totalAmt).toLocaleString('en-IN')}`;
  },

  applyRange() {
    const fromDay = parseInt(document.getElementById('factRangeFromInput')?.value) || 1;
    const toDay = parseInt(document.getElementById('factRangeToInput')?.value) || 31;
    const rate = parseFloat(document.getElementById('factRangeRateInput')?.value);
    const ded = parseFloat(document.getElementById('factRangeDedInput')?.value);
    const noSundays = document.getElementById('factExcludeSundays')?.checked || false;

    let appliedCount = 0;
    this.bulkRows.forEach((r, i) => {
      const day = parseInt(r.date.split('-')[2]);
      const dateObj = new Date(r.date);
      const isSunday = dateObj.getDay() === 0;

      if (day >= fromDay && day <= toDay && (!noSundays || !isSunday)) {
        if (!isNaN(rate)) {
          const rInput = document.getElementById(`bulkRate_${i}`);
          if (rInput) rInput.value = rate;
        }
        if (!isNaN(ded)) {
          const dInput = document.getElementById(`bulkDed_${i}`);
          if (dInput) dInput.value = ded;
        }
        this.onBulkRowChange(i);
        appliedCount++;
      }
    });

    this.recalculateBulkSummary();
    app.showToast(`Range rates applied to ${appliedCount} entries! Click "Save All Changes" to persist.`, 'info');
  },

  async saveAllBulk() {
    try {
      for (let i = 0; i < this.bulkRows.length; i++) {
        const r = this.bulkRows[i];
        const rRate = parseFloat(document.getElementById(`bulkRate_${i}`)?.value);
        const rDed = parseFloat(document.getElementById(`bulkDed_${i}`)?.value);
        const rate = !isNaN(rRate) ? rRate : (r.rate_per_kg || 0);
        const ded = !isNaN(rDed) ? rDed : (r.deduction_pct || 0);
        const newNet = Math.max(0, Math.round(r.gross_weight_kg * (1 - ded / 100)));
        const newAmt = Math.round(newNet * rate);

        await window.electronAPI.db.run(`
          UPDATE factory_collections
          SET rate_per_kg = ?, deduction_pct = ?, net_weight_kg = ?, amount = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [rate, ded, newNet, newAmt, r.id]);
      }

      app.showToast('All bulk rates saved successfully!', 'success');
      await this.loadBulkData();
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[FactoryModule] Bulk save error:', e);
      app.showToast(`Error saving bulk updates: ${e.message}`, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // Manage Factories Dialog & Editing
  // --------------------------------------------------------------------------
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  openManageModal() {
    this.cancelFactoryEdit();
    this.renderFactoryListModal();
    app.openModal('modalManageFactories');
  },

  editFactory(id) {
    const f = this.cachedFactories.find(x => String(x.id) === String(id));
    if (!f) return;

    this.editingFactoryId = f.id;

    const nameInput = document.getElementById('mFactNameInput');
    const phoneInput = document.getElementById('mFactPhoneInput');
    const addrInput = document.getElementById('mFactAddrInput');
    const rateInput = document.getElementById('mFactRateInput');
    const titleEl = document.getElementById('mFactFormTitle');
    const badgeEl = document.getElementById('mFactEditingBadge');
    const submitBtn = document.getElementById('mFactSubmitBtn');
    const cancelBtn = document.getElementById('mFactCancelEditBtn');
    const card = document.getElementById('mFactFormCard');

    if (nameInput) nameInput.value = f.name || '';
    if (phoneInput) phoneInput.value = f.phone || '';
    if (addrInput) addrInput.value = f.address || '';
    if (rateInput) rateInput.value = (f.default_rate !== null && f.default_rate !== undefined) ? f.default_rate : '';

    if (titleEl) titleEl.innerHTML = `✏️ EDIT FACTORY: <span style="color: var(--text-primary); text-transform: none; font-weight: 700;">${this.escapeHtml(f.name)}</span>`;
    if (badgeEl) badgeEl.style.display = 'inline-block';
    if (submitBtn) {
      submitBtn.innerHTML = '💾 Update Factory';
      submitBtn.className = 'btn btn-primary btn-sm';
    }
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    if (card) {
      card.style.borderColor = 'var(--accent-emerald)';
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    this.renderFactoryListModal();
    nameInput?.focus();
  },

  cancelFactoryEdit() {
    this.editingFactoryId = null;

    const nameInput = document.getElementById('mFactNameInput');
    const phoneInput = document.getElementById('mFactPhoneInput');
    const addrInput = document.getElementById('mFactAddrInput');
    const rateInput = document.getElementById('mFactRateInput');
    const titleEl = document.getElementById('mFactFormTitle');
    const badgeEl = document.getElementById('mFactEditingBadge');
    const submitBtn = document.getElementById('mFactSubmitBtn');
    const cancelBtn = document.getElementById('mFactCancelEditBtn');
    const card = document.getElementById('mFactFormCard');

    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (addrInput) addrInput.value = '';
    if (rateInput) rateInput.value = '';

    if (titleEl) titleEl.innerHTML = '＋ ADD NEW FACTORY';
    if (badgeEl) badgeEl.style.display = 'none';
    if (submitBtn) {
      submitBtn.innerHTML = '＋ Add Factory';
      submitBtn.className = 'btn btn-primary btn-sm';
    }
    if (cancelBtn) cancelBtn.style.display = 'none';

    if (card) card.style.borderColor = 'var(--border-subtle)';
    this.renderFactoryListModal();
  },

  renderFactoryListModal() {
    const listBody = document.getElementById('mFactListBody');
    const countBadge = document.getElementById('mFactCountBadge');
    if (!listBody) return;

    if (countBadge) {
      const count = this.cachedFactories.length;
      countBadge.textContent = `${count} ${count === 1 ? 'Factory' : 'Factories'} Registered`;
    }

    if (this.cachedFactories.length === 0) {
      listBody.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px; background: var(--bg-card); border-radius: 8px; border: 1px dashed var(--border-subtle);">
          No factories registered yet. Use the form above to register your first factory.
        </div>
      `;
      return;
    }

    listBody.innerHTML = this.cachedFactories.map(f => {
      const isEditing = String(this.editingFactoryId) === String(f.id);
      return `
        <div style="background: var(--bg-card); border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; border: 1.5px solid ${isEditing ? 'var(--accent-emerald)' : 'var(--border-subtle)'}; gap: 14px; box-shadow: ${isEditing ? '0 0 0 2px rgba(16, 185, 129, 0.2)' : 'none'}; transition: all 0.2s ease;">
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-weight: 700; font-size: 14px; color: var(--text-primary);">${this.escapeHtml(f.name)}</span>
              <span style="font-size: 10px; padding: 1px 8px; border-radius: 999px; background: rgba(16, 185, 129, 0.12); color: var(--accent-emerald); font-weight: 700; text-transform: uppercase;">Active</span>
              ${isEditing ? '<span style="font-size: 10px; padding: 1px 8px; border-radius: 999px; background: rgba(59, 130, 246, 0.15); color: #3b82f6; font-weight: 700; text-transform: uppercase;">Editing Now</span>' : ''}
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 12px;">
              <span>📍 ${this.escapeHtml(f.address || 'No address specified')}</span>
              <span>📞 <span class="mono">${f.phone ? this.escapeHtml(f.phone) : 'No phone'}</span></span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 14px; flex-shrink: 0;">
            <div style="text-align: right;">
              <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Default Rate</div>
              <div style="font-size: 14px; color: var(--accent-emerald); font-weight: 700;" class="mono">₹${parseFloat(f.default_rate || 0).toFixed(2)}/kg</div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 32px; padding: 0 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;" onclick="factoryModule.editFactory('${f.id}')">
              ✏️ Edit
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async saveFactory() {
    const name = document.getElementById('mFactNameInput')?.value.trim();
    const phone = document.getElementById('mFactPhoneInput')?.value.trim().replace(/\D/g, '').slice(0, 10);
    const addr = document.getElementById('mFactAddrInput')?.value.trim();
    const rate = parseFloat(document.getElementById('mFactRateInput')?.value) || 0;

    if (!name) {
      app.showToast('Factory name is required.', 'warning');
      document.getElementById('mFactNameInput')?.focus();
      return;
    }

    if (phone && phone.length !== 10) {
      app.showToast('Factory phone number must be exactly 10 digits.', 'warning');
      document.getElementById('mFactPhoneInput')?.focus();
      return;
    }

    try {
      if (this.editingFactoryId) {
        await window.electronAPI.db.run(`
          UPDATE factories
          SET name = ?, phone = ?, address = ?, default_rate = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [name, phone, addr, rate, this.editingFactoryId]);

        app.showToast(`Factory "${name}" updated successfully!`, 'success');
      } else {
        const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('fac_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
        await window.electronAPI.db.run(`
          INSERT INTO factories (id, name, phone, address, default_rate, is_active, sync_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [id, name, phone, addr, rate]);

        app.showToast(`Factory "${name}" added successfully!`, 'success');
      }

      this.cancelFactoryEdit();
      await this.loadFactories();
      this.renderFactoryListModal();
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[FactoryModule] Save factory error:', e);
      app.showToast(`Error saving factory: ${e.message}`, 'error');
    }
  },

  createFactory() {
    return this.saveFactory();
  },

  load() {
    this.loadDailyData();
    this.loadPaymentsData();
    this.loadBulkData();
  },

  refresh() {
    return this.load();
  }
};

window.factoryModule = factoryModule;
