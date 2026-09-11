/**
 * Leaf Ledger Pro - Electron Security Fuses (afterPack hook)
 * Hardens the binary flags at the native executable level.
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('node:path');
const fs = require('node:fs');

module.exports = async function applyFuses(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const productName = packager.appInfo.productFilename || 'Leaf Ledger Pro';

  let executablePath;
  if (electronPlatformName === 'darwin') {
    executablePath = path.join(
      appOutDir,
      `${productName}.app`,
      'Contents',
      'MacOS',
      productName
    );
  } else if (electronPlatformName === 'win32') {
    executablePath = path.join(appOutDir, `${productName}.exe`);
  } else {
    executablePath = path.join(appOutDir, productName);
  }

  if (!fs.existsSync(executablePath)) {
    console.warn(`[Fuses] Executable not found at ${executablePath}, skipping fuses.`);
    return;
  }

  console.log(`[Fuses] Flipping Electron security fuses for: ${executablePath}`);

  try {
    await flipFuses(executablePath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log('[Fuses] Successfully applied all security fuses!');
  } catch (err) {
    console.error('[Fuses] Error applying fuses:', err);
    throw err;
  }
};
