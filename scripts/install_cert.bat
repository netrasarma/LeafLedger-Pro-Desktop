@echo off
:: Leaf Ledger Pro - One-Click Root CA Installer for Windows
:: Installs the Leaf Ledger Pro Root CA into Trusted Root Certification Authorities
:: to permanently eliminate SmartScreen "Unknown Publisher" warnings.

echo ========================================================
echo    Leaf Ledger Pro - Trusted Certificate Installer
echo ========================================================
echo.

set CERT_FILE=%~dp0..\leaf_ledger_root_ca.cer
if not exist "%CERT_FILE%" (
    set CERT_FILE=%~dp0leaf_ledger_root_ca.cer
)

if not exist "%CERT_FILE%" (
    echo [ERROR] Certificate file 'leaf_ledger_root_ca.cer' not found!
    echo Please make sure leaf_ledger_root_ca.cer is placed beside this script.
    pause
    exit /b 1
)

echo [INSTALL] Adding Leaf Ledger Pro Root CA to Trusted Root Store...
certutil -addstore -f "ROOT" "%CERT_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo [SUCCESS] Leaf Ledger Pro Certificate installed successfully!
    echo Windows SmartScreen and Security warnings are now resolved.
    echo ========================================================
) else (
    echo.
    echo [ERROR] Installation failed. Please right-click and 'Run as Administrator'.
)

echo.
pause
