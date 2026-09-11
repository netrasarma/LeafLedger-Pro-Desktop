/**
 * Leaf Ledger Pro - Registration Screen Module
 * Mirrors Python ui/registration.py logic
 */

const registerModule = {
  init() {
    this.hideError();

    const mobileInput = document.getElementById('regMobileInput');
    const mpinInput = document.getElementById('regMpinInput');
    const confMpinInput = document.getElementById('regConfMpinInput');

    if (mobileInput) {
      mobileInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
      });
    }

    const limitMpin = (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    };

    if (mpinInput) mpinInput.addEventListener('input', limitMpin);
    if (confMpinInput) confMpinInput.addEventListener('input', limitMpin);
  },

  async submitRegistration() {
    this.hideError();

    const bizName = document.getElementById('regBizNameInput')?.value.trim() || '';
    const mobile = document.getElementById('regMobileInput')?.value.trim() || '';
    const mpin = document.getElementById('regMpinInput')?.value.trim() || '';
    const confMpin = document.getElementById('regConfMpinInput')?.value.trim() || '';

    if (!bizName || !mobile || !mpin || !confMpin) {
      this.showError('All fields are required.');
      return;
    }

    if (mobile.length !== 10) {
      this.showError('Mobile number must be exactly 10 digits.');
      return;
    }

    if (mpin.length !== 6) {
      this.showError('MPIN must be exactly 6 digits.');
      return;
    }

    if (mpin !== confMpin) {
      this.showError('MPINs do not match. Please re-enter.');
      return;
    }

    const submitBtn = document.getElementById('registerSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Registering...</span>';
    }

    try {
      const res = await window.electronAPI.auth.signUp(bizName, mobile, mpin);

      if (res && res.success) {
        await window.electronAPI.db.setSetting('last_login_username', mobile);
        await window.electronAPI.db.setSetting('agent_name', bizName);
        app.showToast('Account created successfully! Please sign in.', 'success');
        app.navTo('login');
      } else {
        this.showError(res?.error || 'Registration failed. Please check your network or try again.');
      }
    } catch (err) {
      console.error('[RegisterModule] Registration error:', err);
      this.showError(err.message || 'An unexpected error occurred during registration.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Sign Up</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
      }
    }
  },

  showError(msg) {
    const el = document.getElementById('registerErrorMsg');
    if (el) {
      el.innerText = msg;
      el.style.display = 'block';
    }
  },

  hideError() {
    const el = document.getElementById('registerErrorMsg');
    if (el) {
      el.innerText = '';
      el.style.display = 'none';
    }
  }
};

window.registerModule = registerModule;
