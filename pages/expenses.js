/**
 * Leaf Ledger Pro - Operational Expenses Module
 * Mirrors Python ui/expenses.py category chips, conditional owners, and KPI overhead stats
 */

const expensesModule = {
  selectedCategory: 'Fuel',
  activeCategoryFilter: 'ALL',
  cachedOwners: [],
  expensesList: [],

  async init() {
    const dateInput = document.getElementById('expDateInput');
    const yearInput = document.getElementById('expFilterYear');

    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    if (yearInput) yearInput.value = new Date().getFullYear();

    await this.loadOwners();
    this.selectCategory('Fuel');
    await this.loadExpenses();

    // Keyboard shortcut: N = open modal, Enter in notes = save
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('view-expenses')?.classList.contains('active')) {
        if (e.key === 'n' || e.key === 'N') {
          const tag = document.activeElement?.tagName?.toLowerCase();
          if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            e.preventDefault();
            this.openNewEntryModal();
          }
        }
      }
    });

    document.getElementById('expNotesInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.saveExpense(); }
    });
    document.getElementById('expAmountInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('expNotesInput')?.focus(); }
    });
  },

  openNewEntryModal() {
    // Reset form
    document.getElementById('expAmountInput').value = '';
    document.getElementById('expNotesInput').value = '';
    document.getElementById('expDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('expOwnerContainer').style.display = 'none';
    this.selectCategory('Fuel');
    app.openModal('modalExpenseEntry');
    setTimeout(() => document.getElementById('expAmountInput')?.focus(), 100);
  },

  async loadOwners() {
    try {
      const res = await window.electronAPI.db.query("SELECT * FROM owners WHERE is_active = 1 ORDER BY name ASC");
      this.cachedOwners = res?.data || [];

      const select = document.getElementById('expOwnerSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Select Beneficiary Planter --</option>' +
          this.cachedOwners.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
      }
    } catch (e) {
      console.error('[ExpensesModule] Load owners error:', e);
    }
  },

  selectCategory(cat, btn) {
    this.selectedCategory = cat;
    document.querySelectorAll('.exp-chip').forEach(b => {
      b.style.background = 'var(--bg-input)';
      b.style.color = 'var(--text-secondary)';
      b.style.border = '1px solid var(--border-subtle)';
    });

    const activeBtn = btn || document.querySelector(`.exp-chip[data-cat="${cat}"]`);
    if (activeBtn) {
      activeBtn.style.background = 'var(--accent-emerald)';
      activeBtn.style.color = '#ffffff';
      activeBtn.style.border = '1px solid var(--accent-emerald)';
    }

    // Conditional Owner container for Chemicals
    const ownerContainer = document.getElementById('expOwnerContainer');
    if (ownerContainer) {
      ownerContainer.style.display = cat === 'Chemical' ? 'block' : 'none';
    }
    this.updateSaveButtonLabel();
  },

  onOwnerSelected() {
    this.updateSaveButtonLabel();
  },

  updateSaveButtonLabel() {
    const saveBtn = document.getElementById('expSaveBtn');
    if (!saveBtn) return;
    if (this.selectedCategory === 'Chemical') {
      const ownerId = document.getElementById('expOwnerSelect')?.value;
      if (ownerId) {
        saveBtn.innerHTML = '🌱 &nbsp;Save as Grower Advance';
        return;
      }
    }
    saveBtn.innerHTML = '💾 &nbsp;Save Expense';
  },

  filterByCategory(cat, btn) {
    this.activeCategoryFilter = cat;
    document.querySelectorAll('.exp-filter-chip').forEach(b => {
      b.style.background = 'var(--bg-input)';
      b.style.color = 'var(--text-secondary)';
    });
    if (btn) {
      btn.style.background = 'var(--accent-dark)';
      btn.style.color = '#ffffff';
    }
    this.renderTable();
  },

  async loadExpenses() {
    const mVal = document.getElementById('expFilterMonth')?.value || 'ALL';
    const yVal = parseInt(document.getElementById('expFilterYear')?.value || new Date().getFullYear());

    let sql = "SELECT * FROM expenses WHERE strftime('%Y', date) = ?";
    const params = [String(yVal)];

    if (mVal !== 'ALL') {
      sql += " AND strftime('%m', date) = ?";
      params.push(String(mVal).padStart(2, '0'));
    }

    sql += " ORDER BY date DESC, created_at DESC";

    try {
      const res = await window.electronAPI.db.query(sql, params);
      this.expensesList = res?.data || [];

      // Calculate KPI Stats
      let totalSpent = 0;
      const catSums = {};
      const dates = new Set();

      this.expensesList.forEach(e => {
        const amt = e.amount || 0;
        totalSpent += amt;
        catSums[e.category] = (catSums[e.category] || 0) + amt;
        if (e.date) dates.add(e.date);
      });

      let topCat = 'N/A';
      let maxCatAmt = 0;
      for (const [cat, amt] of Object.entries(catSums)) {
        if (amt > maxCatAmt) { maxCatAmt = amt; topCat = cat; }
      }

      const activeDays = Math.max(1, dates.size);
      const avgDay = Math.round(totalSpent / activeDays);

      const kpiTot = document.getElementById('expKpiTotal');
      const kpiTop = document.getElementById('expKpiTopCat');
      const kpiAvg = document.getElementById('expKpiAvg');

      if (kpiTot) kpiTot.innerText = `Rs. ${Math.round(totalSpent).toLocaleString('en-IN')}`;
      if (kpiTop) kpiTop.innerText = topCat !== 'N/A' ? `${topCat} (₹${Math.round(maxCatAmt)})` : 'N/A';
      if (kpiAvg) kpiAvg.innerText = `Rs. ${avgDay.toLocaleString('en-IN')}`;

      this.renderTable();
    } catch (e) {
      console.error('[ExpensesModule] Load expenses error:', e);
    }
  },

  renderTable() {
    const tbody = document.getElementById('expTableBody');
    const badge = document.getElementById('expCountBadge');
    if (!tbody) return;

    const filtered = this.activeCategoryFilter === 'ALL'
      ? this.expensesList
      : this.expensesList.filter(r => r.category === this.activeCategoryFilter);

    if (badge) badge.innerText = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">No expenses recorded for this period.</td></tr>';
      return;
    }

    const ICONS = {
      Fuel: '⛽', Repair: '🔧', Rent: '🏠', Labor: '👷', Chemical: '🧪', Food: '🍱', Other: '📦'
    };

    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td class="mono">${r.date || '—'}</td>
        <td>
          <span style="font-weight: 700; color: var(--text-primary);">${ICONS[r.category] || '📦'} ${r.category || 'Other'}</span>
        </td>
        <td style="color: var(--text-secondary);">${r.notes || '—'}</td>
        <td class="mono" style="font-weight: 800; color: #ef4444; text-align: right;">Rs. ${Math.round(r.amount).toLocaleString('en-IN')}</td>
        <td style="text-align: right;">
          <button type="button" class="btn btn-danger btn-sm" style="font-size: 11px; padding: 2px 8px;" onclick="expensesModule.deleteExpense('${r.id}')">✕</button>
        </td>
      </tr>
    `).join('');
  },

  async saveExpense() {
    const amount = parseFloat(document.getElementById('expAmountInput')?.value);
    const date = document.getElementById('expDateInput')?.value || new Date().toISOString().split('T')[0];
    let notes = document.getElementById('expNotesInput')?.value.trim() || '';

    if (!amount || amount <= 0) {
      app.showToast('Please enter a valid expense amount.', 'warning');
      document.getElementById('expAmountInput')?.focus();
      return;
    }

    const btn = document.getElementById('expSaveBtn');
    if (btn) btn.disabled = true;

    try {
      const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
      const sid = app.getSessionIdForDate(date);

      // Check if Chemical is assigned to a Garden Owner -> Treat as Advance (Mirroring old software)
      if (this.selectedCategory === 'Chemical') {
        const ownerId = document.getElementById('expOwnerSelect')?.value;
        const owner = this.cachedOwners.find(o => o.id === ownerId);

        if (ownerId && owner) {
          const advId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('adv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
          const combinedNotes = notes ? `Chemical - ${notes}` : 'Chemical Purchase';

          await window.electronAPI.db.run(`
            INSERT INTO advances (id, app_user_id, owner_id, session_id, amount, date, payment_mode, notes, sync_id, sync_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Chemical', ?, ?, 0, CURRENT_TIMESTAMP)
          `, [advId, currentUid, ownerId, sid, amount, date, combinedNotes, advId]);

          app.closeModal('modalExpenseEntry');
          app.showToast(`✅ Chemical (₹${amount.toLocaleString('en-IN')}) recorded as Advance for ${owner.name}!`, 'success');

          await this.loadExpenses();
          if (window.electronAPI?.sync?.smartSync) {
            window.electronAPI.sync.smartSync('advances');
          }
          if (window.advancesModule?.refresh) {
            window.advancesModule.refresh();
          }
          return;
        }
      }

      // Standard agency operational expense (e.g. Fuel, Repair, Rent, or general agency Chemical)
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

      await window.electronAPI.db.run(`
        INSERT INTO expenses (id, app_user_id, session_id, date, category, amount, notes, sync_id, sync_status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      `, [id, currentUid, sid, date, this.selectedCategory, amount, notes, id]);

      app.closeModal('modalExpenseEntry');
      app.showToast(`Expense of Rs. ${amount.toLocaleString('en-IN')} saved under ${this.selectedCategory}!`, 'success');
      await this.loadExpenses();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('expenses');
      }
    } catch (e) {
      console.error('[ExpensesModule] Save expense error:', e);
      app.showToast(`Error saving expense: ${e.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async deleteExpense(id) {
    if (!confirm('Are you sure you want to remove this expense entry?')) return;

    try {
      const row = await window.electronAPI.db.getOne("SELECT sync_id, cloud_id FROM expenses WHERE id = ?", [id]);
      const syncId = row?.sync_id || row?.cloud_id || id;
      await window.electronAPI.db.run("INSERT OR REPLACE INTO deleted_tombstones (sync_id, table_name) VALUES (?, 'expenses')", [syncId]);
      await window.electronAPI.db.run("DELETE FROM expenses WHERE id = ?", [id]);
      app.showToast('Expense removed.', 'info');
      await this.loadExpenses();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('expenses');
      }
    } catch (e) {
      console.error('[ExpensesModule] Delete expense error:', e);
      app.showToast(`Error deleting expense: ${e.message}`, 'error');
    }
  },

  async viewReport() {
    const mVal = document.getElementById('expFilterMonth')?.value || 'ALL';
    const yVal = document.getElementById('expFilterYear')?.value || new Date().getFullYear();
    const monthNames = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const periodLabel = mVal === 'ALL'
      ? `Full Year ${yVal}`
      : `${monthNames[parseInt(mVal)] || ''} ${yVal}`;

    const agencyName = (await window.electronAPI.db.getSetting('agent_name', 'Leaf Ledger Pro')) || 'Leaf Ledger Pro';
    const agentContact = (await window.electronAPI.db.getSetting('agent_contact', '')) || '';
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const list = this.expensesList || [];
    const totalSpent = list.reduce((sum, e) => sum + (e.amount || 0), 0);

    const catSums = {};
    const catCounts = {};
    list.forEach(e => {
      const cat = e.category || 'Other';
      catSums[cat] = (catSums[cat] || 0) + (e.amount || 0);
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    const ICONS = {
      Fuel: '⛽', Repair: '🔧', Rent: '🏠', Labor: '👷', Chemical: '🧪', Food: '🍱', Other: '📦'
    };

    const catRowsHtml = Object.entries(catSums)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const pct = totalSpent > 0 ? ((amt / totalSpent) * 100).toFixed(1) : '0';
        return `
          <tr>
            <td><strong>${ICONS[cat] || '📦'} ${cat}</strong> (${catCounts[cat] || 1} entries)</td>
            <td style="text-align: right;" class="mono">₹${Math.round(amt).toLocaleString('en-IN')}</td>
            <td style="text-align: right;" class="mono">${pct}%</td>
          </tr>
        `;
      }).join('');

    const itemRowsHtml = list.map(r => `
      <tr>
        <td class="mono">${r.date || '—'}</td>
        <td><strong>${ICONS[r.category] || '📦'} ${r.category || 'Other'}</strong></td>
        <td>${r.notes || '—'}</td>
        <td style="text-align: right; font-weight: 700; color: #dc2626;" class="mono">₹${Math.round(r.amount || 0).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Operational Expenses Audit - ${periodLabel}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 28px; color: #0f172a; max-width: 900px; margin: auto; background: #ffffff; }
          .header { text-align: center; border-bottom: 2.5px solid #16a34a; padding-bottom: 12px; margin-bottom: 16px; }
          .title { font-size: 22px; font-weight: 800; color: #166534; }
          .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
          .meta-grid { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; margin-bottom: 18px; font-size: 12.5px; }
          .kpi-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
          .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
          .kpi-title { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
          .kpi-value { font-size: 18px; font-weight: 800; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
          th { background: #f1f5f9; font-weight: 700; color: #334155; }
          .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
          .footer-note { margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">${agencyName}</div>
          <div class="subtitle">Operational Expenses Audit &bull; ${agentContact ? `Contact: ${agentContact} &bull; ` : ''}Official Commercial Record</div>
        </div>
        <div class="meta-grid">
          <div><b>Report:</b> Operational Overheads Statement</div>
          <div><b>Period:</b> ${periodLabel}</div>
          <div><b>Generated On:</b> ${dateStr}</div>
        </div>
        <div class="kpi-cards">
          <div class="kpi-card">
            <div class="kpi-title">Total Operational Spend</div>
            <div class="kpi-value mono" style="color: #dc2626;">₹${Math.round(totalSpent).toLocaleString('en-IN')}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Logged Transactions</div>
            <div class="kpi-value mono" style="color: #2563eb;">${list.length}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Active Categories</div>
            <div class="kpi-value mono" style="color: #16a34a;">${Object.keys(catSums).length}</div>
          </div>
        </div>
        <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #334155;">Cost Breakdown by Category</h4>
        <table>
          <thead>
            <tr><th>Category</th><th style="text-align: right;">Total Spent</th><th style="text-align: right;">% Share</th></tr>
          </thead>
          <tbody>
            ${catRowsHtml || '<tr><td colspan="3" style="text-align:center;">No expenses recorded</td></tr>'}
          </tbody>
        </table>
        <h4 style="margin: 16px 0 8px 0; font-size: 13px; color: #334155;">Itemized Expense Log (${list.length} entries)</h4>
        <table>
          <thead>
            <tr><th>Date</th><th>Category</th><th>Notes / Remarks</th><th style="text-align: right;">Amount</th></tr>
          </thead>
          <tbody>
            ${itemRowsHtml || '<tr><td colspan="4" style="text-align:center;">No expense entries</td></tr>'}
          </tbody>
          <tfoot>
            <tr style="background: #f8fafc; font-weight: 800;">
              <td colspan="3" style="text-align: right;">GRAND TOTAL:</td>
              <td style="text-align: right; color: #dc2626;" class="mono">₹${Math.round(totalSpent).toLocaleString('en-IN')}</td>
            </tr>
          </tfoot>
        </table>
        <div class="footer-note">
          Leaf Ledger Pro ERP &bull; Digitally Verified Operational Expense Statement
        </div>
      </body>
      </html>
    `;

    if (app.showDocumentPreview) {
      app.showDocumentPreview({
        title: `🧾 Expense Audit Report - ${periodLabel}`,
        subtitle: `Operational Overheads • Total: ₹${Math.round(totalSpent).toLocaleString('en-IN')}`,
        html,
        defaultFilename: `Expense_Report_${periodLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
      });
    } else {
      window.print();
    }
  },

  load() {
    return this.loadExpenses();
  },

  refresh() {
    return this.loadExpenses();
  }
};

window.expensesModule = expensesModule;
