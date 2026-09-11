/**
 * Leaf Ledger Pro - Enterprise Electron Desktop Suite
 * Main Process Controller
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { LocalDatabase } = require('./database');
const { SafeVault, LicenseManager, getMachineId } = require('./security');
const { SyncEngine } = require('./sync');
const { ReceiptPrinter } = require('./printer');

let mainWindow = null;
let splashWindow = null;
let splashFinished = false;
let db = null;
let vault = null;
let licenseMgr = null;
let syncEngine = null;
const secrets = require('./secrets');

const DEFAULT_SUPABASE_URL = secrets.SUPABASE_URL;
const DEFAULT_SUPABASE_KEY = secrets.SUPABASE_KEY;

function transitionFromSplash() {
  if (splashFinished) return;
  splashFinished = true;

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createSplashWindow() {
  const splashVideoPath = path.join(__dirname, 'video.mp4');
  if (!fs.existsSync(splashVideoPath)) {
    splashFinished = true;
    return;
  }

  splashFinished = false;
  splashWindow = new BrowserWindow({
    width: 960,
    height: 540,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    center: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
    transitionFromSplash();
  });

  setupRuntimeSecurity(splashWindow);

  // Failsafe timer (8.5s)
  setTimeout(() => {
    transitionFromSplash();
  }, 8500);
}

function setupRuntimeSecurity(win, allowDevTools = false) {
  if (!win || win.isDestroyed()) return;

  const isProd = app.isPackaged || process.env.NODE_ENV === 'production';

  // Production anti-tampering: block DevTools, context menu inspection & dev shortcuts
  if (isProd && !allowDevTools) {
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools();
    });

    win.webContents.on('context-menu', (e) => {
      e.preventDefault();
    });

    win.webContents.on('before-input-event', (event, input) => {
      const isCmdOrCtrl = input.control || input.meta;
      const isShift = input.shift;
      const key = (input.key || '').toLowerCase();

      // Block F12
      if (key === 'f12') {
        event.preventDefault();
        return;
      }

      // Block Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (isCmdOrCtrl && isShift && (key === 'i' || key === 'j' || key === 'c')) {
        event.preventDefault();
        return;
      }

      // Block Ctrl+U (view source)
      if (isCmdOrCtrl && key === 'u') {
        event.preventDefault();
        return;
      }

      // Block Ctrl+R / F5 (reload) in production
      if (key === 'f5' || (isCmdOrCtrl && key === 'r')) {
        event.preventDefault();
        return;
      }
    });
  }

  // Navigation & External URL Guard (enforced in both dev and production)
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol !== 'file:') {
        event.preventDefault();
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          shell.openExternal(navigationUrl);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (_) {}
    return { action: 'deny' };
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 680,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMinimumSize(1120, 680);

  setupRuntimeSecurity(mainWindow);

  // Prevent decreasing window size below desktop threshold (e.g. via mouse drag or OS tiling)
  mainWindow.on('will-resize', (e, newBounds) => {
    if (newBounds.width < 1120 || newBounds.height < 680) {
      e.preventDefault();
    }
  });

  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [w, h] = mainWindow.getSize();
    if (w < 1120 || h < 680) {
      mainWindow.setSize(Math.max(w, 1120), Math.max(h, 680));
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (splashFinished || !splashWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      await syncEngine.autoRestoreSession();
      setTimeout(() => syncEngine.runFullSync(false), 800);
    } catch (_) {}
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initServices() {
  const dataDir = path.join(app.getPath('userData'), 'LLP_Enterprise');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Initialize SQLite
  db = new LocalDatabase(dataDir);

  // 2. Initialize SafeVault
  vault = new SafeVault(dataDir);

  // 3. Initialize Cloud Sync
  const savedUrl = db.getSetting('supabase_url', DEFAULT_SUPABASE_URL);
  const savedKey = db.getSetting('supabase_anon_key', DEFAULT_SUPABASE_KEY);
  syncEngine = new SyncEngine(db, savedUrl, savedKey);

  // Wire syncEngine events to the renderer
  syncEngine.on('data-changed', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:data-changed', info);
    }
  });

  syncEngine.on('status-changed', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status-changed', status);
    }
  });

  // Restore session and connect real-time
  syncEngine.autoRestoreSession().catch((e) => console.warn('[Main] autoRestoreSession error:', e.message));

  // 4. Initialize License Manager
  licenseMgr = new LicenseManager(vault, syncEngine.client, db);
}



function registerIpcHandlers() {
  // --- Database IPC ---
  ipcMain.handle('db:query', async (_, { sql, params }) => {
    try {
      return { success: true, data: db.query(sql, params || []) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db:getOne', async (_, { sql, params }) => {
    try {
      return { success: true, data: db.getOne(sql, params || []) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db:run', async (_, { sql, params }) => {
    try {
      return { success: true, data: db.run(sql, params || []) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('db:getSetting', async (_, { key, defaultValue }) => {
    return db.getSetting(key, defaultValue);
  });

  ipcMain.handle('db:setSetting', async (_, { key, value }) => {
    db.setSetting(key, value);
    return true;
  });

  ipcMain.handle('db:queueMutation', async (_, { tableName, action, payload }) => {
    db.queueMutation(tableName, action, payload);
    return true;
  });

  // --- Collections & Monthly Rate Manager IPC ---
  ipcMain.handle('collections:getMonthlySummary', async (_, { month, year }) => {
    try {
      return { success: true, data: db.getMonthlyCollectionSummary(month, year) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('collections:updateDailyBulk', async (_, { dateStr, rate, waterPct }) => {
    try {
      return { success: true, data: db.updateDailyBulk(dateStr, rate, waterPct) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('collections:updateRangeBulk', async (_, { month, year, fromDay, toDay, rate, waterPct, excludeSundays }) => {
    try {
      return { success: true, data: db.updateRangeBulk(month, year, fromDay, toDay, rate, waterPct, excludeSundays) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // --- Security & Licensing IPC ---
  ipcMain.handle('security:getMachineId', async () => {
    return getMachineId();
  });

  ipcMain.handle('security:validateLicense', async (_, { licenseKey }) => {
    return await licenseMgr.validateKey(licenseKey);
  });

  ipcMain.handle('security:getLicenseStatus', async () => {
    return licenseMgr.getStatus();
  });

  ipcMain.handle('security:deactivateLicense', async () => {
    return licenseMgr.deactivate();
  });

  ipcMain.handle('security:vaultGet', async (_, { key }) => {
    return vault.get(key);
  });

  ipcMain.handle('security:vaultSet', async (_, { key, value }) => {
    vault.set(key, value);
    return true;
  });

  // --- Thermal Printing IPC ---
  ipcMain.handle('printer:getPrinters', async () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return [];
      return await mainWindow.webContents.getPrintersAsync();
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('printer:printReceipt', async (_, { receiptData, config }) => {
    let printWindow = null;
    try {
      const receiptHtml = ReceiptPrinter.generateReceiptHtml(receiptData, config || {});
      printWindow = new BrowserWindow({
        width: 380,
        height: 800,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      // Wait for the page to fully load before printing
      await new Promise((resolve, reject) => {
        printWindow.webContents.once('did-finish-load', resolve);
        printWindow.webContents.once('did-fail-load', reject);
        printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml)}`);
      });

      // Extra settle time for fonts, layout geometry, and print driver
      await new Promise(r => setTimeout(r, 600));

      return new Promise((resolve) => {
        const printOptions = {
          silent: Boolean(config?.silent),
          printBackground: true,
          pageSize: config?.pageSize || { width: 80000, height: 297000 }, // 80mm thermal
          margins: { marginType: 'none' }
        };

        if (config?.printerName) {
          printOptions.deviceName = config.printerName;
        }

        printWindow.webContents.print(printOptions, (success, failureReason) => {
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.close();
            printWindow = null;
          }
          if (success) {
            resolve({ success: true });
          } else {
            console.error('[Print] Failed:', failureReason);
            resolve({ success: false, error: failureReason });
          }
        });
      });
    } catch (err) {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:printHtml', async (_, { html, config }) => {
    let printWindow = null;
    try {
      printWindow = new BrowserWindow({
        width: 800,
        height: 1000,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      // Wait for full load before printing
      await new Promise((resolve, reject) => {
        printWindow.webContents.once('did-finish-load', resolve);
        printWindow.webContents.once('did-fail-load', reject);
        printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      });

      // Settle delay for layout engine
      await new Promise(r => setTimeout(r, 600));

      return new Promise((resolve) => {
        const printOptions = {
          silent: false,
          printBackground: true,
          pageSize: config?.pageSize || 'A4',
          margins: { marginType: 'printableArea' }
        };
        if (config?.printerName) printOptions.deviceName = config.printerName;

        printWindow.webContents.print(printOptions, (success, reason) => {
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.close();
            printWindow = null;
          }
          resolve({ success, error: reason });
        });
      });
    } catch (err) {
      if (printWindow && !printWindow.isDestroyed()) printWindow.close();
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:exportPdf', async (_, { html, defaultFilename }) => {
    try {
      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      // Allow DOM and fonts to settle
      await new Promise(r => setTimeout(r, 400));

      const pdfBuffer = await printWindow.webContents.printToPDF({
        margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
        pageSize: 'A4',
        printBackground: true,
      });
      printWindow.close();

      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Export Rates Audit Report as PDF',
        defaultPath: defaultFilename || 'Rates_Audit_Report.pdf',
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(filePath, pdfBuffer);
      shell.openPath(filePath);
      return { success: true, filePath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // --- Cloud Sync IPC ---
  ipcMain.handle('sync:triggerSync', async () => {
    return await syncEngine.runFullSync(false);
  });

  ipcMain.handle('sync:smartSync', async (_, { tableName }) => {
    syncEngine.smartSync(tableName);
    return true;
  });

  ipcMain.handle('sync:testConnection', async () => {
    return await syncEngine.testConnection();
  });

  ipcMain.handle('sync:configure', async (_, { url, key }) => {
    db.setSetting('supabase_url', url);
    db.setSetting('supabase_anon_key', key);
    syncEngine.initClient(url, key);
    licenseMgr.setClient(syncEngine.client);
    return true;
  });

  // --- Auth & Account IPC ---
  ipcMain.handle('auth:signIn', async (_, { phone, password }) => {
    const res = await syncEngine.signIn(phone, password);
    if (res && res.success && res.user && res.user.id) {
      db.switchUser(res.user.id);
      syncEngine.initRealtimeSubscription(res.user.id);
      syncEngine.startBackgroundSync(60000);
    }
    return res;
  });

  ipcMain.handle('auth:signUp', async (_, { bizName, phone, password }) => {
    return await syncEngine.signUp(bizName, phone, password);
  });

  ipcMain.handle('auth:checkMobileExists', async (_, { phone }) => {
    return await syncEngine.checkUserExists(phone);
  });

  ipcMain.handle('auth:checkActivation', async (_, { userId }) => {
    return await syncEngine.checkUserActivation(userId);
  });

  ipcMain.handle('auth:verifyActivationKey', async (_, { key, userId }) => {
    return await syncEngine.verifyActivationKey(key, userId);
  });

  ipcMain.handle('auth:getCurrentUser', async () => {
    const uid = db.getSetting('current_app_user_id', '');
    if (!uid) return null;
    const phone = db.getSetting('last_login_username', '');
    const name = db.getSetting('agent_name', '');
    const isAct = db.getSetting('is_activated', '0') === '1';
    return { id: uid, phone, name, isActivated: isAct };
  });

  ipcMain.handle('auth:signOut', async () => {
    db.setSetting('current_app_user_id', '');
    db.setSetting('sb_access_token', '');
    db.setSetting('sb_refresh_token', '');
    syncEngine.stopRealtimeSubscription();
    syncEngine.stopBackgroundSync();
    db.switchUser(null);
    return true;
  });

  // --- Window Control IPC ---
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });

  ipcMain.handle('window:setMode', (_, { mode }) => {
    if (!mainWindow) return;
    if (mode === 'auth') {
      mainWindow.setMinimumSize(1000, 680);
      const [w, h] = mainWindow.getSize();
      if (w < 1000 || h < 680) {
        mainWindow.setSize(1180, 750);
        mainWindow.center();
      }
      mainWindow.setResizable(true);
    } else {
      mainWindow.setMinimumSize(1120, 680);
      const [w, h] = mainWindow.getSize();
      if (w < 1120 || h < 680) {
        mainWindow.setSize(Math.max(w, 1120), Math.max(h, 680));
        mainWindow.center();
      }
      mainWindow.setResizable(true);
    }
  });

  // --- System & Export IPC ---
  ipcMain.handle('system:exportCsv', async (_, { filename, csvData }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export to CSV',
      defaultPath: filename || 'leaf_ledger_report.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });

    if (!canceled && filePath) {
      fs.writeFileSync(filePath, csvData, 'utf8');
      return { success: true, filePath };
    }
    return { success: false, canceled: true };
  });

  ipcMain.handle('system:getAppVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('system:openExternal', async (_, { url }) => {
    shell.openExternal(url);
    return true;
  });

  // --- Splash Screen IPC ---
  ipcMain.handle('splash:finish', () => {
    transitionFromSplash();
    return true;
  });

  // --- Auto-Updater Engine IPC ---
  ipcMain.handle('updater:checkForUpdates', () => {
    checkForUpdates(true);
    return true;
  });
}

function isNewerVersion(current, remote) {
  const cParts = (current || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const rParts = (remote || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(cParts.length, rParts.length); i++) {
    const c = cParts[i] || 0;
    const r = rParts[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

function downloadFile(url, destPath, onProgress, onComplete, onError) {
  const proto = url.startsWith('https') ? https : http;

  function requestUrl(targetUrl) {
    const req = proto.get(targetUrl, { headers: { 'User-Agent': 'Leaf-Ledger-Pro-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return requestUrl(res.headers.location);
      }
      if (res.statusCode !== 200) {
        return onError(new Error(`Server responded with HTTP ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      const file = fs.createWriteStream(destPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = (downloadedBytes / totalBytes) * 100;
          onProgress({
            percent,
            downloadedMB: downloadedBytes / (1024 * 1024),
            totalMB: totalBytes / (1024 * 1024),
          });
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => onComplete(destPath));
      });
    });

    req.on('error', (err) => {
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) {}
      onError(err);
    });
  }

  requestUrl(url);
}

function startUpdateDownload(remoteVersion, downloadUrl) {
  if (!downloadUrl) return;

  const updateWindow = new BrowserWindow({
    width: 480,
    height: 190,
    parent: mainWindow,
    modal: true,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: '#0a100d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  updateWindow.loadFile(path.join(__dirname, 'update.html'), {
    search: `version=${remoteVersion}`,
  });

  updateWindow.once('ready-to-show', () => {
    updateWindow.show();
    const tempFile = path.join(app.getPath('temp'), `LeafLedgerPro_Setup_${remoteVersion}.exe`);

    downloadFile(
      downloadUrl,
      tempFile,
      (progress) => {
        if (!updateWindow.isDestroyed()) {
          updateWindow.webContents.send('updater:progress', progress);
        }
      },
      (filePath) => {
        setTimeout(() => {
          try {
            const child = spawn(filePath, [], { detached: true, stdio: 'ignore' });
            child.unref();
          } catch (e) {
            console.error('[Updater] Failed to execute installer:', e);
          }
          app.exit(0);
        }, 1000);
      },
      (err) => {
        if (!updateWindow.isDestroyed()) updateWindow.close();
        dialog.showErrorBox('Update Download Failed', `Failed to download the update:\n${err.message}`);
      }
    );
  });
}

function checkForUpdates(isManual = false) {
  const options = {
    hostname: 'api.github.com',
    path: '/repos/netrasarma/LeafLedger-Pro-Desktop/releases/latest',
    headers: {
      'User-Agent': 'Leaf-Ledger-Pro-Desktop',
      'Accept': 'application/vnd.github.v3+json',
    },
  };

  https.get(options, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        try {
          const release = JSON.parse(data);
          const currentVersion = app.getVersion();
          const remoteTag = release.tag_name || release.name || '';
          const remoteVersion = remoteTag.replace(/^v/, '');

          if (isNewerVersion(currentVersion, remoteVersion)) {
            const exeAsset = (release.assets || []).find(a => a.name.endsWith('.exe')) || release.assets?.[0];
            const downloadUrl = exeAsset ? exeAsset.browser_download_url : release.html_url;

            dialog.showMessageBox(mainWindow, {
              type: 'info',
              buttons: ['Update Now', 'Later'],
              title: 'Leaf Ledger Pro Update Available',
              message: `A new version of Leaf Ledger Pro (v${remoteVersion}) is available!`,
              detail: release.body || 'This update contains critical improvements and new features.',
              defaultId: 0,
              cancelId: 1,
            }).then((res) => {
              if (res.response === 0 && exeAsset) {
                startUpdateDownload(remoteVersion, downloadUrl);
              } else if (res.response === 0) {
                shell.openExternal(downloadUrl);
              }
            });
          } else if (isManual) {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              buttons: ['OK'],
              title: 'Leaf Ledger Pro Up to Date',
              message: 'You are using the latest version.',
              detail: `Leaf Ledger Pro v${currentVersion} is currently up to date.`,
            });
          }
        } catch (e) {
          if (isManual) dialog.showErrorBox('Update Check Failed', 'Could not parse update release details.');
        }
      } else if (isManual) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['OK'],
          title: 'Update Check',
          message: 'No new updates found.',
          detail: `Leaf Ledger Pro v${app.getVersion()} is the current active version.`,
        });
      }
    });
  }).on('error', (err) => {
    if (isManual) dialog.showErrorBox('Update Connection Error', `Could not connect to update release server:\n${err.message}`);
  });
}

app.whenReady().then(() => {
  initServices();
  registerIpcHandlers();
  createSplashWindow();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      splashFinished = true;
      createMainWindow();
      if (mainWindow) mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
