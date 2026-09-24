/**
 * Leaf Ledger Pro — Settings Module
 * 1-to-1 Parity with Python ui/settings_ui.py
 */

class SettingsModule {
  constructor() {
    this.currentTab = 'agent';
    this.sessions = [];
    this.staffList = [];
    this.mobileApkUrl = 'https://drive.google.com/uc?export=download&id=1VXKZ0t7IMsevOAA1uBytAJqmuAKTO62E';
    this.mobileApkVersion = '';
  }

  async init() {
    await this.loadBusinessProfile();
    await this.loadSessions();
    await this.loadActivationStatus();
    await this.loadStaffFleet();
    this.loadMobileAppInfo();
    this.loadSoftwareInfo();
    this.switchTab('agent');
  }

  switchTab(tabKey) {
    this.currentTab = tabKey;

    // Update tab button active states
    document.querySelectorAll('.settings-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
    });

    // Toggle content panels
    document.querySelectorAll('.settings-tab-panel').forEach((panel) => {
      panel.classList.remove('active');
    });

    const activePanel = document.getElementById(`setTab-${tabKey}`);
    if (activePanel) {
      activePanel.classList.add('active');
    }

    if (tabKey === 'appearance' && window.app?.syncThemeSettingsUI) {
      window.app.syncThemeSettingsUI();
    }
    if (tabKey === 'activation') {
      this.loadActivationStatus();
    }
    if (tabKey === 'users') {
      this.loadStaffFleet();
    }
    if (tabKey === 'mobile') {
      this.loadMobileAppInfo();
    }
    if (tabKey === 'update') {
      this.loadSoftwareInfo();
    }
  }

  // --- Tab 1: Business Profile ---
  async loadBusinessProfile() {
    try {
      const name = await window.electronAPI.db.getSetting('agent_name', 'Leaf Ledger Pro');
      const phone = await window.electronAPI.db.getSetting('agent_phone', '');
      const addr = await window.electronAPI.db.getSetting('agent_address', '');
      const authName = await window.electronAPI.db.getSetting('authority_name', '');
      const sigData = await window.electronAPI.db.getSetting('authority_signature', '');

      const nameEl = document.getElementById('setAgentName');
      const phoneEl = document.getElementById('setAgentPhone');
      const addrEl = document.getElementById('setAgentAddress');
      const authEl = document.getElementById('setAuthorityName');

      if (nameEl) nameEl.value = name;
      if (phoneEl) phoneEl.value = phone;
      if (addrEl) addrEl.value = addr;
      if (authEl) authEl.value = authName;

      // Restore signature preview if saved
      if (sigData) {
        this._showSignaturePreview(sigData);
      }
    } catch (e) {
      console.warn('[Settings] Load profile error:', e);
    }
  }

  async saveAgentProfile() {
    const name = document.getElementById('setAgentName')?.value.trim();
    const phone = document.getElementById('setAgentPhone')?.value.trim().replace(/\D/g, '').slice(0, 10);
    const addr = document.getElementById('setAgentAddress')?.value.trim();
    const authName = document.getElementById('setAuthorityName')?.value.trim() || '';

    if (!name) {
      app.showToast('Business Name is required', 'warning');
      return;
    }

    if (phone && phone.length !== 10) {
      app.showToast('Contact number must be exactly 10 digits.', 'warning');
      document.getElementById('setAgentPhone')?.focus();
      return;
    }

    try {
      await window.electronAPI.db.setSetting('agent_name', name);
      await window.electronAPI.db.setSetting('agent_phone', phone || '');
      await window.electronAPI.db.setSetting('agent_address', addr || '');
      await window.electronAPI.db.setSetting('authority_name', authName);

      // Persist current signature (already stored on file-select, but ensure it's in sync)
      const sigImg = document.getElementById('setSignaturePreviewImg');
      if (sigImg && sigImg.src && sigImg.style.display !== 'none') {
        await window.electronAPI.db.setSetting('authority_signature', sigImg.src);
      }

      // Update sidebar brand title
      const brandEl = document.getElementById('brandAgentNameDisplay');
      if (brandEl) brandEl.innerText = name;

      app.showToast('Business information saved successfully!', 'success');
      setTimeout(() => app.triggerSync(), 500);
    } catch (e) {
      app.showToast(`Error saving profile: ${e.message}`, 'error');
    }
  }

  // Called when user picks a signature image file
  onSignatureFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      app.showToast('Please select a PNG or JPG image file.', 'warning');
      return;
    }

    // Max 2MB check
    if (file.size > 2 * 1024 * 1024) {
      app.showToast('Signature image must be under 2MB.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      this._showSignaturePreview(dataUrl);
      // Persist immediately so it survives a page switch
      try {
        await window.electronAPI.db.setSetting('authority_signature', dataUrl);
      } catch (err) {
        console.warn('[Settings] Signature save error:', err);
      }
    };
    reader.readAsDataURL(file);
  }

  _showSignaturePreview(dataUrl) {
    const img = document.getElementById('setSignaturePreviewImg');
    const placeholder = document.getElementById('setSignaturePlaceholder');
    const clearBtn = document.getElementById('setSignatureClearBtn');
    if (img) { img.src = dataUrl; img.style.display = 'block'; }
    if (placeholder) placeholder.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  }

  async clearSignature() {
    const img = document.getElementById('setSignaturePreviewImg');
    const placeholder = document.getElementById('setSignaturePlaceholder');
    const clearBtn = document.getElementById('setSignatureClearBtn');
    const fileInput = document.getElementById('setSignatureFileInput');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (clearBtn) clearBtn.style.display = 'none';
    if (fileInput) fileInput.value = '';
    try {
      await window.electronAPI.db.setSetting('authority_signature', '');
      app.showToast('Signature removed.', 'info');
    } catch (err) {
      console.warn('[Settings] Clear signature error:', err);
    }
  }

  // ─── Public helper ─── called by printer/reports to embed signature in PDF/receipts
  static async getSignatureDataUrl() {
    try {
      const sig = await window.electronAPI.db.getSetting('authority_signature', '');
      const auth = await window.electronAPI.db.getSetting('authority_name', '');
      return { dataUrl: sig || null, authorityName: auth || '' };
    } catch {
      return { dataUrl: null, authorityName: '' };
    }
  }

  // --- Tab 2: Session Manager ---
  async loadSessions() {
    try {
      let activeRes = await window.electronAPI.db.getOne(
        `SELECT * FROM sessions WHERE is_active = 1 LIMIT 1;`
      );
      let activeSession = activeRes?.data;

      // Auto-heal: If no session is marked active, but sessions exist in the table, activate the latest one automatically
      if (!activeSession) {
        const anyRes = await window.electronAPI.db.getOne(
          `SELECT * FROM sessions ORDER BY created_at DESC, id DESC LIMIT 1;`
        );
        if (anyRes?.data?.id) {
          await window.electronAPI.db.run(`UPDATE sessions SET is_active = 1, status = 'active' WHERE id = ?;`, [anyRes.data.id]);
          activeSession = anyRes.data;
        }
      }

      const activeLbl = document.getElementById('setActiveSessionDisplay');
      if (activeLbl) {
        activeLbl.innerText = activeSession ? activeSession.name : 'None';
      }

      const allRes = await window.electronAPI.db.query(
        `SELECT * FROM sessions ORDER BY name DESC;`
      );
      this.sessions = allRes.data || [];

      const select = document.getElementById('setSwitchSessionSelect');
      if (select) {
        select.innerHTML = this.sessions
          .map(
            (s) =>
              `<option value="${s.id}" ${activeSession && activeSession.id === s.id ? 'selected' : ''}>${s.name}</option>`
          )
          .join('');
      }
    } catch (e) {
      console.warn('[Settings] Load sessions error:', e);
    }
  }


  async switchSession() {
    const select = document.getElementById('setSwitchSessionSelect');
    const sid = select?.value;
    if (!sid) return;

    try {
      await window.electronAPI.db.run(`UPDATE sessions SET is_active = 0, status = 'closed', sync_status = 0, updated_at = CURRENT_TIMESTAMP;`);
      await window.electronAPI.db.run(`UPDATE sessions SET is_active = 1, status = 'active', sync_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, [sid]);

      const chosen = this.sessions.find((s) => s.id === sid);
      await this.loadSessions();
      if (window.app?.initActiveSession) await window.app.initActiveSession();
      app.showToast(`Active session changed to: ${chosen ? chosen.name : sid}`, 'info');
      window.electronAPI.sync.smartSync('sessions');
    } catch (e) {
      app.showToast(`Error switching session: ${e.message}`, 'error');
    }
  }

  // --- Tab 3: Security ---
  async updateMpin() {
    const p1 = document.getElementById('setNewMpin')?.value.trim();
    const p2 = document.getElementById('setConfMpin')?.value.trim();

    if (!p1 || !p2) {
      app.showToast('Both MPIN fields are required', 'warning');
      return;
    }
    if (p1.length !== 6 || !/^\d{6}$/.test(p1)) {
      app.showToast('MPIN must be exactly 6 digits', 'warning');
      return;
    }
    if (p1 !== p2) {
      app.showToast('MPINs do not match. Please try again.', 'warning');
      return;
    }

    try {
      await window.electronAPI.db.setSetting('app_password', p1);
      document.getElementById('setNewMpin').value = '';
      document.getElementById('setConfMpin').value = '';
      app.showToast('MPIN safely updated! It will work offline on this device.', 'success');
    } catch (e) {
      app.showToast(`Error updating MPIN: ${e.message}`, 'error');
    }
  }

  // --- Tab 4: Activation & Software License ---
  async loadActivationStatus() {
    try {
      const isActDb = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
      const activeKeyDb = await window.electronAPI.db.getSetting('active_license', '');
      const expiryDateDb = await window.electronAPI.db.getSetting('expiry_date', '');
      const agentName = await window.electronAPI.db.getSetting('agent_name', 'Tea Agency');

      let status = {};
      try {
        status = (await window.electronAPI.security.getLicenseStatus()) || {};
      } catch (e) {
        console.warn('[Settings] getLicenseStatus error:', e);
      }

      const isActivated = Boolean(status.isActivated || isActDb);
      const licenseKey = status.licenseKey || activeKeyDb || '';
      const rawExpiry = status.expiryDate || expiryDateDb || '';
      const customerName = status.customerName || agentName || 'Enterprise Client';
      let machineId = status.machineId || '';
      if (!machineId && window.electronAPI.security.getMachineId) {
        machineId = await window.electronAPI.security.getMachineId().catch(() => '');
      }

      this.currentLicenseKey = licenseKey;
      this.currentMachineId = machineId;

      const badge = document.getElementById('setLicenseStatusBadge');
      const heroCard = document.getElementById('setLicenseHeroCard');
      const expDisplay = document.getElementById('setLicenseExpiryDisplay');
      const expSub = document.getElementById('setLicenseExpirySub');
      const keyDisplay = document.getElementById('setActiveKeyDisplay');
      const validityDisplay = document.getElementById('setValidityStatusDisplay');
      const ownerDisplay = document.getElementById('setLicenseOwnerDisplay');
      const machDisplay = document.getElementById('setMachineIdDisplay');
      const entrySection = document.getElementById('setActEntrySection');

      if (ownerDisplay) ownerDisplay.innerText = customerName;
      if (machDisplay) machDisplay.innerText = machineId || 'Registered Machine';

      const expInfo = this.formatLicenseExpiry(rawExpiry);

      if (isActivated && !expInfo.isExpired) {
        if (badge) {
          badge.innerHTML = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span> ACTIVE LICENSE`;
          badge.style.background = 'rgba(16, 185, 129, 0.12)';
          badge.style.color = '#10b981';
          badge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        }

        if (heroCard) {
          heroCard.style.borderColor = expInfo.status === 'warning' ? '#f59e0b' : 'var(--accent-green)';
        }

        if (expDisplay) {
          expDisplay.innerText = expInfo.formatted;
        }

        if (expSub) {
          expSub.innerHTML = `<span>⏳ ${expInfo.daysLeftText}</span>`;
          expSub.style.color = expInfo.status === 'warning' ? '#d97706' : 'var(--accent-green)';
        }

        if (keyDisplay) {
          keyDisplay.innerText = licenseKey || 'ACTIVE-ENTERPRISE-KEY';
        }

        if (validityDisplay) {
          validityDisplay.innerText = expInfo.status === 'lifetime'
            ? 'Lifetime Permanent Active'
            : `Valid until ${expInfo.formatted}`;
          validityDisplay.style.color = expInfo.status === 'warning' ? '#d97706' : 'var(--accent-green)';
        }

        if (entrySection) entrySection.style.display = 'none';
      } else {
        if (badge) {
          const text = expInfo.isExpired ? 'LICENSE EXPIRED' : 'ACTIVATION REQUIRED';
          badge.innerHTML = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span> ${text}`;
          badge.style.background = 'rgba(239, 68, 68, 0.12)';
          badge.style.color = '#ef4444';
          badge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        }

        if (heroCard) {
          heroCard.style.borderColor = '#ef4444';
        }

        if (expDisplay) {
          expDisplay.innerText = expInfo.isExpired ? `Expired (${expInfo.formatted})` : 'Not Activated';
        }

        if (expSub) {
          expSub.innerHTML = `<span>⚠️ ${expInfo.isExpired ? expInfo.daysLeftText : 'Enter activation key below to activate'}</span>`;
          expSub.style.color = '#ef4444';
        }

        if (keyDisplay) {
          keyDisplay.innerText = licenseKey || 'NO KEY REGISTERED';
        }

        if (validityDisplay) {
          validityDisplay.innerText = expInfo.isExpired ? 'Expired — Renewal Required' : 'Evaluation Mode';
          validityDisplay.style.color = '#ef4444';
        }

        if (entrySection) entrySection.style.display = 'block';
      }
    } catch (e) {
      console.warn('[Settings] Activation check error:', e);
    }
  }

  formatLicenseExpiry(expiryStr) {
    if (!expiryStr) {
      return {
        formatted: 'Lifetime • Never Expires',
        status: 'lifetime',
        daysLeftText: 'Permanent Unlimited License',
        isExpired: false
      };
    }
    const s = String(expiryStr).trim();
    if (s.toLowerCase().includes('life')) {
      return {
        formatted: 'Lifetime • Never Expires',
        status: 'lifetime',
        daysLeftText: 'Permanent Unlimited License',
        isExpired: false
      };
    }

    const expDate = new Date(s);
    if (isNaN(expDate.getTime())) {
      return {
        formatted: s,
        status: 'active',
        daysLeftText: 'Active License',
        isExpired: false
      };
    }

    const now = new Date();
    const diffMs = expDate.getTime() - now.getTime();
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    const formatted = expDate.toLocaleDateString('en-IN', options);

    if (daysLeft < 0) {
      return {
        formatted,
        daysLeft,
        status: 'expired',
        daysLeftText: `Expired ${Math.abs(daysLeft)} days ago`,
        isExpired: true
      };
    } else if (daysLeft <= 30) {
      return {
        formatted,
        daysLeft,
        status: 'warning',
        daysLeftText: `${daysLeft} days remaining (Renewal recommended)`,
        isExpired: false
      };
    } else {
      return {
        formatted,
        daysLeft,
        status: 'active',
        daysLeftText: `${daysLeft} days remaining`,
        isExpired: false
      };
    }
  }

  toggleKeyEntry() {
    const el = document.getElementById('setActEntrySection');
    if (!el) return;
    const isHidden = el.style.display === 'none' || !el.style.display;
    el.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      document.getElementById('setLicenseKeyInput')?.focus();
    }
  }

  async copyLicenseKey() {
    if (!this.currentLicenseKey) {
      app.showToast('No license key to copy', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(this.currentLicenseKey);
      app.showToast('License key copied to clipboard!', 'success');
    } catch {
      app.showToast(`License Key: ${this.currentLicenseKey}`, 'info');
    }
  }

  async copyMachineId() {
    if (!this.currentMachineId) {
      app.showToast('No hardware ID found', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(this.currentMachineId);
      app.showToast('Hardware ID copied to clipboard!', 'success');
    } catch {
      app.showToast(`Hardware ID: ${this.currentMachineId}`, 'info');
    }
  }

  async activateKey() {
    const key = document.getElementById('setLicenseKeyInput')?.value.trim();
    if (!key || key.length < 19) {
      app.showToast('Please enter a valid 16-character key (XXXX-XXXX-XXXX-XXXX)', 'warning');
      return;
    }

    try {
      const res = await window.electronAPI.security.validateLicense(key);
      if (res.valid || res.success) {
        await window.electronAPI.db.setSetting('is_activated', '1');
        if (res.expiryDate) {
          await window.electronAPI.db.setSetting('expiry_date', res.expiryDate);
        }
        app.showToast('Software Activated Successfully!', 'success');
        await this.loadActivationStatus();
        if (app.checkLicenseStatus) {
          await app.checkLicenseStatus();
        }
      } else {
        app.showToast(`Activation failed: ${res.message || 'Invalid Key'}`, 'error');
      }
    } catch (e) {
      app.showToast(`Activation error: ${e.message}`, 'error');
    }
  }

  // --- Tab 5: Staff Accounts & Access Permissions ---
  async loadStaffFleet() {
    try {
      const res = await window.electronAPI.db.query(
        `SELECT * FROM staff_accounts ORDER BY created_at DESC;`
      );
      this.staffList = res.data || [];
      this.updateStaffCounters();
      this.renderStaffTable();
    } catch (e) {
      console.warn('[Settings] Load staff error:', e);
    }
  }

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
  }

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
  }

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
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--text-primary); font-size: 13px;">${s.full_name || 'Staff Member'}</div>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
              <span style="font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono);">📞 +91 ${s.mobile_number || s.username}</span>
              ${s.display_mpin ? `<span style="font-size: 10px; font-weight: 700; background: var(--bg-input); color: var(--text-muted); padding: 1px 6px; border-radius: 4px; font-family: var(--font-mono);" title="Login MPIN">PIN: ${s.display_mpin}</span>` : ''}
            </div>
          </td>
          <td>
            ${
              allowCollector
                ? `<span style="font-size: 11px; font-weight: 700; background: rgba(76, 175, 125, 0.12); color: var(--accent-emerald); border: 1px solid rgba(76, 175, 125, 0.3); padding: 3px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;"><span>🍃</span><span>Collection Allowed</span></span>`
                : `<span style="font-size: 11px; font-weight: 600; background: var(--bg-input); color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 3px 8px; border-radius: 5px;">Disabled</span>`
            }
          </td>
          <td>
            <span class="status-badge ${isActive ? 'active' : 'inactive'}" style="font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;">
              <span style="color: ${isActive ? 'var(--accent-emerald)' : 'var(--accent-red)'}; font-size: 12px;">●</span>
              <span>${isActive ? 'Active' : 'Revoked'}</span>
            </span>
          </td>
          <td style="text-align: right;">
            <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" onclick="settingsModule.openEditStaffModal('${s.id}')">
                <span>✏️</span>
                <span>Edit</span>
              </button>
              
              ${
                isActive
                  ? `<button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; font-weight: 700; color: #f59e0b; border-color: rgba(245, 158, 11, 0.35); display: inline-flex; align-items: center; gap: 4px;" onclick="settingsModule.toggleStaffStatus('${s.id}', 0)">
                      <span>🚫</span>
                      <span>Revoke</span>
                    </button>`
                  : `<button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 11px; font-weight: 700; color: var(--accent-emerald); border-color: rgba(76, 175, 125, 0.35); display: inline-flex; align-items: center; gap: 4px;" onclick="settingsModule.toggleStaffStatus('${s.id}', 1)">
                      <span>✅</span>
                      <span>Grant</span>
                    </button>`
              }

              <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 11px; color: var(--accent-red); border-color: rgba(239, 68, 68, 0.3); display: inline-flex; align-items: center; gap: 3px;" onclick="settingsModule.deleteStaff('${s.id}')">
                <span>🗑️</span>
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');
  }

  openEditStaffModal(id) {
    const s = this.staffList.find((x) => x.id === id);
    if (!s) return;

    document.getElementById('editStaffId').value = s.id;
    document.getElementById('editStaffName').value = s.full_name || '';
    document.getElementById('editStaffMobile').value = s.mobile_number || s.username || '';
    document.getElementById('editStaffMpin').value = '';

    document.getElementById('editStaffActive').checked = s.is_active != 0;
    document.getElementById('editStaffAllowCollector').checked = s.allow_collector != 0;

    document.getElementById('modalEditStaff')?.classList.add('active');
  }

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
  }

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
  }

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

      document.getElementById('setStaffMobile').value = '';
      document.getElementById('setStaffMpin').value = '';
      document.getElementById('setStaffName').value = '';

      app.showToast(`Field collector '${name || mob}' provisioned successfully!`, 'success');
      await this.loadStaffFleet();
      if (window.electronAPI?.sync?.smartSync) {
        window.electronAPI.sync.smartSync('staff_accounts');
      }
      app.triggerSync();
    } catch (e) {
      app.showToast(`Failed to create staff: ${e.message}`, 'error');
    }
  }

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

  // --- Tab 6: OTA Updates ---
  async loadSoftwareInfo() {
    try {
      let ver = '1.0.0';
      if (window.electronAPI?.system?.getAppVersion) {
        ver = await window.electronAPI.system.getAppVersion();
      }
      const el = document.getElementById('softwareVersionSubtitle');
      if (el) {
        el.textContent = `You are running Leaf Ledger Pro v${ver}`;
      }
    } catch (_) {}
  }

  async checkForUpdates() {
    if (window.electronAPI?.updater?.checkForUpdates) {
      window.electronAPI.updater.checkForUpdates();
    } else {
      app.showToast('Checking for updates...', 'info');
    }
  }

  // --- Tab 7: Mobile App ---
  async loadMobileAppInfo() {
    try {
      if (window.electronAPI?.sync?.getMobileAppInfo) {
        const info = await window.electronAPI.sync.getMobileAppInfo();
        if (info && info.url) {
          this.mobileApkUrl = info.url;
          this.mobileApkVersion = info.version || '';
          this.renderMobileAppUI();
        }
      }
    } catch (e) {
      console.warn('[Settings] Failed to fetch dynamic mobile app link from Supabase:', e);
    }
  }

  renderMobileAppUI() {
    const url = this.mobileApkUrl || 'https://drive.google.com/uc?export=download&id=1VXKZ0t7IMsevOAA1uBytAJqmuAKTO62E';
    const qrImg = document.getElementById('mobileQrCodeImg');
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
    }
    const btnText = document.getElementById('btnDownloadApkText');
    if (btnText) {
      btnText.textContent = this.mobileApkVersion ? `Download Mobile APK (v${this.mobileApkVersion})` : 'Download Mobile APK';
    }
    const versionSub = document.getElementById('mobileAppVersionSubtext');
    if (versionSub && this.mobileApkVersion) {
      versionSub.innerHTML = `Latest Release: <b style="color:var(--accent-green);">v${this.mobileApkVersion}</b> &bull; Android 8.0+ &bull; Weighing scale bluetooth ready`;
    }
  }

  downloadApk(type = 'mobile') {
    const url = this.mobileApkUrl || 'https://drive.google.com/uc?export=download&id=1VXKZ0t7IMsevOAA1uBytAJqmuAKTO62E';
    app.openExternalLink(url);
    const verText = this.mobileApkVersion ? ` (v${this.mobileApkVersion})` : '';
    app.showToast(`Opening download link for Leaf Ledger Pro Mobile APK${verText}...`, 'info');
  }
}

window.settingsModule = new SettingsModule();
