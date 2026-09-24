/**
 * Leaf Ledger Pro — Planters Module
 */
window.plantersModule = {
  init() {
    this.render();
  },

  render() {
    const q = (document.getElementById('planterSearchInput')?.value || '').toLowerCase().trim();
    const tbody = document.getElementById('plantersTableBody');
    const badge = document.getElementById('plantersTotalBadge');

    if (badge) badge.innerText = `${app.planters.length} Planters`;
    if (!tbody) return;

    const filtered = app.planters.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        (p.phone && p.phone.includes(q)) ||
        (p.village && p.village.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      tbody.innerHTML = app.getEmptyStateTableRow(7, {
        title: 'No Planters Found',
        message: q ? 'No planters match your search filter.' : 'No planters registered yet.'
      });
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (p) => `
      <tr>
        <td class="mono font-bold">${p.code ? `#${p.code}` : '-'}</td>
        <td class="font-bold">${p.name}</td>
        <td>${p.village || '-'}</td>
        <td class="mono">${p.phone || '-'}</td>
        <td class="mono">${Number(p.default_deduction_pct || 0).toFixed(1)}%</td>
        <td class="mono font-bold">0.00 kg</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="plantersModule.editPlanter('${p.id}')">Edit</button>
        </td>
      </tr>
    `
      )
      .join('');
  },

  filter() {
    this.render();
  },

  openNewModal() {
    document.getElementById('modalPlanterTitle').innerText = 'Add New Planter';
    document.getElementById('modalPlanterId').value = '';
    document.getElementById('modalPlanterName').value = '';
    document.getElementById('modalPlanterCode').value = '';
    document.getElementById('modalPlanterPhone').value = '';
    document.getElementById('modalPlanterVillage').value = '';
    document.getElementById('modalPlanterDed').value = '0.0';
    app.openModal('modalPlanter');
  },

  editPlanter(id) {
    const p = app.planters.find((item) => item.id === id);
    if (!p) return;

    document.getElementById('modalPlanterTitle').innerText = 'Edit Planter';
    document.getElementById('modalPlanterId').value = p.id;
    document.getElementById('modalPlanterName').value = p.name;
    document.getElementById('modalPlanterCode').value = p.code || '';
    document.getElementById('modalPlanterPhone').value = p.phone || '';
    document.getElementById('modalPlanterVillage').value = p.village || '';
    document.getElementById('modalPlanterDed').value = Number(p.default_deduction_pct || 0).toFixed(1);
    app.openModal('modalPlanter');
  },

  async savePlanterModal() {
    const id = document.getElementById('modalPlanterId').value || 'p_' + Date.now();
    const name = document.getElementById('modalPlanterName').value.trim();
    const code = document.getElementById('modalPlanterCode').value.trim();
    const phone = document.getElementById('modalPlanterPhone').value.trim();
    const village = document.getElementById('modalPlanterVillage').value.trim();
    const ded = parseFloat(document.getElementById('modalPlanterDed').value || 0);

    if (!name) {
      app.showToast('Planter name is required', 'error');
      return;
    }

    const isEdit = Boolean(document.getElementById('modalPlanterId').value);
    const sql = isEdit
      ? `UPDATE owners SET name=?, code=?, phone=?, village=?, default_deduction_pct=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      : `INSERT INTO owners (id, name, code, phone, village, default_deduction_pct, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const params = isEdit ? [name, code, phone, village, ded, id] : [id, name, code, phone, village, ded, id];

    const res = await window.electronAPI.db.run(sql, params);
    if (res.success) {
      await window.electronAPI.db.queueMutation('owners', isEdit ? 'UPDATE' : 'INSERT', {
        id,
        name,
        code,
        phone,
        village,
        default_deduction_pct: ded,
      });

      app.showToast(`Planter ${name} saved successfully`, 'success');
      app.closeModal('modalPlanter');
      await app.loadPlanters();
      this.render();
    } else {
      app.showToast('Error saving planter: ' + res.error, 'error');
    }
  },
};
