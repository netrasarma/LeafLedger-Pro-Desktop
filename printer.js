/**
 * Leaf Ledger Pro - ESC/POS & HTML Thermal Receipt Generator
 * Compatible with 58mm and 80mm thermal receipt printers
 * Also supports A5 and A4 inkjet/laser print layouts
 */

class ReceiptPrinter {
  static formatCurrency(num) {
    return '₹' + Number(num || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /**
   * Generate receipt HTML for the given format.
   * @param {object} receiptData
   * @param {object} config  - { format: 'thermal58'|'thermal80'|'a5'|'a4', agentName, agentPhone, agentLocation, signatureDataUrl, authorityName }
   */
  static generateReceiptHtml(receiptData, config = {}) {
    const {
      agentName = 'LEAF LEDGER PRO',
      agentPhone = '',
      agentLocation = '',
      signatureDataUrl = '',
      authorityName = '',
      // Legacy width support; derive format from it
      width,
      format: _format,
    } = config;

    // Resolve format — prefer explicit `format`, fall back to `width`
    let format = _format;
    if (!format) {
      if (width === '80mm') format = 'thermal80';
      else if (width === 'A4') format = 'a4';
      else if (width === 'A5') format = 'a5';
      else format = 'thermal58';
    }

    const isThermal = format === 'thermal58' || format === 'thermal80';
    return isThermal
      ? ReceiptPrinter._thermalHtml(receiptData, { agentName, agentPhone, agentLocation, signatureDataUrl, authorityName, format })
      : ReceiptPrinter._documentHtml(receiptData, { agentName, agentPhone, agentLocation, signatureDataUrl, authorityName, format });
  }

  // ─────────────────────────────────────────────────────────────────────
  // THERMAL LAYOUT (58mm / 80mm) — monospaced, compact
  // ─────────────────────────────────────────────────────────────────────
  static _thermalHtml(receiptData, cfg) {
    const { agentName, agentPhone, agentLocation, signatureDataUrl, authorityName, format } = cfg;
    const is80 = format === 'thermal80';
    const w = is80 ? '72mm' : '52mm';
    const fs = is80 ? '12px' : '11px';
    const titleFs = is80 ? '15px' : '13px';

    const {
      id = '', date = '', time = '',
      planterName = '', planterCode = '', planterPhone = '',
      grossWeight = 0, bagDeduction = 0, waterDeduction = 0,
      otherDeduction = 0, netWeight = 0, rate = 0, totalAmount = 0,
      collectorName = '', notes = ''
    } = receiptData;

    const totalDeductions = Number(bagDeduction || 0) + Number(waterDeduction || 0) + Number(otherDeduction || 0);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${id}</title>
  <style>
    @page { margin: 0; size: auto; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fs};
      line-height: 1.35;
      margin: 0 auto;
      padding: 8px 6px;
      color: #000;
      background: #fff;
      width: ${w};
      max-width: 100%;
      box-sizing: border-box;
    }
    .text-center { text-align: center; }
    .bold { font-weight: bold; }
    .header { margin-bottom: 8px; border-bottom: 1px dashed #000; padding-bottom: 6px; }
    .agent-title { font-size: ${titleFs}; font-weight: bold; letter-spacing: 0.5px; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .double-divider { border-top: 2px solid #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; }
    .val { font-weight: bold; }
    .highlight { font-size: ${is80 ? '14px' : '12px'}; font-weight: 900; }
    .footer { margin-top: 8px; border-top: 1px dashed #000; padding-top: 6px; font-size: 8px; text-align: center; }
  </style>
</head>
<body>
  <div class="header text-center">
    <div class="agent-title">${agentName.toUpperCase()}</div>
    ${agentLocation ? `<div>${agentLocation}</div>` : ''}
    ${agentPhone ? `<div>Ph: ${agentPhone}</div>` : ''}
    <div style="margin-top: 3px; font-size: 8px; text-transform: uppercase;">TEA LEAF INTAKE RECEIPT</div>
  </div>

  <div class="row"><span>Date/Time:</span><span class="val">${date} ${time}</span></div>
  <div class="row"><span>Receipt No:</span><span class="val">${String(id).slice(-8).toUpperCase()}</span></div>
  ${collectorName ? `<div class="row"><span>Collector:</span><span class="val">${collectorName}</span></div>` : ''}

  <div class="divider"></div>

  <div class="row"><span>Planter:</span><span class="val bold">${planterName}</span></div>
  ${planterCode ? `<div class="row"><span>Code:</span><span class="val">#${planterCode}</span></div>` : ''}
  ${planterPhone ? `<div class="row"><span>Phone:</span><span class="val">${planterPhone}</span></div>` : ''}

  <div class="divider"></div>

  <div class="row"><span>Gross Weight:</span><span class="val">${Number(grossWeight).toFixed(2)} kg</span></div>
  ${Number(bagDeduction) > 0 ? `<div class="row"><span>Bag Tare:</span><span class="val">-${Number(bagDeduction).toFixed(2)} kg</span></div>` : ''}
  ${Number(waterDeduction) > 0 ? `<div class="row"><span>Water Ded:</span><span class="val">-${Number(waterDeduction).toFixed(2)} kg</span></div>` : ''}
  ${Number(otherDeduction) > 0 ? `<div class="row"><span>Other Ded:</span><span class="val">-${Number(otherDeduction).toFixed(2)} kg</span></div>` : ''}
  ${totalDeductions > 0 ? `<div class="row"><span>Total Ded:</span><span class="val">-${totalDeductions.toFixed(2)} kg</span></div>` : ''}

  <div class="double-divider"></div>

  <div class="row highlight"><span>NET WEIGHT:</span><span>${Number(netWeight).toFixed(2)} KG</span></div>

  ${Number(rate) > 0 ? `
  <div class="row" style="margin-top:4px;"><span>Rate / Kg:</span><span class="val">₹${Number(rate).toFixed(2)}</span></div>
  <div class="row highlight" style="margin-top:4px;"><span>EST. AMOUNT:</span><span>${ReceiptPrinter.formatCurrency(totalAmount)}</span></div>
  ` : `<div class="text-center" style="margin:4px 0;font-size:8px;color:#555;">[Monthly Rate Settlement Pending]</div>`}

  ${notes ? `<div class="divider"></div><div style="font-size:8px;">Note: ${notes}</div>` : ''}

  <div class="footer">
    <div>Thank you for supplying quality leaf!</div>
    ${signatureDataUrl ? `
    <div style="margin-top:10px;margin-bottom:2px;">
      <img src="${signatureDataUrl}" style="max-height:36px;max-width:100%;object-fit:contain;" alt="Signature">
    </div>
    <div style="border-top:1px solid #000;padding-top:3px;font-size:8px;font-weight:bold;">
      ${authorityName || 'Authorised Signatory'}
    </div>` : ''}
    <div style="margin-top:4px;">Leaf Ledger Pro &bull; Verified Digital Entry</div>
  </div>
</body>
</html>`;
  }

  // ─────────────────────────────────────────────────────────────────────
  // DOCUMENT LAYOUT (A5 / A4) — professional, inkjet/laser
  // ─────────────────────────────────────────────────────────────────────
  static _documentHtml(receiptData, cfg) {
    const { agentName, agentPhone, agentLocation, signatureDataUrl, authorityName, format } = cfg;
    const isA4 = format === 'a4';
    const pageSize = isA4 ? 'A4' : 'A5';
    const fontSize = isA4 ? '13px' : '11.5px';
    const titleSize = isA4 ? '22px' : '18px';
    const subtitleSize = isA4 ? '11px' : '10px';

    const {
      id = '', date = '', time = '',
      planterName = '', planterCode = '', planterPhone = '',
      grossWeight = 0, bagDeduction = 0, waterDeduction = 0,
      otherDeduction = 0, netWeight = 0, rate = 0, totalAmount = 0,
      collectorName = '', notes = ''
    } = receiptData;

    const totalDeductions = Number(bagDeduction || 0) + Number(waterDeduction || 0) + Number(otherDeduction || 0);
    const receiptNo = String(id).slice(-8).toUpperCase();

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Leaf Receipt - ${receiptNo}</title>
  <style>
    @page { size: ${pageSize}; margin: 12mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: ${fontSize};
      color: #1a1a1a;
      background: #fff;
      line-height: 1.5;
      padding: ${isA4 ? '36px 40px' : '24px 26px'};
    }
    @media print {
      body { padding: 0 !important; }
    }

    /* Header */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 12px;
      border-bottom: 3px solid #166534;
      margin-bottom: 16px;
    }
    .biz-name {
      font-size: ${titleSize};
      font-weight: 900;
      color: #166534;
      letter-spacing: -0.5px;
      margin-bottom: 3px;
    }
    .biz-sub { font-size: ${subtitleSize}; color: #555; }
    .receipt-badge {
      text-align: right;
    }
    .receipt-label {
      font-size: ${subtitleSize};
      font-weight: 700;
      color: #166534;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .receipt-no {
      font-size: ${isA4 ? '20px' : '16px'};
      font-weight: 900;
      color: #1a1a1a;
      font-family: 'Courier New', monospace;
    }
    .receipt-date { font-size: ${subtitleSize}; color: #555; margin-top: 2px; }

    /* Info Row */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 16px;
    }
    .info-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 10px 14px;
    }
    .info-box-label {
      font-size: ${subtitleSize};
      font-weight: 700;
      color: #166534;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 3px;
    }
    .info-box-value {
      font-size: ${isA4 ? '15px' : '13px'};
      font-weight: 700;
      color: #1a1a1a;
    }

    /* Weight Table */
    .wt-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .wt-table th {
      background: #166534;
      color: #fff;
      font-size: ${subtitleSize};
      font-weight: 700;
      text-transform: uppercase;
      padding: 7px 12px;
      text-align: left;
      letter-spacing: 0.4px;
    }
    .wt-table td {
      padding: 7px 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: ${fontSize};
    }
    .wt-table tr:last-child td { border-bottom: none; }
    .wt-table tr:nth-child(even) td { background: #f9fafb; }
    .wt-table .ded-row td { color: #dc2626; }
    .total-row td {
      background: #f0fdf4 !important;
      font-weight: 900;
      font-size: ${isA4 ? '16px' : '14px'};
      color: #166534;
      border-top: 2px solid #166534;
    }

    /* Amount Box */
    .amount-box {
      background: #166534;
      color: #fff;
      border-radius: 8px;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .amount-label { font-size: ${subtitleSize}; font-weight: 700; opacity: 0.85; text-transform: uppercase; }
    .amount-value { font-size: ${isA4 ? '26px' : '22px'}; font-weight: 900; font-family: 'Courier New', monospace; }

    /* Notes */
    .notes-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: ${subtitleSize};
      color: #92400e;
      margin-bottom: 16px;
    }

    /* Footer / Signature */
    .doc-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 12px;
      border-top: 1px solid #d1fae5;
      margin-top: 8px;
    }
    .footer-note { font-size: ${subtitleSize}; color: #6b7280; }
    .sig-block { text-align: center; }
    .sig-img { max-height: ${isA4 ? '56px' : '44px'}; max-width: 160px; object-fit: contain; margin-bottom: 3px; display: block; margin: 0 auto 3px; }
    .sig-line { border-top: 1.5px solid #1a1a1a; width: 160px; margin: 0 auto 3px; }
    .sig-name { font-size: ${subtitleSize}; font-weight: 700; color: #1a1a1a; }
    .sig-title { font-size: 9px; color: #555; }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="doc-header">
    <div>
      <div class="biz-name">${agentName}</div>
      ${agentLocation ? `<div class="biz-sub">📍 ${agentLocation}</div>` : ''}
      ${agentPhone ? `<div class="biz-sub">📞 ${agentPhone}</div>` : ''}
    </div>
    <div class="receipt-badge">
      <div class="receipt-label">Leaf Intake Receipt</div>
      <div class="receipt-no">#${receiptNo}</div>
      <div class="receipt-date">${date}${time ? ' &nbsp;|&nbsp; ' + time : ''}</div>
    </div>
  </div>

  <!-- PLANTER & COLLECTOR INFO -->
  <div class="info-grid">
    <div class="info-box">
      <div class="info-box-label">Garden Owner / Planter</div>
      <div class="info-box-value">${planterName || '—'}</div>
      ${planterCode ? `<div style="font-size:${subtitleSize};color:#555;">Code: #${planterCode}</div>` : ''}
      ${planterPhone ? `<div style="font-size:${subtitleSize};color:#555;">Ph: ${planterPhone}</div>` : ''}
    </div>
    <div class="info-box">
      <div class="info-box-label">Collection Details</div>
      ${collectorName ? `<div style="font-size:${subtitleSize};color:#555;">Collector: <strong>${collectorName}</strong></div>` : ''}
      <div style="font-size:${subtitleSize};color:#555;">Date: <strong>${date}</strong></div>
      ${time ? `<div style="font-size:${subtitleSize};color:#555;">Time: <strong>${time}</strong></div>` : ''}
    </div>
  </div>

  <!-- WEIGHT BREAKDOWN TABLE -->
  <table class="wt-table">
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right;">Weight (kg)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Gross Weight Collected</td>
        <td style="text-align:right;font-family:'Courier New',monospace;font-weight:700;">${Number(grossWeight).toFixed(2)} kg</td>
      </tr>
      ${Number(bagDeduction) > 0 ? `<tr class="ded-row">
        <td>(-) Bag / Container Tare</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">-${Number(bagDeduction).toFixed(2)} kg</td>
      </tr>` : ''}
      ${Number(waterDeduction) > 0 ? `<tr class="ded-row">
        <td>(-) Water / Moisture Deduction</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">-${Number(waterDeduction).toFixed(2)} kg</td>
      </tr>` : ''}
      ${Number(otherDeduction) > 0 ? `<tr class="ded-row">
        <td>(-) Other Deduction</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">-${Number(otherDeduction).toFixed(2)} kg</td>
      </tr>` : ''}
      <tr class="total-row">
        <td>NET WEIGHT (Payable)</td>
        <td style="text-align:right;font-family:'Courier New',monospace;">${Number(netWeight).toFixed(2)} kg</td>
      </tr>
    </tbody>
  </table>

  <!-- AMOUNT BLOCK -->
  ${Number(rate) > 0 ? `
  <div class="amount-box">
    <div>
      <div class="amount-label">Rate per kg</div>
      <div style="font-size:${isA4 ? '18px' : '15px'};font-weight:800;font-family:'Courier New',monospace;">₹${Number(rate).toFixed(2)}</div>
    </div>
    <div style="text-align:right;">
      <div class="amount-label">Estimated Amount Payable</div>
      <div class="amount-value">${ReceiptPrinter.formatCurrency(totalAmount)}</div>
    </div>
  </div>` : `
  <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:${subtitleSize};color:#64748b;text-align:center;">
    Monthly rate settlement pending — amount will be finalised at month-end
  </div>`}

  <!-- NOTES -->
  ${notes ? `<div class="notes-box">📝 <strong>Note:</strong> ${notes}</div>` : ''}

  <!-- FOOTER -->
  <div class="doc-footer">
    <div class="footer-note">
      <div style="font-weight:700;color:#166534;">Leaf Ledger Pro</div>
      <div>Verified Digital Entry &bull; Thank you!</div>
      <div style="margin-top:4px;font-size:9px;">This is a computer-generated document.</div>
    </div>
    <div class="sig-block">
      ${signatureDataUrl ? `<img src="${signatureDataUrl}" class="sig-img" alt="Signature">` : `<div style="height:${isA4 ? '56px' : '44px'};"></div>`}
      <div class="sig-line"></div>
      <div class="sig-name">${authorityName || 'Authorised Signatory'}</div>
      <div class="sig-title">Authorised Agent</div>
    </div>
  </div>

</body>
</html>`;
  }

  /** Electron page size config per format */
  static getPageSizeConfig(format) {
    switch (format) {
      case 'thermal80': return { width: 80000, height: 297000 }; // microns: 80mm wide
      case 'a5':        return 'A5';
      case 'a4':        return 'A4';
      default:          return { width: 58000, height: 297000 }; // 58mm
    }
  }
}

module.exports = { ReceiptPrinter };
