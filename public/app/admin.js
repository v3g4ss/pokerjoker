// ====================== Poker Joker - Admin Dashboard ======================
(async function () {

  // === API Helper ===
  async function api(url, opt = {}) {
    const res = await fetch('/api' + url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opt
    });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  }

  // === KPIs ===
  async function loadStats() {
    try {
      const stats = await api('/admin/stats');
      const set = (sel, val) => {
        const el = document.querySelector(sel);
        if (el) el.textContent = val ?? 0;
      };
      set('#statCustomers', stats.customers);
      set('#statAdmins', stats.admins);
      set('#statEmails', stats.emails);
      set('#statEmailsNew', stats.newEmails);
      set('#statTokensBuyins', stats.tokens_buyin);
      set('#statTokensAdmin', stats.tokens_admin);
      set('#statTokensLive', stats.tokens_live);
    } catch (e) {
      console.error('Fehler bei loadStats:', e);
    }
  }

  // === Users ===
  async function loadUsers() {
    try {
      const data = await api('/admin/users');
      const users = Array.isArray(data) ? data : (data.users || []);
      const tbody = document.querySelector('#usersTableBody');
      if (!tbody) return;
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${u.name || ''}</td>
          <td>${u.email || ''}</td>
          <td>${u.tokens ?? 0}</td>
          <td>${u.role || ''}</td>
          <td>${u.created_at ? new Date(u.created_at).toLocaleString() : ''}</td>
        </tr>`).join('');
    } catch (e) {
      console.error('Fehler bei loadUsers:', e);
    }
  }

  // === Letzte 200 Ledger ===
  async function loadLedger200() {
    try {
      const data = await api('/admin/ledger200'); // <-- dein alter funktionierender Pfad
      const rows = Array.isArray(data) ? data : (data.ledger || []);
      const tbody = document.querySelector('#ledgerTableBody');
      if (!tbody) return;
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${r.user_id}</td>
          <td class="${r.delta >= 0 ? 'text-green' : 'text-red'}">${r.delta}</td>
          <td>${r.reason || ''}</td>
          <td>${r.balance_after ?? ''}</td>
          <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
        </tr>`).join('');
    } catch (e) {
      console.error('Fehler bei loadLedger200:', e);
    }
  }

  // === User Ledger (mit Blättern) ===
  let ledgerPage = 1;
  const ledgerLimit = 10;
  let ledgerTotal = 0;

  async function loadUserLedger(page = 1) {
    try {
      const data = await api(`/admin/user-ledger?page=${page}&limit=${ledgerLimit}`); // alter Pfad!
      const rows = Array.isArray(data.rows) ? data.rows : [];
      ledgerTotal = data.total || 0;
      const tbody = document.querySelector('#ledgerTableBodyUser');
      if (!tbody) return;

      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${r.email || ''}</td>
          <td class="${r.delta >= 0 ? 'text-green' : 'text-red'}">${r.delta}</td>
          <td>${r.reason || ''}</td>
          <td>${r.balance_after ?? ''}</td>
          <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
        </tr>`).join('');

      const info = document.getElementById('ledgerInfo');
      if (info) {
        const start = (page - 1) * ledgerLimit + 1;
        const end = Math.min(page * ledgerLimit, ledgerTotal);
        info.textContent = `Einträge ${start}-${end} von ${ledgerTotal}`;
      }

      document.getElementById('ledgerPrev').disabled = page <= 1;
      document.getElementById('ledgerNext').disabled = page * ledgerLimit >= ledgerTotal;
    } catch (e) {
      console.error('Fehler bei loadUserLedger:', e);
    }
  }

  // === Prompt Playground ===
  async function loadPromptSettings() {
    try {
      const data = await api('/admin/prompt');
      document.querySelector('#promptText').value = data.prompt || '';
      document.querySelector('#punctRate').value = data.punct_rate || 1;
      document.querySelector('#maxUsedTokens').value = data.max_usedtokens_per_msg || 500;
    } catch (e) {
      console.error('Fehler bei loadPromptSettings:', e);
    }
  }

  // === Untermenüs ===
  async function loadMenuItems() {
    try {
      const data = await api('/admin-menu/items'); // wieder alter Pfad
      const items = Array.isArray(data) ? data : (data.items || []);
      const tbody = document.querySelector('#menuItemsTableBody');
      if (!tbody) return;
      tbody.innerHTML = items.map(i => `
        <tr>
          <td>${i.id}</td>
          <td>${i.title || ''}</td>
          <td>${i.location || ''}</td>
          <td>${i.created_at ? new Date(i.created_at).toLocaleString() : ''}</td>
        </tr>`).join('');
    } catch (e) {
      console.error('Fehler bei loadMenuItems:', e);
    }
  }

  // === Eventlistener für Blätterbuttons ===
  document.getElementById('ledgerPrev')?.addEventListener('click', () => {
    if (ledgerPage > 1) {
      ledgerPage--;
      loadUserLedger(ledgerPage);
    }
  });

  document.getElementById('ledgerNext')?.addEventListener('click', () => {
    if (ledgerPage * ledgerLimit < ledgerTotal) {
      ledgerPage++;
      loadUserLedger(ledgerPage);
    }
  });

  document.getElementById('ledgerLoadBtn')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('ledgerUserId').value);
    ledgerPage = val > 0 ? val : 1;
    loadUserLedger(ledgerPage);
  });

  // === Initial-Load ===
  await loadStats();
  await loadUsers();
  await loadLedger200();
  await loadUserLedger();
  await loadPromptSettings();
  await loadMenuItems();

})();
