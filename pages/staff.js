/**
 * Leaf Ledger Pro — Staff Module
 */
window.staffModule = {
  init() {
    this.load();
  },

  async load() {
    const res = await window.electronAPI.db.query('SELECT * FROM staff_accounts ORDER BY full_name ASC');
    const tbody = document.getElementById('staffTableBody');
    if (!tbody) return;

    const rows = res.data || [];
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px;">No additional staff collectors configured. Master Admin active.</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map(
          (s) => `
        <tr>
          <td class="font-bold">${s.full_name}</td>
          <td class="mono">@${s.username}</td>
          <td class="mono">${s.mobile_number || '-'}</td>
          <td><span class="badge badge-emerald">Collector Enabled</span></td>
          <td><span class="badge badge-emerald">Active</span></td>
          <td style="text-align: right;"><button class="btn btn-secondary btn-sm" onclick="staffModule.deleteStaff('${s.id}')">Remove</button></td>
        </tr>
      `
        )
        .join('');
    }
  },

  openNewModal() {
    const username = prompt('Enter staff username (e.g. collector1):');
    if (!username) return;
    const name = prompt('Enter staff full name:');
    const rawMobile = prompt('Enter staff 10-digit mobile number:') || '';
    const mobile = rawMobile.replace(/\D/g, '').slice(0, 10);
    if (rawMobile && mobile.length !== 10) {
      app.showToast('Staff mobile number must be exactly 10 digits.', 'warning');
      return;
    }

    const id = 'staff_' + Date.now();
    window.electronAPI.db
      .run(
        'INSERT INTO staff_accounts (id, username, full_name, mobile_number, allow_collector, is_active) VALUES (?, ?, ?, ?, 1, 1)',
        [id, username.toLowerCase(), name, mobile]
      )
      .then(() => {
        app.showToast('Staff collector added', 'success');
        this.load();
      });
  },

  async deleteStaff(id) {
    if (!confirm('Remove this staff member?')) return;
    await window.electronAPI.db.run('DELETE FROM staff_accounts WHERE id = ?', [id]);
    this.load();
  },
};
