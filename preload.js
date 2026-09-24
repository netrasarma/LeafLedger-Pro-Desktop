/**
 * Leaf Ledger Pro - Secure Preload Bridge
 * Context Isolation Bridge exposing hardened APIs to Renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Database Operations
  db: {
    query: (sql, params) => ipcRenderer.invoke('db:query', { sql, params }),
    getOne: (sql, params) => ipcRenderer.invoke('db:getOne', { sql, params }),
    run: (sql, params) => ipcRenderer.invoke('db:run', { sql, params }),
    getSetting: (key, defaultValue) => ipcRenderer.invoke('db:getSetting', { key, defaultValue }),
    setSetting: (key, value) => ipcRenderer.invoke('db:setSetting', { key, value }),
    queueMutation: (tableName, action, payload) => ipcRenderer.invoke('db:queueMutation', { tableName, action, payload }),
  },

  // User Authentication & Registration (Matching Python Desktop App)
  auth: {
    signIn: (phone, password) => ipcRenderer.invoke('auth:signIn', { phone, password }),
    signUp: (bizName, phone, password) => ipcRenderer.invoke('auth:signUp', { bizName, phone, password }),
    checkMobileExists: (phone) => ipcRenderer.invoke('auth:checkMobileExists', { phone }),
    checkActivation: (userId) => ipcRenderer.invoke('auth:checkActivation', { userId }),
    verifyActivationKey: (key, userId) => ipcRenderer.invoke('auth:verifyActivationKey', { key, userId }),
    getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
    signOut: () => ipcRenderer.invoke('auth:signOut'),
  },

  // Collections & Monthly Rate Manager
  collections: {
    getMonthlySummary: (month, year) => ipcRenderer.invoke('collections:getMonthlySummary', { month, year }),
    updateDailyBulk: (dateStr, rate, waterPct) => ipcRenderer.invoke('collections:updateDailyBulk', { dateStr, rate, waterPct }),
    updateRangeBulk: (month, year, fromDay, toDay, rate, waterPct, excludeSundays) =>
      ipcRenderer.invoke('collections:updateRangeBulk', { month, year, fromDay, toDay, rate, waterPct, excludeSundays }),
  },

  // Security & Licensing
  security: {
    getMachineId: () => ipcRenderer.invoke('security:getMachineId'),
    validateLicense: (licenseKey) => ipcRenderer.invoke('security:validateLicense', { licenseKey }),
    getLicenseStatus: () => ipcRenderer.invoke('security:getLicenseStatus'),
    deactivateLicense: () => ipcRenderer.invoke('security:deactivateLicense'),
    vaultGet: (key) => ipcRenderer.invoke('security:vaultGet', { key }),
    vaultSet: (key, value) => ipcRenderer.invoke('security:vaultSet', { key, value }),
  },

  // Thermal Printing
  printer: {
    printReceipt: (receiptData, config) => ipcRenderer.invoke('printer:printReceipt', { receiptData, config }),
    printHtml: (html, config) => ipcRenderer.invoke('printer:printHtml', { html, config }),
    exportPdf: (html, defaultFilename) => ipcRenderer.invoke('printer:exportPdf', { html, defaultFilename }),
    getPrinters: () => ipcRenderer.invoke('printer:getPrinters'),
  },

  // Cloud Sync
  sync: {
    triggerSync: () => ipcRenderer.invoke('sync:triggerSync'),
    smartSync: (tableName) => ipcRenderer.invoke('sync:smartSync', { tableName }),
    testConnection: () => ipcRenderer.invoke('sync:testConnection'),
    configure: (url, key) => ipcRenderer.invoke('sync:configure', { url, key }),
    getMobileAppInfo: () => ipcRenderer.invoke('sync:getMobileAppInfo'),
    onDataChanged: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('sync:data-changed', handler);
      return () => ipcRenderer.removeListener('sync:data-changed', handler);
    },
    onSyncStatus: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('sync:status-changed', handler);
      return () => ipcRenderer.removeListener('sync:status-changed', handler);
    },
  },

  // Window Controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setMode: (mode) => ipcRenderer.invoke('window:setMode', { mode }),
  },

  // Splash Window
  splash: {
    finish: () => ipcRenderer.invoke('splash:finish'),
  },

  // Auto-Update Engine
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    onUpdateProgress: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('updater:progress', handler);
      return () => ipcRenderer.removeListener('updater:progress', handler);
    },
  },

  // Utility & Export
  system: {
    exportCsv: (filename, csvData) => ipcRenderer.invoke('system:exportCsv', { filename, csvData }),
    getAppVersion: () => ipcRenderer.invoke('system:getAppVersion'),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', { url }),
  },
});
