/**
 * Leaf Ledger Pro — Core Shell & Page Router
 * Dynamically loads and renders dedicated HTML/JS modules for each screen
 */

class AppRouter {
  constructor() {
    this.currentView = 'login';
    this.planters = [];
    this.settings = {};
    this.machineId = '';
    this.currentUser = null;
    this.isAuthenticated = false;
    this.activeReceiptData = null;
    this.htmlCache = new Map();
    this.currentTheme = localStorage.getItem('llp_theme') || 'dark';
    this.activeSession = null;
    this.sessions = [];

    this.init();
  }

  async init() {
    this.applyTheme(this.currentTheme);
    this.setupWindowControls();
    this.setupNavigation();
    this.setupKeyboardShortcuts();
    this.setupRealtimeSyncListeners();

    // Close season dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const container = document.getElementById('topSeasonContainer');
      if (container && !container.contains(e.target)) {
        this.toggleSeasonMenu(true);
      }
    });

    await this.loadSettings();
    await this.loadPlanters();
    await this.checkLicenseStatus();
    await this.updateVersionDisplays();
    await this.checkAuthState();
  }

  async checkAuthState() {
    // Security Enforcement: on app launch or full window reload, require MPIN authentication.
    // "Remember me" safely pre-fills the registered 10-digit mobile number on the login screen,
    // but NEVER bypasses the 6-digit MPIN check.
    this.setAuthenticatedState(false);
  }

  async setAuthenticatedState(isAuthenticated, user = null) {
    this.isAuthenticated = isAuthenticated;
    this.currentUser = user;
    const sidebar = document.getElementById('appSidebar');

    document.body.classList.toggle('auth-mode', !isAuthenticated);
    const topSync = document.getElementById('topSyncBtn');
    if (topSync) topSync.style.display = isAuthenticated ? 'inline-flex' : 'none';
    const topRefresh = document.getElementById('topRefreshBtn');
    if (topRefresh) topRefresh.style.display = isAuthenticated ? 'inline-flex' : 'none';
    const topSeason = document.getElementById('topSeasonContainer');
    if (topSeason) topSeason.style.display = isAuthenticated ? 'inline-block' : 'none';

    if (isAuthenticated) {
      await this.checkLicenseStatus();
      if (!this.isActivated) {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.showToast('Active license required. Workstation access is locked.', 'warning');
        this.navTo('login');
        return;
      }

      if (window.electronAPI?.window?.setMode) {
        await window.electronAPI.window.setMode('workspace');
      }
      if (sidebar) sidebar.style.display = 'flex';
      const topQuick = document.getElementById('topQuickShortcuts');
      if (topQuick) topQuick.style.display = 'flex';
      const nameEl = document.getElementById('operatorNameDisplay');
      const avatarEl = document.getElementById('operatorAvatarDisplay');
      if (nameEl) nameEl.innerText = user?.name || user?.full_name || 'Tea Agent';
      if (avatarEl) {
        const initials = (user?.name || user?.full_name || 'AG')
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        avatarEl.innerText = initials || 'AG';
      }

      await this.initActiveSession();

      this.navTo('dashboard');
      setTimeout(() => this.triggerSync(), 1500);
    } else {
      if (window.electronAPI?.window?.setMode) {
        await window.electronAPI.window.setMode('auth');
      }
      if (sidebar) sidebar.style.display = 'none';
      const topQuick = document.getElementById('topQuickShortcuts');
      if (topQuick) topQuick.style.display = 'none';
      this.navTo('login');
    }
  }

  async signOut() {
    if (!confirm('Are you sure you want to sign out of Leaf Ledger Pro?')) return;
    await window.electronAPI.auth.signOut();
    this.showToast('Signed out successfully', 'info');
    this.setAuthenticatedState(false);
  }

  // --------------------------------------------------------------------------
  // Dynamic Page Loading Router
  // --------------------------------------------------------------------------
  navigate(viewName) {
    return this.navTo(viewName);
  }

  async navTo(viewName) {
    let isAuthPage = ['login', 'register', 'activation'].includes(viewName);
    // Strictly block unauthenticated or unactivated users from workspace views
    if (!isAuthPage && (!this.isAuthenticated || !this.isActivated)) {
      viewName = 'login';
      isAuthPage = true;
    }

    this.currentView = viewName;
    // Toggle sidebar and top quick actions visibility for auth vs workspace screens
    document.body.classList.toggle('auth-mode', isAuthPage);

    // Strictly enforce Light Mode on login/auth screens; restore saved preference in workspace
    if (isAuthPage) {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', this.currentTheme);
    }

    const sidebar = document.getElementById('appSidebar');
    if (sidebar) {
      sidebar.style.display = isAuthPage ? 'none' : 'flex';
    }
    const topQuick = document.getElementById('topQuickShortcuts');
    if (topQuick) {
      topQuick.style.display = isAuthPage ? 'none' : 'flex';
    }
    const topSync = document.getElementById('topSyncBtn');
    if (topSync) {
      topSync.style.display = isAuthPage ? 'none' : 'inline-flex';
    }
    const topRefresh = document.getElementById('topRefreshBtn');
    if (topRefresh) {
      topRefresh.style.display = isAuthPage ? 'none' : 'inline-flex';
    }
    const topSeason = document.getElementById('topSeasonContainer');
    if (topSeason) {
      topSeason.style.display = isAuthPage ? 'none' : 'inline-block';
    }

    if (window.electronAPI?.window?.setMode) {
      window.electronAPI.window.setMode(isAuthPage ? 'auth' : 'workspace');
    }

    // Update sidebar navigation active state
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-view') === viewName);
    });

    const container = document.getElementById('mainViewContainer');
    if (!container) return;

    try {
      if (!isAuthPage) {
        container.innerHTML = this.getLoadingStateHtml(`Opening ${viewName.charAt(0).toUpperCase() + viewName.slice(1)}...`);
      }

      // Fetch fresh page content
      const res = await fetch(`pages/${viewName}.html?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Failed to load pages/${viewName}.html: ${res.statusText}`);
      const html = await res.text();

      container.classList.toggle('auth-mode', isAuthPage);
      container.innerHTML = html;
      this.updateVersionDisplays(container);

      // Initialize dedicated module with robust naming lookup
      const moduleMap = {
        login: window.loginModule,
        register: window.registerModule,
        activation: window.activationModule,
        dashboard: window.dashboardModule,
        owners: window.ownersModule,
        advances: window.advancesModule,
        collections: window.collectionsModule,
        rates: window.ratesModule,
        monthly: window.monthlyModule,
        factory: window.factoryModule,
        expenses: window.expensesModule,
        reports: window.reportsModule,
        settings: window.settingsModule,
      };

      const mod = moduleMap[viewName] || window[`${viewName}Module`];
      if (mod && typeof mod.init === 'function') {
        mod.init();
      }
    } catch (err) {
      console.error(`[AppRouter] Navigation error for ${viewName}:`, err);
      this.showToast(`Error loading screen: ${err.message}`, 'error');
    }
  }

  // --------------------------------------------------------------------------
  // Real-Time Sync & Live UI Refresh
  // --------------------------------------------------------------------------
  setupRealtimeSyncListeners() {
    if (!window.electronAPI?.sync?.onDataChanged) return;

    window.electronAPI.sync.onDataChanged((event) => {
      console.log('[AppRouter] 🔄 Realtime data changed received:', event);

      // Refresh sync badge
      const dot = document.getElementById('syncDot');
      const text = document.getElementById('syncText');
      if (dot) dot.classList.remove('syncing');
      if (text) text.innerText = 'Synced';

      // Always reload planters if owners changed
      if (event.table === 'owners' || event.tables?.includes('owners')) {
        this.loadPlanters();
      }

      // Refresh currently visible module
      this.refreshActiveView(event);
    });

    if (window.electronAPI?.sync?.onSyncStatus) {
      window.electronAPI.sync.onSyncStatus((statusInfo) => {
        const dot = document.getElementById('syncDot');
        const text = document.getElementById('syncText');
        if (!dot || !text) return;

        if (statusInfo.status === 'syncing') {
          dot.classList.add('syncing');
          text.innerText = 'Syncing...';
        } else if (statusInfo.status === 'synced') {
          dot.classList.remove('syncing');
          text.innerText = 'Synced';
        } else if (statusInfo.status === 'offline') {
          dot.classList.remove('syncing');
          text.innerText = 'Offline';
        } else if (statusInfo.status === 'error') {
          dot.classList.remove('syncing');
          text.innerText = 'Sync Error';
        }
      });
    }
  }

  refreshActiveView(event) {
    const table = event?.table;
    const tables = event?.tables || (table ? [table] : []);

    if (this.currentView === 'collections' && window.collectionsModule) {
      if (tables.length === 0 || tables.includes('daily_collections') || tables.includes('owners')) {
        if (typeof window.collectionsModule.loadDayList === 'function') window.collectionsModule.loadDayList();
        else if (typeof window.collectionsModule.load === 'function') window.collectionsModule.load();
      }
    } else if (this.currentView === 'rates' && window.ratesModule) {
      if (tables.length === 0 || tables.includes('daily_collections') || tables.includes('factory_collections')) {
        if (typeof window.ratesModule.loadData === 'function') window.ratesModule.loadData();
        else if (typeof window.ratesModule.load === 'function') window.ratesModule.load();
      }
    } else if (this.currentView === 'dashboard' && window.dashboardModule) {
      if (typeof window.dashboardModule.refresh === 'function') window.dashboardModule.refresh();
      else if (typeof window.dashboardModule.load === 'function') window.dashboardModule.load();
    } else if (this.currentView === 'owners' && window.ownersModule) {
      if (tables.length === 0 || tables.includes('owners')) {
        if (typeof window.ownersModule.loadOwners === 'function') window.ownersModule.loadOwners();
        else if (typeof window.ownersModule.load === 'function') window.ownersModule.load();
      }
    } else if (this.currentView === 'advances' && window.advancesModule) {
      if (tables.length === 0 || tables.includes('advances')) {
        if (typeof window.advancesModule.refresh === 'function') window.advancesModule.refresh();
        else if (typeof window.advancesModule.load === 'function') window.advancesModule.load();
      }
    } else if (this.currentView === 'expenses' && window.expensesModule) {
      if (tables.length === 0 || tables.includes('expenses')) {
        if (typeof window.expensesModule.loadExpenses === 'function') window.expensesModule.loadExpenses();
        else if (typeof window.expensesModule.load === 'function') window.expensesModule.load();
      }
    } else if (this.currentView === 'monthly' && window.monthlyModule) {
      if (tables.length === 0 || tables.includes('monthly_payments') || tables.includes('daily_collections')) {
        if (typeof window.monthlyModule.loadMonthlyData === 'function') window.monthlyModule.loadMonthlyData();
        else if (typeof window.monthlyModule.load === 'function') window.monthlyModule.load();
      }
    } else if (this.currentView === 'factory' && window.factoryModule) {
      if (tables.length === 0 || tables.includes('factory_collections') || tables.includes('factory_payments') || tables.includes('factories')) {
        if (typeof window.factoryModule.load === 'function') window.factoryModule.load();
        else if (typeof window.factoryModule.loadDailyData === 'function') window.factoryModule.loadDailyData();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Window & Navigation Setup
  // --------------------------------------------------------------------------
  setupWindowControls() {
    const minBtn = document.getElementById('winMinBtn');
    const maxBtn = document.getElementById('winMaxBtn');
    const closeBtn = document.getElementById('winCloseBtn');

    if (minBtn) minBtn.onclick = () => window.electronAPI.window.minimize();
    if (maxBtn) maxBtn.onclick = () => window.electronAPI.window.maximize();
    if (closeBtn) closeBtn.onclick = () => window.electronAPI.window.close();

    const topSyncBtn = document.getElementById('topSyncBtn');
    if (topSyncBtn) topSyncBtn.onclick = () => this.triggerSync();
  }

  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const viewId = item.getAttribute('data-view');
        this.navTo(viewId);
      });
    });
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Allow Esc to close any open modal anytime
      if (e.key === 'Escape') {
        this.closeAllModals();
        return;
      }

      const tag = document.activeElement?.tagName?.toLowerCase();
      const isInputFocused = tag === 'input' || tag === 'textarea' || tag === 'select';

      // '?' key opens shortcut modal if not typing in an input
      if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !isInputFocused) {
        e.preventDefault();
        this.openModal('modalShortcutsHelp');
        return;
      }

      // If in auth screen, ignore function shortcuts
      const isAuthPage = ['login', 'register', 'activation'].includes(this.currentView);
      if (isAuthPage) return;

      // Function key shortcuts (F1-F6)
      if (e.key === 'F1') {
        e.preventDefault();
        this.openModal('modalShortcutsHelp');
      } else if (e.key === 'F2') {
        e.preventDefault();
        this.openNewLeafEntry();
      } else if (e.key === 'F3') {
        e.preventDefault();
        this.openNewAdvanceEntry();
      } else if (e.key === 'F4') {
        e.preventDefault();
        this.openNewExpenseEntry();
      } else if (e.key === 'F5') {
        e.preventDefault();
        this.navTo('rates');
      } else if (e.key === 'F6') {
        e.preventDefault();
        this.navTo('monthly');
      }
    });
  }

  // --------------------------------------------------------------------------
  // Global Shortcut Quick-Entry Launchers
  // --------------------------------------------------------------------------
  async openNewLeafEntry() {
    if (this.currentView !== 'collections') {
      await this.navTo('collections');
    }
    setTimeout(() => {
      if (window.collectionsModule?.openNewEntryModal) {
        window.collectionsModule.openNewEntryModal();
      }
    }, 120);
  }

  async openNewAdvanceEntry() {
    if (this.currentView !== 'advances') {
      await this.navTo('advances');
    }
    setTimeout(() => {
      if (window.advancesModule?.openNewEntryModal) {
        window.advancesModule.openNewEntryModal();
      }
    }, 120);
  }

  async openNewExpenseEntry() {
    if (this.currentView !== 'expenses') {
      await this.navTo('expenses');
    }
    setTimeout(() => {
      if (window.expensesModule?.openNewEntryModal) {
        window.expensesModule.openNewEntryModal();
      }
    }, 120);
  }

  // --------------------------------------------------------------------------
  // Global Screen Refresh Action
  // --------------------------------------------------------------------------
  async refreshCurrentScreen() {
    const icon = document.getElementById('topRefreshIcon') || document.querySelector('#topRefreshBtn svg');
    if (icon) {
      icon.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      icon.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        icon.style.transition = 'none';
        icon.style.transform = 'none';
      }, 600);
    }

    if (this.currentView === 'dashboard' && window.dashboardModule?.refresh) {
      await window.dashboardModule.refresh();
    } else {
      this.refreshActiveView();
    }
    await this.triggerSync();
  }

  // --------------------------------------------------------------------------
  // Theme Management (Executive Dark / Clean Light)
  // --------------------------------------------------------------------------
  applyTheme(theme) {
    this.currentTheme = theme === 'light' ? 'light' : 'dark';
    try {
      localStorage.setItem('llp_theme', this.currentTheme);
    } catch (e) {}

    // Strictly enforce Light Mode if on login/auth view
    const isAuth = ['login', 'register', 'activation'].includes(this.currentView) || document.body.classList.contains('auth-mode');
    document.documentElement.setAttribute('data-theme', isAuth ? 'light' : this.currentTheme);

    // Update Titlebar Toggle Icon & Tooltip
    const iconEl = document.getElementById('themeToggleIcon');
    const toggleBtn = document.getElementById('topThemeToggleBtn');
    if (iconEl) {
      iconEl.innerHTML = this.currentTheme === 'light'
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    }
    if (toggleBtn) {
      toggleBtn.title = this.currentTheme === 'light' ? 'Switch to Executive Dark Mode' : 'Switch to Clean Light Mode';
    }

    // Sync Settings Page cards if currently displayed
    this.syncThemeSettingsUI();
  }

  toggleTheme() {
    const nextTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(nextTheme);
  }

  async setTheme(theme) {
    this.applyTheme(theme);
    try {
      if (window.electronAPI?.db?.setSetting) {
        await window.electronAPI.db.setSetting('app_theme', this.currentTheme);
      }
    } catch (e) {
      console.warn('[AppRouter] Failed to save theme setting to db:', e);
    }
    this.showToast(`Switched to ${this.currentTheme === 'light' ? 'Clean Light' : 'Executive Dark'} theme`, 'info');
  }

  syncThemeSettingsUI() {
    const darkCard = document.getElementById('themeCardDark');
    const lightCard = document.getElementById('themeCardLight');
    const darkBadge = document.getElementById('themeBadgeDark');
    const lightBadge = document.getElementById('themeBadgeLight');

    if (darkCard && lightCard) {
      const isLight = this.currentTheme === 'light';
      darkCard.style.borderColor = isLight ? 'var(--border-subtle)' : 'var(--accent-emerald)';
      lightCard.style.borderColor = isLight ? 'var(--accent-emerald)' : 'var(--border-subtle)';
      if (darkBadge) darkBadge.style.display = isLight ? 'none' : 'inline-block';
      if (lightBadge) lightBadge.style.display = isLight ? 'inline-block' : 'none';
    }
  }

  // --------------------------------------------------------------------------
  // Notifications & Modal Management
  // --------------------------------------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success' ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  openExternalLink(url) {
    if (window.electronAPI && window.electronAPI.system && window.electronAPI.system.openExternal) {
      window.electronAPI.system.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.remove('active'));
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('active');
  }

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('active');
  }

  // --------------------------------------------------------------------------
  // Planters Cache
  // --------------------------------------------------------------------------
  async loadPlanters() {
    const res = await window.electronAPI.db.query('SELECT * FROM owners WHERE is_active = 1 ORDER BY name ASC');
    if (res.success) {
      this.planters = res.data || [];
      const badge = document.getElementById('navPlantersCount');
      if (badge) badge.innerText = String(this.planters.length);

      const sel = document.getElementById('mAdvPlanterSelect');
      if (sel) {
        sel.innerHTML = this.planters
          .map((p) => `<option value="${p.id}">${p.name} ${p.code ? `(#${p.code})` : ''} - ${p.village || 'Estate'}</option>`)
          .join('');
      }
    }
  }

  // --------------------------------------------------------------------------
  // Thermal Printing & Receipt Simulator
  // --------------------------------------------------------------------------
  previewAndPrintReceipt(receiptData) {
    this.activeReceiptData = receiptData;
    const config = {
      agentName: this.settings.agent_name || 'LEAF LEDGER PRO',
      agentLocation: this.settings.agent_contact || '',
      width: this.settings.printer_width || '58mm',
    };

    const container = document.getElementById('receiptPaperContainer');
    if (container) {
      container.innerHTML = `
        <div style="text-align: center; border-bottom: 1px dashed #444; padding-bottom: 6px; margin-bottom: 6px;">
          <div style="font-weight: 900; font-size: 14px;">${config.agentName}</div>
          ${config.agentLocation ? `<div style="font-size: 10px; color: #555;">${config.agentLocation}</div>` : ''}
          <div style="font-size: 9px; margin-top: 3px;">GREEN LEAF INTAKE</div>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span>Date: ${receiptData.date}</span>
          <span>${receiptData.time}</span>
        </div>
        <div style="font-size: 11px; margin-top: 2px;">Receipt: #${String(receiptData.id).slice(-8).toUpperCase()}</div>
        <div style="border-top: 1px dashed #444; margin: 5px 0;"></div>
        <div style="font-weight: 700; font-size: 13px;">${receiptData.planterName} ${receiptData.planterCode ? `(#${receiptData.planterCode})` : ''}</div>
        <div style="border-top: 1px dashed #444; margin: 5px 0;"></div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span>Gross Weight:</span>
          <span>${Number(receiptData.grossWeight).toFixed(2)} kg</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px;">
          <span>Total Deductions:</span>
          <span>-${(Number(receiptData.bagDeduction || 0) + Number(receiptData.waterDeduction || 0)).toFixed(2)} kg</span>
        </div>
        <div style="border-top: 2px solid #000; margin: 6px 0;"></div>
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 900;">
          <span>NET WEIGHT:</span>
          <span>${Number(receiptData.netWeight).toFixed(2)} KG</span>
        </div>
        ${receiptData.rate > 0 ? `
        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px;">
          <span>Rate / Kg:</span>
          <span>₹${Number(receiptData.rate).toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; margin-top: 2px;">
          <span>Est. Payout:</span>
          <span>₹${Number(receiptData.totalAmount).toFixed(2)}</span>
        </div>` : ''}
        ${receiptData.notes ? `
        <div style="border-top: 1px dashed #444; margin: 6px 0 4px 0;"></div>
        <div style="font-size: 10px; color: #333; font-style: italic; line-height: 1.3;">
          ${receiptData.notes}
        </div>` : ''}
        <div style="border-top: 1px dashed #444; margin-top: 8px; padding-top: 6px; text-align: center; font-size: 9px; color: #555;">
          Verified Digital Entry &bull; Leaf Ledger Pro
        </div>
      `;
    }

    const printBtn = document.getElementById('modalReceiptPrintBtn');
    if (printBtn) {
      printBtn.onclick = () => {
        window.electronAPI.printer.printReceipt(this.activeReceiptData, config);
        this.closeModal('modalReceipt');
      };
    }

    if (this.settings.auto_print === '1') {
      window.electronAPI.printer.printReceipt(this.activeReceiptData, config);
    } else {
      this.openModal('modalReceipt');
    }
  }

  showDocumentPreview({ title, subtitle, html, defaultFilename }) {
    const titleEl = document.getElementById('docPreviewModalTitle');
    const subEl = document.getElementById('docPreviewModalSubtitle');
    const frame = document.getElementById('docPreviewFrame');
    const printBtn = document.getElementById('docPreviewPrintBtn');
    const exportPdfBtn = document.getElementById('docPreviewExportPdfBtn');

    if (titleEl && title) titleEl.innerText = title;
    if (subEl && subtitle) subEl.innerText = subtitle;
    if (frame) {
      frame.srcdoc = html;
    }

    if (printBtn) {
      printBtn.onclick = async () => {
        try {
          await window.electronAPI.printer.printHtml(html);
          this.showToast('Document sent to printer!', 'success');
        } catch (e) {
          this.showToast(`Print failed: ${e.message}`, 'error');
        }
      };
    }

    if (exportPdfBtn) {
      exportPdfBtn.onclick = async () => {
        try {
          const res = await window.electronAPI.printer.exportPdf(html, defaultFilename || 'Procurement_Statement.pdf');
          if (res?.success) {
            this.showToast('PDF saved and opened successfully.', 'success');
          } else if (res?.canceled) {
            this.showToast('Export cancelled.', 'info');
          } else {
            this.showToast(`Export error: ${res?.error || 'Failed to save PDF'}`, 'error');
          }
        } catch (e) {
          this.showToast(`Export failed: ${e.message}`, 'error');
        }
      };
    }

    this.openModal('modalDocPreview');
  }

  reprintCollection(c) {
    const receiptData = {
      id: c.id,
      date: c.date,
      time: new Date(c.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      planterName: c.planter_name,
      planterCode: c.planter_code,
      grossWeight: c.gross_weight_kg,
      bagDeduction: c.bag_weight_kg,
      waterDeduction: 0,
      netWeight: c.net_weight_kg,
      rate: c.rate_per_kg,
      totalAmount: c.amount,
      collectorName: c.collector_name,
    };
    this.previewAndPrintReceipt(receiptData);
  }

  // --------------------------------------------------------------------------
  // Settings & Cloud Sync
  // --------------------------------------------------------------------------
  async loadSettings() {
    this.machineId = await window.electronAPI.security.getMachineId();

    const savedWidth = await window.electronAPI.db.getSetting('printer_width', '58mm');
    const savedName = await window.electronAPI.db.getSetting('agent_name', 'LEAF LEDGER PRO');
    const savedContact = await window.electronAPI.db.getSetting('agent_contact', 'Assam, India');
    const cloudConfig = (await window.electronAPI?.sync?.getConfig?.()) || {};
    const cloudUrl = await window.electronAPI.db.getSetting('supabase_url', cloudConfig.url || '');
    const cloudKey = await window.electronAPI.db.getSetting('supabase_anon_key', cloudConfig.key || '');
    const savedTheme = await window.electronAPI.db.getSetting('app_theme', this.currentTheme);
    if (savedTheme && savedTheme !== this.currentTheme) {
      this.applyTheme(savedTheme);
    }

    this.settings = {
      printer_width: savedWidth,
      agent_name: savedName,
      agent_contact: savedContact,
      auto_print: autoPrint,
      supabase_url: cloudUrl,
      supabase_anon_key: cloudKey,
      app_theme: this.currentTheme,
    };
  }

  async checkLicenseStatus() {
    try {
      let status = {};
      try {
        status = await window.electronAPI.security.getLicenseStatus();
      } catch (e) {
        console.warn('License status error:', e);
      }
      const isActDb = (await window.electronAPI.db.getSetting('is_activated', '0')) === '1';
      const expiryDateDb = await window.electronAPI.db.getSetting('expiry_date', '');
      const isActivated = Boolean(status?.isActivated || isActDb);
      this.isActivated = isActivated;
      const rawExp = status?.expiryDate || expiryDateDb || '';

      const operatorRole = document.getElementById('licenseBadgeDisplay');
      if (operatorRole) {
        if (!isActivated) {
          operatorRole.innerText = 'Unlicensed';
          operatorRole.title = 'No active commercial license';
        } else {
          let expSnippet = '';
          if (rawExp) {
            const s = String(rawExp).trim().toLowerCase();
            if (s.includes('life')) {
              expSnippet = 'Lifetime';
            } else {
              const d = new Date(rawExp);
              if (!isNaN(d.getTime())) {
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                expSnippet = `Exp: ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
              }
            }
          }
          operatorRole.innerText = expSnippet ? `Pro • ${expSnippet}` : 'Enterprise • Pro';
          operatorRole.title = rawExp ? `Software License Valid Until: ${expSnippet || rawExp}` : 'Enterprise • Pro';
        }
      }
    } catch (e) {
      console.warn('[App] checkLicenseStatus err:', e);
    }
  }

  async triggerSync() {
    const dot = document.getElementById('syncDot');
    const text = document.getElementById('syncText');
    if (dot) dot.classList.add('syncing');
    if (text) text.innerText = 'Syncing...';

    try {
      const res = await window.electronAPI.sync.triggerSync();
      if (res.status === 'ok') {
        if (dot) dot.classList.remove('syncing');
        if (text) text.innerText = 'Synced';
        this.showToast(`Sync complete! Flushed ${res.flushed} offline records.`, 'success');
        await this.loadPlanters();
        if (this.currentView === 'dashboard' && window.dashboardModule) {
          window.dashboardModule.load();
        }
      } else {
        if (dot) dot.classList.remove('syncing');
        if (text) text.innerText = 'Offline';
      }
    } catch {
      if (dot) dot.classList.remove('syncing');
      if (text) text.innerText = 'Offline';
    }
  }

  // --------------------------------------------------------------------------
  // Enterprise Auto-Session Engine & Global Quick-Switcher
  // --------------------------------------------------------------------------
  async initActiveSession() {
    try {
      let activeRes = await window.electronAPI.db.getOne(
        `SELECT * FROM sessions WHERE is_active = 1 LIMIT 1;`
      );
      let session = activeRes?.data;

      // Fail-safe Auto-Heal: If no session is marked active, activate the latest or create current year
      if (!session) {
        const latestRes = await window.electronAPI.db.getOne(
          `SELECT * FROM sessions ORDER BY created_at DESC, id DESC LIMIT 1;`
        );
        if (latestRes?.data?.id) {
          await window.electronAPI.db.run(
            `UPDATE sessions SET is_active = 1, status = 'active', sync_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
            [latestRes.data.id]
          );
          session = latestRes.data;
        } else {
          // Auto-create current year's season seamlessly without blocking user
          const year = new Date().getFullYear();
          const sessId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('ses_' + Date.now());
          const curUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
          const today = new Date().toISOString().split('T')[0];
          await window.electronAPI.db.run(
            `INSERT INTO sessions (id, app_user_id, name, date, is_active, status, start_date, sync_id, sync_status, updated_at) VALUES (?, ?, ?, ?, 1, 'active', ?, ?, 0, CURRENT_TIMESTAMP);`,
            [sessId, curUid, String(year), today, today, sessId]
          );
          session = { id: sessId, name: String(year), is_active: 1 };
          window.electronAPI.sync.smartSync('sessions');
        }
      }

      this.activeSession = session;

      // Load all available sessions for dropdown selection
      const allRes = await window.electronAPI.db.query(`SELECT * FROM sessions ORDER BY name DESC;`);
      this.sessions = allRes?.data || [];

      // Update UI titlebar pill and menu
      this.updateSeasonUI();
      return this.activeSession;
    } catch (e) {
      console.error('[App] initActiveSession error:', e);
      return null;
    }
  }

  updateSeasonUI() {
    const nameEl = document.getElementById('topSeasonName');
    if (nameEl) {
      nameEl.innerText = this.activeSession ? `Season ${this.activeSession.name}` : 'Season';
    }

    const listEl = document.getElementById('topSeasonList');
    if (listEl) {
      if (!this.sessions.length) {
        listEl.innerHTML = '<div style="padding: 10px 12px; font-size: 11px; color: var(--text-muted);">No seasons found</div>';
      } else {
        listEl.innerHTML = this.sessions.map(s => {
          const isActive = this.activeSession && this.activeSession.id === s.id;
          return `<div class="season-item ${isActive ? 'active' : ''}" onclick="app.switchSession('${s.id}')">
            <span>🌿 Season ${s.name}</span>
          </div>`;
        }).join('');
      }
    }
  }

  toggleSeasonMenu(forceClose = false) {
    const container = document.getElementById('topSeasonContainer');
    const menu = document.getElementById('topSeasonDropdown');
    if (!container || !menu) return;

    if (forceClose || menu.style.display === 'block') {
      menu.style.display = 'none';
      container.classList.remove('open');
    } else {
      menu.style.display = 'block';
      container.classList.add('open');
    }
  }

  getSessionIdForDate(dateStr) {
    const yr = (dateStr && dateStr.length >= 4) ? dateStr.slice(0, 4) : String(new Date().getFullYear());
    return '00000000-0000-0000-0000-00000000' + yr.padStart(4, '0');
  }

  async getActiveSession(dateContext = null) {
    if (dateContext) {
      const sid = this.getSessionIdForDate(dateContext);
      const matched = this.sessions.find(s => s.id === sid);
      if (matched) return matched;
    }
    if (this.activeSession && this.activeSession.id) {
      return this.activeSession;
    }
    return await this.initActiveSession();
  }

  async switchSession(sessionId) {
    this.toggleSeasonMenu(true);
    if (!sessionId || (this.activeSession && this.activeSession.id === sessionId)) return;

    try {
      await window.electronAPI.db.run(`UPDATE sessions SET is_active = 0, status = 'closed', sync_status = 0, updated_at = CURRENT_TIMESTAMP;`);
      await window.electronAPI.db.run(`UPDATE sessions SET is_active = 1, status = 'active', sync_status = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, [sessionId]);

      await this.initActiveSession();
      window.electronAPI.sync.smartSync('sessions');

      const sessName = this.activeSession ? this.activeSession.name : '';
      this.showToast(`Working session changed to Season ${sessName}`, 'info');

      // Refresh current screen to show newly selected season data
      this.refreshCurrentScreen();
    } catch (e) {
      this.showToast(`Error switching season: ${e.message}`, 'error');
    }
  }

  async promptNewSeason() {
    this.toggleSeasonMenu(true);
    const name = prompt("Enter new plucking season name (e.g. 2028 or 2027-28):");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();

    try {
      const sessId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('ses_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
      const curUid = (await window.electronAPI.auth.getCurrentUser())?.id || '';
      const today = new Date().toISOString().split('T')[0];

      await window.electronAPI.db.run(`UPDATE sessions SET is_active = 0, status = 'closed', sync_status = 0, updated_at = CURRENT_TIMESTAMP;`);
      await window.electronAPI.db.run(
        `INSERT INTO sessions (id, app_user_id, name, date, is_active, status, start_date, sync_id, sync_status, updated_at) VALUES (?, ?, ?, ?, 1, 'active', ?, ?, 0, CURRENT_TIMESTAMP);`,
        [sessId, curUid, cleanName, today, today, sessId]
      );

      await this.initActiveSession();
      window.electronAPI.sync.smartSync('sessions');
      this.showToast(`Created and switched to Season ${cleanName}!`, 'success');
      this.refreshCurrentScreen();
    } catch (e) {
      this.showToast(`Error creating season: ${e.message}`, 'error');
    }
  }

  // --------------------------------------------------------------------------
  // Smart Dynamic Version Management
  // Reads version once from Electron package.json and injects across all screens
  // --------------------------------------------------------------------------
  async getAppVersion() {
    if (this._appVersion) return this._appVersion;
    try {
      if (window.electronAPI?.system?.getAppVersion) {
        this._appVersion = await window.electronAPI.system.getAppVersion();
      }
    } catch (_) {}
    this._appVersion = this._appVersion || '1.0.0';
    return this._appVersion;
  }

  async updateVersionDisplays(root = document) {
    const ver = await this.getAppVersion();
    const scope = root && root.querySelectorAll ? root : document;

    // 1. Update any element with [data-app-version] or .app-version-text
    scope.querySelectorAll('[data-app-version], .app-version-text').forEach((el) => {
      const template = el.getAttribute('data-app-version');
      if (template && template.includes('{version}')) {
        el.textContent = template.replace('{version}', ver);
      } else {
        el.textContent = `v${ver}`;
      }
    });

    // 2. Automatically update known global badge locations
    const loginBadge = document.getElementById('loginAppVersionBadge');
    if (loginBadge) {
      loginBadge.textContent = `v${ver} Enterprise`;
    }

    const licenseBadge = document.getElementById('licenseBadgeDisplay');
    if (licenseBadge && (!licenseBadge.dataset.customLicense || licenseBadge.textContent.includes('v'))) {
      licenseBadge.textContent = `v${ver} Enterprise`;
    }

    const versionSub = document.getElementById('softwareVersionSubtitle');
    if (versionSub) {
      versionSub.textContent = `You are running Leaf Ledger Pro v${ver}`;
    }
  }

  // --------------------------------------------------------------------------
  // Signature Titan Organic Leaf Empty State & Floating Loader Components
  // Exact visual & animation parity with Leaf Ledger Pro Web & Mobile Suite
  // --------------------------------------------------------------------------
  getEmptyStateHtml({
    title = 'No Records Found',
    message = 'No recordings found for this selection.',
    actionHtml = ''
  } = {}) {
    const leafPath = "M272 96c-78.6 0-145.1 51.5-167.7 122.5c33.6-17 71.5-26.5 111.7-26.5l88 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-16 0-72 0s0 0 0 0c-16.6 0-32.7 1.9-48.3 5.4c-25.9 5.9-49.9 16.4-71.4 30.7c0 0 0 0 0 0C38.3 298.8 0 364.9 0 440l0 16c0 13.3 10.7 24 24 24s24-10.7 24-24l0-16c0-48.7 20.7-92.5 53.8-123.2C121.6 392.3 190.3 448 272 448l1 0c132.1-.7 239-130.9 239-291.4c0-42.6-7.5-83.1-21.1-119.6c-2.6-6.9-12.7-6.6-16.2-.1C455.9 72.1 418.7 96 376 96L272 96z";

    return `
      <div class="titan-empty-state tea-empty-state">
        <div class="titan-empty-cluster tea-leaf-cluster">
          <svg class="titan-empty-main-leaf tea-leaf-primary" viewBox="0 0 512 512" fill="currentColor">
            <path d="${leafPath}"/>
          </svg>
          <svg class="titan-empty-sub-leaf tea-leaf-secondary" viewBox="0 0 512 512" fill="currentColor">
            <path d="${leafPath}"/>
          </svg>
        </div>
        <h3 class="titan-empty-title tea-empty-title">${title}</h3>
        <p class="titan-empty-desc tea-empty-desc">${message}</p>
        ${actionHtml ? `<div class="titan-empty-action tea-empty-action">${actionHtml}</div>` : ''}
      </div>
    `;
  }

  getEmptyStateTableRow(colspan = 8, options = {}) {
    return `
      <tr>
        <td colspan="${colspan}" style="padding: 10px 0; border: none; background: transparent;">
          ${this.getEmptyStateHtml(options)}
        </td>
      </tr>
    `;
  }

  renderEmptyState(container, options = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (el) el.innerHTML = this.getEmptyStateHtml(options);
  }

  getLoadingStateHtml(message = 'Synchronizing Data...', subMessage = 'Please wait a moment') {
    const leafPath = "M272 96c-78.6 0-145.1 51.5-167.7 122.5c33.6-17 71.5-26.5 111.7-26.5l88 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-16 0-72 0s0 0 0 0c-16.6 0-32.7 1.9-48.3 5.4c-25.9 5.9-49.9 16.4-71.4 30.7c0 0 0 0 0 0C38.3 298.8 0 364.9 0 440l0 16c0 13.3 10.7 24 24 24s24-10.7 24-24l0-16c0-48.7 20.7-92.5 53.8-123.2C121.6 392.3 190.3 448 272 448l1 0c132.1-.7 239-130.9 239-291.4c0-42.6-7.5-83.1-21.1-119.6c-2.6-6.9-12.7-6.6-16.2-.1C455.9 72.1 418.7 96 376 96L272 96z";

    return `
      <div class="titan-leaf-loader tea-loading-state">
        <div class="titan-leaf-float-wrap">
          <svg class="titan-leaf-icon" viewBox="0 0 512 512" fill="currentColor">
            <path d="${leafPath}"/>
          </svg>
          <svg class="titan-leaf-sub-icon" viewBox="0 0 512 512" fill="currentColor">
            <path d="${leafPath}"/>
          </svg>
        </div>
        <div class="titan-leaf-shadow"></div>
        <div class="titan-leaf-loader-text">${message}</div>
        ${subMessage ? `<div class="titan-leaf-loader-sub">${subMessage}</div>` : ''}
      </div>
    `;
  }

  getLoadingStateTableRow(colspan = 8, message = 'Synchronizing Data...', subMessage = '') {
    return `
      <tr>
        <td colspan="${colspan}" style="padding: 10px 0; border: none; background: transparent;">
          ${this.getLoadingStateHtml(message, subMessage)}
        </td>
      </tr>
    `;
  }

  renderLoadingState(container, message = 'Synchronizing Data...', subMessage = '') {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (el) el.innerHTML = this.getLoadingStateHtml(message, subMessage);
  }
}

// Instantiate global app router
const app = new AppRouter();
window.app = app;

// Global helper attachments matching web and mobile parity
window.getEmptyStateHtml = (opts) => app.getEmptyStateHtml(opts);
window.getEmptyStateTableRow = (cs, opts) => app.getEmptyStateTableRow(cs, opts);
window.renderEmptyState = (c, opts) => app.renderEmptyState(c, opts);

window.getLoadingStateHtml = (msg, sub) => app.getLoadingStateHtml(msg, sub);
window.getLoadingStateTableRow = (cs, msg, sub) => app.getLoadingStateTableRow(cs, msg, sub);
window.renderLoadingState = (c, msg, sub) => app.renderLoadingState(c, msg, sub);

window.getLeafLoaderHtml = (msg, sub) => app.getLoadingStateHtml(msg, sub);
window.renderLeafLoader = (c, msg, sub) => app.renderLoadingState(c, msg, sub);
