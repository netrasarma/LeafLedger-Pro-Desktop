/**
 * Leaf Ledger Pro - Monthly Statement & Ledger Module
 * Aligned with Python ui/monthly.py & Mobile MonthlyStatementScreen logic & backend schemas
 */

const monthlyModule = {
  currentTab: 'pending',
  pendingOwners: [],
  completedPayments: [],
  activeAuditData: null,
  activeSessionId: null,

  async init() {
    const curDate = new Date();
    const monthSelect = document.getElementById('monthlyMonthSelect');
    const yearInput = document.getElementById('monthlyYearInput');

    if (monthSelect) monthSelect.value = curDate.getMonth() + 1;
    if (yearInput) yearInput.value = curDate.getFullYear();

    // Fetch active season session
    try {
      const activeSession = await app.getActiveSession();
      this.activeSessionId = activeSession?.id || null;
    } catch (_) {
      this.activeSessionId = null;
    }

    await this.loadMonthlyData();
  },

  switchTab(tab) {
    this.currentTab = tab;
    const btnP = document.getElementById('tabBtnPending');
    const btnC = document.getElementById('tabBtnCompleted');
    const tabP = document.getElementById('mTabPendingContent');
    const tabC = document.getElementById('mTabCompletedContent');

    if (tab === 'pending') {
      if (btnP) { btnP.className = 'btn btn-primary btn-sm'; }
      if (btnC) { btnC.className = 'btn btn-secondary btn-sm'; }
      if (tabP) tabP.style.display = 'block';
      if (tabC) tabC.style.display = 'none';
    } else {
      if (btnP) { btnP.className = 'btn btn-secondary btn-sm'; }
      if (btnC) { btnC.className = 'btn btn-primary btn-sm'; }
      if (tabP) tabP.style.display = 'none';
      if (tabC) tabC.style.display = 'block';
    }
  },

  async loadMonthlyData() {
    const m = parseInt(document.getElementById('monthlyMonthSelect')?.value || (new Date().getMonth() + 1));
    const y = parseInt(document.getElementById('monthlyYearInput')?.value || new Date().getFullYear());
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;
    const sid = this.activeSessionId;

    const pTbody = document.getElementById('mPendingTableBody');
    const cTbody = document.getElementById('mCompletedTableBody');
    if (pTbody) pTbody.innerHTML = app.getLoadingStateTableRow(8, 'Auditing monthly grower accounts...');
    if (cTbody) cTbody.innerHTML = app.getLoadingStateTableRow(8, 'Loading completed settlements...');

    try {
      // 1. Fetch collections for this month grouped by owner (with missing rate detection)
      let collQuery = `
        SELECT dc.owner_id, o.name as owner_name, o.phone, o.address, o.village,
               o.bank_name, o.bank_acc, o.bank_ifsc, o.account_holder_name, o.agreement_date,
               SUM(dc.gross_weight_kg) as total_gross,
               SUM(dc.net_weight_kg) as total_net,
               SUM(dc.amount) as total_amount,
               COUNT(dc.id) as total_pickups,
               SUM(CASE WHEN dc.rate_per_kg IS NULL OR dc.rate_per_kg = 0 THEN 1 ELSE 0 END) as missing_rate_count
        FROM daily_collections dc
        JOIN owners o ON dc.owner_id = o.id
        WHERE dc.date LIKE ?
      `;
      const collParams = [`${monthPrefix}%`];
      if (sid) {
        collQuery += " AND (dc.session_id = ? OR dc.session_id IS NULL)";
        collParams.push(sid);
      }
      collQuery += " GROUP BY dc.owner_id";

      const collsRes = await window.electronAPI.db.query(collQuery, collParams);
      const monthlyRows = collsRes?.data || [];

      // 2. Fetch completed settlements for this month & year
      let payQuery = `
        SELECT mp.*, o.name as owner_name, o.phone, o.address, o.village,
               o.bank_name, o.bank_acc, o.bank_ifsc, o.account_holder_name, o.agreement_date
        FROM monthly_payments mp
        JOIN owners o ON mp.owner_id = o.id
        WHERE mp.month = ? AND mp.year = ? AND (mp.is_paid = 1 OR mp.is_paid IS NULL)
      `;
      const payParams = [m, y];
      if (sid) {
        payQuery += " AND (mp.session_id = ? OR mp.session_id IS NULL)";
        payParams.push(sid);
      }
      payQuery += " ORDER BY mp.payment_date DESC, mp.created_at DESC";

      const payRes = await window.electronAPI.db.query(payQuery, payParams);
      this.completedPayments = payRes?.data || [];
      const paidOwnerIds = new Set(this.completedPayments.map(p => p.owner_id));

      // 3. Fetch cumulative advance balances (Total advances given - total deductions in finalized settlements)
      const advTotalRes = await window.electronAPI.db.query(
        "SELECT owner_id, COALESCE(SUM(amount), 0) as total_adv FROM advances GROUP BY owner_id"
      );
      const advRecRes = await window.electronAPI.db.query(
        "SELECT owner_id, COALESCE(SUM(COALESCE(advance_deducted, total_advances, 0)), 0) as total_rec FROM monthly_payments WHERE is_paid = 1 GROUP BY owner_id"
      );

      const advTotalMap = new Map((advTotalRes?.data || []).map(r => [r.owner_id, Number(r.total_adv)]));
      const advRecMap = new Map((advRecRes?.data || []).map(r => [r.owner_id, Number(r.total_rec)]));

      // 4. Separate into Pending vs Completed & Compute Totals
      this.pendingOwners = [];
      let totalPendingPayout = 0;
      let totalLeaf = 0;

      monthlyRows.forEach(r => {
        totalLeaf += (r.total_net || 0);

        if (!paidOwnerIds.has(r.owner_id)) {
          const totAdv = advTotalMap.get(r.owner_id) || 0;
          const totRec = advRecMap.get(r.owner_id) || 0;
          const currentAdv = Math.max(0, totAdv - totRec);

          // Auto-propose deduction: min of available advance and gross leaf payout
          const proposedDeduc = Math.min(currentAdv, r.total_amount || 0);
          const netPayable = Math.max(0, (r.total_amount || 0) - proposedDeduc);
          totalPendingPayout += netPayable;

          this.pendingOwners.push({
            ...r,
            available_advance: currentAdv,
            proposed_deduction: proposedDeduc,
            net_payable: netPayable
          });
        }
      });

      // Stats from completed
      let totalPaidAmount = 0;
      let totalAdvDeducted = 0;

      this.completedPayments.forEach(p => {
        const netPaid = p.final_paid_amount || p.net_paid || p.net_payable || p.total_amount || 0;
        const advDed = p.advance_deducted || p.total_advances || 0;
        totalPaidAmount += Number(netPaid);
        totalAdvDeducted += Number(advDed);
      });

      // Update Header Quick Stats
      const sPending = document.getElementById('mStatPendingPayout');
      const sPaid = document.getElementById('mStatPaidAmount');
      const sDeduc = document.getElementById('mStatAdvDeducted');
      const sLeaf = document.getElementById('mStatTotalLeaf');

      if (sPending) sPending.innerText = `Rs. ${Math.round(totalPendingPayout).toLocaleString('en-IN')}`;
      if (sPaid) sPaid.innerText = `Rs. ${Math.round(totalPaidAmount).toLocaleString('en-IN')}`;
      if (sDeduc) sDeduc.innerText = `Rs. ${Math.round(totalAdvDeducted).toLocaleString('en-IN')}`;
      if (sLeaf) sLeaf.innerText = `${Math.round(totalLeaf).toLocaleString('en-IN')} kg`;

      this.renderTables();
    } catch (e) {
      console.error('[MonthlyModule] Load error:', e);
      app.showToast(`Error loading monthly data: ${e.message}`, 'error');
    }
  },

  filterGrid() {
    this.renderTables();
  },

  renderTables() {
    const searchTerm = (document.getElementById('monthlySearchInput')?.value || '').toLowerCase().trim();

    // 1. Pending Table
    const pTbody = document.getElementById('mPendingTableBody');
    if (pTbody) {
      const filtered = this.pendingOwners.filter(o => 
        (o.owner_name || '').toLowerCase().includes(searchTerm) ||
        (o.phone || '').includes(searchTerm)
      );

      if (filtered.length === 0) {
        pTbody.innerHTML = app.getEmptyStateTableRow(8, {
          title: 'All Accounts Reconciled',
          message: 'No pending grower payments for this month. All verified!'
        });
      } else {
        pTbody.innerHTML = filtered.map(o => {
          const hasMissingRates = (o.missing_rate_count || 0) > 0;
          const rateBadge = hasMissingRates
            ? `<span class="badge" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 11px; font-weight: 700; cursor: pointer;" onclick="app.navTo('rates')" title="Click to open Pricing & Rates Desk">⚠️ ${o.missing_rate_count} Rate Missing</span>`
            : `<span class="badge badge-success" style="font-size: 11px;">✔ Rates Applied</span>`;

          return `
            <tr>
              <td>
                <div style="font-weight: 700; color: var(--text-primary);">${o.owner_name}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${o.phone || 'No phone'}</div>
              </td>
              <td class="mono" style="color: var(--accent-emerald-light); font-weight: 700;">${Math.round(o.total_net).toLocaleString('en-IN')} kg</td>
              <td>${rateBadge}</td>
              <td class="mono" style="font-weight: 600;">Rs. ${Math.round(o.total_amount).toLocaleString('en-IN')}</td>
              <td class="mono" style="color: #ff9800; font-weight: 600;">Rs. ${Math.round(o.available_advance).toLocaleString('en-IN')}</td>
              <td class="mono" style="color: var(--accent-amber); font-weight: 700;">-Rs. ${Math.round(o.proposed_deduction).toLocaleString('en-IN')}</td>
              <td class="mono" style="font-size: 14px; font-weight: 800; color: var(--accent-emerald);">Rs. ${Math.round(o.net_payable).toLocaleString('en-IN')}</td>
              <td style="text-align: right;">
                <button type="button" class="btn btn-primary btn-sm" style="font-size: 11px; padding: 5px 12px; font-weight: 700;" onclick="monthlyModule.openAuditModal('${o.owner_id}', 'pending')">
                  Audit & Settle
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 2. Completed Table
    const cTbody = document.getElementById('mCompletedTableBody');
    if (cTbody) {
      const filtered = this.completedPayments.filter(p => 
        (p.owner_name || '').toLowerCase().includes(searchTerm) ||
        (p.phone || '').includes(searchTerm)
      );

      if (filtered.length === 0) {
        cTbody.innerHTML = app.getEmptyStateTableRow(8, {
          title: 'No Completed Settlements',
          message: 'No finalized monthly payout records for this period.'
        });
      } else {
        cTbody.innerHTML = filtered.map(p => {
          const paidAmt = p.final_paid_amount || p.net_paid || p.net_payable || p.total_amount || 0;
          const grossAmt = p.total_amount || p.gross_amount || 0;
          const advDed = p.advance_deducted || p.total_advances || 0;
          const netKg = p.total_net_kg || p.net_weight || 0;

          // Check 7-day grace period for reopening
          let canReopen = true;
          if (p.payment_date) {
            const pDate = new Date(p.payment_date);
            const diffDays = Math.ceil((Date.now() - pDate.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays > 7) canReopen = false;
          }

          return `
            <tr>
              <td class="mono">${p.payment_date || '—'}</td>
              <td>
                <div style="font-weight: 700; color: var(--text-primary);">${p.owner_name}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${p.phone || ''}</div>
              </td>
              <td class="mono" style="color: var(--accent-emerald-light); font-weight: 700;">${Math.round(netKg).toLocaleString('en-IN')} kg</td>
              <td class="mono">Rs. ${Math.round(grossAmt).toLocaleString('en-IN')}</td>
              <td class="mono" style="color: #ff9800; font-weight: 600;">-Rs. ${Math.round(advDed).toLocaleString('en-IN')}</td>
              <td class="mono" style="font-size: 14px; font-weight: 800; color: #10b981;">Rs. ${Math.round(paidAmt).toLocaleString('en-IN')}</td>
              <td><span class="badge badge-primary" style="font-size: 10.5px;">${p.payment_mode || 'Cash'}</span></td>
              <td style="text-align: right;">
                <div style="display: inline-flex; align-items: center; gap: 6px;">
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px;" onclick="monthlyModule.openAuditModal('${p.owner_id}', 'completed')">
                    Audit
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 8px;" onclick="monthlyModule.printStatement('${p.owner_id}')">
                    📄 Print
                  </button>
                  ${canReopen ? `
                    <button type="button" class="btn btn-danger btn-sm" style="font-size: 10.5px; padding: 4px 8px; font-weight: 700;" onclick="monthlyModule.reopenStatement('${p.id}', '${p.owner_name}')" title="Re-Open statement and revert to pending (Within 7-day grace period)">
                      🔓 Re-Open
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  },

  /**
   * Opens the Comprehensive Audit Statement Modal
   */
  async openAuditModal(ownerId, mode = 'pending') {
    const m = parseInt(document.getElementById('monthlyMonthSelect')?.value || (new Date().getMonth() + 1));
    const y = parseInt(document.getElementById('monthlyYearInput')?.value || new Date().getFullYear());
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    try {
      // 1. Fetch Owner Profile
      const ownerRes = await window.electronAPI.db.getOne("SELECT * FROM owners WHERE id = ?", [ownerId]);
      const owner = ownerRes?.data;
      if (!owner) {
        app.showToast('Owner profile not found', 'error');
        return;
      }

      // 2. Fetch Collections for this owner in selected month
      let logQuery = "SELECT * FROM daily_collections WHERE owner_id = ? AND date LIKE ?";
      const logParams = [ownerId, `${monthPrefix}%`];
      if (this.activeSessionId) {
        logQuery += " AND (session_id = ? OR session_id IS NULL)";
        logParams.push(this.activeSessionId);
      }
      logQuery += " ORDER BY date ASC";

      const logRes = await window.electronAPI.db.query(logQuery, logParams);
      const rows = logRes?.data || [];

      // 3. Fetch Existing Payment if in Completed Mode
      let payment = null;
      if (mode === 'completed') {
        const pRes = await window.electronAPI.db.getOne(
          "SELECT * FROM monthly_payments WHERE owner_id = ? AND month = ? AND year = ? ORDER BY created_at DESC LIMIT 1",
          [ownerId, m, y]
        );
        payment = pRes?.data || null;
      }

      // 4. Calculate Advance Balance
      const advTotalRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(amount), 0) as total FROM advances WHERE owner_id = ?",
        [ownerId]
      );
      const advDeducRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(COALESCE(advance_deducted, total_advances, 0)), 0) as deducted FROM monthly_payments WHERE owner_id = ? AND is_paid = 1",
        [ownerId]
      );

      const totalAdv = Number(advTotalRes?.data?.total || 0);
      let totalDeducted = Number(advDeducRes?.data?.deducted || 0);
      
      // If viewing a completed payment, add back its deduction to show the available balance at that time
      if (payment && payment.is_paid) {
        totalDeducted -= Number(payment.advance_deducted || payment.total_advances || 0);
      }
      const availableAdv = Math.max(0, totalAdv - totalDeducted);

      // Aggregates
      const totalGross = rows.reduce((s, r) => s + (Number(r.gross_weight_kg) || 0), 0);
      const totalNet = rows.reduce((s, r) => s + (Number(r.net_weight_kg) || 0), 0);
      const grossAmt = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const missingRateCount = rows.filter(r => !r.rate_per_kg || Number(r.rate_per_kg) === 0).length;

      // Store in active state
      this.activeAuditData = {
        owner,
        rows,
        month: m,
        year: y,
        monthName: monthNames[m - 1],
        mode,
        payment,
        totalGross,
        totalNet,
        grossAmt,
        availableAdv,
        missingRateCount
      };

      // Populate UI Elements
      const initials = (owner.name || 'G').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const avEl = document.getElementById('mAuditAvatar');
      const titleEl = document.getElementById('mAuditOwnerTitle');
      const phoneEl = document.getElementById('mAuditOwnerPhone');
      const badgeEl = document.getElementById('mAuditStatusBadge');
      const addrEl = document.getElementById('mAuditAddress');
      const agrEl = document.getElementById('mAuditAgreement');
      const periodEl = document.getElementById('mAuditPeriod');

      const bankNameEl = document.getElementById('mAuditBankName');
      const bankHolderEl = document.getElementById('mAuditBankHolder');
      const bankAccEl = document.getElementById('mAuditBankAcc');
      const bankIfscEl = document.getElementById('mAuditBankIfsc');

      if (avEl) avEl.innerText = initials;
      if (titleEl) titleEl.innerText = owner.name;
      if (phoneEl) phoneEl.innerText = `📞 +91 ${owner.phone || 'No phone recorded'}`;
      if (addrEl) addrEl.innerText = owner.address || owner.village || '—';
      if (agrEl) agrEl.innerText = owner.agreement_date || '—';
      if (periodEl) periodEl.innerText = `${monthNames[m - 1]} ${y}`;

      if (bankNameEl) bankNameEl.innerText = owner.bank_name || '—';
      if (bankHolderEl) bankHolderEl.innerText = owner.account_holder_name || owner.name || '—';
      if (bankAccEl) bankAccEl.innerText = owner.bank_acc || '—';
      if (bankIfscEl) bankIfscEl.innerText = owner.bank_ifsc || '—';

      // Missing Rate Warning Banner (Strict Settlement Blocker)
      const warnBanner = document.getElementById('mAuditRateWarnBanner');
      const warnText = document.getElementById('mAuditRateWarnText');
      if (warnBanner) {
        if (missingRateCount > 0) {
          warnBanner.style.display = 'flex';
          warnBanner.style.background = 'rgba(239, 68, 68, 0.12)';
          warnBanner.style.borderColor = 'rgba(239, 68, 68, 0.35)';
          if (warnText) {
            warnText.style.color = '#ef4444';
            warnText.innerText = `Payment Blocked: ${missingRateCount} of ${rows.length} leaf pickup(s) have no rate applied (₹0.00/kg). Enter rates before finalizing payout.`;
          }
        } else {
          warnBanner.style.display = 'none';
        }
      }

      // Render Daily Log Table
      const logTbody = document.getElementById('mAuditLogTableBody');
      const logCount = document.getElementById('mAuditLogCount');
      if (logCount) logCount.innerText = `${rows.length} pickup${rows.length === 1 ? '' : 's'} recorded`;

      if (logTbody) {
        if (rows.length === 0) {
          logTbody.innerHTML = app.getEmptyStateTableRow(7, {
            title: 'No Collections Recorded',
            message: 'No leaf collections found for this grower during this billing period.'
          });
        } else {
          logTbody.innerHTML = rows.map(r => {
            const hasRate = r.rate_per_kg && Number(r.rate_per_kg) > 0;
            const rateStr = hasRate ? `₹${Number(r.rate_per_kg).toFixed(2)}` : '<span style="color: #ef4444; font-weight: 700;">⚠️ 0.00</span>';
            const amtStr = hasRate ? `₹${Math.round(r.amount).toLocaleString('en-IN')}` : '<span style="color: #ef4444; font-weight: 700;">₹0</span>';

            let noteContent = r.notes || '—';
            let dedBadges = '';
            if (r.notes && r.notes.includes('Deductions: [')) {
              const dedPart = r.notes.split('Deductions: [')[1].split(']')[0];
              const tags = dedPart.split(', ');
              dedBadges = tags.map(t => {
                const tClean = t.trim();
                let cls = 'long';
                let icon = '<i class="fa-solid fa-leaf"></i>';
                if (tClean.toLowerCase().includes('wet')) { cls = 'wet'; icon = '<i class="fa-solid fa-droplet"></i>'; }
                else if (tClean.toLowerCase().includes('hard')) { cls = 'hard'; icon = '<i class="fa-solid fa-shield-halved"></i>'; }
                return `<span class="deduction-pill ${cls}" style="font-size: 9px; padding: 1px 6px;">${icon} ${tClean}</span>`;
              }).join(' ');

              const userNote = r.notes.replace(/Deductions: \[.*?\]( \| )?/, '').trim();
              noteContent = `
                <div style="display: flex; flex-direction: column; gap: 3px;">
                  <div style="display: flex; gap: 4px; flex-wrap: wrap;">${dedBadges}</div>
                  ${userNote ? `<span style="color: var(--text-secondary); font-size: 11px;">${userNote}</span>` : ''}
                </div>
              `;
            }

            return `
              <tr>
                <td class="mono">${r.date}</td>
                <td class="mono">${Math.round(r.gross_weight_kg || 0)}</td>
                <td class="mono" style="color: var(--accent-amber);">${Math.round(r.bag_weight_kg || 0)}%</td>
                <td class="mono" style="color: var(--accent-emerald-light); font-weight: 700;">${Math.round(r.net_weight_kg || 0)}</td>
                <td class="mono">${rateStr}</td>
                <td class="mono" style="font-weight: 700;">${amtStr}</td>
                <td>${noteContent}</td>
              </tr>
            `;
          }).join('');
        }
      }

      // Populate Payout Totals
      const totNetEl = document.getElementById('mAuditTotalNet');
      const grossAmtEl = document.getElementById('mAuditGrossAmt');
      const availAdvEl = document.getElementById('mAuditAvailAdv');
      const maxHintEl = document.getElementById('mAuditMaxDeducHint');

      if (totNetEl) totNetEl.innerText = `${Math.round(totalNet).toLocaleString('en-IN')} kg`;
      if (grossAmtEl) grossAmtEl.innerText = `Rs. ${Math.round(grossAmt).toLocaleString('en-IN')}`;
      if (availAdvEl) availAdvEl.innerText = `Rs. ${Math.round(availableAdv).toLocaleString('en-IN')}`;
      if (maxHintEl) maxHintEl.innerText = `Rs. ${Math.round(availableAdv).toLocaleString('en-IN')}`;

      // Mode-Specific Controls Setup
      const inputsRow = document.getElementById('mAuditInputsRow');
      const paidRow = document.getElementById('mAuditPaidInfoRow');
      const settleBtn = document.getElementById('mAuditSettleBtn');
      const reopenBtn = document.getElementById('mAuditReopenBtn');
      const deducInput = document.getElementById('mAuditAdvDeducInput');
      const modeSelect = document.getElementById('mAuditPayModeSelect');
      const notesInput = document.getElementById('mAuditNotesInput');

      if (mode === 'pending') {
        if (badgeEl) {
          badgeEl.innerText = 'VERIFICATION & PAYOUT';
          badgeEl.style.background = 'rgba(245, 158, 11, 0.12)';
          badgeEl.style.color = '#d97706';
          badgeEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
        }

        if (inputsRow) inputsRow.style.display = 'grid';
        if (paidRow) paidRow.style.display = 'none';
        if (settleBtn) {
          settleBtn.style.display = 'inline-block';
          if (missingRateCount > 0) {
            settleBtn.disabled = true;
            settleBtn.title = `Payment blocked: ${missingRateCount} leaf pickup(s) do not have rates applied (₹0.00/kg). Enter rates in Rates Desk first.`;
            settleBtn.classList.remove('btn-primary');
            settleBtn.classList.add('btn-secondary');
            settleBtn.style.opacity = '0.6';
            settleBtn.style.cursor = 'not-allowed';
            settleBtn.innerHTML = `🚫 &nbsp;Rate Missing (${missingRateCount})`;
          } else {
            settleBtn.disabled = false;
            settleBtn.title = 'Confirm and finalize payment';
            settleBtn.classList.add('btn-primary');
            settleBtn.classList.remove('btn-secondary');
            settleBtn.style.opacity = '1';
            settleBtn.style.cursor = 'pointer';
            settleBtn.innerHTML = `✅ &nbsp;Confirm Payment`;
          }
        }
        if (reopenBtn) reopenBtn.style.display = 'none';

        // Auto-propose deduction
        const proposedDeduc = Math.min(availableAdv, grossAmt);
        if (deducInput) deducInput.value = Math.round(proposedDeduc);
        if (modeSelect) modeSelect.value = 'Cash';
        if (notesInput) notesInput.value = '';

        this.updateAuditNetCalc();
      } else {
        // Completed mode (Read-only + Re-open option)
        if (badgeEl) {
          badgeEl.innerText = 'PAID & FINALIZED';
          badgeEl.style.background = 'rgba(16, 185, 129, 0.12)';
          badgeEl.style.color = '#10b981';
          badgeEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        }

        if (inputsRow) inputsRow.style.display = 'none';
        if (paidRow) paidRow.style.display = 'block';
        if (settleBtn) settleBtn.style.display = 'none';

        const pPaidDate = document.getElementById('mAuditPaidDate');
        const pPaidMode = document.getElementById('mAuditPaidMode');
        const pPaidAdv = document.getElementById('mAuditPaidAdv');
        const pPaidNotes = document.getElementById('mAuditPaidNotes');

        const deducVal = payment ? (payment.advance_deducted || payment.total_advances || 0) : 0;
        const finalVal = payment ? (payment.final_paid_amount || payment.net_paid || payment.net_payable || 0) : 0;
        const pendingAdvVal = Math.max(0, availableAdv - deducVal);

        if (pPaidDate) pPaidDate.innerText = payment?.payment_date || '—';
        if (pPaidMode) pPaidMode.innerText = payment?.payment_mode || 'Cash';
        if (pPaidAdv) pPaidAdv.innerText = `Rs. ${Math.round(deducVal).toLocaleString('en-IN')}`;
        const pPaidPendingAdv = document.getElementById('mAuditPaidPendingAdv');
        if (pPaidPendingAdv) pPaidPendingAdv.innerText = `Rs. ${Math.round(pendingAdvVal).toLocaleString('en-IN')}`;
        if (pPaidNotes) pPaidNotes.innerText = payment?.notes || '—';

        const netPayableEl = document.getElementById('mAuditNetPayable');
        if (netPayableEl) netPayableEl.innerText = `Rs. ${Math.round(finalVal).toLocaleString('en-IN')}`;

        // 7-day grace period for reopening
        let canReopen = true;
        if (payment?.payment_date) {
          const pDate = new Date(payment.payment_date);
          const diffDays = Math.ceil((Date.now() - pDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays > 7) canReopen = false;
        }
        if (reopenBtn) reopenBtn.style.display = canReopen ? 'inline-block' : 'none';
      }

      app.openModal('modalAuditStatement');
    } catch (e) {
      console.error('[MonthlyModule] openAuditModal error:', e);
      app.showToast(`Error opening audit modal: ${e.message}`, 'error');
    }
  },

  /**
   * Updates Net Payable in the Audit Modal based on user's deduction input
   */
  updateAuditNetCalc() {
    if (!this.activeAuditData) return;

    const gross = this.activeAuditData.grossAmt || 0;
    const maxAdv = this.activeAuditData.availableAdv || 0;
    const deducInput = document.getElementById('mAuditAdvDeducInput');
    let deduc = parseFloat(deducInput?.value) || 0;

    if (deduc < 0) {
      deduc = 0;
      if (deducInput) deducInput.value = 0;
    } else if (deduc > maxAdv) {
      deduc = maxAdv;
      if (deducInput) deducInput.value = deduc;
    }

    const netPayable = Math.max(0, gross - deduc);
    const netPayableEl = document.getElementById('mAuditNetPayable');
    if (netPayableEl) netPayableEl.innerText = `Rs. ${Math.round(netPayable).toLocaleString('en-IN')}`;

    // Live update of pending advance balance hint
    const pendingAdv = Math.max(0, maxAdv - deduc);
    const pendingAdvHint = document.getElementById('mAuditPendingAdvHint');
    if (pendingAdvHint) pendingAdvHint.innerText = `Rs. ${Math.round(pendingAdv).toLocaleString('en-IN')}`;
  },

  /**
   * Commits settlement from the Audit Statement Modal
   */
  async commitAuditSettlement() {
    if (!this.activeAuditData) return;

    const { owner, month, year, grossAmt, totalGross, totalNet, availableAdv, missingRateCount } = this.activeAuditData;
    const deducInput = document.getElementById('mAuditAdvDeducInput');
    const modeSelect = document.getElementById('mAuditPayModeSelect');
    const notesInput = document.getElementById('mAuditNotesInput');

    const deduc = parseFloat(deducInput?.value) || 0;
    const mode = modeSelect?.value || 'Cash';
    const notes = notesInput?.value.trim() || '';
    const netPayable = Math.max(0, grossAmt - deduc);
    const todayStr = new Date().toISOString().split('T')[0];

    // Validation 1: Missing Rates Check - STRICT BLOCK
    if (missingRateCount > 0) {
      alert(
        `🚫 SETTLEMENT BLOCKED:\n\n${missingRateCount} leaf pickup(s) do not have rates applied (Rs. 0.00/kg).\n\nYou cannot finalize this payout statement because rates are missing.\n\nPlease open the Rates Desk and enter rates for all leaf collections before settling.`
      );
      return;
    }

    // Validation 2: Max Deduction Check
    if (deduc > availableAdv) {
      alert(`Advance deduction (Rs. ${deduc}) cannot exceed available advance balance (Rs. ${availableAdv}).`);
      return;
    }

    // Confirmation
    if (!confirm(`Confirm and finalize payment of Rs. ${Math.round(netPayable).toLocaleString('en-IN')} for ${owner.name} via ${mode}?`)) {
      return;
    }

    try {
      const id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('mp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
      const syncId = `settle_${owner.id}_${month}_${year}_${Date.now()}`;
      const sid = this.activeSessionId;
      const currentUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';

      // Insert with all schema columns for complete compatibility
      await window.electronAPI.db.run(`
        INSERT INTO monthly_payments (
          id, app_user_id, owner_id, month, year, payment_date, 
          total_gross_kg, total_net_kg, gross_weight, net_weight,
          rate_per_kg, total_amount, gross_amount, 
          advance_deducted, total_advances, 
          final_paid_amount, net_paid, net_payable,
          payment_mode, is_paid, notes, session_id, sync_id, sync_status
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 
          ?, ?, ?, ?,
          ?, ?, ?, 
          ?, ?, 
          ?, ?, ?,
          ?, 1, ?, ?, ?, 0
        )
      `, [
        id, currentUid, owner.id, month, year, todayStr,
        totalGross, totalNet, totalGross, totalNet,
        0, grossAmt, grossAmt,
        deduc, deduc,
        netPayable, netPayable, netPayable,
        mode, notes, sid, syncId
      ]);

      app.closeModal('modalAuditStatement');
      app.showToast(`Payment of Rs. ${Math.round(netPayable).toLocaleString('en-IN')} committed for ${owner.name}!`, 'success');

      await this.loadMonthlyData();
      this.switchTab('completed');
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('monthly_payments');
      }
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[MonthlyModule] Settle commit error:', e);
      app.showToast(`Error committing settlement: ${e.message}`, 'error');
    }
  },

  /**
   * Re-Open statement within the 7-day grace period
   */
  async reopenStatement(paymentId, ownerName) {
    if (!confirm(`Are you sure you want to re-open the statement for ${ownerName}?\n\nThis payment will be cancelled and returned to Pending Payments.`)) {
      return;
    }

    try {
      const row = await window.electronAPI.db.getOne("SELECT sync_id, cloud_id FROM monthly_payments WHERE id = ?", [paymentId]);
      const syncId = row?.data?.sync_id || row?.data?.cloud_id || paymentId;
      await window.electronAPI.db.run(
        "INSERT OR REPLACE INTO deleted_tombstones (sync_id, table_name, deleted_at) VALUES (?, 'monthly_payments', CURRENT_TIMESTAMP)",
        [syncId]
      );
      await window.electronAPI.db.run("DELETE FROM monthly_payments WHERE id = ?", [paymentId]);
      app.showToast(`Statement for ${ownerName} re-opened and returned to Pending.`, 'info');
      await this.loadMonthlyData();
      this.switchTab('pending');
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('monthly_payments');
      }
      setTimeout(() => app.triggerSync(), 1000);
    } catch (e) {
      console.error('[MonthlyModule] Reopen error:', e);
      app.showToast(`Error re-opening statement: ${e.message}`, 'error');
    }
  },

  async reopenCurrentStatement() {
    if (!this.activeAuditData?.payment) return;
    const paymentId = this.activeAuditData.payment.id;
    const ownerName = this.activeAuditData.owner.name;
    app.closeModal('modalAuditStatement');
    await this.reopenStatement(paymentId, ownerName);
  },

  /**
   * Prints printable HTML statement for the active audit modal
   */
  async printAuditStatement() {
    if (!this.activeAuditData) return;
    await this.printStatement(this.activeAuditData.owner.id);
  },

  /**
   * Generates clean formatted Printable Statement
   */
  async printStatement(ownerId) {
    const m = parseInt(document.getElementById('monthlyMonthSelect')?.value);
    const y = parseInt(document.getElementById('monthlyYearInput')?.value);
    const monthPrefix = `${y}-${String(m).padStart(2, '0')}`;
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    try {
      const ownerRes = await window.electronAPI.db.getOne("SELECT * FROM owners WHERE id = ?", [ownerId]);
      const owner = ownerRes?.data;
      if (!owner) return;

      const collsRes = await window.electronAPI.db.query(
        "SELECT * FROM daily_collections WHERE owner_id = ? AND date LIKE ? ORDER BY date ASC",
        [ownerId, `${monthPrefix}%`]
      );
      const rows = collsRes?.data || [];

      const payRes = await window.electronAPI.db.getOne(
        "SELECT * FROM monthly_payments WHERE owner_id = ? AND month = ? AND year = ? ORDER BY created_at DESC LIMIT 1",
        [ownerId, m, y]
      );
      const pay = payRes?.data || {};

      // Outstanding Advances Calculation for Statement
      const advTotalRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(amount), 0) as total FROM advances WHERE owner_id = ?",
        [ownerId]
      );
      const advDeducRes = await window.electronAPI.db.getOne(
        "SELECT COALESCE(SUM(COALESCE(advance_deducted, total_advances, 0)), 0) as deducted FROM monthly_payments WHERE owner_id = ? AND is_paid = 1" + (pay.id ? " AND id != ?" : ""),
        pay.id ? [ownerId, pay.id] : [ownerId]
      );

      const totalAdv = Number(advTotalRes?.data?.total || 0);
      const prevDeducted = Number(advDeducRes?.data?.deducted || 0);
      const outstandingBefore = Math.max(0, totalAdv - prevDeducted);

      const agencyName = await window.electronAPI.db.getSetting('agent_name', 'Leaf Ledger Pro');
      const agentContact = await window.electronAPI.db.getSetting('agent_contact', '');

      const totNet = pay.total_net_kg || pay.net_weight || rows.reduce((s, r) => s + (Number(r.net_weight_kg) || 0), 0);
      const grossAmt = pay.total_amount || pay.gross_amount || rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

      // Check if user has an active deduction entered in the modal currently being viewed
      let modalDeduc = null;
      if (this.activeAuditData && this.activeAuditData.owner?.id === ownerId && !pay.is_paid) {
        const inputVal = parseFloat(document.getElementById('mAuditAdvDeducInput')?.value);
        if (!isNaN(inputVal)) modalDeduc = inputVal;
      }

      const advDed = pay.is_paid ? (pay.advance_deducted || pay.total_advances || 0) : (modalDeduc !== null ? modalDeduc : (pay.advance_deducted || pay.total_advances || 0));
      const pendingAdv = Math.max(0, outstandingBefore - advDed);
      const finalPaid = pay.is_paid ? (pay.final_paid_amount || pay.net_paid || pay.net_payable || (grossAmt - advDed)) : Math.max(0, grossAmt - advDed);

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Monthly Statement - ${owner.name}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #111; max-width: 800px; margin: auto; }
            .header { text-align: center; border-bottom: 2.5px solid #16a34a; padding-bottom: 12px; margin-bottom: 16px; }
            .title { font-size: 22px; font-weight: 800; color: #166534; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; margin-bottom: 18px; font-size: 12.5px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
            th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
            th { background: #f1f5f9; font-weight: 700; color: #334155; }
            .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
            .total-box { margin-top: 14px; text-align: right; font-size: 13px; line-height: 1.9; background: #f8fafc; padding: 14px 18px; border-radius: 8px; border: 1px solid #e2e8f0; }
            .highlight { font-size: 18px; font-weight: 800; color: #15803d; }
            .footer-note { margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${agencyName}</div>
            <div class="subtitle">Authorized Tea Leaf Procurement &bull; ${agentContact ? `Contact: ${agentContact} &bull; ` : ''}Monthly Statement: ${monthNames[m - 1]} ${y}</div>
          </div>

          <div class="meta-grid">
            <div>
              <div><b>Planter:</b> ${owner.name}</div>
              <div><b>Phone:</b> +91 ${owner.phone || '—'}</div>
              <div><b>Address:</b> ${owner.address || owner.village || '—'}</div>
              <div><b>Agreement Date:</b> ${owner.agreement_date || '—'}</div>
            </div>
            <div style="text-align: right;">
              <div><b>Statement Date:</b> ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
              <div><b>Bank:</b> ${owner.bank_name || '—'}</div>
              <div><b>A/c No:</b> <span class="mono">${owner.bank_acc || '—'}</span></div>
              <div><b>IFSC:</b> <span class="mono">${owner.bank_ifsc || '—'}</span></div>
              <div><b>Status:</b> <b>${pay.is_paid ? 'PAID & SETTLED' : 'PENDING'}</b></div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Gross (kg)</th>
                <th>Ded %</th>
                <th>Net (kg)</th>
                <th>Rate (₹)</th>
                <th style="text-align: right;">Amount (Rs)</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td class="mono">${r.date}</td>
                  <td class="mono">${Math.round(r.gross_weight_kg || 0)}</td>
                  <td class="mono">${Math.round(r.bag_weight_kg || 0)}%</td>
                  <td class="mono" style="font-weight: 700;">${Math.round(r.net_weight_kg || 0)}</td>
                  <td class="mono">₹${Number(r.rate_per_kg || 0).toFixed(2)}</td>
                  <td class="mono" style="text-align: right; font-weight: 700;">₹${Math.round(r.amount || 0).toLocaleString('en-IN')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="total-box">
            <div>Total Net Weight: <b>${Math.round(totNet).toLocaleString('en-IN')} kg</b></div>
            <div>Gross Payable Amount: <b>Rs. ${Math.round(grossAmt).toLocaleString('en-IN')}</b></div>
            <div>Advance Deducted: <b style="color: #c2410c;">- Rs. ${Math.round(advDed).toLocaleString('en-IN')}</b></div>
            <div style="font-size: 13.5px; color: #b45309; font-weight: 700; margin: 2px 0;">Pending Advance Balance: <b style="color: #b45309;">Rs. ${Math.round(pendingAdv).toLocaleString('en-IN')}</b></div>
            <div class="highlight">Final Net Settled: Rs. ${Math.round(finalPaid).toLocaleString('en-IN')}</div>
            ${pay.payment_mode ? `<div>Payment Mode: <b>${pay.payment_mode}</b></div>` : ''}
          </div>

          <div style="display: flex; justify-content: space-between; margin-top: 40px; padding: 0 10px;">
            <div style="text-align: center; border-top: 1px solid #94a3b8; padding-top: 8px; width: 200px; font-size: 11px; color: #475569;">
              <b>Planter Signature / Thumb</b>
            </div>
            <div style="text-align: center; border-top: 1px solid #94a3b8; padding-top: 8px; width: 200px; font-size: 11px; color: #475569;">
              <b>Authorized Agent Signatory</b>
            </div>
          </div>

          <div class="footer-note">
            Generated via Leaf Ledger Pro ERP &bull; Official Procurement Statement &bull; Digitally Verified
          </div>
        </body>
        </html>
      `;

      const defaultFilename = `Monthly_Statement_${(owner.name || 'Planter').replace(/[^a-zA-Z0-9]/g, '_')}_${monthNames[m - 1]}_${y}.pdf`;

      if (app.showDocumentPreview) {
        app.showDocumentPreview({
          title: `📄 Statement Preview: ${owner.name}`,
          subtitle: `Monthly Procurement Statement for ${monthNames[m - 1]} ${y}`,
          html,
          defaultFilename
        });
      } else {
        await window.electronAPI.printer.printHtml(html);
        app.showToast('Statement sent to printer!', 'success');
      }
    } catch (e) {
      console.error('[MonthlyModule] Print statement error:', e);
      app.showToast(`Error printing statement: ${e.message}`, 'error');
    }
  },

  load() {
    return this.loadMonthlyData();
  },

  refresh() {
    return this.loadMonthlyData();
  }
};

window.monthlyModule = monthlyModule;
