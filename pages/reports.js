/**
 * Leaf Ledger Pro - Reports & Analytics Module
 * Mirrors Python ui/reports.py: Business Pulse, Reconciliation, P&L Statement & Owner Analysis
 */

const reportsModule = {
  currentTab: 'pulse',
  cachedOwners: [],
  cachedFactories: [],
  lastExportData: null,

  async init() {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    const mSelect = document.getElementById('repMonthSelect');
    const yInput = document.getElementById('repYearInput');
    if (mSelect) mSelect.value = String(curMonth);
    if (yInput) yInput.value = String(curYear);

    await this.loadFilters();
    this.updatePresetPillStyles('current');
    await this.generateReport();
  },

  async loadFilters() {
    try {
      const ownersRes = await window.electronAPI.db.query(
        "SELECT id, name FROM owners WHERE is_active = 1 ORDER BY name ASC"
      );
      this.cachedOwners = ownersRes?.data || [];
      const oSelect = document.getElementById('repOwnerSelect');
      if (oSelect) {
        oSelect.innerHTML = '<option value="ALL">All Growers</option>' +
          this.cachedOwners.map(o => `<option value="${o.id}">${this.escapeHtml(o.name)}</option>`).join('');
      }

      const factRes = await window.electronAPI.db.query(
        "SELECT id, name FROM factories WHERE is_active = 1 ORDER BY name ASC"
      );
      this.cachedFactories = factRes?.data || [];
      const fSelect = document.getElementById('repFactorySelect');
      if (fSelect) {
        fSelect.innerHTML = '<option value="ALL">All Factories</option>' +
          this.cachedFactories.map(f => `<option value="${f.id}">${this.escapeHtml(f.name)}</option>`).join('');
      }
    } catch (e) {
      console.error('[ReportsModule] Load filters error:', e);
    }
  },

  setPeriodPreset(preset) {
    const now = new Date();
    const mSelect = document.getElementById('repMonthSelect');
    const yInput = document.getElementById('repYearInput');

    if (preset === 'current') {
      if (mSelect) mSelect.value = String(now.getMonth() + 1);
      if (yInput) yInput.value = String(now.getFullYear());
    } else if (preset === 'last') {
      let prevM = now.getMonth();
      let prevY = now.getFullYear();
      if (prevM === 0) {
        prevM = 12;
        prevY -= 1;
      }
      if (mSelect) mSelect.value = String(prevM);
      if (yInput) yInput.value = String(prevY);
    } else if (preset === 'season') {
      if (mSelect) mSelect.value = 'ALL';
      if (yInput) yInput.value = String(now.getFullYear());
    }

    this.updatePresetPillStyles(preset);
    this.generateReport();
  },

  updatePresetPillStyles(preset) {
    const btnCur = document.getElementById('repQuickCurrentMonth');
    const btnLast = document.getElementById('repQuickLastMonth');
    const btnSeason = document.getElementById('repQuickFullSeason');

    [btnCur, btnLast, btnSeason].forEach(b => {
      if (b) {
        b.className = 'btn btn-secondary btn-sm';
        b.style.fontWeight = '600';
      }
    });

    if (preset === 'current' && btnCur) {
      btnCur.className = 'btn btn-primary btn-sm';
      btnCur.style.fontWeight = '700';
    } else if (preset === 'last' && btnLast) {
      btnLast.className = 'btn btn-primary btn-sm';
      btnLast.style.fontWeight = '700';
    } else if (preset === 'season' && btnSeason) {
      btnSeason.className = 'btn btn-primary btn-sm';
      btnSeason.style.fontWeight = '700';
    }
  },

  onFilterChange() {
    this.updatePresetPillStyles('');
    this.generateReport();
  },

  switchTab(tab) {
    this.currentTab = tab;
    const tabIds = ['repTabPulse', 'repTabRecon', 'repTabFinance', 'repTabGrower', 'repTabFactory', 'repTabExpenses'];
    tabIds.forEach(id => {
      const b = document.getElementById(id);
      if (b) b.className = 'btn btn-secondary btn-sm';
    });

    const oContainer = document.getElementById('repOwnerContainer');
    const fContainer = document.getElementById('repFactoryContainer');

    if (oContainer) oContainer.style.display = 'none';
    if (fContainer) fContainer.style.display = 'none';

    if (tab === 'pulse') {
      document.getElementById('repTabPulse')?.setAttribute('class', 'btn btn-primary btn-sm');
    } else if (tab === 'comparison') {
      document.getElementById('repTabRecon')?.setAttribute('class', 'btn btn-primary btn-sm');
      if (fContainer) fContainer.style.display = 'flex';
    } else if (tab === 'finance') {
      document.getElementById('repTabFinance')?.setAttribute('class', 'btn btn-primary btn-sm');
    } else if (tab === 'grower') {
      document.getElementById('repTabGrower')?.setAttribute('class', 'btn btn-primary btn-sm');
      if (oContainer) oContainer.style.display = 'flex';
    } else if (tab === 'factory') {
      document.getElementById('repTabFactory')?.setAttribute('class', 'btn btn-primary btn-sm');
      if (fContainer) fContainer.style.display = 'flex';
    } else if (tab === 'expenses') {
      document.getElementById('repTabExpenses')?.setAttribute('class', 'btn btn-primary btn-sm');
    }

    this.generateReport();
  },

  getDateFilter() {
    const mVal = document.getElementById('repMonthSelect')?.value || 'ALL';
    const yVal = document.getElementById('repYearInput')?.value || new Date().getFullYear();
    const datePrefix = mVal === 'ALL' ? `${yVal}-` : `${yVal}-${String(mVal).padStart(2, '0')}`;

    const monthNames = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const periodLabel = mVal === 'ALL'
      ? `Full Season (Year ${yVal})`
      : `${monthNames[parseInt(mVal)] || ''} ${yVal}`;

    const statusEl = document.getElementById('repPeriodStatusText');
    if (statusEl) statusEl.textContent = `📅 ${periodLabel}`;

    return { datePrefix, mVal, yVal, periodLabel };
  },

  async generateReport() {
    const content = document.getElementById('repContentArea');
    if (!content) return;

    content.innerHTML = app.getLoadingStateHtml('Compiling executive analytics & intelligence...');

    const { datePrefix, periodLabel } = this.getDateFilter();
    const selectedOwnerId = document.getElementById('repOwnerSelect')?.value || 'ALL';
    const selectedFactoryId = document.getElementById('repFactorySelect')?.value || 'ALL';

    try {
      if (this.currentTab === 'pulse') {
        await this.renderExecutivePulse(datePrefix, periodLabel, content);
      } else if (this.currentTab === 'comparison') {
        await this.renderTransitAudit(datePrefix, periodLabel, selectedFactoryId, content);
      } else if (this.currentTab === 'finance') {
        await this.renderPandL(datePrefix, periodLabel, content);
      } else if (this.currentTab === 'grower') {
        await this.renderGrowerIntelligence(datePrefix, periodLabel, selectedOwnerId, content);
      } else if (this.currentTab === 'factory') {
        await this.renderFactoryComparative(datePrefix, periodLabel, selectedFactoryId, content);
      } else if (this.currentTab === 'expenses') {
        await this.renderExpenseAudit(datePrefix, periodLabel, content);
      }
    } catch (e) {
      console.error('[ReportsModule] Generate error:', e);
      content.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 12px; padding: 20px; color: #ef4444;">
          <strong>Error generating report:</strong> ${e.message}
        </div>
      `;
    }
  },

  // ==========================================================================
  // TAB 1: EXECUTIVE PULSE & COMMERCIAL SPREAD
  // ==========================================================================
  async renderExecutivePulse(datePrefix, periodLabel, container) {
    const collRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(gross_weight_kg), 0) as gross,
             COALESCE(SUM(net_weight_kg), 0) as net,
             COALESCE(SUM(amount), 0) as payout,
             COUNT(DISTINCT owner_id) as active_growers,
             COUNT(*) as collection_count
      FROM daily_collections WHERE date LIKE ?
    `, [`${datePrefix}%`]);

    const factRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(gross_weight_kg), 0) as gross,
             COALESCE(SUM(net_weight_kg), 0) as net,
             COALESCE(SUM(amount), 0) as revenue,
             COUNT(DISTINCT factory_id) as active_factories,
             COUNT(*) as delivery_count
      FROM factory_collections WHERE date LIKE ?
    `, [`${datePrefix}%`]);

    const expRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses
      FROM expenses WHERE date LIKE ?
    `, [`${datePrefix}%`]);

    const advAllTimeRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(amount), 0) as total_all_time FROM advances
    `);
    const advRecoveredAllTimeRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(advance_deducted), 0) as total_recovered FROM monthly_payments
    `);

    const dailyGarden = await window.electronAPI.db.query(`
      SELECT date, SUM(net_weight_kg) as garden_net
      FROM daily_collections WHERE date LIKE ?
      GROUP BY date ORDER BY date ASC
    `, [`${datePrefix}%`]);

    const dailyFactory = await window.electronAPI.db.query(`
      SELECT date, SUM(net_weight_kg) as factory_net
      FROM factory_collections WHERE date LIKE ?
      GROUP BY date ORDER BY date ASC
    `, [`${datePrefix}%`]);

    const gardenGross = Math.round(collRes?.data?.gross || 0);
    const gardenNet = Math.round(collRes?.data?.net || 0);
    const planterPayout = Math.round(collRes?.data?.payout || 0);
    const activeGrowers = collRes?.data?.active_growers || 0;

    const factNet = Math.round(factRes?.data?.net || 0);
    const factGross = Math.round(factRes?.data?.gross || 0);
    const factRevenue = Math.round(factRes?.data?.revenue || 0);
    const activeFactories = factRes?.data?.active_factories || 0;

    const expenses = Math.round(expRes?.data?.total_expenses || 0);

    const advTotalAll = advAllTimeRes?.data?.total_all_time || 0;
    const advRecAll = advRecoveredAllTimeRes?.data?.total_recovered || 0;
    const unrecoveredAdvances = Math.max(0, Math.round(advTotalAll - advRecAll));

    const avgBuyingRate = gardenNet > 0 ? (planterPayout / gardenNet) : 0;
    const avgSellingRate = factNet > 0 ? (factRevenue / factNet) : 0;
    const grossSpreadPerKg = avgSellingRate > 0 && avgBuyingRate > 0 ? (avgSellingRate - avgBuyingRate) : 0;

    const transitDiff = factNet - gardenNet;
    const transitLossKg = Math.abs(transitDiff);
    const transitLossPct = gardenNet > 0 ? ((transitDiff / gardenNet) * 100) : 0;
    const transitLossCost = Math.round(transitLossKg * (avgSellingRate || 28));

    const grossOperatingProfit = factRevenue - planterPayout;
    const netEbitda = grossOperatingProfit - expenses;
    const netEbitdaPerKg = gardenNet > 0 ? (netEbitda / gardenNet) : 0;
    const marginPct = factRevenue > 0 ? ((netEbitda / factRevenue) * 100) : 0;

    this.lastExportData = {
      title: `Executive Pulse - ${periodLabel}`,
      headers: ['Indicator', 'Metric', 'Unit / Details'],
      rows: [
        ['Garden Intake Net', `${gardenNet.toLocaleString('en-IN')} kg`, `Gross: ${gardenGross.toLocaleString('en-IN')} kg`],
        ['Factory Accepted Net', `${factNet.toLocaleString('en-IN')} kg`, `Gross: ${factGross.toLocaleString('en-IN')} kg`],
        ['Transit Shortage / Variance', `${transitDiff > 0 ? '+' : ''}${transitDiff.toLocaleString('en-IN')} kg`, `${transitLossPct.toFixed(2)}% loss`],
        ['Transit Loss Valuation', `₹${transitLossCost.toLocaleString('en-IN')}`, 'Financial erosion due to weight loss'],
        ['Average Buying Rate', `₹${avgBuyingRate.toFixed(2)} / kg`, 'Paid to small tea growers'],
        ['Average Selling Rate', `₹${avgSellingRate.toFixed(2)} / kg`, 'Realized from bought-leaf factories'],
        ['Gross Commercial Spread', `₹${grossSpreadPerKg.toFixed(2)} / kg`, 'Agency margin before overheads'],
        ['Total Factory Revenue', `₹${factRevenue.toLocaleString('en-IN')}`, 'Gross sales realization'],
        ['Total Planter Leaf Cost', `₹${planterPayout.toLocaleString('en-IN')}`, 'Cost of raw material'],
        ['Operational Overheads', `₹${expenses.toLocaleString('en-IN')}`, 'Fuel, labor, transport, weighing'],
        ['Net Operating EBITDA', `₹${netEbitda.toLocaleString('en-IN')}`, `Net Profit (${marginPct.toFixed(1)}% margin)`],
        ['Unrecovered Advances', `₹${unrecoveredAdvances.toLocaleString('en-IN')}`, 'Grower capital in field']
      ]
    };

    const insights = this.generateExecutiveInsights({
      gardenNet, factNet, grossSpreadPerKg, transitLossPct, transitLossCost,
      netEbitda, marginPct, unrecoveredAdvances, activeGrowers, activeFactories
    });

    container.innerHTML = `
      <!-- Smart Business Advisory Banner -->
      <div class="rep-insight-banner">
        <div class="rep-insight-title">
          <span>⚡</span> Executive Advisory & Operational Intelligence (${periodLabel})
        </div>
        <div class="rep-insight-list">
          ${insights.map(item => `
            <div class="rep-insight-item">
              ${item}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Top KPI Strip -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 22px;">
        
        <div class="rep-kpi-card">
          <div class="rep-kpi-header">
            <span class="rep-kpi-title">Garden Intake Volume</span>
            <span class="rep-kpi-icon">🍃</span>
          </div>
          <div class="rep-kpi-value mono" style="color: var(--accent-emerald);">
            ${gardenNet.toLocaleString('en-IN')} <span style="font-size: 14px; font-weight: 600;">kg</span>
          </div>
          <div class="rep-kpi-sub">
            <span>Gross: <strong class="mono">${gardenGross.toLocaleString('en-IN')} kg</strong></span>
            <span style="color: var(--border-strong);">&bull;</span>
            <span>${activeGrowers} growers</span>
          </div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header">
            <span class="rep-kpi-title">Gross Spread (₹/kg)</span>
            <span class="rep-kpi-icon">📈</span>
          </div>
          <div class="rep-kpi-value mono" style="color: #3b82f6;">
            ₹${grossSpreadPerKg.toFixed(2)} <span style="font-size: 14px; font-weight: 600;">/kg</span>
          </div>
          <div class="rep-kpi-sub">
            <span>Sell: ₹${avgSellingRate.toFixed(2)}</span>
            <span style="color: var(--border-strong);">&bull;</span>
            <span>Buy: ₹${avgBuyingRate.toFixed(2)}</span>
          </div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header">
            <span class="rep-kpi-title">Transit Shrinkage</span>
            <span class="rep-kpi-icon">⚖️</span>
          </div>
          <div class="rep-kpi-value mono" style="color: ${transitDiff < 0 ? '#ef4444' : '#10b981'};">
            ${transitDiff > 0 ? '+' : ''}${transitDiff.toLocaleString('en-IN')} <span style="font-size: 14px; font-weight: 600;">kg</span>
          </div>
          <div class="rep-kpi-sub">
            <span class="rep-badge ${Math.abs(transitLossPct) > 2.5 ? 'rep-badge-danger' : 'rep-badge-success'}">
              ${transitLossPct.toFixed(2)}%
            </span>
            <span>Erosion: <strong class="mono">₹${transitLossCost.toLocaleString('en-IN')}</strong></span>
          </div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header">
            <span class="rep-kpi-title">Net EBITDA Profit</span>
            <span class="rep-kpi-icon">💰</span>
          </div>
          <div class="rep-kpi-value mono" style="color: ${netEbitda >= 0 ? 'var(--accent-emerald)' : '#ef4444'};">
            ₹${netEbitda.toLocaleString('en-IN')}
          </div>
          <div class="rep-kpi-sub">
            <span>Margin: <strong>${marginPct.toFixed(1)}%</strong></span>
            <span style="color: var(--border-strong);">&bull;</span>
            <span>₹${netEbitdaPerKg.toFixed(2)}/kg net</span>
          </div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header">
            <span class="rep-kpi-title">Unrecovered Advances</span>
            <span class="rep-kpi-icon">💼</span>
          </div>
          <div class="rep-kpi-value mono" style="color: #f59e0b;">
            ₹${unrecoveredAdvances.toLocaleString('en-IN')}
          </div>
          <div class="rep-kpi-sub">
            <span>Capital deployed with growers</span>
          </div>
        </div>

      </div>

      <!-- Visual Spread Meter & Intake Trends -->
      <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; margin-bottom: 22px;">
        
        <!-- Volume Trend SVG Mini Chart -->
        <div style="background: var(--bg-card); border-radius: 12px; padding: 20px; border: 1px solid var(--border-subtle);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div>
              <div style="font-size: 13px; font-weight: 800; color: var(--text-primary);">📊 Daily Intake vs Factory Acceptance Trend</div>
              <div style="font-size: 11px; color: var(--text-muted);">Timeline of green leaf processed vs factory scale weight</div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; font-size: 11px;">
              <span style="display: inline-flex; align-items: center; gap: 4px;">
                <span style="width: 10px; height: 10px; background: var(--accent-emerald); border-radius: 2px;"></span> Garden Intake
              </span>
              <span style="display: inline-flex; align-items: center; gap: 4px;">
                <span style="width: 10px; height: 10px; background: #3b82f6; border-radius: 2px;"></span> Factory Accepted
              </span>
            </div>
          </div>
          <div style="overflow-x: auto; padding-bottom: 4px;">
            ${this.renderVolumeTrendSVG(dailyGarden?.data || [], dailyFactory?.data || [])}
          </div>
        </div>

        <!-- Unit Economics Spread Card -->
        <div style="background: var(--bg-card); border-radius: 12px; padding: 20px; border: 1px solid var(--border-subtle); display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 13px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">
              🔍 Unit Economics Breakdown (Per Kg Realization)
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">
              How every 1 kg of green leaf converts to agency profitability
            </div>

            <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">🏭 Factory Realization Rate:</span>
                <span class="mono" style="font-weight: 700; color: var(--text-primary);">₹${avgSellingRate.toFixed(2)} /kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">🌱 Less: Grower Purchase Price:</span>
                <span class="mono" style="font-weight: 700; color: #ef4444;">- ₹${avgBuyingRate.toFixed(2)} /kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-subtle); padding-top: 6px;">
                <span style="font-weight: 700; color: var(--text-primary);">Gross Spread:</span>
                <span class="mono" style="font-weight: 800; color: #3b82f6;">₹${grossSpreadPerKg.toFixed(2)} /kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">⚖️ Less: Transit Shrinkage Loss:</span>
                <span class="mono" style="font-weight: 700; color: #f59e0b;">- ₹${gardenNet > 0 ? (transitLossCost / gardenNet).toFixed(2) : '0.00'} /kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">🚛 Less: Operating Overhead:</span>
                <span class="mono" style="font-weight: 700; color: #ef4444;">- ₹${gardenNet > 0 ? (expenses / gardenNet).toFixed(2) : '0.00'} /kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 2px solid var(--border-subtle); padding-top: 8px; font-size: 14px;">
                <span style="font-weight: 800; color: var(--text-primary);">Net Realized Margin:</span>
                <span class="mono" style="font-weight: 800; color: ${netEbitdaPerKg >= 0 ? 'var(--accent-emerald)' : '#ef4444'}; font-size: 16px;">
                  ₹${netEbitdaPerKg.toFixed(2)} /kg
                </span>
              </div>
            </div>
          </div>

          <div style="margin-top: 16px;">
            <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); margin-bottom: 4px;">
              <span>Grower Cost (${factRevenue > 0 ? Math.round((planterPayout / factRevenue) * 100) : 0}%)</span>
              <span>Expenses (${factRevenue > 0 ? Math.round((expenses / factRevenue) * 100) : 0}%)</span>
              <span>Net Profit (${marginPct.toFixed(0)}%)</span>
            </div>
            <div class="rep-meter-bar">
              <div class="rep-meter-seg" style="width: ${factRevenue > 0 ? (planterPayout / factRevenue) * 100 : 80}%; background: #ef4444;"></div>
              <div class="rep-meter-seg" style="width: ${factRevenue > 0 ? (expenses / factRevenue) * 100 : 10}%; background: #f59e0b;"></div>
              <div class="rep-meter-seg" style="width: ${factRevenue > 0 ? Math.max(0, marginPct) : 10}%; background: var(--accent-emerald);"></div>
            </div>
          </div>

        </div>

      </div>
    `;
  },

  generateExecutiveInsights(m) {
    const insights = [];

    if (m.gardenNet === 0) {
      return ['No collection records logged for this period. Enter daily collections to unlock live analytics.'];
    }

    if (m.grossSpreadPerKg >= 5) {
      insights.push(`💡 <strong>Strong Spread:</strong> Your gross trading spread is <strong>₹${m.grossSpreadPerKg.toFixed(2)}/kg</strong>, providing solid room for high operating profitability.`);
    } else if (m.grossSpreadPerKg > 0) {
      insights.push(`⚠️ <strong>Tight Margin Spread:</strong> Your spread is <strong>₹${m.grossSpreadPerKg.toFixed(2)}/kg</strong>. Review factory rates or optimize grower buying rates to avoid margin compression.`);
    } else {
      insights.push(`🚨 <strong>Negative Spread Warning:</strong> Factory rates logged are currently lower than grower payout rates! Check rate configurations immediately.`);
    }

    const absLoss = Math.abs(m.transitLossPct);
    if (absLoss <= 2.0) {
      insights.push(`✅ <strong>Efficient Transit:</strong> Shrinkage is strictly controlled at <strong>${absLoss.toFixed(2)}%</strong> (${m.transitLossCost > 0 ? `costing ₹${m.transitLossCost.toLocaleString('en-IN')}` : 'safe levels'}), within healthy industry standards (<2.5%).`);
    } else {
      insights.push(`⚠️ <strong>High Transit Loss:</strong> Weight variance is <strong>${absLoss.toFixed(2)}%</strong>, eroding <strong>₹${m.transitLossCost.toLocaleString('en-IN')}</strong> in value. Audit factory weighbridge scales and transit drying.`);
    }

    if (m.unrecoveredAdvances > 0) {
      insights.push(`💼 <strong>Working Capital:</strong> You have <strong>₹${m.unrecoveredAdvances.toLocaleString('en-IN')}</strong> deployed in grower advances. Review deduction schedules to accelerate recovery.`);
    } else {
      insights.push(`✅ <strong>Clean Advances:</strong> No unrecovered grower advances pending across active accounts.`);
    }

    if (m.activeFactories > 1) {
      insights.push(`🏭 <strong>Multi-Factory Diversification:</strong> Supplying across <strong>${m.activeFactories} factories</strong> gives you route flexibility and price negotiation leverage.`);
    }

    return insights;
  },

  renderVolumeTrendSVG(gardenRows, factoryRows) {
    if (gardenRows.length === 0) {
      return app.getEmptyStateHtml({
        title: 'No Trends Recorded',
        message: 'No daily collection trends recorded for this period.'
      });
    }

    const factMap = new Map(factoryRows.map(r => [r.date, r.factory_net]));
    const dates = gardenRows.slice(-15);
    const maxVal = Math.max(...dates.map(d => Math.max(d.garden_net, factMap.get(d.date) || 0)), 100);

    const w = Math.max(480, dates.length * 40);
    const h = 180;
    const padX = 35;
    const padY = 25;
    const chartW = w - padX * 2;
    const chartH = h - padY * 2;
    const colW = chartW / dates.length;

    let bars = '';
    let labels = '';

    dates.forEach((d, i) => {
      const gVal = d.garden_net || 0;
      const fVal = factMap.get(d.date) || 0;

      const gH = (gVal / maxVal) * chartH;
      const fH = (fVal / maxVal) * chartH;

      const x = padX + i * colW;
      const dayStr = d.date.split('-')[2];

      bars += `
        <rect x="${x + 4}" y="${h - padY - gH}" width="${(colW / 2) - 3}" height="${gH}" fill="var(--accent-emerald)" rx="2" opacity="0.9">
          <title>${d.date} Intake: ${gVal} kg</title>
        </rect>
        <rect x="${x + (colW / 2) + 1}" y="${h - padY - fH}" width="${(colW / 2) - 3}" height="${fH}" fill="#3b82f6" rx="2" opacity="0.85">
          <title>${d.date} Factory: ${fVal} kg</title>
        </rect>
      `;

      labels += `
        <text x="${x + colW / 2}" y="${h - 8}" font-size="10" font-family="monospace" fill="var(--text-muted)" text-anchor="middle">
          ${dayStr}
        </text>
      `;
    });

    return `
      <svg width="${w}" height="${h}" style="width: 100%; height: auto; min-width: ${w}px;">
        <line x1="${padX}" y1="${padY}" x2="${w - padX}" y2="${padY}" stroke="var(--border-subtle)" stroke-dasharray="3 3"/>
        <line x1="${padX}" y1="${padY + chartH / 2}" x2="${w - padX}" y2="${padY + chartH / 2}" stroke="var(--border-subtle)" stroke-dasharray="3 3"/>
        <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="var(--border-subtle)"/>
        
        <text x="${padX - 6}" y="${padY + 4}" font-size="9" fill="var(--text-muted)" text-anchor="end" font-family="monospace">${Math.round(maxVal)}k</text>
        <text x="${padX - 6}" y="${padY + chartH / 2 + 3}" font-size="9" fill="var(--text-muted)" text-anchor="end" font-family="monospace">${Math.round(maxVal / 2)}k</text>

        ${bars}
        ${labels}
      </svg>
    `;
  },

  // ==========================================================================
  // TAB 2: TRANSIT SHORTAGE & RECONCILIATION AUDIT
  // ==========================================================================
  async renderTransitAudit(datePrefix, periodLabel, factoryId, container) {
    let factClause = '';
    const params = [`${datePrefix}%`];
    if (factoryId && factoryId !== 'ALL') {
      factClause = 'AND factory_id = ?';
      params.push(factoryId);
    }

    const gardenRes = await window.electronAPI.db.query(`
      SELECT date, 
             SUM(gross_weight_kg) as g_gross, 
             SUM(net_weight_kg) as g_net,
             COUNT(DISTINCT owner_id) as growers_count
      FROM daily_collections
      WHERE date LIKE ?
      GROUP BY date
      ORDER BY date DESC
    `, [`${datePrefix}%`]);

    const factRes = await window.electronAPI.db.query(`
      SELECT date, 
             SUM(gross_weight_kg) as f_gross, 
             SUM(net_weight_kg) as f_net,
             AVG(rate_per_kg) as avg_rate,
             COUNT(*) as shipments_count
      FROM factory_collections
      WHERE date LIKE ? ${factClause}
      GROUP BY date
      ORDER BY date DESC
    `, params);

    const factMap = new Map((factRes?.data || []).map(r => [r.date, r]));
    const rows = gardenRes?.data || [];

    let totGGross = 0, totGNet = 0, totFGross = 0, totFNet = 0, totLossVal = 0;

    const auditRows = rows.map(r => {
      const gGross = Math.round(r.g_gross || 0);
      const gNet = Math.round(r.g_net || 0);
      const f = factMap.get(r.date);
      const fGross = f ? Math.round(f.f_gross || 0) : 0;
      const fNet = f ? Math.round(f.f_net || 0) : 0;
      const fRate = f?.avg_rate || 28;

      const gDedPct = gGross > 0 ? (((gGross - gNet) / gGross) * 100) : 0;
      const fDedPct = fGross > 0 ? (((fGross - fNet) / fGross) * 100) : 0;

      const diff = fNet - gNet;
      const varPct = gNet > 0 ? ((diff / gNet) * 100) : 0;
      const lossVal = Math.round(diff * fRate);

      totGGross += gGross;
      totGNet += gNet;
      totFGross += fGross;
      totFNet += fNet;
      if (diff < 0) totLossVal += Math.abs(lossVal);

      return {
        date: r.date,
        gGross, gDedPct, gNet,
        fGross, fDedPct, fNet,
        diff, varPct, lossVal
      };
    });

    const netVariance = totFNet - totGNet;
    const netVariancePct = totGNet > 0 ? ((netVariance / totGNet) * 100) : 0;

    this.lastExportData = {
      title: `Transit Reconciliation Audit - ${periodLabel}`,
      headers: ['Date', 'Garden Gross (kg)', 'Garden Ded %', 'Garden Net (kg)', 'Factory Gross (kg)', 'Factory Ded %', 'Factory Net (kg)', 'Variance (kg)', 'Variance %', 'Valuation Impact (₹)'],
      rows: auditRows.map(r => [
        r.date, r.gGross, `${r.gDedPct.toFixed(1)}%`, r.gNet,
        r.fGross, `${r.fDedPct.toFixed(1)}%`, r.fNet,
        `${r.diff > 0 ? '+' : ''}${r.diff}`, `${r.varPct.toFixed(1)}%`,
        `₹${r.lossVal}`
      ])
    };

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px;">
        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Total Garden Intake</span><span>🌱</span></div>
          <div class="rep-kpi-value mono" style="color: var(--accent-emerald);">${totGNet.toLocaleString('en-IN')} kg</div>
          <div class="rep-kpi-sub">Gross: ${totGGross.toLocaleString('en-IN')} kg</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Factory Accepted</span><span>🏭</span></div>
          <div class="rep-kpi-value mono" style="color: #3b82f6;">${totFNet.toLocaleString('en-IN')} kg</div>
          <div class="rep-kpi-sub">Gross: ${totFGross.toLocaleString('en-IN')} kg</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Net Weight Variance</span><span>⚖️</span></div>
          <div class="rep-kpi-value mono" style="color: ${netVariance < 0 ? '#ef4444' : '#10b981'};">
            ${netVariance > 0 ? '+' : ''}${netVariance.toLocaleString('en-IN')} kg
          </div>
          <div class="rep-kpi-sub">Shrinkage Rate: <strong>${netVariancePct.toFixed(2)}%</strong></div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Transit Loss Value</span><span>💸</span></div>
          <div class="rep-kpi-value mono" style="color: #ef4444;">₹${totLossVal.toLocaleString('en-IN')}</div>
          <div class="rep-kpi-sub">Financial impact of shrinkage</div>
        </div>
      </div>

      <div style="background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;">
        <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary);">⚖️ Day-by-Day Green Leaf Transit & Scale Audit</div>
            <div style="font-size: 11px; color: var(--text-muted);">Comparing garden pickup weights with factory weighbridge acceptance</div>
          </div>
          <span style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">${auditRows.length} Days Audited</span>
        </div>

        <div style="overflow-x: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: var(--bg-input); border-bottom: 1px solid var(--border-subtle); text-transform: uppercase; font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px;">
                <th style="padding: 10px 14px; text-align: left;">Date</th>
                <th style="padding: 10px 14px; text-align: right;">Garden Gross</th>
                <th style="padding: 10px 14px; text-align: right;">Garden Ded</th>
                <th style="padding: 10px 14px; text-align: right;">Garden Net</th>
                <th style="padding: 10px 14px; text-align: right;">Factory Gross</th>
                <th style="padding: 10px 14px; text-align: right;">Factory Ded</th>
                <th style="padding: 10px 14px; text-align: right;">Factory Net</th>
                <th style="padding: 10px 14px; text-align: right;">Variance (kg)</th>
                <th style="padding: 10px 14px; text-align: right;">Var %</th>
                <th style="padding: 10px 14px; text-align: right;">Loss Valuation</th>
              </tr>
            </thead>
            <tbody>
              ${auditRows.length === 0 ? 
                app.getEmptyStateTableRow(10, {
                  title: 'No Transit Records',
                  message: 'No transit dispatch data available for this period.'
                }) : auditRows.map(r => {
                const isLoss = r.diff < 0;
                const isHighLoss = r.varPct < -2.5;
                const statusColor = isHighLoss ? '#ef4444' : (isLoss ? '#f59e0b' : '#10b981');

                return `
                  <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
                    <td style="padding: 10px 14px; font-weight: 600;" class="mono">${r.date}</td>
                    <td style="padding: 10px 14px; text-align: right; color: var(--text-secondary);" class="mono">${r.gGross.toLocaleString('en-IN')} kg</td>
                    <td style="padding: 10px 14px; text-align: right; color: var(--text-muted);" class="mono">${r.gDedPct.toFixed(1)}%</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: var(--accent-emerald);" class="mono">${r.gNet.toLocaleString('en-IN')} kg</td>
                    <td style="padding: 10px 14px; text-align: right; color: var(--text-secondary);" class="mono">${r.fGross > 0 ? `${r.fGross.toLocaleString('en-IN')} kg` : '—'}</td>
                    <td style="padding: 10px 14px; text-align: right; color: var(--text-muted);" class="mono">${r.fGross > 0 ? `${r.fDedPct.toFixed(1)}%` : '—'}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #3b82f6;" class="mono">${r.fNet > 0 ? `${r.fNet.toLocaleString('en-IN')} kg` : '—'}</td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: ${statusColor};" class="mono">
                      ${r.fNet > 0 ? `${r.diff > 0 ? '+' : ''}${r.diff.toLocaleString('en-IN')} kg` : '—'}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${statusColor};" class="mono">
                      ${r.fNet > 0 ? `${r.varPct.toFixed(1)}%` : '—'}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${statusColor};" class="mono">
                      ${r.fNet > 0 ? (r.lossVal < 0 ? `-₹${Math.abs(r.lossVal).toLocaleString('en-IN')}` : `+₹${r.lossVal.toLocaleString('en-IN')}`) : '—'}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // ==========================================================================
  // TAB 3: PROFIT & LOSS STATEMENT & CASH FLOW
  // ==========================================================================
  async renderPandL(datePrefix, periodLabel, container) {
    const factRes = await window.electronAPI.db.getOne(
      "SELECT COALESCE(SUM(amount), 0) as rev, COALESCE(SUM(net_weight_kg), 0) as net FROM factory_collections WHERE date LIKE ?",
      [`${datePrefix}%`]
    );

    const collRes = await window.electronAPI.db.getOne(
      "SELECT COALESCE(SUM(amount), 0) as cost, COALESCE(SUM(net_weight_kg), 0) as net FROM daily_collections WHERE date LIKE ?",
      [`${datePrefix}%`]
    );

    const expRes = await window.electronAPI.db.query(
      "SELECT category, SUM(amount) as total_amt, COUNT(*) as tx_count FROM expenses WHERE date LIKE ? GROUP BY category ORDER BY total_amt DESC",
      [`${datePrefix}%`]
    );

    const advGivenRes = await window.electronAPI.db.getOne(
      "SELECT COALESCE(SUM(amount), 0) as given FROM advances WHERE date LIKE ?",
      [`${datePrefix}%`]
    );
    const advRecRes = await window.electronAPI.db.getOne(
      "SELECT COALESCE(SUM(advance_deducted), 0) as rec FROM monthly_payments WHERE (year || '-' || printf('%02d', month)) LIKE ?",
      [`${datePrefix}%`]
    );

    const revenue = Math.round(factRes?.data?.rev || 0);
    const factNet = Math.round(factRes?.data?.net || 0);
    const leafCost = Math.round(collRes?.data?.cost || 0);
    const gardenNet = Math.round(collRes?.data?.net || 0);

    const grossTradingProfit = revenue - leafCost;
    const grossMarginPct = revenue > 0 ? ((grossTradingProfit / revenue) * 100) : 0;

    const expList = expRes?.data || [];
    const totalExpenses = expList.reduce((sum, e) => sum + (e.total_amt || 0), 0);

    const netEbitda = grossTradingProfit - totalExpenses;
    const netMarginPct = revenue > 0 ? ((netEbitda / revenue) * 100) : 0;

    const advGiven = Math.round(advGivenRes?.data?.given || 0);
    const advRec = Math.round(advRecRes?.data?.rec || 0);
    const netAdvanceFlow = advGiven - advRec;

    this.lastExportData = {
      title: `Profit & Loss Statement - ${periodLabel}`,
      headers: ['P&L Line Item', 'Amount (₹)', '% Share / Note'],
      rows: [
        ['Factory Green Leaf Revenue', `₹${revenue.toLocaleString('en-IN')}`, '100.0% of Revenue'],
        ['Raw Leaf Purchase Cost (COGS)', `-₹${leafCost.toLocaleString('en-IN')}`, `${revenue > 0 ? ((leafCost / revenue) * 100).toFixed(1) : 0}% of Revenue`],
        ['Gross Operating Profit', `₹${grossTradingProfit.toLocaleString('en-IN')}`, `${grossMarginPct.toFixed(1)}% Gross Margin`],
        ...expList.map(e => [`Expense: ${e.category}`, `-₹${Math.round(e.total_amt).toLocaleString('en-IN')}`, `${revenue > 0 ? ((e.total_amt / revenue) * 100).toFixed(1) : 0}% of Revenue`]),
        ['Total Operating Overheads', `-₹${Math.round(totalExpenses).toLocaleString('en-IN')}`, `${revenue > 0 ? ((totalExpenses / revenue) * 100).toFixed(1) : 0}% of Revenue`],
        ['Net Operating EBITDA', `₹${Math.round(netEbitda).toLocaleString('en-IN')}`, `${netMarginPct.toFixed(1)}% Net Margin`],
        ['Advances Lent in Period', `₹${advGiven.toLocaleString('en-IN')}`, 'Cash Outflow to Planters'],
        ['Advances Recovered in Period', `₹${advRec.toLocaleString('en-IN')}`, 'Recovered from Monthly Settlements'],
        ['Net Working Capital Advance Flow', `₹${netAdvanceFlow.toLocaleString('en-IN')}`, netAdvanceFlow > 0 ? 'Net Outflow into Field' : 'Net Cash Realized']
      ]
    };

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px;">
        
        <div style="background: var(--bg-card); border-radius: 14px; padding: 24px; border: 1px solid var(--border-subtle); box-shadow: var(--shadow-sm);">
          <div style="font-size: 15px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">
            💰 Commercial Income Statement (P&L)
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 20px;">
            Accounting period: <strong>${periodLabel}</strong> &bull; Currency: INR (₹)
          </div>

          <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
            
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(59, 130, 246, 0.08); border-radius: 8px;">
              <div>
                <strong style="color: var(--text-primary);">Gross Factory Realization (Revenue)</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${factNet.toLocaleString('en-IN')} kg delivered</div>
              </div>
              <span class="mono" style="font-weight: 800; color: #3b82f6; font-size: 16px;">
                ₹${revenue.toLocaleString('en-IN')}
              </span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(239, 68, 68, 0.06); border-radius: 8px;">
              <div>
                <strong style="color: var(--text-primary);">Green Leaf Purchase Cost (Grower Payouts)</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${gardenNet.toLocaleString('en-IN')} kg procured</div>
              </div>
              <span class="mono" style="font-weight: 800; color: #ef4444; font-size: 16px;">
                - ₹${leafCost.toLocaleString('en-IN')}
              </span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-top: 2px solid var(--border-subtle); border-bottom: 2px solid var(--border-subtle);">
              <div>
                <strong style="color: var(--text-primary); font-size: 14px;">Gross Operating Trading Spread</strong>
                <div style="font-size: 11px; color: var(--accent-emerald);">Gross Margin: ${grossMarginPct.toFixed(1)}%</div>
              </div>
              <span class="mono" style="font-weight: 800; color: ${grossTradingProfit >= 0 ? 'var(--accent-emerald)' : '#ef4444'}; font-size: 17px;">
                ₹${grossTradingProfit.toLocaleString('en-IN')}
              </span>
            </div>

            <div style="font-size: 12px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 6px;">
              Operational Overheads & Direct Costs
            </div>

            ${expList.length === 0 ? `
              <div style="font-size: 12px; color: var(--text-muted); padding: 4px 12px;">No operational expenses recorded for this period.</div>
            ` : expList.map(e => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; font-size: 12px;">
                <span style="color: var(--text-secondary);">&bull; ${this.escapeHtml(e.category)} (${e.tx_count} entries)</span>
                <span class="mono" style="font-weight: 600; color: #f59e0b;">- ₹${Math.round(e.total_amt).toLocaleString('en-IN')}</span>
              </div>
            `).join('')}

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; font-size: 12px; color: var(--text-muted); border-top: 1px dashed var(--border-subtle);">
              <span>Total Overheads:</span>
              <span class="mono" style="font-weight: 700; color: #f59e0b;">- ₹${Math.round(totalExpenses).toLocaleString('en-IN')}</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: ${netEbitda >= 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'}; border-radius: 10px; border: 1.5px solid ${netEbitda >= 0 ? 'var(--accent-emerald)' : '#ef4444'}; margin-top: 10px;">
              <div>
                <strong style="font-size: 15px; color: var(--text-primary);">Net Operating Profit (EBITDA)</strong>
                <div style="font-size: 11px; color: var(--text-muted);">After COGS & all operating overheads</div>
              </div>
              <div style="text-align: right;">
                <div class="mono" style="font-size: 22px; font-weight: 900; color: ${netEbitda >= 0 ? 'var(--accent-emerald)' : '#ef4444'};">
                  ₹${Math.round(netEbitda).toLocaleString('en-IN')}
                </div>
                <div style="font-size: 11px; font-weight: 700; color: ${netEbitda >= 0 ? 'var(--accent-emerald)' : '#ef4444'};">
                  ${netMarginPct.toFixed(1)}% Net Margin
                </div>
              </div>
            </div>

          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 18px;">
          
          <div style="background: var(--bg-card); border-radius: 14px; padding: 22px; border: 1px solid var(--border-subtle);">
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">
              💼 Cash Flow & Working Capital Position
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">
              Advances disbursed vs recovered through leaf deductions
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">Advances Disbursed to Growers:</span>
                <span class="mono" style="font-weight: 700; color: #ef4444;">₹${advGiven.toLocaleString('en-IN')}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">Advances Recovered in Monthly Bills:</span>
                <span class="mono" style="font-weight: 700; color: var(--accent-emerald);">₹${advRec.toLocaleString('en-IN')}</span>
              </div>
              <div style="display: flex; justify-content: space-between; border-top: 1px dashed var(--border-subtle); padding-top: 8px;">
                <span style="font-weight: 700; color: var(--text-primary);">Net Advance Float Change:</span>
                <span class="mono" style="font-weight: 800; color: ${netAdvanceFlow > 0 ? '#f59e0b' : 'var(--accent-emerald)'};">
                  ${netAdvanceFlow > 0 ? `+₹${netAdvanceFlow.toLocaleString('en-IN')} (Lent out)` : `-₹${Math.abs(netAdvanceFlow).toLocaleString('en-IN')} (Recovered)`}
                </span>
              </div>
            </div>
          </div>

          <div style="background: var(--bg-card); border-radius: 14px; padding: 22px; border: 1px solid var(--border-subtle); flex: 1;">
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">
              📊 Revenue Allocation Mix
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 14px;">
              Visual distribution of total turnover
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              <div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                  <span>🌱 Planter Leaf Cost</span>
                  <strong class="mono">${revenue > 0 ? ((leafCost / revenue) * 100).toFixed(1) : 0}%</strong>
                </div>
                <div style="height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden;">
                  <div style="height: 100%; width: ${revenue > 0 ? Math.min(100, (leafCost / revenue) * 100) : 0}%; background: #ef4444;"></div>
                </div>
              </div>

              <div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                  <span>🚛 Operating Expenses</span>
                  <strong class="mono">${revenue > 0 ? ((totalExpenses / revenue) * 100).toFixed(1) : 0}%</strong>
                </div>
                <div style="height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden;">
                  <div style="height: 100%; width: ${revenue > 0 ? Math.min(100, (totalExpenses / revenue) * 100) : 0}%; background: #f59e0b;"></div>
                </div>
              </div>

              <div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
                  <span>📈 Net Operating Profit</span>
                  <strong class="mono" style="color: var(--accent-emerald);">${revenue > 0 ? Math.max(0, netMarginPct).toFixed(1) : 0}%</strong>
                </div>
                <div style="height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden;">
                  <div style="height: 100%; width: ${revenue > 0 ? Math.max(0, Math.min(100, netMarginPct)) : 0}%; background: var(--accent-emerald);"></div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    `;
  },

  // ==========================================================================
  // TAB 4: GROWER INTELLIGENCE & QUALITY SCORECARD
  // ==========================================================================
  async renderGrowerIntelligence(datePrefix, periodLabel, selectedOwnerId, container) {
    if (selectedOwnerId && selectedOwnerId !== 'ALL') {
      return this.renderSingleGrowerDetail(datePrefix, periodLabel, selectedOwnerId, container);
    }

    const growerStatsRes = await window.electronAPI.db.query(`
      SELECT o.id, o.name, o.phone, o.address,
             COALESCE(SUM(c.gross_weight_kg), 0) as total_gross,
             COALESCE(SUM(c.net_weight_kg), 0) as total_net,
             COALESCE(SUM(c.amount), 0) as total_payout,
             AVG(c.bag_weight_kg) as avg_ded_pct,
             COUNT(c.id) as delivery_days
      FROM owners o
      LEFT JOIN daily_collections c ON o.id = c.owner_id AND c.date LIKE ?
      WHERE o.is_active = 1
      GROUP BY o.id
      ORDER BY total_net DESC
    `, [`${datePrefix}%`]);

    const advRes = await window.electronAPI.db.query(`
      SELECT owner_id, SUM(amount) as total_adv FROM advances GROUP BY owner_id
    `);
    const advRecRes = await window.electronAPI.db.query(`
      SELECT owner_id, SUM(advance_deducted) as total_rec FROM monthly_payments GROUP BY owner_id
    `);

    const advMap = new Map((advRes?.data || []).map(r => [r.owner_id, r.total_adv]));
    const recMap = new Map((advRecRes?.data || []).map(r => [r.owner_id, r.total_rec]));

    const growers = (growerStatsRes?.data || []).map(g => {
      const advTotal = advMap.get(g.id) || 0;
      const recTotal = recMap.get(g.id) || 0;
      const outstandingAdvance = Math.max(0, advTotal - recTotal);
      const isAdvanceRisk = outstandingAdvance > 0 && outstandingAdvance > (g.total_payout * 1.2) && g.total_payout > 0;

      return {
        ...g,
        total_gross: Math.round(g.total_gross || 0),
        total_net: Math.round(g.total_net || 0),
        total_payout: Math.round(g.total_payout || 0),
        avg_ded_pct: g.avg_ded_pct ? parseFloat(g.avg_ded_pct).toFixed(1) : '0.0',
        outstandingAdvance,
        isAdvanceRisk
      };
    });

    const totalAgencyNet = growers.reduce((sum, g) => sum + g.total_net, 0);
    const activeGrowersList = growers.filter(g => g.total_net > 0);
    const riskGrowersList = growers.filter(g => g.isAdvanceRisk);

    this.lastExportData = {
      title: `Grower Intelligence & Risk - ${periodLabel}`,
      headers: ['Grower Name', 'Phone', 'Net Leaf (kg)', 'Volume Share %', 'Avg Ded %', 'Total Earnings (₹)', 'Outstanding Advance (₹)', 'Risk Status'],
      rows: growers.map(g => [
        g.name, g.phone || '—', g.total_net,
        totalAgencyNet > 0 ? `${((g.total_net / totalAgencyNet) * 100).toFixed(1)}%` : '0%',
        `${g.avg_ded_pct}%`, `₹${g.total_payout}`, `₹${g.outstandingAdvance}`,
        g.isAdvanceRisk ? 'HIGH RISK' : (g.outstandingAdvance > 0 ? 'Active Advance' : 'Clear')
      ])
    };

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px;">
        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Active Planters</span><span>👥</span></div>
          <div class="rep-kpi-value mono" style="color: var(--accent-emerald);">${activeGrowersList.length} <span style="font-size: 13px; color: var(--text-muted);">/ ${growers.length}</span></div>
          <div class="rep-kpi-sub">Supplied leaf this period</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Average Agency Ded</span><span>🍂</span></div>
          <div class="rep-kpi-value mono" style="color: #f59e0b;">
            ${activeGrowersList.length > 0 ? (activeGrowersList.reduce((s, g) => s + parseFloat(g.avg_ded_pct), 0) / activeGrowersList.length).toFixed(1) : 0}%
          </div>
          <div class="rep-kpi-sub">Leaf moisture & quality deduction</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Advance Risk Alerts</span><span>⚠️</span></div>
          <div class="rep-kpi-value mono" style="color: ${riskGrowersList.length > 0 ? '#ef4444' : 'var(--accent-emerald)'};">
            ${riskGrowersList.length} Growers
          </div>
          <div class="rep-kpi-sub">Advances exceed leaf supply</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Total Planter Dues</span><span>💰</span></div>
          <div class="rep-kpi-value mono" style="color: #3b82f6;">
            ₹${growers.reduce((s, g) => s + g.total_payout, 0).toLocaleString('en-IN')}
          </div>
          <div class="rep-kpi-sub">Gross earnings in period</div>
        </div>
      </div>

      ${riskGrowersList.length > 0 ? `
        <div style="background: rgba(239, 68, 68, 0.08); border: 1.5px solid #ef4444; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;">
          <div style="font-size: 13px; font-weight: 800; color: #ef4444; display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span>⚠️</span> ADVANCE EXPOSURE RISK: ${riskGrowersList.length} Planters with Critical Balances
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 10px;">
            The following growers have outstanding advance loans that significantly exceed their current delivery earnings:
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${riskGrowersList.map(r => `
              <span style="background: var(--bg-card); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 4px 10px; font-size: 11px;">
                <strong>${this.escapeHtml(r.name)}</strong>: <span class="mono" style="color: #ef4444; font-weight: 700;">₹${r.outstandingAdvance.toLocaleString('en-IN')} advance</span> vs ₹${r.total_payout.toLocaleString('en-IN')} leaf
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div style="background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;">
        <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary);">👥 Small Tea Growers Volume & Quality Ranking</div>
            <div style="font-size: 11px; color: var(--text-muted);">Ranked by net green leaf volume supplied</div>
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: var(--bg-input); border-bottom: 1px solid var(--border-subtle); text-transform: uppercase; font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px;">
                <th style="padding: 10px 14px; text-align: left;">Rank / Grower</th>
                <th style="padding: 10px 14px; text-align: left;">Contact / Loc</th>
                <th style="padding: 10px 14px; text-align: right;">Net Leaf (kg)</th>
                <th style="padding: 10px 14px; text-align: right;">Volume Share</th>
                <th style="padding: 10px 14px; text-align: right;">Avg Ded %</th>
                <th style="padding: 10px 14px; text-align: right;">Total Earnings</th>
                <th style="padding: 10px 14px; text-align: right;">Advance Balance</th>
                <th style="padding: 10px 14px; text-align: center;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${growers.map((g, i) => {
                const sharePct = totalAgencyNet > 0 ? ((g.total_net / totalAgencyNet) * 100).toFixed(1) : 0;
                const dedNum = parseFloat(g.avg_ded_pct);
                const dedClass = dedNum > 8 ? 'rep-badge-danger' : (dedNum > 5 ? 'rep-badge-warning' : 'rep-badge-success');

                return `
                  <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
                    <td style="padding: 10px 14px;">
                      <div style="font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 10px; color: var(--text-muted); width: 18px;">#${i + 1}</span>
                        ${this.escapeHtml(g.name)}
                      </div>
                    </td>
                    <td style="padding: 10px 14px; color: var(--text-secondary);" class="mono">
                      ${g.phone || '—'}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: var(--accent-emerald);" class="mono">
                      ${g.total_net.toLocaleString('en-IN')} kg
                    </td>
                    <td style="padding: 10px 14px; text-align: right;" class="mono">
                      ${sharePct}%
                    </td>
                    <td style="padding: 10px 14px; text-align: right;">
                      <span class="rep-badge ${dedClass} mono">${g.avg_ded_pct}%</span>
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #3b82f6;" class="mono">
                      ₹${g.total_payout.toLocaleString('en-IN')}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${g.outstandingAdvance > 0 ? '#f59e0b' : 'var(--text-muted)'};" class="mono">
                      ${g.outstandingAdvance > 0 ? `₹${g.outstandingAdvance.toLocaleString('en-IN')}` : 'Nil'}
                    </td>
                    <td style="padding: 10px 14px; text-align: center;">
                      <button type="button" class="btn btn-secondary btn-sm" style="height: 26px; padding: 0 8px; font-size: 11px;" onclick="reportsModule.selectGrowerAndInspect('${g.id}')">
                        Inspect
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  selectGrowerAndInspect(ownerId) {
    const oSelect = document.getElementById('repOwnerSelect');
    if (oSelect) oSelect.value = ownerId;
    this.generateReport();
  },

  async renderSingleGrowerDetail(datePrefix, periodLabel, ownerId, container) {
    const oRes = await window.electronAPI.db.getOne("SELECT * FROM owners WHERE id = ?", [ownerId]);
    const owner = oRes?.data;

    const collsRes = await window.electronAPI.db.query(
      "SELECT * FROM daily_collections WHERE owner_id = ? AND date LIKE ? ORDER BY date DESC",
      [ownerId, `${datePrefix}%`]
    );
    const rows = collsRes?.data || [];

    const advRes = await window.electronAPI.db.getOne("SELECT COALESCE(SUM(amount), 0) as tot FROM advances WHERE owner_id = ?", [ownerId]);
    const recRes = await window.electronAPI.db.getOne("SELECT COALESCE(SUM(advance_deducted), 0) as rec FROM monthly_payments WHERE owner_id = ?", [ownerId]);
    const outstanding = Math.max(0, Math.round((advRes?.data?.tot || 0) - (recRes?.data?.rec || 0)));

    let totalGross = 0, totalNet = 0, totalAmt = 0;
    rows.forEach(r => {
      totalGross += (r.gross_weight_kg || 0);
      totalNet += (r.net_weight_kg || 0);
      totalAmt += (r.amount || 0);
    });

    this.lastExportData = {
      title: `Planter Ledger - ${owner?.name} - ${periodLabel}`,
      headers: ['Date', 'Gross (kg)', 'Ded %', 'Net (kg)', 'Rate (₹)', 'Amount (₹)'],
      rows: rows.map(r => [
        r.date, r.gross_weight_kg, `${r.bag_weight_kg}%`, r.net_weight_kg, `₹${r.rate_per_kg}`, `₹${r.amount}`
      ])
    };

    container.innerHTML = `
      <div style="background: var(--bg-card); border-radius: 12px; padding: 20px; border: 1px solid var(--border-subtle); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
        <div>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-bottom: 8px;" onclick="reportsModule.selectGrowerAndInspect('ALL')">
            ← Back to All Planters
          </button>
          <div style="font-size: 18px; font-weight: 800; color: var(--text-primary);">${this.escapeHtml(owner?.name)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
            📞 +91 ${owner?.phone || '—'} &bull; 📍 ${owner?.address || 'No address specified'}
          </div>
        </div>
        <div style="display: flex; gap: 14px;">
          <div style="background: var(--bg-input); padding: 10px 16px; border-radius: 8px; text-align: right;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Total Net Leaf</div>
            <div class="mono" style="font-size: 16px; font-weight: 800; color: var(--accent-emerald);">${Math.round(totalNet).toLocaleString('en-IN')} kg</div>
          </div>
          <div style="background: var(--bg-input); padding: 10px 16px; border-radius: 8px; text-align: right;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Total Earnings</div>
            <div class="mono" style="font-size: 16px; font-weight: 800; color: #3b82f6;">₹${Math.round(totalAmt).toLocaleString('en-IN')}</div>
          </div>
          <div style="background: var(--bg-input); padding: 10px 16px; border-radius: 8px; text-align: right;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Pending Advance</div>
            <div class="mono" style="font-size: 16px; font-weight: 800; color: #f59e0b;">₹${outstanding.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>

      <div style="background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;">
        <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: var(--bg-input); border-bottom: 1px solid var(--border-subtle); text-transform: uppercase; font-size: 10px; color: var(--text-muted);">
              <th style="padding: 10px 14px; text-align: left;">Date</th>
              <th style="padding: 10px 14px; text-align: right;">Gross (kg)</th>
              <th style="padding: 10px 14px; text-align: right;">Ded %</th>
              <th style="padding: 10px 14px; text-align: right;">Net (kg)</th>
              <th style="padding: 10px 14px; text-align: right;">Rate (₹/kg)</th>
              <th style="padding: 10px 14px; text-align: right;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0 ? 
              app.getEmptyStateTableRow(6, {
                title: 'No Deliveries Found',
                message: 'No factory deliveries found for this period.'
              }) : rows.map(r => `
              <tr style="border-bottom: 1px solid var(--border-subtle);">
                <td style="padding: 10px 14px;" class="mono">${r.date}</td>
                <td style="padding: 10px 14px; text-align: right;" class="mono">${Math.round(r.gross_weight_kg)} kg</td>
                <td style="padding: 10px 14px; text-align: right; color: #ef4444;" class="mono">${r.bag_weight_kg}%</td>
                <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: var(--accent-emerald);" class="mono">${Math.round(r.net_weight_kg)} kg</td>
                <td style="padding: 10px 14px; text-align: right;" class="mono">₹${r.rate_per_kg}</td>
                <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #3b82f6;" class="mono">₹${Math.round(r.amount).toLocaleString('en-IN')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  // ==========================================================================
  // TAB 5: FACTORY COMPARATIVE SCORECARD
  // ==========================================================================
  async renderFactoryComparative(datePrefix, periodLabel, selectedFactoryId, container) {
    let fClause = '';
    const params = [`${datePrefix}%`];
    if (selectedFactoryId && selectedFactoryId !== 'ALL') {
      fClause = 'AND f.id = ?';
      params.push(selectedFactoryId);
    }

    const factStatsRes = await window.electronAPI.db.query(`
      SELECT f.id, f.name, f.default_rate, f.phone, f.address,
             COALESCE(SUM(fc.gross_weight_kg), 0) as total_gross,
             COALESCE(SUM(fc.net_weight_kg), 0) as total_net,
             COALESCE(SUM(fc.amount), 0) as total_revenue,
             AVG(fc.rate_per_kg) as avg_rate,
             COUNT(fc.id) as shipments_count
      FROM factories f
      LEFT JOIN factory_collections fc ON f.id = fc.factory_id AND fc.date LIKE ?
      WHERE f.is_active = 1 ${fClause}
      GROUP BY f.id
      ORDER BY total_net DESC
    `, params);

    const factList = (factStatsRes?.data || []).map(f => {
      const gross = Math.round(f.total_gross || 0);
      const net = Math.round(f.total_net || 0);
      const revenue = Math.round(f.total_revenue || 0);
      const avgRate = f.avg_rate ? parseFloat(f.avg_rate) : (f.default_rate || 0);
      const dedPct = gross > 0 ? (((gross - net) / gross) * 100) : 0;

      return {
        ...f,
        gross, net, revenue,
        avgRate, dedPct
      };
    });

    const totalFactNet = factList.reduce((sum, f) => sum + f.net, 0);

    const activeFactories = factList.filter(f => f.net > 0);
    const bestRateFactory = activeFactories.length > 0
      ? [...activeFactories].sort((a, b) => b.avgRate - a.avgRate)[0]
      : null;

    this.lastExportData = {
      title: `Factory Comparative Scorecard - ${periodLabel}`,
      headers: ['Factory Name', 'Shipments', 'Gross (kg)', 'Factory Ded %', 'Accepted Net (kg)', 'Average Rate (₹/kg)', 'Total Realization (₹)'],
      rows: factList.map(f => [
        f.name, f.shipments_count, f.gross, `${f.dedPct.toFixed(1)}%`,
        f.net, `₹${f.avgRate.toFixed(2)}`, `₹${f.revenue}`
      ])
    };

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 22px;">
        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Delivered Leaf Net</span><span>🏭</span></div>
          <div class="rep-kpi-value mono" style="color: #3b82f6;">${totalFactNet.toLocaleString('en-IN')} kg</div>
          <div class="rep-kpi-sub">Across ${activeFactories.length} processing factories</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Best Realization Factory</span><span>🏆</span></div>
          <div class="rep-kpi-value mono" style="color: var(--accent-emerald); font-size: 18px;">
            ${bestRateFactory ? this.escapeHtml(bestRateFactory.name) : '—'}
          </div>
          <div class="rep-kpi-sub">Avg Rate: <strong>₹${bestRateFactory ? bestRateFactory.avgRate.toFixed(2) : '0.00'}/kg</strong></div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Total Factory Revenue</span><span>💰</span></div>
          <div class="rep-kpi-value mono" style="color: var(--accent-emerald);">
            ₹${factList.reduce((sum, f) => sum + f.revenue, 0).toLocaleString('en-IN')}
          </div>
          <div class="rep-kpi-sub">Billed green leaf value</div>
        </div>
      </div>

      <div style="background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;">
        <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary);">🏭 Bought-Leaf Factory Comparative Matrix</div>
            <div style="font-size: 11px; color: var(--text-muted);">Compare price realization, deduction harshness, and supply volume</div>
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: var(--bg-input); border-bottom: 1px solid var(--border-subtle); text-transform: uppercase; font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px;">
                <th style="padding: 10px 14px; text-align: left;">Factory Name</th>
                <th style="padding: 10px 14px; text-align: left;">Contact / Location</th>
                <th style="padding: 10px 14px; text-align: right;">Shipments</th>
                <th style="padding: 10px 14px; text-align: right;">Gross Leaf</th>
                <th style="padding: 10px 14px; text-align: right;">Factory Ded %</th>
                <th style="padding: 10px 14px; text-align: right;">Accepted Net</th>
                <th style="padding: 10px 14px; text-align: right;">Realized Rate</th>
                <th style="padding: 10px 14px; text-align: right;">Total Turnover</th>
              </tr>
            </thead>
            <tbody>
              ${factList.length === 0 ? 
                app.getEmptyStateTableRow(8, {
                  title: 'No Factories Found',
                  message: 'No registered factory delivery records found.'
                }) : factList.map(f => `
                <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
                  <td style="padding: 10px 14px; font-weight: 700; color: var(--text-primary);">
                    ${this.escapeHtml(f.name)}
                  </td>
                  <td style="padding: 10px 14px; color: var(--text-muted);">
                    ${this.escapeHtml(f.address || '—')} &bull; <span class="mono">${f.phone || '—'}</span>
                  </td>
                  <td style="padding: 10px 14px; text-align: right;" class="mono">
                    ${f.shipments_count}
                  </td>
                  <td style="padding: 10px 14px; text-align: right; color: var(--text-secondary);" class="mono">
                    ${f.gross.toLocaleString('en-IN')} kg
                  </td>
                  <td style="padding: 10px 14px; text-align: right;">
                    <span class="rep-badge ${f.dedPct > 8 ? 'rep-badge-danger' : 'rep-badge-success'} mono">${f.dedPct.toFixed(1)}%</span>
                  </td>
                  <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #3b82f6;" class="mono">
                    ${f.net.toLocaleString('en-IN')} kg
                  </td>
                  <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: var(--accent-emerald);" class="mono">
                    ₹${f.avgRate.toFixed(2)} /kg
                  </td>
                  <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: var(--text-primary);" class="mono">
                    ₹${f.revenue.toLocaleString('en-IN')}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  // ==========================================================================
  // TAB 6: OPERATIONAL EXPENSES & OVERHEADS AUDIT
  // ==========================================================================
  async renderExpenseAudit(datePrefix, periodLabel, container) {
    const expRows = await window.electronAPI.db.query(`
      SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC, created_at DESC
    `, [`${datePrefix}%`]);
    const expensesList = expRows?.data || [];

    const collRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(net_weight_kg), 0) as net, COALESCE(SUM(amount), 0) as payout
      FROM daily_collections WHERE date LIKE ?
    `, [`${datePrefix}%`]);

    const factRes = await window.electronAPI.db.getOne(`
      SELECT COALESCE(SUM(amount), 0) as revenue FROM factory_collections WHERE date LIKE ?
    `, [`${datePrefix}%`]);

    const netLeaf = collRes?.data?.net || 0;
    const factRevenue = factRes?.data?.revenue || 0;

    const totalSpent = expensesList.reduce((sum, e) => sum + (e.amount || 0), 0);
    const dates = new Set(expensesList.map(e => e.date).filter(Boolean));
    const activeDays = Math.max(1, dates.size);
    const dailyRunRate = Math.round(totalSpent / activeDays);
    const costPerKg = netLeaf > 0 ? (totalSpent / netLeaf) : 0;
    const overheadPct = factRevenue > 0 ? ((totalSpent / factRevenue) * 100) : 0;

    const ICONS = {
      Fuel: '⛽', Repair: '🔧', Rent: '🏠', Labor: '👷', Chemical: '🧪', Food: '🍱', Other: '📦'
    };

    const catSums = {};
    const catCounts = {};
    expensesList.forEach(e => {
      const cat = e.category || 'Other';
      catSums[cat] = (catSums[cat] || 0) + (e.amount || 0);
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });

    let topCat = 'N/A';
    let topAmt = 0;
    for (const [c, a] of Object.entries(catSums)) {
      if (a > topAmt) {
        topAmt = a;
        topCat = c;
      }
    }
    const topPct = totalSpent > 0 ? ((topAmt / totalSpent) * 100) : 0;

    const sortedCats = Object.keys(catSums).sort((a, b) => catSums[b] - catSums[a]);

    this.lastExportData = {
      title: `Operational Expenses Audit - ${periodLabel}`,
      headers: ['Date', 'Category', 'Notes / Remarks', 'Amount (INR)', '% Share'],
      rows: expensesList.map(e => {
        const pct = totalSpent > 0 ? `${((e.amount / totalSpent) * 100).toFixed(1)}%` : '0%';
        return [
          e.date || '',
          e.category || '',
          e.notes || '',
          Math.round(e.amount || 0),
          pct
        ];
      })
    };

    container.innerHTML = `
      <!-- Smart Advisory Banner -->
      <div class="rep-insight-banner">
        <div class="rep-insight-title" style="font-weight: 800; font-size: 14px; margin-bottom: 6px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
          <span>🧾</span> Operational Cost Audit & Overheads Intelligence (${periodLabel})
        </div>
        <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;">
          Total operational overheads logged: <strong class="mono" style="color: #ef4444;">₹${Math.round(totalSpent).toLocaleString('en-IN')}</strong> across <strong>${expensesList.length}</strong> transactions.
          ${topCat !== 'N/A' ? `Primary cost driver is <strong>${ICONS[topCat] || '📦'} ${topCat}</strong> representing <strong class="mono">${topPct.toFixed(1)}%</strong> of the operational budget.` : ''}
          ${netLeaf > 0 ? ` Operational overhead impact is <strong class="mono">₹${costPerKg.toFixed(2)}</strong> per kg of green leaf collected (${overheadPct.toFixed(1)}% of factory turnover).` : ''}
        </div>
      </div>

      <!-- Executive KPI Cards -->
      <div class="rep-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 22px;">
        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Total Overheads</span><span class="rep-kpi-icon">💸</span></div>
          <div class="rep-kpi-value mono" style="color: #ef4444;">₹${Math.round(totalSpent).toLocaleString('en-IN')}</div>
          <div class="rep-kpi-sub">${expensesList.length} transaction${expensesList.length === 1 ? '' : 's'} logged</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Top Cost Driver</span><span class="rep-kpi-icon">${ICONS[topCat] || '📊'}</span></div>
          <div class="rep-kpi-value" style="font-size: 18px; color: var(--text-primary);">${topCat !== 'N/A' ? `${ICONS[topCat] || ''} ${topCat}` : 'None'}</div>
          <div class="rep-kpi-sub">${topCat !== 'N/A' ? `₹${Math.round(topAmt).toLocaleString('en-IN')} (${topPct.toFixed(1)}%)` : 'No expense data'}</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Overhead / Kg Leaf</span><span class="rep-kpi-icon">🌱</span></div>
          <div class="rep-kpi-value mono" style="color: ${costPerKg > 2.5 ? '#ef4444' : 'var(--accent-emerald)'};">₹${costPerKg.toFixed(2)} <span style="font-size: 12px; font-weight: 600;">/kg</span></div>
          <div class="rep-kpi-sub">${netLeaf > 0 ? `Across ${Math.round(netLeaf).toLocaleString('en-IN')} kg leaf` : 'No leaf intake in period'}</div>
        </div>

        <div class="rep-kpi-card">
          <div class="rep-kpi-header"><span class="rep-kpi-title">Daily Run Rate</span><span class="rep-kpi-icon">📅</span></div>
          <div class="rep-kpi-value mono" style="color: #3b82f6;">₹${dailyRunRate.toLocaleString('en-IN')}</div>
          <div class="rep-kpi-sub">Avg across ${dates.size} operational day${dates.size === 1 ? '' : 's'}</div>
        </div>
      </div>

      <!-- Cost Distribution & Category Breakdown -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 22px;">
        <!-- Left: Category Progress Bars -->
        <div style="background: var(--bg-card); border-radius: 12px; padding: 20px; border: 1px solid var(--border-subtle);">
          <div style="font-size: 14px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">📊 Cost Center Distribution</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">Breakdown of operational spend by category</div>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${sortedCats.length === 0 ? '<div style="color: var(--text-muted); font-size: 12px; padding: 20px 0; text-align: center;">No expenses recorded for this period.</div>' : sortedCats.map(cat => {
              const amt = catSums[cat];
              const pct = totalSpent > 0 ? ((amt / totalSpent) * 100) : 0;
              return `
                <div>
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; margin-bottom: 4px;">
                    <span style="font-weight: 700; color: var(--text-primary);">${ICONS[cat] || '📦'} ${cat} <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">(${catCounts[cat]} entries)</span></span>
                    <span class="mono" style="font-weight: 800; color: var(--text-primary);">₹${Math.round(amt).toLocaleString('en-IN')} <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">(${pct.toFixed(1)}%)</span></span>
                  </div>
                  <div style="background: var(--bg-input); height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="background: ${cat === 'Fuel' ? '#f59e0b' : cat === 'Labor' ? '#3b82f6' : cat === 'Repair' ? '#ef4444' : cat === 'Chemical' ? '#8b5cf6' : 'var(--accent-emerald)'}; width: ${Math.min(100, Math.max(2, pct))}%; height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Right: Operational Efficiency Summary -->
        <div style="background: var(--bg-card); border-radius: 12px; padding: 20px; border: 1px solid var(--border-subtle); display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary); margin-bottom: 4px;">⚖️ Operational Burden Breakdown</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 16px;">Relation to gross margin & tea revenue</div>
            <div style="display: flex; flex-direction: column; gap: 10px; font-size: 13px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">🏭 Total Factory Realization:</span>
                <span class="mono" style="font-weight: 700; color: var(--text-primary);">₹${Math.round(factRevenue).toLocaleString('en-IN')}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">🌱 Total Green Leaf Intake:</span>
                <span class="mono" style="font-weight: 700; color: var(--text-primary);">${Math.round(netLeaf).toLocaleString('en-IN')} kg</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-subtle); padding-top: 6px;">
                <span style="color: var(--text-secondary);">💸 Operational Overheads:</span>
                <span class="mono" style="font-weight: 800; color: #ef4444;">₹${Math.round(totalSpent).toLocaleString('en-IN')}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-secondary);">📉 Overhead Burden % of Revenue:</span>
                <span class="mono" style="font-weight: 700; color: ${overheadPct > 15 ? '#ef4444' : '#3b82f6'};">${overheadPct.toFixed(1)}%</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 2px solid var(--border-subtle); padding-top: 8px;">
                <span style="font-weight: 800; color: var(--text-primary);">Cost / Kg Handled:</span>
                <span class="mono" style="font-weight: 800; font-size: 15px; color: ${costPerKg > 2.5 ? '#ef4444' : 'var(--accent-emerald)'};">₹${costPerKg.toFixed(2)} /kg</span>
              </div>
            </div>
          </div>
          <div style="margin-top: 16px; padding: 10px 12px; background: var(--bg-input); border-radius: 8px; font-size: 11px; color: var(--text-secondary);">
            💡 <strong>Industry Benchmark:</strong> Sustainable smallholder collection agency overhead typically runs between ₹0.50 - ₹1.80 per kg of green leaf.
          </div>
        </div>
      </div>

      <!-- Itemized Expense Audit Table -->
      <div style="background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden;">
        <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary);">🧾 Itemized Operational Expense Ledger</div>
            <div style="font-size: 11px; color: var(--text-muted);">${expensesList.length} verified transactions for ${periodLabel}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11.5px; height: 32px; padding: 0 12px;" onclick="reportsModule.exportCSV()">📥 Download CSV</button>
            <button type="button" class="btn btn-primary btn-sm" style="font-size: 11.5px; height: 32px; padding: 0 12px;" onclick="reportsModule.exportPDF()">📄 Print / PDF</button>
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr style="background: var(--bg-input); border-bottom: 1px solid var(--border-subtle); text-transform: uppercase; font-size: 10px; color: var(--text-muted); letter-spacing: 0.5px;">
                <th style="padding: 10px 14px; text-align: left;">Date</th>
                <th style="padding: 10px 14px; text-align: left;">Category</th>
                <th style="padding: 10px 14px; text-align: left;">Notes / Description</th>
                <th style="padding: 10px 14px; text-align: right;">Amount</th>
                <th style="padding: 10px 14px; text-align: right;">Share</th>
              </tr>
            </thead>
            <tbody>
              ${expensesList.length === 0 ? 
                app.getEmptyStateTableRow(5, {
                  title: 'No Expenses Recorded',
                  message: `No operational expenses recorded for ${periodLabel}.`
                }) : expensesList.map(e => {
                const pct = totalSpent > 0 ? ((e.amount / totalSpent) * 100) : 0;
                return `
                  <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;">
                    <td style="padding: 10px 14px;" class="mono">${e.date || '—'}</td>
                    <td style="padding: 10px 14px; font-weight: 700; color: var(--text-primary);">
                      ${ICONS[e.category] || '📦'} ${this.escapeHtml(e.category || 'Other')}
                    </td>
                    <td style="padding: 10px 14px; color: var(--text-secondary);">
                      ${this.escapeHtml(e.notes || '—')}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: #ef4444;" class="mono">
                      ₹${Math.round(e.amount || 0).toLocaleString('en-IN')}
                    </td>
                    <td style="padding: 10px 14px; text-align: right; color: var(--text-muted);" class="mono">
                      ${pct.toFixed(1)}%
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background: var(--bg-input); font-weight: 800; border-top: 2px solid var(--border-subtle);">
                <td colspan="3" style="padding: 12px 14px; text-align: right; text-transform: uppercase; font-size: 11px; color: var(--text-primary);">
                  Total Operational Spend (${periodLabel}):
                </td>
                <td style="padding: 12px 14px; text-align: right; color: #ef4444; font-size: 14px;" class="mono">
                  ₹${Math.round(totalSpent).toLocaleString('en-IN')}
                </td>
                <td style="padding: 12px 14px; text-align: right; color: var(--text-primary);" class="mono">
                  100%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  },

  // ==========================================================================
  // EXPORT ENGINE: CSV & PRINT/PDF
  // ==========================================================================
  exportCSV() {
    if (!this.lastExportData || !this.lastExportData.rows || this.lastExportData.rows.length === 0) {
      app.showToast('No report data available to export.', 'warning');
      return;
    }

    try {
      const title = this.lastExportData.title || 'Report';
      const headers = this.lastExportData.headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');
      const rows = this.lastExportData.rows.map(row => {
        return row.map(cell => `"${String(cell !== null && cell !== undefined ? cell : '').replace(/"/g, '""')}"`).join(',');
      }).join('\n');

      const csvContent = `${title}\n\n${headers}\n${rows}`;
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.setAttribute('href', url);
      const safeFilename = title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
      link.setAttribute('download', `${safeFilename}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      app.showToast(`Report exported: ${safeFilename}.csv`, 'success');
    } catch (e) {
      console.error('[ReportsModule] Export CSV error:', e);
      app.showToast(`Failed to export CSV: ${e.message}`, 'error');
    }
  },

  async exportPDF() {
    const area = document.getElementById('repContentArea');
    if (!area) {
      window.print();
      return;
    }

    const tabNames = {
      pulse: 'Business Pulse & Spread Audit',
      comparison: 'Factory Transit Shortage Audit',
      finance: 'Commercial P&L Statement',
      grower: 'Grower Intelligence & Risk Report',
      factory: 'Factory Scorecard & Matrix',
      expenses: 'Operational Expenses Audit Report'
    };

    const tabTitle = tabNames[this.currentTab || this.activeTab] || 'Executive Performance Report';
    const periodText = document.getElementById('repPeriodStatusText')?.innerText || '';
    const agencyName = (await window.electronAPI.db.getSetting('agent_name', 'Leaf Ledger Pro')) || 'Leaf Ledger Pro';
    const agentContact = await window.electronAPI.db.getSetting('agent_contact', '');
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${tabTitle} - ${agencyName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 28px; color: #0f172a; max-width: 900px; margin: auto; background: #ffffff; }
          .header { text-align: center; border-bottom: 2.5px solid #16a34a; padding-bottom: 12px; margin-bottom: 16px; }
          .title { font-size: 22px; font-weight: 800; color: #166534; }
          .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
          .meta-grid { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 8px; margin-bottom: 18px; font-size: 12.5px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 18px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
          th { background: #f1f5f9; font-weight: 700; color: #334155; }
          .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
          .footer-note { margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          button, .btn, select, input { display: none !important; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">${agencyName}</div>
          <div class="subtitle">Authorized Tea Leaf Procurement &bull; ${agentContact ? `Contact: ${agentContact} &bull; ` : ''}${tabTitle}</div>
        </div>
        <div class="meta-grid">
          <div><b>Report:</b> ${tabTitle}</div>
          <div><b>Period:</b> ${periodText || 'Current Season'}</div>
          <div><b>Generated On:</b> ${dateStr}</div>
        </div>
        <div class="report-body">
          ${area.innerHTML}
        </div>
        <div class="footer-note">
          Generated via Leaf Ledger Pro ERP &bull; Official Executive Intelligence Report &bull; Digitally Verified
        </div>
      </body>
      </html>
    `;

    const safeFilename = `${tabTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;

    if (app.showDocumentPreview) {
      app.showDocumentPreview({
        title: `📈 Report Preview: ${tabTitle}`,
        subtitle: `Executive Intelligence Report • ${periodText || 'Current Season'}`,
        html,
        defaultFilename: safeFilename
      });
    } else {
      window.print();
    }
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.reportsModule = reportsModule;
