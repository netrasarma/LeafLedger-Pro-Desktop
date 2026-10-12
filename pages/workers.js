/**
 * Leaf Ledger Pro - Workers & Labor Management Module
 * Comprehensive management for Temporary Daily Wage Laborers (Hazira/Thika) & Permanent Monthly Staff
 */

const workersModule = {
  currentTab: 'attendance',
  currentDateStr: '',
  workersList: [],
  staffList: [],
  attendanceMap: {}, // worker_id -> attendance_row
  payoutsList: [],
  profileWorkerId: null,
  profileCalYear: new Date().getFullYear(),
  profileCalMonth: new Date().getMonth(),
  profileSubTab: 'calendar',

  async init() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.currentDateStr = `${yyyy}-${mm}-${dd}`;

    const dateIn = document.getElementById('wrkAttendanceDate');
    if (dateIn) dateIn.value = this.currentDateStr;

    const fromDateIn = document.getElementById('wrkPayFromDate');
    const toDateIn = document.getElementById('wrkPayToDate');
    if (fromDateIn) fromDateIn.value = `${yyyy}-${mm}-01`;
    if (toDateIn) toDateIn.value = this.currentDateStr;

    const joinDateIn = document.getElementById('wrkInputJoinDate');
    if (joinDateIn) joinDateIn.value = this.currentDateStr;

    const payoutDateIn = document.getElementById('payoutInputDate');
    if (payoutDateIn) payoutDateIn.value = this.currentDateStr;

    await this.loadAllData();
  },

  switchTab(tabId) {
    this.currentTab = tabId;

    const tabs = ['attendance', 'directory', 'payroll', 'staff'];
    tabs.forEach(t => {
      const pane = document.getElementById(`wrkTabPane_${t}`);
      const btn = document.getElementById(`wrkTabBtn_${t}`);
      if (pane) pane.style.display = (t === tabId) ? 'flex' : 'none';
      if (btn) {
        if (t === tabId) {
          btn.style.background = 'var(--bg-card)';
          btn.style.borderBottom = '2px solid var(--accent-emerald)';
          btn.style.color = 'var(--accent-emerald)';
          btn.style.fontWeight = '800';
        } else {
          btn.style.background = 'transparent';
          btn.style.borderBottom = 'none';
          btn.style.color = 'var(--text-secondary)';
          btn.style.fontWeight = '700';
        }
      }
    });

    const dateGroup = document.getElementById('wrkDateSelectorGroup');
    if (dateGroup) {
      dateGroup.style.display = (tabId === 'attendance') ? 'flex' : 'none';
    }

    if (tabId === 'directory') {
      this.renderDirectoryTable();
    } else if (tabId === 'attendance') {
      this.loadAttendanceForDate();
    } else if (tabId === 'payroll') {
      this.calculatePayroll();
    } else if (tabId === 'staff') {
      this.loadStaffFleet();
    }
  },

  async loadAllData() {
    try {
      // 1. Fetch Workers
      const wrkRes = await window.electronAPI.db.query(
        `SELECT * FROM workers ORDER BY status ASC, name ASC`
      );
      this.workersList = wrkRes?.data || (Array.isArray(wrkRes) ? wrkRes : []);

      // 2. Fetch Payouts for Current Month
      const [y, m] = this.currentDateStr.split('-');
      const monthStart = `${y}-${m}-01`;
      const monthEnd = `${y}-${m}-31`;

      const payRes = await window.electronAPI.db.query(
        `SELECT * FROM worker_payouts WHERE payment_date BETWEEN ? AND ?`,
        [monthStart, monthEnd]
      );
      this.payoutsList = payRes?.data || (Array.isArray(payRes) ? payRes : []);

      // 3. Fetch Staff Fleet
      await this.loadStaffFleet();

      // 4. Update Top KPIs
      this.updateTopKPIs();

      // 5. Render Current Tab
      if (this.currentTab === 'attendance') {
        await this.loadAttendanceForDate();
      } else if (this.currentTab === 'directory') {
        this.renderDirectoryTable();
      } else if (this.currentTab === 'payroll') {
        this.calculatePayroll();
      } else if (this.currentTab === 'staff') {
        this.renderStaffTable();
      }

    } catch (err) {
      console.error('[workersModule] loadAllData error:', err);
      app.showToast(`Error loading workers: ${err.message}`, 'error');
    }
  },

  updateTopKPIs() {
    const totalActive = this.workersList.filter(w => w.status === 'active');
    const tempWorkers = totalActive.filter(w => w.worker_type === 'temporary');
    const permWorkers = totalActive.filter(w => w.worker_type === 'permanent');

    const kpiTotal = document.getElementById('wrkKpiTotal');
    const kpiTypes = document.getElementById('wrkKpiTypes');
    if (kpiTotal) kpiTotal.innerText = `${totalActive.length} Active`;
    if (kpiTypes) kpiTypes.innerText = `${tempWorkers.length} Daily • ${permWorkers.length} Monthly`;

    // Monthly payouts
    let monthPayoutTotal = 0;
    this.payoutsList.forEach(p => { monthPayoutTotal += (p.amount || 0); });
    const kpiMonthPay = document.getElementById('wrkKpiMonthPayout');
    const kpiMonthCount = document.getElementById('wrkKpiMonthDisbursedCount');
    if (kpiMonthPay) kpiMonthPay.innerText = `₹ ${Math.round(monthPayoutTotal).toLocaleString('en-IN')}`;
    if (kpiMonthCount) kpiMonthCount.innerText = `${this.payoutsList.length} wage disbursement${this.payoutsList.length === 1 ? '' : 's'}`;
  },

  // =========================================================================
  // TAB 1: Attendance Register Methods
  // =========================================================================

  changeAttendanceDate(offsetDays) {
    const [y, m, d] = this.currentDateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + offsetDays);

    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    this.currentDateStr = `${yyyy}-${mm}-${dd}`;

    const dateIn = document.getElementById('wrkAttendanceDate');
    if (dateIn) dateIn.value = this.currentDateStr;

    this.loadAttendanceForDate();
  },

  jumpAttendanceToday() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    this.currentDateStr = `${yyyy}-${mm}-${dd}`;

    const dateIn = document.getElementById('wrkAttendanceDate');
    if (dateIn) dateIn.value = this.currentDateStr;

    this.loadAttendanceForDate();
  },

  async loadAttendanceForDate() {
    const dateIn = document.getElementById('wrkAttendanceDate');
    if (dateIn && dateIn.value) {
      this.currentDateStr = dateIn.value;
    }

    const heading = document.getElementById('wrkAttDateHeading');
    if (heading) {
      const isToday = this.currentDateStr === new Date().toISOString().split('T')[0];
      heading.innerText = isToday ? `Roll Call: Today (${this.currentDateStr})` : `Roll Call: ${this.currentDateStr}`;
    }

    try {
      const res = await window.electronAPI.db.query(
        `SELECT * FROM worker_attendance WHERE date = ?`,
        [this.currentDateStr]
      );
      const rows = res?.data || (Array.isArray(res) ? res : []);

      this.attendanceMap = {};
      rows.forEach(r => {
        this.attendanceMap[r.worker_id] = {
          ...r,
          wage_earned: Number(r.wage_earned) || 0,
          is_paid: Number(r.is_paid) || 0
        };
      });

      // Initialize defaults for active workers not yet in database for this date
      const activeWorkers = this.workersList.filter(w => w.status === 'active');
      activeWorkers.forEach(w => {
        if (!this.attendanceMap[w.id]) {
          this.attendanceMap[w.id] = {
            worker_id: w.id,
            date: this.currentDateStr,
            status: 'absent',
            wage_earned: 0,
            is_paid: 0,
            notes: ''
          };
        }
      });

      this.renderAttendanceTable();

    } catch (err) {
      console.error('[workersModule] loadAttendanceForDate error:', err);
      app.showToast(`Error fetching attendance: ${err.message}`, 'error');
    }
  },

  markAllPresent() {
    const activeWorkers = this.workersList.filter(w => w.status === 'active');
    activeWorkers.forEach(w => {
      const rate = Number(w.rate || 0);
      const isTemp = w.worker_type === 'temporary';
      const wage = isTemp ? rate : 0;

      if (!this.attendanceMap[w.id]) {
        this.attendanceMap[w.id] = {
          worker_id: w.id,
          date: this.currentDateStr,
          status: 'present',
          wage_earned: wage,
          is_paid: 0,
          notes: ''
        };
      } else {
        this.attendanceMap[w.id].status = 'present';
        this.attendanceMap[w.id].wage_earned = wage;
      }
    });

    this.renderAttendanceTable();
    app.showToast(`Marked ${activeWorkers.length} active workers as Present for ${this.currentDateStr}.`, 'info');
  },

  markAllPaid() {
    const activeWorkers = this.workersList.filter(w => w.status === 'active');
    activeWorkers.forEach(w => {
      if (!this.attendanceMap[w.id]) {
        const rate = Number(w.rate || 0);
        const isTemp = w.worker_type === 'temporary';
        this.attendanceMap[w.id] = {
          worker_id: w.id,
          date: this.currentDateStr,
          status: 'present',
          wage_earned: isTemp ? rate : 0,
          is_paid: 1,
          notes: ''
        };
      } else {
        this.attendanceMap[w.id].is_paid = 1;
      }
    });

    this.renderAttendanceTable();
    app.showToast(`Marked all daily wages as Paid for ${this.currentDateStr}. Don't forget to click Save!`, 'success');
  },

  togglePaidStatus(workerId) {
    if (!this.attendanceMap[workerId]) {
      const w = this.workersList.find(x => x.id === workerId);
      const rate = Number(w?.rate || 0);
      const isTemp = w?.worker_type === 'temporary';
      this.attendanceMap[workerId] = {
        worker_id: workerId,
        date: this.currentDateStr,
        status: 'present',
        wage_earned: isTemp ? rate : 0,
        is_paid: 1,
        notes: ''
      };
    } else {
      const current = this.attendanceMap[workerId].is_paid;
      this.attendanceMap[workerId].is_paid = (current === 1) ? 0 : 1;
    }

    this.renderAttendanceTable();
  },

  setAttendanceStatus(workerId, status) {
    const worker = this.workersList.find(w => w.id === workerId);
    if (!worker) return;

    const rate = Number(worker.rate || 0);
    const isTemp = worker.worker_type === 'temporary';
    
    let mult = 0;
    if (status === 'present') mult = 1.0;
    else if (status === 'half_day') mult = 0.5;

    const wage = isTemp ? (rate * mult) : 0;

    if (!this.attendanceMap[workerId]) {
      this.attendanceMap[workerId] = {
        worker_id: workerId,
        date: this.currentDateStr,
        status: status,
        wage_earned: wage,
        notes: ''
      };
    } else {
      this.attendanceMap[workerId].status = status;
      this.attendanceMap[workerId].wage_earned = wage;
    }

    this.renderAttendanceTable();
  },

  onWageInputChange(workerId, value) {
    const numVal = Math.max(0, parseFloat(value) || 0);
    if (!this.attendanceMap[workerId]) {
      this.attendanceMap[workerId] = {
        worker_id: workerId,
        date: this.currentDateStr,
        status: 'present',
        wage_earned: numVal,
        notes: ''
      };
    } else {
      this.attendanceMap[workerId].wage_earned = numVal;
    }

    const inputEl = document.getElementById(`wrkWageInput_${workerId}`);
    if (inputEl) {
      inputEl.style.color = numVal > 0 ? 'var(--accent-emerald-light)' : 'var(--text-muted)';
    }

    this.recalculateAttendanceTotals();
  },

  updateAttendanceDutyNotes(workerId, text) {
    if (!this.attendanceMap[workerId]) {
      this.attendanceMap[workerId] = {
        worker_id: workerId,
        date: this.currentDateStr,
        status: 'present',
        wage_earned: 0,
        notes: text
      };
    } else {
      this.attendanceMap[workerId].notes = text;
    }
  },

  recalculateAttendanceTotals() {
    const search = (document.getElementById('wrkAttSearch')?.value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('wrkAttFilterType')?.value || 'ALL';

    const activeWorkers = this.workersList.filter(w => {
      if (w.status !== 'active') return false;
      if (typeFilter !== 'ALL' && w.worker_type !== typeFilter) return false;
      if (search && !w.name.toLowerCase().includes(search) && !(w.designation || '').toLowerCase().includes(search)) return false;
      return true;
    });

    let presentCount = 0;
    let halfCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let totalWageLiability = 0;
    let paidWageTotal = 0;

    activeWorkers.forEach(w => {
      const att = this.attendanceMap[w.id];
      const status = att ? att.status : 'absent';
      const wage = att ? (att.wage_earned || 0) : 0;
      const isPaid = att ? (att.is_paid === 1) : false;

      if (status === 'present') presentCount++;
      else if (status === 'half_day') halfCount++;
      else if (status === 'absent') absentCount++;
      else if (status === 'leave') leaveCount++;

      totalWageLiability += wage;
      if (isPaid) paidWageTotal += wage;
    });

    this.updateAttendanceCounters(activeWorkers, presentCount, halfCount, absentCount, totalWageLiability, paidWageTotal);
  },

  renderAttendanceTable() {
    const container = document.getElementById('wrkAttendanceListContainer');
    if (!container) return;

    const search = (document.getElementById('wrkAttSearch')?.value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('wrkAttFilterType')?.value || 'ALL';

    const activeWorkers = this.workersList.filter(w => {
      if (w.status !== 'active') return false;
      if (typeFilter !== 'ALL' && w.worker_type !== typeFilter) return false;
      if (search && !w.name.toLowerCase().includes(search) && !(w.designation || '').toLowerCase().includes(search)) return false;
      return true;
    });

    if (activeWorkers.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 50px 20px;">
          <i class="fa-solid fa-user-clock" style="font-size: 32px; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
          <div style="font-weight: 700; color: var(--text-secondary);">No active workers found matching criteria</div>
          <div style="font-size: 11px; margin-top: 4px;">Click "+ Add Worker" above to register workers in your workforce.</div>
        </div>
      `;
      this.updateAttendanceCounters([], 0, 0, 0, 0, 0);
      return;
    }

    let presentCount = 0;
    let halfCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    let totalWageLiability = 0;
    let paidWageTotal = 0;

    let html = '';
    activeWorkers.forEach((w, idx) => {
      const att = this.attendanceMap[w.id] || null;
      const status = att ? att.status : 'absent';
      const wageEarned = att ? (att.wage_earned || 0) : 0;
      const isPaid = att ? (att.is_paid === 1) : false;
      const dutyNotes = att ? (att.notes || '') : '';

      if (status === 'present') presentCount++;
      else if (status === 'half_day') halfCount++;
      else if (status === 'absent') absentCount++;
      else if (status === 'leave') leaveCount++;

      totalWageLiability += wageEarned;
      if (isPaid) paidWageTotal += wageEarned;

      const isTemp = w.worker_type === 'temporary';
      const rateLabel = isTemp ? `₹${w.rate}/day` : `₹${w.rate}/mo`;
      const typeBadge = isTemp 
        ? `<span style="font-size: 10.5px; font-weight: 700; color: var(--accent-amber); background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); padding: 2px 7px; border-radius: 4px; white-space: nowrap;">Daily Wage</span>`
        : `<span style="font-size: 10.5px; font-weight: 700; color: #818cf8; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); padding: 2px 7px; border-radius: 4px; white-space: nowrap;">Monthly Staff</span>`;

      const rowBg = idx % 2 === 0 ? 'var(--bg-input)' : 'transparent';

      const paidBtnHtml = isPaid
        ? `<button type="button" class="btn btn-sm" style="border: none; width: 100%; padding: 4px 6px; font-size: 11px; font-weight: 700; border-radius: 6px; background: rgba(16, 185, 129, 0.18); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); cursor: pointer;" onclick="workersModule.togglePaidStatus('${w.id}')" title="Marked as Paid. Click to toggle.">
             Paid
           </button>`
        : `<button type="button" class="btn btn-sm" style="border: none; width: 100%; padding: 4px 6px; font-size: 11px; font-weight: 700; border-radius: 6px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.28); cursor: pointer;" onclick="workersModule.togglePaidStatus('${w.id}')" title="Unpaid. Click to mark Paid.">
             Unpaid
           </button>`;

      html += `
        <div style="display: grid; grid-template-columns: 2fr 115px 105px 230px 105px 90px 1.4fr; gap: 8px; align-items: center; padding: 7px 10px; margin-bottom: 2px; border-radius: 8px; background: ${rowBg}; font-size: 12px; transition: background 0.15s ease;">
          <div style="cursor: pointer;" onclick="workersModule.openWorkerProfile('${w.id}')" title="Click to view 360° Profile">
            <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">
              ${w.name}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">${w.designation || 'General Duty'} ${w.phone ? `• ${w.phone}` : ''}</div>
          </div>

          <div>${typeBadge}</div>

          <div style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">
            ${rateLabel}
          </div>

          <!-- 4-State Segmented Buttons -->
          <div style="display: flex; justify-content: center; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 2px; gap: 2px;">
            <button type="button" class="btn btn-sm" style="border: none; flex: 1; padding: 3px 0; font-size: 10.5px; font-weight: 700; border-radius: 4px; ${status === 'present' ? 'background: #10b981; color: #fff;' : 'background: transparent; color: var(--text-muted);'}" onclick="workersModule.setAttendanceStatus('${w.id}', 'present')">
              Present
            </button>
            <button type="button" class="btn btn-sm" style="border: none; flex: 1; padding: 3px 0; font-size: 10.5px; font-weight: 700; border-radius: 4px; ${status === 'half_day' ? 'background: #f59e0b; color: #fff;' : 'background: transparent; color: var(--text-muted);'}" onclick="workersModule.setAttendanceStatus('${w.id}', 'half_day')">
              Half
            </button>
            <button type="button" class="btn btn-sm" style="border: none; flex: 1; padding: 3px 0; font-size: 10.5px; font-weight: 700; border-radius: 4px; ${status === 'absent' ? 'background: #ef4444; color: #fff;' : 'background: transparent; color: var(--text-muted);'}" onclick="workersModule.setAttendanceStatus('${w.id}', 'absent')">
              Absent
            </button>
            <button type="button" class="btn btn-sm" style="border: none; flex: 1; padding: 3px 0; font-size: 10.5px; font-weight: 700; border-radius: 4px; ${status === 'leave' ? 'background: #3b82f6; color: #fff;' : 'background: transparent; color: var(--text-muted);'}" onclick="workersModule.setAttendanceStatus('${w.id}', 'leave')">
              Leave
            </button>
          </div>

          <!-- Daily Earned Wage (Fully Editable) -->
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
            <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); font-family: var(--font-mono);">₹</span>
            <input type="number" 
                   id="wrkWageInput_${w.id}"
                   class="form-input mono" 
                   min="0" 
                   step="1"
                   value="${wageEarned !== undefined && wageEarned !== null ? Math.round(wageEarned) : 0}" 
                   style="width: 75px; height: 28px; text-align: right; font-size: 12px; font-weight: 800; padding: 2px 6px; border-radius: 6px; color: ${wageEarned > 0 ? 'var(--accent-emerald-light)' : 'var(--text-muted)'};"
                   oninput="workersModule.onWageInputChange('${w.id}', this.value)"
                   placeholder="0">
          </div>

          <!-- Payout Status (Paid / Unpaid) -->
          <div>
            ${paidBtnHtml}
          </div>

          <!-- Duty Note -->
          <div>
            <input type="text" class="form-input" placeholder="Duty notes..." value="${dutyNotes}" style="height: 28px; width: 100%; font-size: 11px; padding: 2px 6px;" onchange="workersModule.updateAttendanceDutyNotes('${w.id}', this.value)">
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    this.updateAttendanceCounters(activeWorkers, presentCount, halfCount, absentCount, totalWageLiability, paidWageTotal);
  },

  updateAttendanceCounters(workers, present, half, absent, wage, paidWage = 0) {
    const kpiPresent = document.getElementById('wrkKpiPresent');
    const kpiSub = document.getElementById('wrkKpiAbsenceSub');
    if (kpiPresent) kpiPresent.innerText = `${present} Present`;
    if (kpiSub) kpiSub.innerText = `${half} Half Day • ${absent} Absent`;

    const kpiWage = document.getElementById('wrkKpiTodayWage');
    if (kpiWage) kpiWage.innerText = `₹ ${Math.round(wage).toLocaleString('en-IN')}`;

    const footStats = document.getElementById('wrkAttFooterStats');
    const footWage = document.getElementById('wrkAttFooterWage');
    const dueWage = Math.max(0, wage - paidWage);
    if (footStats) footStats.innerText = `Showing ${workers.length} active workers`;
    if (footWage) {
      footWage.innerHTML = `₹ ${Math.round(wage).toLocaleString('en-IN')} <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-left: 6px;">(₹ ${Math.round(dueWage).toLocaleString('en-IN')} Due • <span style="color: #10b981;">₹ ${Math.round(paidWage).toLocaleString('en-IN')} Paid</span>)</span>`;
    }
  },

  async saveAttendanceBatch() {
    try {
      const currentUser = await window.electronAPI.auth.getCurrentUser();
      const appUserId = currentUser?.id || '2e45613e-6514-4070-a459-398c73b05344';

      const activeWorkers = this.workersList.filter(w => w.status === 'active');
      let savedCount = 0;

      for (const w of activeWorkers) {
        const att = this.attendanceMap[w.id] || {
          worker_id: w.id,
          date: this.currentDateStr,
          status: 'absent',
          wage_earned: 0,
          is_paid: 0,
          notes: ''
        };
        const syncId = `att_${w.id}_${this.currentDateStr}`;

        // Correctly check existing record through IPC response wrapper (.data)
        const existRes = await window.electronAPI.db.getOne(
          `SELECT id FROM worker_attendance WHERE worker_id = ? AND date = ?`,
          [w.id, this.currentDateStr]
        );
        const existingRecord = existRes?.data;

        if (existingRecord && existingRecord.id) {
          await window.electronAPI.db.run(
            `UPDATE worker_attendance 
             SET status = ?, wage_earned = ?, is_paid = ?, notes = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [att.status, Number(att.wage_earned) || 0, att.is_paid ? 1 : 0, att.notes || '', existingRecord.id]
          );
        } else {
          const newId = crypto.randomUUID();
          await window.electronAPI.db.run(
            `INSERT INTO worker_attendance (id, app_user_id, worker_id, date, status, wage_earned, is_paid, notes, sync_id, sync_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [newId, appUserId, w.id, this.currentDateStr, att.status, Number(att.wage_earned) || 0, att.is_paid ? 1 : 0, att.notes || '', syncId]
          );
        }
        savedCount++;
      }

      app.showToast(`Saved attendance register for ${savedCount} worker(s) on ${this.currentDateStr}.`, 'success');
      await this.loadAttendanceForDate();
      this.updateTopKPIs();
      window.electronAPI.sync.smartSync('worker_attendance');

    } catch (err) {
      console.error('[workersModule] saveAttendanceBatch error:', err);
      app.showToast(`Failed to save attendance: ${err.message}`, 'error');
    }
  },

  // =========================================================================
  // TAB 2: Worker Directory Methods
  // =========================================================================

  renderDirectoryTable() {
    const container = document.getElementById('wrkDirectoryListContainer');
    if (!container) return;

    const search = (document.getElementById('wrkDirSearch')?.value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('wrkDirFilterType')?.value || 'ALL';
    const statusFilter = document.getElementById('wrkDirFilterStatus')?.value || 'active';

    const filtered = this.workersList.filter(w => {
      if (statusFilter !== 'ALL' && w.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && w.worker_type !== typeFilter) return false;
      if (search && !w.name.toLowerCase().includes(search) && !(w.phone || '').includes(search) && !(w.designation || '').toLowerCase().includes(search)) return false;
      return true;
    });

    const countLabel = document.getElementById('wrkDirCountLabel');
    if (countLabel) countLabel.innerText = `${filtered.length} worker${filtered.length === 1 ? '' : 's'} listed`;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 50px 20px;">
          <i class="fa-solid fa-users-slash" style="font-size: 32px; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
          <div style="font-weight: 700; color: var(--text-secondary);">No workers match the selected filter</div>
          <div style="font-size: 11px; margin-top: 4px;">Click "+ Add Worker" at top right to register new labor.</div>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach((w, idx) => {
      const isTemp = w.worker_type === 'temporary';
      const typeBadge = isTemp 
        ? `<span style="font-size: 10.5px; font-weight: 700; color: var(--accent-amber); background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); padding: 2px 7px; border-radius: 4px;">Daily Wage</span>`
        : `<span style="font-size: 10.5px; font-weight: 700; color: #818cf8; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); padding: 2px 7px; border-radius: 4px;">Monthly Staff</span>`;

      const statusBadge = w.status === 'active'
        ? `<span style="font-size: 10px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.14); padding: 2px 6px; border-radius: 4px;">Active</span>`
        : `<span style="font-size: 10px; font-weight: 700; color: #ef4444; background: rgba(239, 68, 68, 0.14); padding: 2px 6px; border-radius: 4px;">Inactive</span>`;

      const rateText = isTemp ? `₹${w.rate} / day` : `₹${w.rate} / mo`;
      const rowBg = idx % 2 === 0 ? 'var(--bg-input)' : 'transparent';

      html += `
        <div style="display: grid; grid-template-columns: 2fr 130px 130px 120px 120px 90px 180px; gap: 8px; align-items: center; padding: 8px 12px; margin-bottom: 2px; border-radius: 8px; background: ${rowBg}; font-size: 12px; transition: background 0.15s ease;">
          <div style="cursor: pointer;" onclick="workersModule.openWorkerProfile('${w.id}')" title="Click to open 360° Profile">
            <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">
              ${w.name}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">Joined: ${w.joined_date || '—'}</div>
          </div>

          <div style="font-weight: 600; color: var(--text-secondary);">${w.designation || 'General Duty'}</div>

          <div>${typeBadge}</div>

          <div style="text-align: right; font-family: var(--font-mono); font-weight: 800; color: var(--text-primary);">
            ${rateText}
          </div>

          <div style="font-family: var(--font-mono); color: var(--text-secondary);">
            ${w.phone || '—'}
          </div>

          <div style="text-align: center;">${statusBadge}</div>

          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px; color: var(--accent-blue);" title="360° Profile & Attendance Calendar" onclick="workersModule.openWorkerProfile('${w.id}')">
              Profile
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px;" title="Edit Profile" onclick="workersModule.editWorker('${w.id}')">
              Edit
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 8px; color: ${w.status === 'active' ? '#ef4444' : '#10b981'};" title="${w.status === 'active' ? 'Deactivate' : 'Activate'}" onclick="workersModule.toggleWorkerStatus('${w.id}', '${w.status}')">
              ${w.status === 'active' ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  async openWorkerProfile(workerId) {
    const w = this.workersList.find(x => x.id === workerId);
    if (!w) {
      app.showToast('Worker details not found.', 'warning');
      return;
    }

    this.profileWorkerId = workerId;
    const now = new Date();
    this.profileCalYear = now.getFullYear();
    this.profileCalMonth = now.getMonth();

    try {
      // 1. Fetch attendance records and aggregate stats
      const attRes = await window.electronAPI.db.query(
        `SELECT date, status, wage_earned, is_paid 
         FROM worker_attendance 
         WHERE worker_id = ? 
         ORDER BY date DESC`,
        [workerId]
      );
      const attRows = attRes?.data || (Array.isArray(attRes) ? attRes : []);

      let daysWorked = 0;
      let grossWage = 0;
      attRows.forEach(a => {
        if (a.status === 'present') daysWorked += 1.0;
        else if (a.status === 'half_day') daysWorked += 0.5;
        grossWage += (Number(a.wage_earned) || 0);
      });

      // 2. Fetch payouts
      const payRes = await window.electronAPI.db.query(
        `SELECT * FROM worker_payouts WHERE worker_id = ? ORDER BY payment_date DESC, created_at DESC`,
        [workerId]
      );
      const payRows = payRes?.data || (Array.isArray(payRes) ? payRes : []);

      let totalPaid = 0;
      payRows.forEach(p => {
        totalPaid += (Number(p.amount) || 0);
      });

      const dueAmount = Math.max(0, grossWage - totalPaid);

      // 3. Populate Header & Badges
      const avatarEl = document.getElementById('profAvatar');
      if (avatarEl) avatarEl.innerText = (w.name || 'W').charAt(0).toUpperCase();

      const nameEl = document.getElementById('profName');
      if (nameEl) nameEl.innerText = w.name;

      const statusBadge = document.getElementById('profStatusBadge');
      if (statusBadge) {
        statusBadge.innerText = w.status === 'active' ? 'Active' : 'Inactive';
        statusBadge.style.color = w.status === 'active' ? '#10b981' : '#ef4444';
        statusBadge.style.background = w.status === 'active' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)';
      }

      const roleEl = document.getElementById('profRole');
      if (roleEl) roleEl.innerText = w.designation || 'General Duty Worker';

      const typePill = document.getElementById('profTypePill');
      if (typePill) {
        typePill.innerText = w.worker_type === 'temporary' ? 'Daily Wage (Hazira)' : 'Permanent Monthly Staff';
        typePill.style.color = w.worker_type === 'temporary' ? 'var(--accent-amber)' : '#818cf8';
      }

      const rateEl = document.getElementById('profRate');
      if (rateEl) rateEl.innerText = `₹${w.rate}${w.worker_type === 'temporary' ? ' / day' : ' / month'}`;

      // 4. Global KPI Counters in Header Bar
      const kpiDays = document.getElementById('profStatDays');
      const kpiGross = document.getElementById('profStatGross');
      const kpiPaid = document.getElementById('profStatPaid');
      const kpiDue = document.getElementById('profStatDue');

      if (kpiDays) kpiDays.innerText = `${daysWorked} d`;
      if (kpiGross) kpiGross.innerText = `₹ ${Math.round(grossWage).toLocaleString('en-IN')}`;
      if (kpiPaid) kpiPaid.innerText = `₹ ${Math.round(totalPaid).toLocaleString('en-IN')}`;
      if (kpiDue) kpiDue.innerText = `₹ ${Math.round(dueAmount).toLocaleString('en-IN')}`;

      // 5. Personal Credentials
      const fPhone = document.getElementById('profFieldPhone');
      const fEmergency = document.getElementById('profFieldEmergency');
      const fJoined = document.getElementById('profFieldJoined');
      const fIdProof = document.getElementById('profFieldIdProof');
      const fAddress = document.getElementById('profFieldAddress');

      if (fPhone) fPhone.innerText = w.phone || '—';
      if (fEmergency) fEmergency.innerText = w.emergency_phone || '—';
      if (fJoined) fJoined.innerText = w.joined_date || '—';
      if (fIdProof) fIdProof.innerText = w.id_proof_number || '—';
      if (fAddress) fAddress.innerText = w.address || '—';

      // 6. Bank & Digital Payment
      const fBank = document.getElementById('profFieldBank');
      const fAcc = document.getElementById('profFieldAcc');
      const fIfsc = document.getElementById('profFieldIfsc');
      const fUpi = document.getElementById('profFieldUpi');

      if (fBank) fBank.innerText = w.bank_name || '—';
      if (fAcc) fAcc.innerText = w.bank_acc || '—';
      if (fIfsc) fIfsc.innerText = w.bank_ifsc || '—';
      if (fUpi) fUpi.innerText = w.upi_id || '—';

      // 7. Mini Payouts Ledger
      const countEl = document.getElementById('profPayoutCount');
      if (countEl) countEl.innerText = `${payRows.length} record${payRows.length === 1 ? '' : 's'}`;

      const listContainer = document.getElementById('profPayoutList');
      if (listContainer) {
        if (payRows.length === 0) {
          listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px 0; font-size: 11.5px;">No payouts recorded yet for this worker.</div>`;
        } else {
          listContainer.innerHTML = payRows.map(p => {
            const typeLabel = p.payout_type === 'daily_wage' ? 'Daily Wage' : (p.payout_type === 'advance' ? 'Advance' : 'Monthly Salary');
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-input); border-radius: 8px; margin-bottom: 5px; font-size: 12px; border: 1px solid var(--border-subtle);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">${p.payment_date}</span>
                  <span style="font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: rgba(59, 130, 246, 0.14); color: #3b82f6;">${typeLabel}</span>
                  <span style="color: var(--text-muted); font-size: 11px;">(${p.payment_mode || 'Cash'})</span>
                  ${p.notes ? `<span style="color: var(--text-secondary); font-size: 11px;">• ${p.notes}</span>` : ''}
                </div>
                <div style="font-family: var(--font-mono); font-weight: 800; color: #10b981; font-size: 13px;">
                  ₹ ${Math.round(p.amount || 0).toLocaleString('en-IN')}
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // 8. Bind Bottom Modal Actions
      const btnEdit = document.getElementById('profBtnEdit');
      if (btnEdit) {
        btnEdit.onclick = () => {
          app.closeModal('modalWorkerProfile');
          this.editWorker(workerId);
        };
      }

      const btnDisburse = document.getElementById('profBtnDisburse');
      if (btnDisburse) {
        btnDisburse.onclick = () => {
          app.closeModal('modalWorkerProfile');
          this.openPayoutModal(workerId, dueAmount, w.worker_type === 'temporary' ? 'daily_wage' : 'monthly_salary');
        };
      }

      // 9. Switch to Default Sub-tab (Monthly Attendance Calendar)
      this.switchProfileSubTab('calendar');

      app.openModal('modalWorkerProfile');

    } catch (err) {
      console.error('[workersModule] openWorkerProfile error:', err);
      app.showToast(`Error loading profile: ${err.message}`, 'error');
    }
  },

  switchProfileSubTab(subTabId) {
    this.profileSubTab = subTabId;
    const tabs = ['calendar', 'personal', 'payouts'];
    tabs.forEach(t => {
      const pane = document.getElementById(`profSubTabPane_${t}`);
      const btn = document.getElementById(`profSubTabBtn_${t}`);
      if (pane) pane.style.display = (t === subTabId) ? 'flex' : 'none';
      if (btn) {
        if (t === subTabId) {
          btn.style.color = 'var(--accent-emerald)';
          btn.style.borderBottom = '2px solid var(--accent-emerald)';
          btn.style.fontWeight = '800';
        } else {
          btn.style.color = 'var(--text-secondary)';
          btn.style.borderBottom = '2px solid transparent';
          btn.style.fontWeight = '700';
        }
      }
    });

    if (subTabId === 'calendar') {
      this.renderProfileCalendar();
    }
  },

  changeProfileCalendarMonth(offset) {
    this.profileCalMonth += offset;
    if (this.profileCalMonth < 0) {
      this.profileCalMonth = 11;
      this.profileCalYear -= 1;
    } else if (this.profileCalMonth > 11) {
      this.profileCalMonth = 0;
      this.profileCalYear += 1;
    }
    this.renderProfileCalendar();
  },

  jumpProfileCalendarCurrent() {
    const now = new Date();
    this.profileCalYear = now.getFullYear();
    this.profileCalMonth = now.getMonth();
    this.renderProfileCalendar();
  },

  async renderProfileCalendar() {
    if (!this.profileWorkerId) return;
    const worker = this.workersList.find(w => w.id === this.profileWorkerId);
    if (!worker) return;

    const year = this.profileCalYear;
    const month = this.profileCalMonth;
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthStr = String(month + 1).padStart(2, '0');
    const monthPattern = `${year}-${monthStr}%`;

    const lbl = document.getElementById('profCalMonthLabel');
    if (lbl) lbl.innerText = `${monthNames[month]} ${year}`;

    try {
      // Query attendance for this worker in this month
      const attRes = await window.electronAPI.db.query(
        `SELECT date, status, wage_earned, is_paid, notes 
         FROM worker_attendance 
         WHERE worker_id = ? AND date LIKE ? 
         ORDER BY date ASC`,
        [this.profileWorkerId, monthPattern]
      );
      const rows = attRes?.data || (Array.isArray(attRes) ? attRes : []);
      const attByDate = {};
      let presentCount = 0;
      let halfCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      let monthWage = 0;
      let monthPaid = 0;

      rows.forEach(r => {
        attByDate[r.date] = r;
        const wEarned = Number(r.wage_earned) || 0;
        if (r.status === 'present') {
          presentCount++;
          monthWage += wEarned;
        } else if (r.status === 'half_day') {
          halfCount++;
          monthWage += wEarned;
        } else if (r.status === 'absent') {
          absentCount++;
        } else if (r.status === 'leave') {
          leaveCount++;
        }
        if (r.is_paid === 1) {
          monthPaid += wEarned;
        }
      });

      // Update Month Counter Badges
      const elP = document.getElementById('profCalPresCount');
      const elH = document.getElementById('profCalHalfCount');
      const elA = document.getElementById('profCalAbsCount');
      const elW = document.getElementById('profCalMonthWage');
      const elPaid = document.getElementById('profCalMonthPaid');

      if (elP) elP.innerText = presentCount;
      if (elH) elH.innerText = halfCount;
      if (elA) elA.innerText = absentCount;
      if (elW) elW.innerText = `₹ ${Math.round(monthWage).toLocaleString('en-IN')}`;
      if (elPaid) elPaid.innerText = `₹ ${Math.round(monthPaid).toLocaleString('en-IN')}`;

      // Build 7-column Calendar Days Grid
      const grid = document.getElementById('profCalGrid');
      if (!grid) return;

      const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
      const totalDays = new Date(year, month + 1, 0).getDate();
      const todayStr = new Date().toISOString().split('T')[0];

      let html = '';

      // Padding cells before first day
      for (let i = 0; i < firstDayOfWeek; i++) {
        html += `<div style="min-height: 68px; border-radius: 8px; background: rgba(0,0,0,0.06); border: 1px dashed var(--border-subtle); opacity: 0.3;"></div>`;
      }

      // Day cells
      for (let d = 1; d <= totalDays; d++) {
        const dayStr = `${year}-${monthStr}-${String(d).padStart(2, '0')}`;
        const att = attByDate[dayStr];
        const isToday = (dayStr === todayStr);
        const dayOfWeek = new Date(year, month, d).getDay();
        const isSunday = (dayOfWeek === 0);

        let cellBorder = '1px solid var(--border-subtle)';
        let cellBg = 'var(--bg-input)';
        let statusBadge = '';
        let wageHtml = '';
        let paidHtml = '';
        let noteHtml = '';

        if (att) {
          const wEarned = Number(att.wage_earned) || 0;
          if (att.status === 'present') {
            cellBorder = '1px solid rgba(16, 185, 129, 0.45)';
            cellBg = 'rgba(16, 185, 129, 0.09)';
            statusBadge = `<span style="font-size: 9.5px; font-weight: 800; background: #10b981; color: #fff; padding: 1px 5px; border-radius: 4px;">P</span>`;
            wageHtml = `<div style="font-size: 11px; font-weight: 800; color: var(--accent-emerald-light); font-family: var(--font-mono); margin-top: 2px;">₹${Math.round(wEarned)}</div>`;
          } else if (att.status === 'half_day') {
            cellBorder = '1px solid rgba(245, 158, 11, 0.45)';
            cellBg = 'rgba(245, 158, 11, 0.09)';
            statusBadge = `<span style="font-size: 9.5px; font-weight: 800; background: #f59e0b; color: #fff; padding: 1px 5px; border-radius: 4px;">H</span>`;
            wageHtml = `<div style="font-size: 11px; font-weight: 800; color: var(--accent-amber); font-family: var(--font-mono); margin-top: 2px;">₹${Math.round(wEarned)}</div>`;
          } else if (att.status === 'absent') {
            cellBorder = '1px solid rgba(239, 68, 68, 0.35)';
            cellBg = 'rgba(239, 68, 68, 0.06)';
            statusBadge = `<span style="font-size: 9.5px; font-weight: 800; background: #ef4444; color: #fff; padding: 1px 5px; border-radius: 4px;">A</span>`;
          } else if (att.status === 'leave') {
            cellBorder = '1px solid rgba(59, 130, 246, 0.35)';
            cellBg = 'rgba(59, 130, 246, 0.06)';
            statusBadge = `<span style="font-size: 9.5px; font-weight: 800; background: #3b82f6; color: #fff; padding: 1px 5px; border-radius: 4px;">L</span>`;
          }

          if (wEarned > 0) {
            paidHtml = att.is_paid === 1
              ? `<span style="font-size: 9.5px; font-weight: 700; color: #10b981;">Paid</span>`
              : `<span style="font-size: 9.5px; font-weight: 700; color: #ef4444;">Due</span>`;
          }

          if (att.notes) {
            noteHtml = `<div style="font-size: 9px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55px;" title="${att.notes}">${att.notes}</div>`;
          }
        }

        const todayRing = isToday ? 'box-shadow: 0 0 0 1.5px var(--accent-emerald);' : '';
        const dayColor = isToday ? 'var(--accent-emerald-light)' : (isSunday ? '#ef4444' : 'var(--text-primary)');

        html += `
          <div style="min-height: 68px; border-radius: 8px; border: ${cellBorder}; background: ${cellBg}; padding: 6px; display: flex; flex-direction: column; justify-content: space-between; position: relative; ${todayRing}">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 12px; font-weight: 800; color: ${dayColor}; font-family: var(--font-mono);">${d}</span>
              ${statusBadge}
            </div>
            
            <div style="margin-top: auto; display: flex; flex-direction: column; gap: 1px;">
              ${wageHtml}
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 2px;">
                ${paidHtml}
                ${noteHtml}
              </div>
            </div>
          </div>
        `;
      }

      grid.innerHTML = html;

    } catch (err) {
      console.error('[workersModule] renderProfileCalendar error:', err);
    }
  },

  openAddWorkerModal(editId = null) {
    const modalTitle = document.getElementById('modalWorkerTitle');
    const editIdIn = document.getElementById('wrkEditId');
    const nameIn = document.getElementById('wrkInputName');
    const rateIn = document.getElementById('wrkInputRate');
    const roleIn = document.getElementById('wrkInputRole');
    const phoneIn = document.getElementById('wrkInputPhone');
    const emPhoneIn = document.getElementById('wrkInputEmergencyPhone');
    const joinIn = document.getElementById('wrkInputJoinDate');
    const idProofIn = document.getElementById('wrkInputIdProof');
    const addressIn = document.getElementById('wrkInputAddress');
    const bankNameIn = document.getElementById('wrkInputBankName');
    const bankAccIn = document.getElementById('wrkInputBankAcc');
    const bankIfscIn = document.getElementById('wrkInputBankIfsc');
    const upiIdIn = document.getElementById('wrkInputUpiId');
    const notesIn = document.getElementById('wrkInputNotes');

    if (editId) {
      const w = this.workersList.find(x => x.id === editId);
      if (!w) return;

      if (modalTitle) modalTitle.innerText = `Edit Worker: ${w.name}`;
      if (editIdIn) editIdIn.value = w.id;
      if (nameIn) nameIn.value = w.name;
      if (rateIn) rateIn.value = w.rate;
      if (roleIn) roleIn.value = w.designation || '';
      if (phoneIn) phoneIn.value = w.phone || '';
      if (emPhoneIn) emPhoneIn.value = w.emergency_phone || '';
      if (joinIn) joinIn.value = w.joined_date || this.currentDateStr;
      if (idProofIn) idProofIn.value = w.id_proof_number || '';
      if (addressIn) addressIn.value = w.address || '';
      if (bankNameIn) bankNameIn.value = w.bank_name || '';
      if (bankAccIn) bankAccIn.value = w.bank_acc || '';
      if (bankIfscIn) bankIfscIn.value = w.bank_ifsc || '';
      if (upiIdIn) upiIdIn.value = w.upi_id || '';
      if (notesIn) notesIn.value = w.notes || '';

      const radios = document.getElementsByName('wrkRadioType');
      radios.forEach(r => { r.checked = (r.value === w.worker_type); });
    } else {
      if (modalTitle) modalTitle.innerText = 'Add New Worker / Laborer';
      if (editIdIn) editIdIn.value = '';
      if (nameIn) nameIn.value = '';
      if (rateIn) rateIn.value = '350';
      if (roleIn) roleIn.value = '';
      if (phoneIn) phoneIn.value = '';
      if (emPhoneIn) emPhoneIn.value = '';
      if (joinIn) joinIn.value = this.currentDateStr;
      if (idProofIn) idProofIn.value = '';
      if (addressIn) addressIn.value = '';
      if (bankNameIn) bankNameIn.value = '';
      if (bankAccIn) bankAccIn.value = '';
      if (bankIfscIn) bankIfscIn.value = '';
      if (upiIdIn) upiIdIn.value = '';
      if (notesIn) notesIn.value = '';

      const radios = document.getElementsByName('wrkRadioType');
      radios.forEach(r => { r.checked = (r.value === 'temporary'); });
    }

    this.onWorkerTypeChange();
    app.openModal('modalAddWorker');
    setTimeout(() => { nameIn?.focus(); }, 100);
  },

  editWorker(id) {
    this.openAddWorkerModal(id);
  },

  onWorkerTypeChange() {
    const selected = document.querySelector('input[name="wrkRadioType"]:checked')?.value || 'temporary';
    const label = document.getElementById('wrkRateLabel');
    const rateIn = document.getElementById('wrkInputRate');

    if (label) {
      label.innerHTML = selected === 'temporary' 
        ? 'Daily Wage Rate (₹ / Day) <span style="color: #ef4444;">*</span>' 
        : 'Monthly Base Salary (₹ / Month) <span style="color: #ef4444;">*</span>';
    }

    if (rateIn && !rateIn.value) {
      rateIn.placeholder = selected === 'temporary' ? '350' : '12000';
    }
  },

  async saveWorkerProfile() {
    const editId = document.getElementById('wrkEditId')?.value;
    const name = document.getElementById('wrkInputName')?.value.trim();
    const type = document.querySelector('input[name="wrkRadioType"]:checked')?.value || 'temporary';
    const rate = parseFloat(document.getElementById('wrkInputRate')?.value || '0');
    const role = document.getElementById('wrkInputRole')?.value.trim();
    const phone = document.getElementById('wrkInputPhone')?.value.trim();
    const emergencyPhone = document.getElementById('wrkInputEmergencyPhone')?.value.trim();
    const joinDate = document.getElementById('wrkInputJoinDate')?.value;
    const idProof = document.getElementById('wrkInputIdProof')?.value.trim();
    const address = document.getElementById('wrkInputAddress')?.value.trim();
    const bankName = document.getElementById('wrkInputBankName')?.value.trim();
    const bankAcc = document.getElementById('wrkInputBankAcc')?.value.trim();
    const bankIfsc = (document.getElementById('wrkInputBankIfsc')?.value.trim() || '').toUpperCase();
    const upiId = document.getElementById('wrkInputUpiId')?.value.trim();
    const notes = document.getElementById('wrkInputNotes')?.value.trim();

    if (!name) {
      app.showToast('Please enter the worker full name.', 'warning');
      return;
    }

    if (isNaN(rate) || rate < 0) {
      app.showToast('Please enter a valid wage or salary rate.', 'warning');
      return;
    }

    try {
      const currentUser = await window.electronAPI.auth.getCurrentUser();
      const appUserId = currentUser?.id || '2e45613e-6514-4070-a459-398c73b05344';

      if (editId) {
        await window.electronAPI.db.run(
          `UPDATE workers 
           SET name = ?, worker_type = ?, rate = ?, designation = ?, phone = ?, emergency_phone = ?,
               address = ?, id_proof_number = ?, bank_name = ?, bank_acc = ?, bank_ifsc = ?, upi_id = ?,
               joined_date = ?, notes = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [name, type, rate, role, phone, emergencyPhone, address, idProof, bankName, bankAcc, bankIfsc, upiId, joinDate, notes, editId]
        );
        app.showToast(`Worker profile for "${name}" updated.`, 'success');
      } else {
        const newId = crypto.randomUUID();
        const syncId = `wrk_${newId}`;
        await window.electronAPI.db.run(
          `INSERT INTO workers (id, app_user_id, name, phone, emergency_phone, address, id_proof_number,
                                bank_name, bank_acc, bank_ifsc, upi_id, worker_type, rate, designation,
                                status, joined_date, notes, sync_id, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`,
          [newId, appUserId, name, phone, emergencyPhone, address, idProof, bankName, bankAcc, bankIfsc, upiId, type, rate, role, joinDate, notes, syncId]
        );
        app.showToast(`Worker "${name}" registered successfully.`, 'success');
      }

      app.closeModal('modalAddWorker');
      await this.loadAllData();
      window.electronAPI.sync.smartSync('workers');

    } catch (err) {
      console.error('[workersModule] saveWorkerProfile error:', err);
      app.showToast(`Error saving worker profile: ${err.message}`, 'error');
    }
  },

  async toggleWorkerStatus(workerId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      await window.electronAPI.db.run(
        `UPDATE workers SET status = ?, sync_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newStatus, workerId]
      );
      app.showToast(`Worker status updated to ${newStatus}.`, 'info');
      await this.loadAllData();
      window.electronAPI.sync.smartSync('workers');
    } catch (err) {
      app.showToast(`Status update failed: ${err.message}`, 'error');
    }
  },

  // =========================================================================
  // TAB 3: Wage & Salary Settlements Desk ("if paid make paid")
  // =========================================================================

  async calculatePayroll() {
    const container = document.getElementById('wrkPayrollListContainer');
    if (!container) return;

    const fromDate = document.getElementById('wrkPayFromDate')?.value;
    const toDate = document.getElementById('wrkPayToDate')?.value;

    if (!fromDate || !toDate) {
      app.showToast('Please select a valid date range.', 'warning');
      return;
    }

    try {
      // 1. Fetch attendance in range
      const attRes = await window.electronAPI.db.query(
        `SELECT worker_id, status, wage_earned 
         FROM worker_attendance 
         WHERE date BETWEEN ? AND ?`,
        [fromDate, toDate]
      );
      const attRows = attRes?.data || (Array.isArray(attRes) ? attRes : []);

      // Group attendance by worker_id
      const attStats = {};
      attRows.forEach(a => {
        if (!attStats[a.worker_id]) {
          attStats[a.worker_id] = { daysWorked: 0, grossWage: 0 };
        }
        if (a.status === 'present') {
          attStats[a.worker_id].daysWorked += 1.0;
        } else if (a.status === 'half_day') {
          attStats[a.worker_id].daysWorked += 0.5;
        }
        attStats[a.worker_id].grossWage += (a.wage_earned || 0);
      });

      // 2. Fetch payouts in range
      const payRes = await window.electronAPI.db.query(
        `SELECT worker_id, amount, payout_type 
         FROM worker_payouts 
         WHERE payment_date BETWEEN ? AND ?`,
        [fromDate, toDate]
      );
      const payRows = payRes?.data || (Array.isArray(payRes) ? payRes : []);

      const payStats = {};
      payRows.forEach(p => {
        payStats[p.worker_id] = (payStats[p.worker_id] || 0) + (p.amount || 0);
      });

      const activeWorkers = this.workersList.filter(w => w.status === 'active');

      if (activeWorkers.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">No active workers found</div>`;
        return;
      }

      let html = '';
      activeWorkers.forEach((w, idx) => {
        const stats = attStats[w.id] || { daysWorked: 0, grossWage: 0 };
        const paidAlready = payStats[w.id] || 0;

        const isTemp = w.worker_type === 'temporary';
        let grossCalculated = 0;

        if (isTemp) {
          grossCalculated = stats.grossWage > 0 ? stats.grossWage : (stats.daysWorked * Number(w.rate || 0));
        } else {
          // Monthly staff base rate
          grossCalculated = Number(w.rate || 0);
        }

        const netPayable = Math.max(0, grossCalculated - paidAlready);
        const rowBg = idx % 2 === 0 ? 'var(--bg-input)' : 'transparent';

        // "if paid make paid" settlement actions
        let actionHtml = '';
        if (grossCalculated === 0) {
          actionHtml = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No duty logged</span>`;
        } else if (netPayable <= 0 && grossCalculated > 0) {
          actionHtml = `
            <span style="font-size: 11px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.16); border: 1px solid rgba(16, 185, 129, 0.35); padding: 4px 10px; border-radius: 6px;">
              Paid in Full
            </span>
          `;
        } else if (paidAlready > 0) {
          actionHtml = `
            <button type="button" class="btn btn-primary btn-sm" style="font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; background: #f59e0b; border-color: #f59e0b;" onclick="workersModule.openPayoutModal('${w.id}', ${netPayable}, '${isTemp ? 'daily_wage' : 'monthly_salary'}')">
              Pay Balance ₹${Math.round(netPayable)}
            </button>
          `;
        } else {
          actionHtml = `
            <button type="button" class="btn btn-primary btn-sm" style="font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px;" onclick="workersModule.openPayoutModal('${w.id}', ${netPayable}, '${isTemp ? 'daily_wage' : 'monthly_salary'}')">
              Disburse ₹${Math.round(netPayable)}
            </button>
          `;
        }

        html += `
          <div style="display: grid; grid-template-columns: 2fr 130px 100px 110px 110px 120px 140px; gap: 8px; align-items: center; padding: 8px 12px; margin-bottom: 2px; border-radius: 8px; background: ${rowBg}; font-size: 12px;">
            <div style="cursor: pointer;" onclick="workersModule.openWorkerProfile('${w.id}')" title="Click to view 360° Profile">
              <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">
                ${w.name}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">${w.designation || 'General'}</div>
            </div>

            <div>
              <div style="font-weight: 700; font-size: 11.5px; color: ${isTemp ? 'var(--accent-amber)' : '#818cf8'};">${isTemp ? 'Daily Wage' : 'Monthly Staff'}</div>
              <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary);">₹${w.rate}${isTemp ? '/d' : '/m'}</div>
            </div>

            <div style="text-align: center; font-weight: 700; font-family: var(--font-mono); color: var(--accent-emerald-light);">
              ${stats.daysWorked} days
            </div>

            <div style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary);">
              ₹ ${Math.round(grossCalculated).toLocaleString('en-IN')}
            </div>

            <div style="text-align: right; font-family: var(--font-mono); color: #ef4444;">
              ${paidAlready > 0 ? `₹ ${Math.round(paidAlready).toLocaleString('en-IN')}` : '—'}
            </div>

            <div style="text-align: right; font-family: var(--font-mono); font-weight: 800; color: ${netPayable <= 0 && grossCalculated > 0 ? '#10b981' : 'var(--accent-emerald-light)'}; font-size: 13px;">
              ₹ ${Math.round(netPayable).toLocaleString('en-IN')}
            </div>

            <div style="text-align: right;">
              ${actionHtml}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;

    } catch (err) {
      console.error('[workersModule] calculatePayroll error:', err);
      app.showToast(`Error calculating payroll: ${err.message}`, 'error');
    }
  },

  openPayoutModal(defaultWorkerId = null, defaultAmount = 0, defaultType = 'daily_wage') {
    const sel = document.getElementById('payoutSelectWorker');
    if (!sel) return;

    const activeWorkers = this.workersList.filter(w => w.status === 'active');
    sel.innerHTML = activeWorkers.map(w => `
      <option value="${w.id}" data-rate="${w.rate}" data-type="${w.worker_type}" ${w.id === defaultWorkerId ? 'selected' : ''}>
        ${w.name} (${w.worker_type === 'temporary' ? 'Daily Wage' : 'Monthly Salary'} • ₹${w.rate})
      </option>
    `).join('');

    const amtIn = document.getElementById('payoutInputAmount');
    if (amtIn) amtIn.value = defaultAmount > 0 ? Math.round(defaultAmount) : '';

    const typeIn = document.getElementById('payoutSelectType');
    if (typeIn) typeIn.value = defaultType;

    const dateIn = document.getElementById('payoutInputDate');
    if (dateIn) dateIn.value = this.currentDateStr;

    app.openModal('modalWorkerPayout');
  },

  onPayoutWorkerSelect() {
    const sel = document.getElementById('payoutSelectWorker');
    const opt = sel?.options[sel.selectedIndex];
    if (opt) {
      const type = opt.getAttribute('data-type');
      const typeSel = document.getElementById('payoutSelectType');
      if (typeSel) {
        typeSel.value = type === 'temporary' ? 'daily_wage' : 'monthly_salary';
      }
    }
  },

  async submitPayout() {
    const workerId = document.getElementById('payoutSelectWorker')?.value;
    const amount = parseFloat(document.getElementById('payoutInputAmount')?.value || '0');
    const mode = document.getElementById('payoutSelectMode')?.value || 'Cash';
    const payDate = document.getElementById('payoutInputDate')?.value || this.currentDateStr;
    const payType = document.getElementById('payoutSelectType')?.value || 'daily_wage';
    const linkExpense = document.getElementById('payoutCheckExpense')?.checked;
    const notes = document.getElementById('payoutInputNotes')?.value.trim();

    if (!workerId) {
      app.showToast('Please select a worker.', 'warning');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      app.showToast('Please enter a valid payout amount.', 'warning');
      return;
    }

    const worker = this.workersList.find(w => w.id === workerId);
    const workerName = worker?.name || 'Worker';

    try {
      const currentUser = await window.electronAPI.auth.getCurrentUser();
      const appUserId = currentUser?.id || '2e45613e-6514-4070-a459-398c73b05344';

      const payoutId = crypto.randomUUID();
      const syncId = `payout_${payoutId}`;

      // 1. Insert into worker_payouts
      await window.electronAPI.db.run(
        `INSERT INTO worker_payouts (id, app_user_id, worker_id, payout_type, amount, payment_date, payment_mode, notes, sync_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [payoutId, appUserId, workerId, payType, amount, payDate, mode, notes, syncId]
      );

      // 2. "if paid make paid": Auto-mark past attendance records as Paid (is_paid = 1) up to this payment date
      await window.electronAPI.db.run(
        `UPDATE worker_attendance 
         SET is_paid = 1, sync_status = 0, updated_at = CURRENT_TIMESTAMP 
         WHERE worker_id = ? AND date <= ?`,
        [workerId, payDate]
      );
      window.electronAPI.sync.smartSync('worker_attendance');

      // 3. Optionally record into operational expenses
      if (linkExpense) {
        const expId = crypto.randomUUID();
        const expSyncId = `exp_${expId}`;
        const expCategory = payType === 'daily_wage' ? 'Worker Wages' : 'Staff Salary';
        const expNotes = `Disbursed to ${workerName} (${payType.replace('_', ' ')}) • ${notes || ''}`.trim();

        await window.electronAPI.db.run(
          `INSERT INTO expenses (id, app_user_id, date, category, amount, notes, sync_id, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          [expId, appUserId, payDate, expCategory, amount, expNotes, expSyncId]
        );
        window.electronAPI.sync.smartSync('expenses');
      }

      app.closeModal('modalWorkerPayout');
      app.showToast(`Recorded payout of ₹${Math.round(amount).toLocaleString('en-IN')} for ${workerName} (marked attendance paid).`, 'success');

      await this.loadAllData();
      window.electronAPI.sync.smartSync('worker_payouts');

    } catch (err) {
      console.error('[workersModule] submitPayout error:', err);
      app.showToast(`Error recording payout: ${err.message}`, 'error');
    }
  },

  exportPayrollPDF() {
    app.showToast('Generating worker payroll statement...', 'info');
    setTimeout(() => {
      window.print();
    }, 300);
  },

  // =========================================================================
  // Staff & Field App Access Management
  // =========================================================================
  async loadStaffFleet() {
    try {
      const res = await window.electronAPI.db.query(
        `SELECT * FROM staff_accounts ORDER BY created_at DESC;`
      );
      this.staffList = res?.data || (Array.isArray(res) ? res : []);
      this.updateStaffCounters();
      this.renderStaffTable();
    } catch (e) {
      console.warn('[workersModule] Load staff error:', e);
    }
  },

  updateStaffCounters() {
    const totalEl = document.getElementById('statStaffTotal');
    const activeEl = document.getElementById('statStaffActive');
    const revokedEl = document.getElementById('statStaffRevoked');

    const total = this.staffList.length;
    const active = this.staffList.filter((s) => s.is_active != 0).length;
    const revoked = total - active;

    if (totalEl) totalEl.textContent = `Total: ${total}`;
    if (activeEl) activeEl.textContent = `Active: ${active}`;
    if (revokedEl) revokedEl.textContent = `Revoked: ${revoked}`;
  },

  filterStaffTable() {
    const search = document.getElementById('setStaffSearchInput')?.value.trim().toLowerCase() || '';
    const status = document.getElementById('setStaffFilterStatus')?.value || 'all';

    const filtered = this.staffList.filter((s) => {
      const matchSearch =
        !search ||
        (s.full_name && s.full_name.toLowerCase().includes(search)) ||
        (s.mobile_number && s.mobile_number.includes(search)) ||
        (s.username && s.username.includes(search));

      const matchStatus =
        status === 'all' ||
        (status === 'active' && s.is_active != 0) ||
        (status === 'revoked' && s.is_active == 0);

      return matchSearch && matchStatus;
    });

    this.renderStaffTable(filtered);
  },

  renderStaffTable(list = null) {
    const tbody = document.getElementById('setStaffTableBody');
    if (!tbody) return;

    const data = list !== null ? list : this.staffList;

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 28px; color: var(--text-muted); font-size: 13px;">No staff members matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = data
      .map((s) => {
        const isActive = s.is_active != 0;
        const allowCollector = s.allow_collector != 0;

        return `
        <tr style="border-bottom: 1px solid var(--border-subtle);">
          <td style="padding: 10px 14px;">
            <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${s.full_name || 'Staff Member'}</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
              <span style="font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono);">+91 ${s.mobile_number || s.username}</span>
              ${s.display_mpin ? `<span style="font-size: 10px; font-weight: 700; background: var(--bg-input); color: var(--text-muted); padding: 1px 6px; border-radius: 4px; font-family: var(--font-mono);" title="Login MPIN">PIN: ${s.display_mpin}</span>` : ''}
            </div>
          </td>
          <td style="padding: 10px 14px;">
            ${
              allowCollector
                ? `<span style="font-size: 11px; font-weight: 700; background: rgba(16, 185, 129, 0.12); color: var(--accent-emerald); border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 5px;">Collection Allowed</span>`
                : `<span style="font-size: 11px; font-weight: 600; background: var(--bg-input); color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 3px 8px; border-radius: 5px;">Disabled</span>`
            }
          </td>
          <td style="padding: 10px 14px; text-align: center;">
            <span class="status-badge ${isActive ? 'active' : 'inactive'}" style="font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
              ${isActive ? 'Active' : 'Revoked'}
            </span>
          </td>
          <td style="padding: 10px 14px; text-align: right;">
            <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; font-weight: 700;" onclick="workersModule.openEditStaffModal('${s.id}')">
                Edit
              </button>
              
              ${
                isActive
                  ? `<button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; font-weight: 700; color: #f59e0b; border-color: rgba(245, 158, 11, 0.35);" onclick="workersModule.toggleStaffStatus('${s.id}', 0)">
                      Revoke
                    </button>`
                  : `<button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; font-weight: 700; color: var(--accent-emerald); border-color: rgba(16, 185, 129, 0.35);" onclick="workersModule.toggleStaffStatus('${s.id}', 1)">
                      Grant
                    </button>`
              }

              <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px; color: var(--accent-red); border-color: rgba(239, 68, 68, 0.3);" onclick="workersModule.deleteStaff('${s.id}')">
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');
  },

  openEditStaffModal(id) {
    const s = this.staffList.find((x) => x.id === id);
    if (!s) return;

    document.getElementById('editStaffId').value = s.id;
    document.getElementById('editStaffName').value = s.full_name || '';
    document.getElementById('editStaffMobile').value = s.mobile_number || s.username || '';
    document.getElementById('editStaffMpin').value = '';

    document.getElementById('editStaffActive').checked = s.is_active != 0;
    document.getElementById('editStaffAllowCollector').checked = s.allow_collector != 0;

    app.openModal('modalEditStaff');
  },

  async saveStaffEdit() {
    const id = document.getElementById('editStaffId')?.value;
    const name = document.getElementById('editStaffName')?.value.trim();
    const mob = document.getElementById('editStaffMobile')?.value.trim().replace(/\D/g, '').slice(0, 10);
    const pin = document.getElementById('editStaffMpin')?.value.trim();
    const isActive = document.getElementById('editStaffActive')?.checked ? 1 : 0;
    const allowCollector = document.getElementById('editStaffAllowCollector')?.checked ? 1 : 0;

    if (!name) {
      app.showToast('Full Name is required.', 'warning');
      return;
    }
    if (!mob || mob.length !== 10 || !/^\d{10}$/.test(mob)) {
      app.showToast('Mobile Number must be exactly 10 digits.', 'warning');
      return;
    }
    if (pin && (pin.length !== 6 || !/^\d{6}$/.test(pin))) {
      app.showToast('If updating MPIN, it must be exactly 6 digits.', 'warning');
      return;
    }

    const nowIso = new Date().toISOString();
    try {
      if (pin) {
        await window.electronAPI.db.run(
          `UPDATE staff_accounts 
           SET full_name = ?, mobile_number = ?, username = ?, is_active = ?, allow_collector = ?, allow_collector_mobile = ?, mpin_hash = ?, display_mpin = ?, updated_at = ?, sync_status = 0 
           WHERE id = ?;`,
          [name, mob, mob, isActive, allowCollector, allowCollector, pin, pin, nowIso, id]
        );
      } else {
        await window.electronAPI.db.run(
          `UPDATE staff_accounts 
           SET full_name = ?, mobile_number = ?, username = ?, is_active = ?, allow_collector = ?, allow_collector_mobile = ?, updated_at = ?, sync_status = 0 
           WHERE id = ?;`,
          [name, mob, mob, isActive, allowCollector, allowCollector, nowIso, id]
        );
      }

      app.closeModal('modalEditStaff');
      app.showToast(`Collector permissions updated for '${name}'!`, 'success');
      await this.loadStaffFleet();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('staff_accounts');
      }
      app.triggerSync();
    } catch (e) {
      app.showToast(`Failed to update staff: ${e.message}`, 'error');
    }
  },

  async toggleStaffStatus(id, newStatus) {
    const s = this.staffList.find((x) => x.id === id);
    const nowIso = new Date().toISOString();

    try {
      await window.electronAPI.db.run(
        `UPDATE staff_accounts 
         SET is_active = ?, allow_collector = ?, allow_collector_mobile = ?, updated_at = ?, sync_status = 0 
         WHERE id = ?;`,
        [newStatus, newStatus, newStatus, nowIso, id]
      );

      const msg = newStatus === 1
        ? `Access granted for '${s?.full_name || 'Collector'}'. Mobile login is now ACTIVE.`
        : `Access revoked for '${s?.full_name || 'Collector'}'. Mobile login has been SUSPENDED.`;

      app.showToast(msg, newStatus === 1 ? 'success' : 'warning');
      await this.loadStaffFleet();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('staff_accounts');
      }
      app.triggerSync();
    } catch (e) {
      app.showToast(`Error updating access: ${e.message}`, 'error');
    }
  },

  async addStaffMember() {
    const mob = document.getElementById('setStaffMobile')?.value.trim().replace(/\D/g, '').slice(0, 10);
    const pin = document.getElementById('setStaffMpin')?.value.trim();
    const name = document.getElementById('setStaffName')?.value.trim();

    if (!mob || !pin) {
      app.showToast('Mobile Number and MPIN are required.', 'warning');
      return;
    }
    if (mob.length !== 10 || !/^\d{10}$/.test(mob)) {
      app.showToast('Mobile Number must be exactly 10 digits.', 'warning');
      document.getElementById('setStaffMobile')?.focus();
      return;
    }
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      app.showToast('MPIN must be exactly 6 digits.', 'warning');
      return;
    }

    try {
      const id = 'staff_' + Date.now();
      const nowIso = new Date().toISOString();
      await window.electronAPI.db.run(
        `INSERT INTO staff_accounts (id, username, full_name, mobile_number, mpin_hash, display_mpin, is_active, allow_collector, allow_collector_mobile, sync_status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, 0, ?, ?);`,
        [id, mob, name || mob, mob, pin, pin, nowIso, nowIso]
      );

      const mobEl = document.getElementById('setStaffMobile');
      const pinEl = document.getElementById('setStaffMpin');
      const nameEl = document.getElementById('setStaffName');
      if (mobEl) mobEl.value = '';
      if (pinEl) pinEl.value = '';
      if (nameEl) nameEl.value = '';

      app.showToast(`Field collector '${name || mob}' provisioned successfully!`, 'success');
      await this.loadStaffFleet();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('staff_accounts');
      }
      app.triggerSync();
    } catch (e) {
      app.showToast(`Failed to create staff: ${e.message}`, 'error');
    }
  },

  async deleteStaff(id) {
    const s = this.staffList.find((x) => x.id === id);
    const staffName = s?.full_name || 'this staff member';
    if (!confirm(`Are you sure you want to completely delete ${staffName}? To temporarily pause access instead, use 'Revoke'.`)) return;

    try {
      const syncId = s?.sync_id || s?.cloud_id || s?.id;
      await window.electronAPI.db.run(`DELETE FROM staff_accounts WHERE id = ?;`, [id]);
      if (syncId) {
        await window.electronAPI.db.run(
          `INSERT INTO deleted_tombstones (sync_id, table_name, deleted_at) VALUES (?, 'staff_accounts', CURRENT_TIMESTAMP)
           ON CONFLICT(sync_id) DO UPDATE SET deleted_at = CURRENT_TIMESTAMP;`,
          [syncId]
        );
      }
      app.showToast(`Staff account for '${staffName}' permanently removed.`, 'info');
      await this.loadStaffFleet();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('staff_accounts');
      }
      setTimeout(() => app.triggerSync(), 300);
    } catch (e) {
      app.showToast(`Error removing staff: ${e.message}`, 'error');
    }
  }
};

window.workersModule = workersModule;
