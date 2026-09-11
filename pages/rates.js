/**
 * Leaf Ledger Pro — Executive Rates & Pricing Desk
 * High-Speed Green Leaf Rate Calibration & Auditing Desk
 */

const ratesModule = {
  currentMonth: new Date().getMonth() + 1,
  currentYear: new Date().getFullYear(),
  cachedSummary: null,

  async init() {
    const d = new Date();
    this.currentMonth = d.getMonth() + 1;
    this.currentYear = d.getFullYear();

    const mSelect = document.getElementById('ratesMonthSelect');
    const ySelect = document.getElementById('ratesYearSelect');

    if (mSelect) mSelect.value = String(this.currentMonth);
    if (ySelect) {
      ySelect.innerHTML = Array.from({ length: 8 }, (_, i) => 2023 + i)
        .map(y => `<option value="${y}" ${y === this.currentYear ? 'selected' : ''}>${y}</option>`)
        .join('');
    }

    await this.loadData();
  },

  jumpToCurrentMonth() {
    const d = new Date();
    this.currentMonth = d.getMonth() + 1;
    this.currentYear = d.getFullYear();

    const mSelect = document.getElementById('ratesMonthSelect');
    const ySelect = document.getElementById('ratesYearSelect');
    if (mSelect) mSelect.value = String(this.currentMonth);
    if (ySelect) ySelect.value = String(this.currentYear);

    this.loadData();
  },

  prevMonth() {
    let m = parseInt(document.getElementById('ratesMonthSelect')?.value || this.currentMonth);
    let y = parseInt(document.getElementById('ratesYearSelect')?.value || this.currentYear);

    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }

    this.updateSelects(m, y);
    this.loadData();
  },

  nextMonth() {
    let m = parseInt(document.getElementById('ratesMonthSelect')?.value || this.currentMonth);
    let y = parseInt(document.getElementById('ratesYearSelect')?.value || this.currentYear);

    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }

    this.updateSelects(m, y);
    this.loadData();
  },

  updateSelects(m, y) {
    this.currentMonth = m;
    this.currentYear = y;
    const mSelect = document.getElementById('ratesMonthSelect');
    const ySelect = document.getElementById('ratesYearSelect');
    if (mSelect) mSelect.value = String(m);
    if (ySelect) {
      if (!Array.from(ySelect.options).some(o => o.value == y)) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.text = y;
        ySelect.add(opt);
      }
      ySelect.value = String(y);
    }
  },

  setRangePreset(preset) {
    const month = parseInt(document.getElementById('ratesMonthSelect')?.value || this.currentMonth);
    const year = parseInt(document.getElementById('ratesYearSelect')?.value || this.currentYear);
    const numDays = new Date(year, month, 0).getDate();

    const bFrom = document.getElementById('ratesBulkFrom');
    const bTo = document.getElementById('ratesBulkTo');

    if (!bFrom || !bTo) return;

    if (preset === 'all') {
      bFrom.value = '1';
      bTo.value = String(numDays);
    } else if (preset === 'p1') {
      bFrom.value = '1';
      bTo.value = '15';
    } else if (preset === 'p2') {
      bFrom.value = '16';
      bTo.value = String(numDays);
    }
  },

  async loadData() {
    const mSelect = document.getElementById('ratesMonthSelect');
    const ySelect = document.getElementById('ratesYearSelect');

    const month = parseInt(mSelect?.value || this.currentMonth);
    const year = parseInt(ySelect?.value || this.currentYear);
    this.currentMonth = month;
    this.currentYear = year;

    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const badge = document.getElementById('ratesDaysMonthBadge');
    if (badge) badge.innerText = `${monthNames[month]} ${year}`;

    const daysScroll = document.getElementById('ratesDaysScrollContainer');
    const ledgerScroll = document.getElementById('ratesLedgerScrollContainer');

    if (daysScroll) daysScroll.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-muted); font-size: 13px;">⏳ Loading daily rate records...</div>';
    if (ledgerScroll) ledgerScroll.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-muted); font-size: 13px;">⏳ Calculating monthly audit ledger...</div>';

    try {
      const res = await window.electronAPI.collections.getMonthlySummary(month, year);
      const summary = res?.data || { gross: 0, net: 0, amount: 0, days: [], factoryMap: {} };
      this.cachedSummary = summary;

      // Calculate totals
      let totalSlips = 0;
      let totalGross = summary.gross || 0;
      let totalNet = summary.net || 0;
      let totalAmt = summary.amount || 0;

      (summary.days || []).forEach(d => {
        totalSlips += (d.entries || 0);
      });

      const effectiveDedPct = totalGross > 0 ? (((totalGross - totalNet) / totalGross) * 100) : 0;
      const weightedAvgRate = totalNet > 0 ? (totalAmt / totalNet) : 0;

      // Update Top 4 Executive KPI Cards
      const statGross = document.getElementById('ratesStatGross');
      const statNet = document.getElementById('ratesStatNet');
      const statAvgRate = document.getElementById('ratesStatAvgRate');
      const statPayable = document.getElementById('ratesStatPayable');
      const statSlips = document.getElementById('ratesStatSlipsCount');
      const statDedPct = document.getElementById('ratesStatDedPct');

      if (statGross) statGross.innerText = `${Math.round(totalGross).toLocaleString('en-IN')} kg`;
      if (statSlips) statSlips.innerText = `${totalSlips} collection slips`;

      if (statNet) statNet.innerText = `${Math.round(totalNet).toLocaleString('en-IN')} kg`;
      if (statDedPct) statDedPct.innerText = `${effectiveDedPct.toFixed(1)}% avg deduction`;

      if (statAvgRate) statAvgRate.innerText = `₹ ${weightedAvgRate.toFixed(2)}`;
      if (statPayable) statPayable.innerText = `Rs. ${Math.round(totalAmt).toLocaleString('en-IN')}`;

      // Left Column: Render Days (1 to last day of month)
      const numDays = new Date(year, month, 0).getDate();
      const dayDataMap = {};
      (summary.days || []).forEach(d => { dayDataMap[d.date] = d; });
      const factoryMap = summary.factoryMap || {};

      let daysHtml = '';
      for (let day = 1; day <= numDays; day++) {
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dtObj = new Date(year, month - 1, day);
        const isSunday = dtObj.getDay() === 0;
        const dayName = dtObj.toLocaleDateString('en-US', { weekday: 'short' });

        const dInfo = dayDataMap[dStr] || {};
        const fInfo = factoryMap[dStr] || {};

        const curRate = dInfo.rate ? Number(dInfo.rate).toFixed(2).replace(/\.?0+$/, '') : '';
        const curDed = dInfo.standard_deduction_pct ? Number(dInfo.standard_deduction_pct).toFixed(1) : '';
        const fRate = fInfo.rate ? `₹${Number(fInfo.rate).toFixed(2).replace(/\.?0+$/, '')}` : '—';
        const fDed = fInfo.water_deduction_pct ? `${Number(fInfo.water_deduction_pct).toFixed(1)}%` : '—';

        const rowBg = isSunday 
          ? 'rgba(239, 68, 68, 0.12)' 
          : (dInfo.entries > 0 ? 'rgba(76, 175, 125, 0.08)' : (day % 2 === 0 ? 'var(--bg-input)' : 'transparent'));
        const dayColor = isSunday ? 'var(--accent-red)' : 'var(--text-primary)';
        const dayBorder = dInfo.entries > 0 ? 'border-left: 3px solid var(--accent-emerald);' : '';

        const activityPill = dInfo.entries > 0
          ? `<span style="font-size: 11px; font-weight: 700; color: var(--accent-emerald-light); font-family: var(--font-mono); white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;">
               <span style="color: var(--accent-emerald); font-size: 8px;">●</span> ${Math.round(dInfo.gross).toLocaleString('en-IN')} kg
             </span>`
          : `<span style="font-size: 11px; color: var(--text-muted); white-space: nowrap;">—</span>`;

        daysHtml += `
          <div style="display: grid; grid-template-columns: 58px 78px 1fr 1fr 38px 65px 65px; gap: 6px; align-items: center; padding: 5px 8px; margin-bottom: 3px; border-radius: 8px; background: ${rowBg}; ${dayBorder} transition: background 0.15s ease;">
            <div style="display: flex; align-items: center; gap: 4px; white-space: nowrap;">
              <span style="font-size: 12px; font-weight: 800; color: ${dayColor}; font-family: var(--font-mono);">${String(day).padStart(2, '0')}</span>
              <span style="font-size: 11px; font-weight: 600; color: ${isSunday ? 'var(--accent-red)' : 'var(--text-secondary)'};">${dayName}</span>
            </div>

            <div style="min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${activityPill}</div>

            <div>
              <input type="number" step="0.05" id="rateRow_rate_${dStr}" class="form-input mono" value="${curRate}" placeholder="₹" 
                     style="height: 28px; width: 100%; font-size: 12px; padding: 2px 6px; text-align: center; border-radius: 6px;" 
                     onkeydown="ratesModule.handleRowKeyDown(event, '${dStr}', ${day}, ${numDays})">
            </div>

            <div>
              <input type="number" step="0.1" id="rateRow_ded_${dStr}" class="form-input mono" value="${curDed}" placeholder="%" 
                     style="height: 28px; width: 100%; font-size: 12px; padding: 2px 6px; text-align: center; border-radius: 6px;" 
                     onkeydown="ratesModule.handleRowKeyDown(event, '${dStr}', ${day}, ${numDays})">
            </div>

            <div>
              <button type="button" class="btn btn-primary btn-sm" 
                      style="height: 28px; width: 100%; padding: 0; font-size: 11px; font-weight: 800; background: var(--accent-dark); border: 1px solid var(--accent-emerald); border-radius: 6px; color: #ffffff; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; text-align: center;" 
                      title="Apply rate for ${dStr}" onclick="ratesModule.applyDayBulkUpdate('${dStr}')">
                Ok
              </button>
            </div>

            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-align: center; font-family: var(--font-mono); white-space: nowrap;">${fRate}</div>
            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-align: center; font-family: var(--font-mono); white-space: nowrap;">${fDed}</div>
          </div>
        `;
      }
      if (daysScroll) daysScroll.innerHTML = daysHtml;

      // Right Column: Render Monthly Auditing Ledger Table
      const rows = summary.days || [];
      const ledgerCountBadge = document.getElementById('ratesLedgerDaysCount');
      if (ledgerCountBadge) ledgerCountBadge.innerText = `${rows.length} Active Day${rows.length === 1 ? '' : 's'}`;

      if (rows.length === 0) {
        if (ledgerScroll) {
          ledgerScroll.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 60px 20px; font-size: 13px;">
              <div style="font-size: 32px; margin-bottom: 8px;">🍃</div>
              <div style="font-weight: 700; color: var(--text-secondary);">No green leaf collections recorded for this month</div>
              <div style="font-size: 11px; margin-top: 4px;">Collections recorded in the Leaf Collection screen will automatically appear here.</div>
            </div>
          `;
        }
      } else {
        let ledgerHtml = '';
        rows.forEach((r, i) => {
          const [y, m, d] = r.date.split('-').map(Number);
          const dtObj = new Date(y, m - 1, d);
          const isSunday = dtObj.getDay() === 0;
          const dayNum = String(d).padStart(2, '0');
          const dayName = dtObj.toLocaleDateString('en-US', { weekday: 'short' });

          const rowBg = isSunday 
            ? 'rgba(239, 68, 68, 0.1)' 
            : (i % 2 === 0 ? 'var(--bg-input)' : 'transparent');
          const dayColor = isSunday ? 'var(--accent-red)' : 'var(--text-primary)';

          ledgerHtml += `
            <div style="display: grid; grid-template-columns: 55px 50px 1fr 65px 1fr 75px 1.2fr 34px; gap: 4px; align-items: center; padding: 7px 10px; margin-bottom: 2px; border-radius: 6px; background: ${rowBg}; font-size: 12px; cursor: pointer; transition: background 0.15s ease;"
                 onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='${rowBg}'"
                 onclick="ratesModule.inspectDay('${r.date}', ${r.entries})">
              <div style="font-weight: 800; color: ${dayColor}; font-family: var(--font-mono);">${dayNum} <span style="font-size: 10px; font-weight: 600; color: var(--text-muted);">${dayName}</span></div>
              <div style="color: var(--text-muted); text-align: center; font-weight: 600;">${r.entries}</div>
              <div style="color: var(--accent-blue); text-align: right; font-family: var(--font-mono);">${Math.round(r.gross).toLocaleString('en-IN')}</div>
              <div style="color: var(--accent-amber); font-weight: 700; text-align: center;">${Number(r.standard_deduction_pct || 0).toFixed(1)}%</div>
              <div style="color: var(--accent-emerald-light); font-weight: 700; text-align: right; font-family: var(--font-mono);">${Math.round(r.net).toLocaleString('en-IN')}</div>
              <div style="color: var(--text-secondary); text-align: right; font-family: var(--font-mono);">₹${Number(r.rate || 0).toFixed(2)}</div>
              <div style="font-weight: 800; color: var(--text-primary); text-align: right; font-family: var(--font-mono);">₹${Math.round(r.amount).toLocaleString('en-IN')}</div>
              <div style="text-align: center; color: var(--text-muted); font-size: 11px;" title="Inspect day details">🔍</div>
            </div>
          `;
        });
        if (ledgerScroll) ledgerScroll.innerHTML = ledgerHtml;
      }

      // Update Summary Footer Row
      const footSlips = document.getElementById('ratesFootSlips');
      const footGross = document.getElementById('ratesFootGross');
      const footDed = document.getElementById('ratesFootDed');
      const footNet = document.getElementById('ratesFootNet');
      const footRate = document.getElementById('ratesFootRate');
      const footAmt = document.getElementById('ratesFootAmt');

      if (footSlips) footSlips.innerText = totalSlips;
      if (footGross) footGross.innerText = Math.round(totalGross).toLocaleString('en-IN');
      if (footDed) footDed.innerText = `${effectiveDedPct.toFixed(1)}%`;
      if (footNet) footNet.innerText = Math.round(totalNet).toLocaleString('en-IN');
      if (footRate) footRate.innerText = `₹${weightedAvgRate.toFixed(2)}`;
      if (footAmt) footAmt.innerText = `₹${Math.round(totalAmt).toLocaleString('en-IN')}`;

    } catch (e) {
      console.error('[RatesModule] loadData error:', e);
      if (daysScroll) daysScroll.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error: ${e.message}</div>`;
      if (ledgerScroll) ledgerScroll.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Error: ${e.message}</div>`;
    }
  },

  handleRowKeyDown(event, dateStr, day, numDays) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.applyDayBulkUpdate(dateStr);
      // Focus next day rate input
      const nextDay = day + 1;
      if (nextDay <= numDays) {
        const nextDStr = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
        const nextIn = document.getElementById(`rateRow_rate_${nextDStr}`);
        if (nextIn) nextIn.focus();
      }
    }
  },

  async applyDayBulkUpdate(dateStr) {
    const rateIn = document.getElementById(`rateRow_rate_${dateStr}`)?.value.trim();
    const dedIn = document.getElementById(`rateRow_ded_${dateStr}`)?.value.trim();

    const rate = rateIn !== '' ? parseFloat(rateIn) : null;
    const ded = dedIn !== '' ? parseFloat(dedIn) : null;

    if (rate === null && ded === null) {
      app.showToast(`Please enter at least Rate or Ded% for ${dateStr}`, 'warning');
      return;
    }

    this.showProcessing(`Updating green leaf rates for ${dateStr}...`);

    try {
      const res = await window.electronAPI.collections.updateDailyBulk(dateStr, rate, ded);
      this.hideProcessing();

      if (res?.success) {
        app.showToast(`Rates for ${dateStr} updated successfully.`, 'success');
        await this.loadData();
        window.electronAPI.sync.smartSync('daily_collections');
      } else {
        app.showToast(res?.error || 'Bulk update failed', 'error');
      }
    } catch (err) {
      this.hideProcessing();
      app.showToast(`Update error: ${err.message}`, 'error');
    }
  },

  async applyRangeBulkUpdate() {
    const fromDay = parseInt(document.getElementById('ratesBulkFrom')?.value || '1');
    const toDay = parseInt(document.getElementById('ratesBulkTo')?.value || '31');
    const rateStr = document.getElementById('ratesBulkRate')?.value.trim();
    const dedStr = document.getElementById('ratesBulkDed')?.value.trim();
    const noSun = document.getElementById('ratesBulkNoSun')?.checked;

    const rate = rateStr !== '' ? parseFloat(rateStr) : null;
    const ded = dedStr !== '' ? parseFloat(dedStr) : null;

    if (rate === null && ded === null) {
      app.showToast('Please enter at least a Rate or a Deduction %.', 'warning');
      return;
    }

    if (isNaN(fromDay) || isNaN(toDay) || fromDay < 1 || toDay > 31 || fromDay > toDay) {
      app.showToast('Invalid Day Range. Please enter valid days (1-31).', 'warning');
      return;
    }

    const month = parseInt(document.getElementById('ratesMonthSelect')?.value);
    const year = parseInt(document.getElementById('ratesYearSelect')?.value);

    let confirmMsg = `Apply bulk rate adjustments from Day ${fromDay} to Day ${toDay}?\n`;
    if (rate !== null) confirmMsg += `• Rate: ₹${rate}\n`;
    if (ded !== null) confirmMsg += `• Ded%: ${ded}%\n`;
    confirmMsg += `• Skip Sundays: ${noSun ? 'Yes' : 'No'}`;

    if (!confirm(confirmMsg)) return;

    this.showProcessing('Recalculating monthly rates and account ledgers...');

    try {
      const res = await window.electronAPI.collections.updateRangeBulk(month, year, fromDay, toDay, rate, ded, noSun);
      this.hideProcessing();

      if (res?.success) {
        app.showToast('Bulk update applied successfully across date range.', 'success');
        await this.loadData();
        window.electronAPI.sync.smartSync('daily_collections');
      } else {
        app.showToast(res?.error || 'Bulk update failed', 'error');
      }
    } catch (err) {
      this.hideProcessing();
      app.showToast(`Bulk update error: ${err.message}`, 'error');
    }
  },

  clearBulkInputs() {
    const bRate = document.getElementById('ratesBulkRate');
    const bDed = document.getElementById('ratesBulkDed');
    if (bRate) bRate.value = '';
    if (bDed) bDed.value = '';
    app.showToast('Bulk input fields cleared.', 'info');
  },

  async inspectDay(dateStr, slipCount) {
    const title = document.getElementById('ratesInspectorTitle');
    const sub = document.getElementById('ratesInspectorSub');
    const tbody = document.getElementById('ratesInspectorTableBody');

    if (title) title.innerText = `Collections Breakdown — ${dateStr}`;
    if (sub) sub.innerText = `${slipCount} garden owner collection receipt${slipCount === 1 ? '' : 's'} recorded`;
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">⏳ Loading farmer slips...</td></tr>';

    app.openModal('ratesDayInspectorModal');

    try {
      const rows = await window.electronAPI.db.query(
        `SELECT id, created_at, owner_name, gross_weight_kg, bag_weight_kg, net_weight_kg, rate_per_kg, amount
         FROM daily_collections
         WHERE date = ?
         ORDER BY created_at ASC`,
        [dateStr]
      );

      if (!rows || rows.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">No records found.</td></tr>';
        return;
      }

      let html = '';
      rows.forEach(r => {
        const time = r.created_at ? new Date(r.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
        html += `
          <tr style="border-bottom: 1px solid var(--border-subtle); font-size: 12px;">
            <td style="padding: 8px; font-family: var(--font-mono); color: var(--text-muted);">${time}</td>
            <td style="padding: 8px; font-weight: 700; color: var(--text-primary);">${r.owner_name}</td>
            <td style="padding: 8px; text-align: right; font-family: var(--font-mono); color: var(--accent-blue);">${Math.round(r.gross_weight_kg)} kg</td>
            <td style="padding: 8px; text-align: center; font-family: var(--font-mono); color: var(--accent-amber);">${Number(r.bag_weight_kg).toFixed(1)}%</td>
            <td style="padding: 8px; text-align: right; font-family: var(--font-mono); color: var(--accent-emerald-light); font-weight: 700;">${Math.round(r.net_weight_kg)} kg</td>
            <td style="padding: 8px; text-align: right; font-family: var(--font-mono); color: var(--text-secondary);">₹${Number(r.rate_per_kg).toFixed(2)}</td>
            <td style="padding: 8px; text-align: right; font-family: var(--font-mono); color: var(--text-primary); font-weight: 800;">₹${Math.round(r.amount).toLocaleString('en-IN')}</td>
          </tr>
        `;
      });
      if (tbody) tbody.innerHTML = html;
    } catch (err) {
      console.error('[RatesModule] inspectDay error:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--accent-red);">Error loading receipts: ${err.message}</td></tr>`;
    }
  },

  async exportPDF() {
    if (!this.cachedSummary || !this.cachedSummary.days || this.cachedSummary.days.length === 0) {
      app.showToast('No ledger records available to export for this month.', 'warning');
      return;
    }

    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const periodName = `${monthNames[this.currentMonth]} ${this.currentYear}`;
    const generatedOn = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const summary = this.cachedSummary;
    const totalGross = summary.gross || 0;
    const totalNet = summary.net || 0;
    const totalAmt = summary.amount || 0;
    let totalSlips = 0;
    (summary.days || []).forEach(d => { totalSlips += (d.entries || 0); });

    const avgDedPct = totalGross > 0 ? (((totalGross - totalNet) / totalGross) * 100) : 0;
    const weightedRate = totalNet > 0 ? (totalAmt / totalNet) : 0;
    const factoryMap = summary.factoryMap || {};

    const rowsHtml = summary.days.map((r, idx) => {
      const [y, m, d] = r.date.split('-').map(Number);
      const dtObj = new Date(y, m - 1, d);
      const dayName = dtObj.toLocaleDateString('en-US', { weekday: 'short' });
      const fInfo = factoryMap[r.date] || {};

      const fRate = fInfo.rate ? `₹${Number(fInfo.rate).toFixed(2)}` : '—';
      const fDed = fInfo.water_deduction_pct ? `${Number(fInfo.water_deduction_pct).toFixed(1)}%` : '—';
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

      return `
        <tr style="background-color: ${rowBg};">
          <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${r.date}</td>
          <td style="padding: 7px 8px; border-bottom: 1px solid #e2e8f0; color: #475569;">${dayName}</td>
          <td style="padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">${r.entries}</td>
          <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace;">${Number(r.gross).toFixed(2)}</td>
          <td style="padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #d97706;">${Number(r.standard_deduction_pct || 0).toFixed(1)}%</td>
          <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace; font-weight: 600;">${Number(r.net).toFixed(2)}</td>
          <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace;">₹${Number(r.rate || 0).toFixed(2)}</td>
          <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace; font-weight: 700;">₹${Math.round(r.amount).toLocaleString('en-IN')}</td>
          <td style="padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b;">${fRate}</td>
          <td style="padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b;">${fDed}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Monthly Rates Audit Statement — ${periodName}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 14mm 15mm;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 11px;
            color: #0f172a;
            background: #ffffff;
            line-height: 1.4;
          }
          .header-container {
            border-bottom: 2px solid #0f172a;
            padding-bottom: 14px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .company-title {
            font-size: 18px;
            font-weight: 900;
            letter-spacing: 0.5px;
            color: #0f172a;
          }
          .report-title {
            font-size: 13px;
            font-weight: 700;
            color: #0f766e;
            text-transform: uppercase;
            margin-top: 4px;
            letter-spacing: 0.3px;
          }
          .meta-box {
            text-align: right;
            font-size: 11px;
            color: #475569;
          }
          .meta-box b {
            color: #0f172a;
          }
          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            margin-bottom: 18px;
          }
          .kpi-card {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 10px 12px;
            background: #f8fafc;
          }
          .kpi-label {
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #64748b;
            margin-bottom: 3px;
          }
          .kpi-val {
            font-size: 16px;
            font-weight: 800;
            font-family: monospace;
            color: #0f172a;
          }
          .kpi-sub {
            font-size: 10px;
            color: #64748b;
            margin-top: 2px;
          }
          table.audit-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            margin-bottom: 20px;
          }
          table.audit-table th {
            background-color: #0f172a;
            color: #ffffff;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            padding: 8px 10px;
            border: 1px solid #0f172a;
          }
          table.audit-table td {
            border: 1px solid #e2e8f0;
          }
          .footer-summary td {
            background-color: #f1f5f9;
            font-weight: 800;
            font-size: 11px;
            padding: 9px 10px;
            border-top: 2px solid #0f172a !important;
            border-bottom: 2px solid #0f172a !important;
          }
          .signature-section {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            padding: 0 20px;
            page-break-inside: avoid;
          }
          .sig-box {
            width: 200px;
            text-align: center;
          }
          .sig-line {
            border-top: 1px solid #475569;
            margin-bottom: 6px;
          }
          .sig-label {
            font-size: 10px;
            font-weight: 700;
            color: #334155;
            text-transform: uppercase;
          }
          .disclaimer {
            margin-top: 30px;
            padding-top: 10px;
            border-top: 1px dashed #cbd5e1;
            font-size: 9px;
            color: #94a3b8;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="header-container">
          <div>
            <div class="company-title">LEAF LEDGER PRO</div>
            <div class="report-title">Monthly Green Leaf Rates & Auditing Statement</div>
          </div>
          <div class="meta-box">
            <div>Audit Period: <b>${periodName.toUpperCase()}</b></div>
            <div>Generated: <b>${generatedOn}</b></div>
            <div>Status: <b>Official Settled Record</b></div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Gross Intake</div>
            <div class="kpi-val">${Math.round(totalGross).toLocaleString('en-IN')} kg</div>
            <div class="kpi-sub">${totalSlips} Intake Batches</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Net Purchased</div>
            <div class="kpi-val">${Math.round(totalNet).toLocaleString('en-IN')} kg</div>
            <div class="kpi-sub">Avg Ded: ${avgDedPct.toFixed(2)}%</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Weighted Avg Rate</div>
            <div class="kpi-val">₹ ${weightedRate.toFixed(2)}</div>
            <div class="kpi-sub">per net kg leaf</div>
          </div>
          <div class="kpi-card" style="background-color: #f0fdf4; border-color: #86efac;">
            <div class="kpi-label" style="color: #166534;">Total Net Payable</div>
            <div class="kpi-val" style="color: #166534;">₹ ${Math.round(totalAmt).toLocaleString('en-IN')}</div>
            <div class="kpi-sub" style="color: #15803d;">Final Farmer Liability</div>
          </div>
        </div>

        <table class="audit-table">
          <thead>
            <tr>
              <th style="text-align: left;">Date</th>
              <th style="text-align: left;">Day</th>
              <th style="text-align: center;">Slips</th>
              <th style="text-align: right;">Gross (kg)</th>
              <th style="text-align: center;">Ded %</th>
              <th style="text-align: right;">Net (kg)</th>
              <th style="text-align: right;">Rate (₹/kg)</th>
              <th style="text-align: right;">Amount (₹)</th>
              <th style="text-align: center;">F.Rate</th>
              <th style="text-align: center;">F.Ded%</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="footer-summary">
              <td colspan="2">TOTAL</td>
              <td style="text-align: center;">${totalSlips}</td>
              <td style="text-align: right; font-family: monospace;">${Number(totalGross).toFixed(2)}</td>
              <td style="text-align: center; color: #d97706;">${avgDedPct.toFixed(1)}%</td>
              <td style="text-align: right; font-family: monospace;">${Number(totalNet).toFixed(2)}</td>
              <td style="text-align: right; font-family: monospace;">₹${weightedRate.toFixed(2)}</td>
              <td style="text-align: right; font-family: monospace;">₹${Math.round(totalAmt).toLocaleString('en-IN')}</td>
              <td colspan="2" style="text-align: center; color: #64748b; font-size: 9px;">Audited Ledger</td>
            </tr>
          </tfoot>
        </table>

        <div class="signature-section">
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">Prepared By (Agent)</div>
          </div>
          <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">Verified By (Auditor)</div>
          </div>
        </div>

        <div class="disclaimer">
          This document is an authentic certified commercial report generated by Leaf Ledger Pro Enterprise ERP system.
        </div>
      </body>
      </html>
    `;

    const defaultFilename = `Rates_Audit_Report_${monthNames[this.currentMonth]}_${this.currentYear}.pdf`;

    this.showProcessing('Generating formal PDF report...');

    try {
      if (window.electronAPI?.printer?.exportPdf) {
        const res = await window.electronAPI.printer.exportPdf(html, defaultFilename);
        this.hideProcessing();

        if (res?.success) {
          app.showToast('PDF exported and opened successfully.', 'success');
        } else if (res?.canceled) {
          app.showToast('Export cancelled.', 'info');
        } else {
          app.showToast(`Export error: ${res?.error || 'Failed to save PDF'}`, 'error');
        }
      } else {
        await window.electronAPI.printer.printHtml(html);
        this.hideProcessing();
        app.showToast('Report sent to PDF printer preview.', 'success');
      }
    } catch (err) {
      this.hideProcessing();
      console.error('[RatesModule] exportPDF error:', err);
      app.showToast(`Export failed: ${err.message}`, 'error');
    }
  },

  showProcessing(msg = 'Processing server-side updates...') {
    const overlay = document.getElementById('ratesProcessingOverlay');
    const msgEl = document.getElementById('ratesProcessingMsg');
    if (msgEl) msgEl.innerText = msg;
    if (overlay) overlay.style.display = 'flex';
  },

  hideProcessing() {
    const overlay = document.getElementById('ratesProcessingOverlay');
    if (overlay) overlay.style.display = 'none';
  }
};

window.ratesModule = ratesModule;
