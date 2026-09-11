/**
 * Leaf Ledger Pro - Product Activation Screen Module
 * Mirrors Python ui/activation.py key formatting and online verification
 */

const activationModule = {
  init() {
    this.hideError();

    const keyInput = document.getElementById('activationKeyInput');
    if (keyInput) {
      keyInput.addEventListener('input', (e) => {
        let raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
        const parts = [];
        for (let i = 0; i < raw.length; i += 4) {
          parts.push(raw.slice(i, i + 4));
        }
        e.target.value = parts.join('-');
      });

      keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.submitActivation();
      });
    }
  },

  async submitActivation() {
    this.hideError();

    const keyInput = document.getElementById('activationKeyInput');
    const key = keyInput?.value.trim().toUpperCase() || '';

    if (!key || key.replace(/-/g, '').length !== 16) {
      this.showError('Please enter a complete 16-character activation key.');
      keyInput?.focus();
      return;
    }

    const submitBtn = document.getElementById('activationSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Verifying...</span>';
    }

    try {
      const user = await window.electronAPI.auth.getCurrentUser();
      const userId = user?.id || null;

      const res = await window.electronAPI.auth.verifyActivationKey(key, userId);

      if (res && (res.status === 'success' || res.success)) {
        await window.electronAPI.db.setSetting('is_activated', '1');
        await window.electronAPI.db.setSetting('activation_key', key);
        app.showToast(`Device activated successfully! ${res.username ? `Welcome ${res.username}` : ''}`, 'success');
        app.setAuthenticatedState(true, user);
      } else {
        this.showError(res?.message || res?.error || 'Invalid or expired activation key. Contact support: +91 8638149032.');
      }
    } catch (err) {
      console.error('[ActivationModule] Verification error:', err);
      this.showError(err.message || 'Could not verify activation key with server.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>ACTIVATE ONLINE</span>';
      }
    }
  },

  showError(msg) {
    const el = document.getElementById('activationErrorMsg');
    if (el) {
      el.innerText = msg;
      el.style.display = 'block';
    }
  },

  hideError() {
    const el = document.getElementById('activationErrorMsg');
    if (el) {
      el.innerText = '';
      el.style.display = 'none';
    }
  }
};

window.activationModule = activationModule;
