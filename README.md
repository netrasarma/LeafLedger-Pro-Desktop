# Leaf Ledger Pro — Enterprise Desktop Suite

Executive enterprise desktop application for tea leaf agencies and tea collection management, built on Electron with SQLite local-first storage and Supabase real-time cloud synchronization.

---

## Key Features

- **Local-First Architecture**: Lightning-fast local SQLite database with automatic background synchronization to Supabase.
- **Enterprise Security**:
  - Binary hardening with Electron Security Fuses (`@electron/fuses`).
  - Dynamic 32-byte Cyclic XOR secrets obfuscation.
  - Production DevTools, context-menu, and inspection lockout.
  - Anti-Clock-Tampering DRM with hardware fingerprinting.
  - Dual-tier X.509 code-signing certificate chain.
- **Automated In-App Updates**:
  - Built-in updater with progress modal (`update.html`) comparing releases via GitHub API.
  - Automatic download and silent background installation.
- **Full Tea Ledger Operations**:
  - Daily Garden Intakes & Grower Ledgers.
  - Advance Management & Chemical Advance Redirection.
  - Factory Delivery Logs & Transit Reconciliation.
  - Printable Statements & Thermal Receipt Printing.

---

## Development

```bash
# Install dependencies
npm install

# Start in development mode
npm start

# Generate dynamic secrets
npm run generate:secrets

# Generate code-signing certificates
npm run generate:cert

# Test protected build pipeline
npm run build:secure
```

---

## Automated CI/CD & Releases

Pushing a version tag triggers the GitHub Actions workflow to build, sign, and publish the Windows installer:

```bash
git tag v2.0.8
git push origin v2.0.8
```
