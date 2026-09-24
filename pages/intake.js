/**
 * Leaf Ledger Pro — Rapid Intake Module
 */
window.intakeModule = {
  todayCollections: [],

  init() {
    this.setDefaultDate();
    this.setupEvents();
    this.loadTodayLog();
    setTimeout(() => document.getElementById('intakePlanterSearch')?.focus(), 150);
  },

  setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    const intakeDateEl = document.getElementById('intakeDate');
    if (intakeDateEl && !intakeDateEl.value) intakeDateEl.value = today;
  },

  setupEvents() {
    const searchInput = document.getElementById('intakePlanterSearch');
    const dropdown = document.getElementById('intakeAutocompleteDropdown');
    const grossInput = document.getElementById('intakeGrossWeight');
    const bagInput = document.getElementById('intakeBagWeight');
    const dedInput = document.getElementById('intakeDedPct');
    const rateInput = document.getElementById('intakeRate');

    if (searchInput && dropdown) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        if (!q) {
          dropdown.style.display = 'none';
          return;
        }

        const matches = app.planters.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.code && p.code.toLowerCase().includes(q)) ||
            (p.phone && p.phone.includes(q)) ||
            (p.village && p.village.toLowerCase().includes(q))
        );

        if (matches.length === 0) {
          dropdown.innerHTML = `<div style="padding: 10px; font-size: 12px; color: var(--text-muted);">No matching planters found</div>`;
          dropdown.style.display = 'block';
          return;
        }

        dropdown.innerHTML = matches
          .slice(0, 8)
          .map(
            (p) => `
          <div class="autocomplete-item" data-id="${p.id}">
            <div>
              <strong>${p.name}</strong>
              ${p.code ? `<span style="color: var(--accent-emerald); font-family: var(--font-mono); margin-left: 6px;">#${p.code}</span>` : ''}
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">${p.village || ''}</div>
          </div>
        `
          )
          .join('');

        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.autocomplete-item').forEach((item) => {
          item.onclick = () => {
            const pid = item.getAttribute('data-id');
            this.selectPlanter(pid);
          };
        });
      });

      document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
          dropdown.style.display = 'none';
        }
      });
    }

    [grossInput, bagInput, dedInput, rateInput].forEach((el) => {
      el?.addEventListener('input', () => this.recalc());
    });

    if (grossInput) {
      grossInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.saveCollection(true);
        }
      });
    }
  },

  selectPlanter(planterId) {
    const p = app.planters.find((item) => item.id === planterId);
    if (!p) return;

    document.getElementById('intakeSelectedPlanterId').value = p.id;
    document.getElementById('intakePlanterSearch').value = `${p.name} ${p.code ? `(#${p.code})` : ''}`;
    document.getElementById('intakeSelectedPlanterDetails').innerText = `✓ ${p.village || ''} (Ded: ${p.default_deduction_pct || 0}%)`;
    document.getElementById('intakeAutocompleteDropdown').style.display = 'none';

    if (Number(p.default_deduction_pct) > 0) {
      document.getElementById('intakeDedPct').value = Number(p.default_deduction_pct).toFixed(1);
    }

    this.recalc();
    document.getElementById('intakeGrossWeight')?.focus();
  },

  addBagTare(kg) {
    const bagInput = document.getElementById('intakeBagWeight');
    const current = parseFloat(bagInput.value || 0);
    bagInput.value = (current + kg).toFixed(2);
    this.recalc();
  },

  clearBagTare() {
    document.getElementById('intakeBagWeight').value = '0.00';
    this.recalc();
  },

  recalc() {
    const gross = parseFloat(document.getElementById('intakeGrossWeight')?.value || 0);
    const bagTare = parseFloat(document.getElementById('intakeBagWeight')?.value || 0);
    const dedPct = parseFloat(document.getElementById('intakeDedPct')?.value || 0);
    const rate = parseFloat(document.getElementById('intakeRate')?.value || 0);

    const weightAfterBag = Math.max(0, gross - bagTare);
    const waterDeduction = (weightAfterBag * dedPct) / 100;
    const netWeight = Math.max(0, weightAfterBag - waterDeduction);
    const totalAmount = netWeight * rate;

    const grossEl = document.getElementById('calcGrossDisplay');
    const dedEl = document.getElementById('calcDedDisplay');
    const netEl = document.getElementById('calcNetDisplay');
    const amountRow = document.getElementById('calcAmountRow');
    const amountEl = document.getElementById('calcAmountDisplay');

    if (grossEl) grossEl.innerText = `${gross.toFixed(2)} kg`;
    if (dedEl) dedEl.innerText = `-${(bagTare + waterDeduction).toFixed(2)} kg`;
    if (netEl) netEl.innerText = `${netWeight.toFixed(2)} KG`;

    if (amountRow && amountEl) {
      if (rate > 0) {
        amountRow.style.display = 'flex';
        amountEl.innerText = `₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else {
        amountRow.style.display = 'none';
      }
    }

    return { gross, bagTare, waterDeduction, netWeight, rate, totalAmount };
  },

  toggleDeductionChip(btn) {
    if (btn) btn.classList.toggle('active');
  },

  async saveCollection(shouldPrint = true) {
    const planterId = document.getElementById('intakeSelectedPlanterId')?.value;
    if (!planterId) {
      app.showToast('Please select a planter first', 'error');
      document.getElementById('intakePlanterSearch')?.focus();
      return;
    }

    const { gross, bagTare, waterDeduction, netWeight, rate, totalAmount } = this.recalc();
    if (gross <= 0) {
      app.showToast('Gross weight must be greater than 0', 'error');
      document.getElementById('intakeGrossWeight')?.focus();
      return;
    }

    const date = document.getElementById('intakeDate')?.value || new Date().toISOString().split('T')[0];
    const collector = document.getElementById('intakeCollector')?.value || 'Agent';
    const id = 'col_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    // Extract active leaf deduction chips (Mobile Parity: Wet leaves, Long Leaves, Hard Leaves)
    const activeChips = Array.from(document.querySelectorAll('#intakeDeductionChips .leaf-chip.active'))
      .map(c => c.getAttribute('data-val') || c.innerText.trim());

    let notes = '';
    if (activeChips.length > 0) {
      notes = `Deductions: [${activeChips.join(', ')}]`;
    }

    const record = {
      id,
      owner_id: planterId,
      date,
      gross_weight_kg: gross,
      bag_weight_kg: bagTare + waterDeduction,
      net_weight_kg: netWeight,
      rate_per_kg: rate,
      amount: totalAmount,
      collector_name: collector,
      notes,
      sync_id: id,
    };

    const res = await window.electronAPI.db.run(
      `INSERT INTO daily_collections (id, owner_id, date, gross_weight_kg, bag_weight_kg, net_weight_kg, rate_per_kg, amount, collector_name, notes, sync_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.owner_id, record.date, record.gross_weight_kg, record.bag_weight_kg, record.net_weight_kg, record.rate_per_kg, record.amount, record.collector_name, record.notes, record.sync_id]
    );

    if (res.success) {
      await window.electronAPI.db.queueMutation('daily_collections', 'INSERT', record);
      app.showToast(`Saved collection: ${netWeight.toFixed(2)} KG for Planter`, 'success');

      const planter = app.planters.find((p) => p.id === planterId);
      const receiptData = {
        id,
        date,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        planterName: planter ? planter.name : 'Tea Grower',
        planterCode: planter ? planter.code : '',
        planterPhone: planter ? planter.phone : '',
        grossWeight: gross,
        bagDeduction: bagTare,
        waterDeduction: waterDeduction,
        netWeight: netWeight,
        rate: rate,
        totalAmount: totalAmount,
        collectorName: collector,
        notes: notes,
      };

      if (shouldPrint) {
        app.previewAndPrintReceipt(receiptData);
      }

      // Reset
      document.getElementById('intakeGrossWeight').value = '';
      document.getElementById('intakeBagWeight').value = '0.00';
      document.querySelectorAll('#intakeDeductionChips .leaf-chip').forEach(c => c.classList.remove('active'));
      this.recalc();
      this.loadTodayLog();

      setTimeout(() => document.getElementById('intakePlanterSearch')?.focus(), 150);
    } else {
      app.showToast('Database error: ' + res.error, 'error');
    }
  },

  async loadTodayLog() {
    const today = document.getElementById('intakeDate')?.value || new Date().toISOString().split('T')[0];
    const tbody = document.getElementById('intakeTodayLogTable');
    if (tbody) tbody.innerHTML = app.getLoadingStateTableRow(6, 'Loading daily collections...');

    const res = await window.electronAPI.db.query(
      `SELECT c.*, o.name as planter_name, o.code as planter_code
       FROM daily_collections c
       LEFT JOIN owners o ON c.owner_id = o.id
       WHERE c.date = ?
       ORDER BY c.created_at DESC`,
      [today]
    );

    this.todayCollections = res.data || [];
    this.filterIntakeLog();
  },

  filterIntakeLog() {
    const q = (document.getElementById('intakeLogFilter')?.value || '').toLowerCase().trim();
    const tbody = document.getElementById('intakeTodayLogTable');
    if (!tbody) return;

    const filtered = this.todayCollections.filter(
      (c) =>
        !q ||
        (c.planter_name && c.planter_name.toLowerCase().includes(q)) ||
        (c.planter_code && c.planter_code.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      tbody.innerHTML = app.getEmptyStateTableRow(6, {
        title: 'No Collections Found',
        message: q ? 'No matching collections match your search filter.' : 'No collections recorded for this date.'
      });
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (c) => {
          let dedBadges = '';
          const rowNotes = c.notes || '';
          if (rowNotes.includes('Deductions: [')) {
            const dedContent = rowNotes.split('Deductions: [')[1].split(']')[0];
            const tags = dedContent.split(', ');
            dedBadges = tags.map(t => {
              const tClean = t.trim();
              let cls = 'long';
              let icon = '<i class="fa-solid fa-leaf"></i>';
              if (tClean.toLowerCase().includes('wet')) { cls = 'wet'; icon = '<i class="fa-solid fa-droplet"></i>'; }
              else if (tClean.toLowerCase().includes('hard')) { cls = 'hard'; icon = '<i class="fa-solid fa-shield-halved"></i>'; }
              return `<span class="deduction-pill ${cls}" style="font-size: 10px; padding: 1px 6px;">${icon} ${tClean}</span>`;
            }).join(' ');
          }

          return `
      <tr>
        <td class="mono">${new Date(c.created_at || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>
          <div class="font-bold">${c.planter_name || 'Planter'}</div>
          ${dedBadges ? `<div style="margin-top: 2px;">${dedBadges}</div>` : ''}
        </td>
        <td class="mono">${Number(c.gross_weight_kg).toFixed(2)}</td>
        <td class="mono">-${Number(c.bag_weight_kg).toFixed(2)}</td>
        <td class="mono font-bold" style="color: var(--accent-emerald);">${Number(c.net_weight_kg).toFixed(2)}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick='app.reprintCollection(${JSON.stringify(c)})'>Print</button>
        </td>
      </tr>
    `;
        }
      )
      .join('');
  },
};
