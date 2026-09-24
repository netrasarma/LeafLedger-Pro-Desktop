/**
 * Leaf Ledger Pro — Desktop Split-Screen Authentication Workbench
 * High-performance, reactive form with real-time validation and error handling
 */

class LoginModule {
  constructor() {
    this.currentMode = 'login';
    this.isMpinVisible = false;
  }

  async init() {
    // Strictly enforce light theme on login screen
    document.documentElement.setAttribute('data-theme', 'light');
    this.setupListeners();
    this.clearAlert();

    // Check remembered user & credentials
    try {
      if (window.electronAPI?.db?.getSetting) {
        const isRem = (await window.electronAPI.db.getSetting('remember_me', '0')) === '1';
        const lastUser = await window.electronAPI.db.getSetting('last_login_username', '');
        
        const remCb = document.getElementById('loginRememberMe');
        if (remCb) remCb.checked = isRem;

        const mobIn = document.getElementById('loginMobileInput');
        if (mobIn && lastUser) {
          mobIn.value = lastUser.replace(/\D/g, '').slice(0, 10);
          this.onMobileInput(mobIn, false); // Update counter & checkmark without stealing focus

          // If remembered mobile is 10 digits, place focus directly into MPIN
          if (mobIn.value.length === 10) {
            const mpinIn = document.getElementById('loginMpinInput');
            if (mpinIn) {
              setTimeout(() => mpinIn.focus(), 100);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[LoginModule] Init settings restoration warning:', e);
    }

    // Check database connection indicator
    this.checkDbStatus();
    this.updateVersionDisplay();
  }

  async updateVersionDisplay() {
    try {
      if (window.electronAPI?.system?.getAppVersion) {
        const ver = await window.electronAPI.system.getAppVersion();
        const badge = document.getElementById('loginAppVersionBadge');
        if (badge) {
          badge.textContent = `v${ver} Enterprise`;
        }
      }
    } catch (_) {}
  }

  async checkDbStatus() {
    const statusEl = document.getElementById('authStatusText');
    if (!statusEl) return;
    try {
      if (window.electronAPI?.db?.getSetting) {
        await window.electronAPI.db.getSetting('app_version', '1.0');
        statusEl.innerText = 'Local Database Ready';
      }
    } catch (err) {
      statusEl.innerText = 'Database Connecting...';
    }
  }

  setupListeners() {
    // Enter key submits or moves to next field
    const mobIn = document.getElementById('loginMobileInput');
    const mpinIn = document.getElementById('loginMpinInput');

    if (mobIn) {
      mobIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (mobIn.value.trim().length === 10) {
            mpinIn?.focus();
          } else {
            this.submitLogin();
          }
        }
      });
    }

    if (mpinIn) {
      mpinIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.submitLogin();
        }
      });
    }
  }

  // --- Real-Time Reactive Input Handlers ---
  onMobileInput(input, autoAdvance = true) {
    if (!input) return;
    this.clearAlert();

    let clean = input.value.replace(/\D/g, '');
    if (clean.length > 10) clean = clean.slice(0, 10);
    input.value = clean;

    const counter = document.getElementById('loginMobileCounter');
    const check = document.getElementById('loginMobileValid');

    if (counter) {
      counter.innerText = `${clean.length}/10`;
      counter.classList.toggle('valid', clean.length === 10);
    }

    if (check) {
      check.style.display = clean.length === 10 ? 'inline-block' : 'none';
    }

    // Auto-advance cursor to MPIN if 10 digits completed
    if (clean.length === 10 && autoAdvance) {
      const mpinIn = document.getElementById('loginMpinInput');
      if (mpinIn && !mpinIn.value) {
        mpinIn.focus();
      }
    }
  }

  onMpinInput(input) {
    if (!input) return;
    this.clearAlert();

    let clean = input.value.replace(/\D/g, '');
    if (clean.length > 6) clean = clean.slice(0, 6);
    input.value = clean;

    const counter = document.getElementById('loginMpinCounter');
    if (counter) {
      counter.innerText = `${clean.length}/6`;
      counter.classList.toggle('valid', clean.length === 6);
    }
  }

  toggleMpin() {
    this.isMpinVisible = !this.isMpinVisible;
    const input = document.getElementById('loginMpinInput');
    const btn = document.getElementById('btnToggleMpin');
    if (!input || !btn) return;

    if (this.isMpinVisible) {
      input.type = 'text';
      btn.innerText = 'HIDE';
      btn.classList.add('active');
    } else {
      input.type = 'password';
      btn.innerText = 'SHOW';
      btn.classList.remove('active');
    }
  }

  // --- Primary Authentication Submission ---
  async submitLogin() {
    const mobIn = document.getElementById('loginMobileInput');
    const mpinIn = document.getElementById('loginMpinInput');

    const mobile = mobIn?.value.trim() || '';
    const mpin = mpinIn?.value.trim() || '';

    // Field validations with high-fidelity messaging
    if (!mobile) {
      this.showAlert('error', 'Please enter your registered 10-digit mobile number.');
      mobIn?.focus();
      return;
    }

    if (mobile.length !== 10 || !/^\d{10}$/.test(mobile)) {
      this.showAlert('error', `Mobile number must be exactly 10 digits (currently ${mobile.length}).`);
      mobIn?.focus();
      return;
    }

    if (!mpin) {
      this.showAlert('error', 'Please enter your 6-digit security MPIN.');
      mpinIn?.focus();
      return;
    }

    if (mpin.length !== 6 || !/^\d{6}$/.test(mpin)) {
      this.showAlert('error', `Security MPIN must be exactly 6 digits (currently ${mpin.length}).`);
      mpinIn?.focus();
      return;
    }

    // Engage loading state
    this.setButtonLoading('btnLoginSubmit', 'loginSpinner', 'loginBtnText', true, 'Authenticating...');

    try {
      const res = await window.electronAPI.auth.signIn(mobile, mpin);

      if (res && (res.success || res.status === 'success')) {
        // Save remember-me preferences
        const isRem = document.getElementById('loginRememberMe')?.checked;
        if (window.electronAPI?.db?.setSetting) {
          await window.electronAPI.db.setSetting('remember_me', isRem ? '1' : '0');
          await window.electronAPI.db.setSetting('last_login_username', isRem ? mobile : '');
        }

        // Strict License Gating: Verify active commercial license before workspace admission
        let isActivated = false;
        if (res.activation && res.activation.isActivated) {
          isActivated = true;
        } else {
          const licStatus = await window.electronAPI.security?.getLicenseStatus?.();
          const dbAct = (await window.electronAPI.db?.getSetting('is_activated', '0')) === '1';
          isActivated = Boolean(licStatus?.isActivated || dbAct);
        }

        if (!isActivated) {
          this.setButtonLoading('btnLoginSubmit', 'loginSpinner', 'loginBtnText', false, 'Sign In to Agency Portal ➔');
          this.showAlert('warning', 'Commercial License Required: This workstation is not activated.');

          // Switch immediately to License Activation screen
          setTimeout(() => {
            this.showActivation();
            this.showAlert('warning', 'Commercial License Required: Please enter your 16-character product key to activate this workstation and unlock Leaf Ledger Pro.');
          }, 500);
          return;
        }

        this.showAlert('success', '✓ Access Granted! Initializing executive workspace...');
        
        const btnText = document.getElementById('loginBtnText');
        if (btnText) btnText.innerText = 'Access Granted ✓';

        // Smooth visual handover to workspace
        setTimeout(() => {
          const appRouter = window.app || (typeof app !== 'undefined' ? app : null);
          if (appRouter?.setAuthenticatedState) {
            appRouter.setAuthenticatedState(true, {
              id: res.user?.id || '',
              phone: mobile,
              name: res.user?.full_name || 'Tea Agent',
            });
          }
        }, 300);

      } else {
        const errorMsg = res?.message || 'Invalid mobile number or security MPIN. Please try again.';
        this.showAlert('error', errorMsg);
        this.setButtonLoading('btnLoginSubmit', 'loginSpinner', 'loginBtnText', false, 'Sign In to Agency Portal ➔');
        mpinIn?.select();
      }
    } catch (err) {
      console.error('[LoginModule] Authentication error:', err);
      this.showAlert('error', err.message || 'Database connection error. Please verify SQLite service is active.');
      this.setButtonLoading('btnLoginSubmit', 'loginSpinner', 'loginBtnText', false, 'Sign In to Agency Portal ➔');
      mpinIn?.select();
    }
  }

  // --- Inline Registration Flow ---
  onRegMobileInput(input) {
    let clean = input.value.replace(/\D/g, '').slice(0, 10);
    input.value = clean;
    const counter = document.getElementById('regMobileCounter');
    if (counter) {
      counter.innerText = `${clean.length}/10`;
      counter.classList.toggle('valid', clean.length === 10);
    }
    this.clearAlert();
  }

  onRegMpinInput(input) {
    let clean = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = clean;
    const counter = document.getElementById('regMpinCounter');
    if (counter) {
      counter.innerText = `${clean.length}/6`;
      counter.classList.toggle('valid', clean.length === 6);
    }
    this.clearAlert();
  }

  onRegConfMpinInput(input) {
    let clean = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = clean;
    const counter = document.getElementById('regConfCounter');
    if (counter) {
      counter.innerText = `${clean.length}/6`;
      counter.classList.toggle('valid', clean.length === 6);
    }
    this.clearAlert();
  }

  async submitRegistration() {
    const bizName = document.getElementById('regBizNameInput')?.value.trim();
    const mobile = document.getElementById('regMobileInput')?.value.trim();
    const mpin = document.getElementById('regMpinInput')?.value.trim();
    const confMpin = document.getElementById('regConfMpinInput')?.value.trim();

    if (!bizName) {
      this.showAlert('error', 'Please enter your Agency or Business name.');
      document.getElementById('regBizNameInput')?.focus();
      return;
    }

    if (!mobile || mobile.length !== 10) {
      this.showAlert('error', 'Please enter a valid 10-digit mobile number.');
      document.getElementById('regMobileInput')?.focus();
      return;
    }

    if (!mpin || mpin.length !== 6) {
      this.showAlert('error', 'Please enter a 6-digit MPIN.');
      document.getElementById('regMpinInput')?.focus();
      return;
    }

    if (mpin !== confMpin) {
      this.showAlert('error', 'Security MPINs do not match. Please re-enter.');
      document.getElementById('regConfMpinInput')?.focus();
      return;
    }

    this.setButtonLoading('btnRegisterSubmit', 'regSpinner', 'regBtnText', true, 'Registering Agency...');

    try {
      const res = await window.electronAPI.auth.signUp(bizName, mobile, mpin);
      if (res && (res.success || res.status === 'success')) {
        if (window.electronAPI?.db?.setSetting) {
          await window.electronAPI.db.setSetting('agent_name', bizName);
          await window.electronAPI.db.setSetting('last_login_username', mobile);
        }

        this.showLogin();
        const mobIn = document.getElementById('loginMobileInput');
        if (mobIn) {
          mobIn.value = mobile;
          this.onMobileInput(mobIn, false);
        }

        this.showAlert('success', '✓ Account registered successfully! Please enter your MPIN to sign in.');
        document.getElementById('loginMpinInput')?.focus();
      } else {
        this.showAlert('error', res?.message || 'Registration failed. Mobile may already be registered.');
      }
    } catch (err) {
      this.showAlert('error', err.message || 'Registration error. Please check database connection.');
    } finally {
      this.setButtonLoading('btnRegisterSubmit', 'regSpinner', 'regBtnText', false, 'Create Agency Account');
    }
  }

  // --- Inline Product License Activation Flow ---
  onActivationKeyInput(input) {
    this.clearAlert();
    let raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    let parts = [];
    for (let i = 0; i < raw.length; i += 4) {
      parts.push(raw.substring(i, i + 4));
    }
    input.value = parts.join('-');
  }

  async submitActivation() {
    const actIn = document.getElementById('actKeyInput');
    const key = actIn?.value.trim() || '';
    const cleanChars = key.replace(/[^A-Za-z0-9]/g, '');

    if (!cleanChars || cleanChars.length < 16) {
      this.showAlert('error', 'Please enter a complete product license key (at least 16 alphanumeric characters).');
      actIn?.focus();
      return;
    }

    this.setButtonLoading('btnActivateSubmit', 'actSpinner', 'actBtnText', true, 'Validating License Key...');

    try {
      let res = await window.electronAPI.security.validateLicense(key);
      
      // Fallback verification against Supabase activation_keys if user profile exists
      if (!res || !res.valid) {
        const currentUser = await window.electronAPI.auth.getCurrentUser();
        if (currentUser?.id) {
          const actRes = await window.electronAPI.auth.verifyActivationKey(key, currentUser.id);
          if (actRes && actRes.success) {
            res = { valid: true, message: actRes.message };
          }
        }
      }

      if (res && res.valid) {
        if (window.electronAPI?.db?.setSetting) {
          await window.electronAPI.db.setSetting('is_activated', '1');
        }
        if (window.app?.checkLicenseStatus) {
          await window.app.checkLicenseStatus();
        }
        this.showLogin();
        this.showAlert('success', '✓ Enterprise License Activated! Please enter your MPIN to open workspace.');
        document.getElementById('loginMpinInput')?.focus();
      } else {
        this.showAlert('error', res?.message || 'Invalid or expired hardware product key. Contact official support.');
      }
    } catch (err) {
      this.showAlert('error', err.message || 'License verification service error.');
    } finally {
      this.setButtonLoading('btnActivateSubmit', 'actSpinner', 'actBtnText', false, 'Activate License Online');
    }
  }

  // --- Mode Navigation ---
  showLogin() {
    this.currentMode = 'login';
    this.hideAllModes();
    const el = document.getElementById('authLoginMode');
    if (el) el.style.display = 'block';
    this.clearAlert();
  }

  showRegister() {
    this.currentMode = 'register';
    this.hideAllModes();
    const el = document.getElementById('authRegisterMode');
    if (el) el.style.display = 'block';
    this.clearAlert();
    document.getElementById('regBizNameInput')?.focus();
  }

  showActivation() {
    this.currentMode = 'activation';
    this.hideAllModes();
    const el = document.getElementById('authActivationMode');
    if (el) el.style.display = 'block';
    this.clearAlert();
    document.getElementById('actKeyInput')?.focus();
  }

  // Backward compatibility aliases
  showStep1() {
    this.showLogin();
  }

  showStep2() {
    this.showLogin();
    document.getElementById('loginMpinInput')?.focus();
  }

  verifyMobile() {
    this.submitLogin();
  }

  hideAllModes() {
    ['authLoginMode', 'authRegisterMode', 'authActivationMode'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  // --- Dynamic Alerts & Shake Animations ---
  showAlert(type, message) {
    const alertBox = document.getElementById('authAlertBox');
    const alertIcon = document.getElementById('authAlertIcon');
    const alertText = document.getElementById('authAlertText');

    if (!alertBox || !alertText) return;

    alertBox.className = `auth-alert-box ${type}`;
    alertText.innerText = message;

    if (alertIcon) {
      if (type === 'error') alertIcon.innerText = '⚠️';
      else if (type === 'success') alertIcon.innerText = '✓';
      else alertIcon.innerText = 'ℹ️';
    }

    alertBox.style.display = 'flex';

    // Shake animation on error
    if (type === 'error') {
      const card = document.getElementById('authCard');
      if (card) {
        card.classList.remove('shake');
        void card.offsetWidth; // Force CSS reflow
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 450);
      }
    }
  }

  clearAlert() {
    const alertBox = document.getElementById('authAlertBox');
    if (alertBox) {
      alertBox.style.display = 'none';
    }
  }

  showHelp(e) {
    if (e && e.preventDefault) e.preventDefault();
    this.showAlert(
      'info',
      'For MPIN reset or account recovery, contact your system administrator or call Official Support at +91 8638149032.'
    );
  }

  setButtonLoading(btnId, spinnerId, textId, isLoading, loadingText) {
    const btn = document.getElementById(btnId);
    const spinner = document.getElementById(spinnerId);
    const textSpan = document.getElementById(textId);

    if (btn) btn.disabled = isLoading;
    if (spinner) spinner.style.display = isLoading ? 'inline-block' : 'none';
    if (textSpan && loadingText) textSpan.innerText = loadingText;
  }
}

// Global Singleton Instance
window.loginModule = new LoginModule();
