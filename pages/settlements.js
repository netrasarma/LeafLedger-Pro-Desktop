/**
 * Leaf Ledger Pro — Settlements Module
 */
window.settlementsModule = {
  init() {
    const currentMonth = new Date().getMonth() + 1;
    const settleMonth = document.getElementById('settleMonthSelect');
    if (settleMonth) settleMonth.value = String(currentMonth);
    this.load();
  },

  async load() {
    const month = parseInt(document.getElementById('settleMonthSelect')?.value || (new Date().getMonth() + 1));
    const year = parseInt(document.getElementById('settleYearSelect')?.value || new Date().getFullYear());
    const monthStr = String(month).padStart(2, '0');
    const startPattern = `${year}-${monthStr}-%`;

    const res = await window.electronAPI.db.query(
      `SELECT
         o.id as owner_id,
         o.name,
         o.code,
         COALESCE(SUM(c.net_weight_kg), 0) as total_net_kg,
         COALESCE(SUM(c.gross_weight_kg), 0) as total_gross_kg
       FROM owners o
       LEFT JOIN daily_collections c ON o.id = c.owner_id AND c.date LIKE ?
       WHERE o.is_active = 1
       GROUP BY o.id
       ORDER BY total_net_kg DESC`,
      [startPattern]
    );

    const advRes = await window.electronAPI.db.query(
      `SELECT owner_id, SUM(amount) as total_adv FROM advances WHERE date LIKE ? GROUP BY owner_id`,
      [startPattern]
    );

    const advMap = new Map();
    (advRes.data || []).forEach((a) => advMap.set(a.owner_id, Number(a.total_adv || 0)));

    const rows = res.data || [];
    const uniformRate = parseFloat(document.getElementById('settleUniformRate')?.value || 0);

    const tbody = document.getElementById('settlementsTableBody');
    if (!tbody) return;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 24px;">No collection data found for this month.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const netKg = Number(r.total_net_kg || 0);
        const grossAmount = netKg * uniformRate;
        const adv = advMap.get(r.owner_id) || 0;
        const netPayable = Math.max(0, grossAmount - adv);

        return `
        <tr data-owner="${r.owner_id}">
          <td class="font-bold">${r.name} ${r.code ? `<span class="badge badge-emerald">#${r.code}</span>` : ''}</td>
          <td class="mono font-bold">${netKg.toFixed(2)}</td>
          <td class="mono">₹${uniformRate.toFixed(2)}</td>
          <td class="mono font-bold">₹${grossAmount.toFixed(2)}</td>
          <td class="mono" style="color: var(--accent-red);">-₹${adv.toFixed(2)}</td>
          <td class="mono font-bold" style="color: var(--accent-emerald); font-size: 14px;">₹${netPayable.toFixed(2)}</td>
          <td><span class="badge badge-amber">Unsettled</span></td>
          <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="app.showPlanterPassbook('${r.owner_id}')">Passbook</button></td>
        </tr>
      `;
      })
      .join('');
  },

  applyRate() {
    this.load();
    app.showToast('Applied rate across all active planters', 'success');
  },

  exportCsv() {
    const month = document.getElementById('settleMonthSelect')?.value;
    const year = document.getElementById('settleYearSelect')?.value;
    const rows = document.querySelectorAll('#settlementsTableBody tr');

    let csv = 'Planter,Net Weight (KG),Rate/KG,Gross Amount (INR),Advances Deducted (INR),Net Payable (INR)\n';
    rows.forEach((tr) => {
      const cols = tr.querySelectorAll('td');
      if (cols.length >= 6) {
        const name = cols[0].innerText.replace(/,/g, '');
        const net = cols[1].innerText;
        const rate = cols[2].innerText.replace('₹', '');
        const gross = cols[3].innerText.replace('₹', '');
        const adv = cols[4].innerText.replace('₹', '').replace('-', '');
        const pay = cols[5].innerText.replace('₹', '');
        csv += `"${name}",${net},${rate},${gross},${adv},${pay}\n`;
      }
    });

    window.electronAPI.system.exportCsv(`leaf_settlement_${month}_${year}.csv`, csv);
  },
};
