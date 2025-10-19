// ====================== Poker Joker - Admin Dashboard ======================
(async function () {

  // --- API Helper ---
  const api = async (url, opt = {}) => {
    const res = await fetch('/api' + url, { credentials: 'include', ...opt });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  };

  // --- KPIs laden ---
  async function loadStats() {
    try {
      const { stats } = await api('/admin/stats');
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
    } catch (err) {
      console.error('Fehler bei loadStats:', err);
    }
  }

  // --- Users laden ---
  async function loadUsers(page = 1, limit = 10) {
    try {
      const data = await api(`/admin/users?page=${page}&limit=${limit}`);
      const users = Array.isArray(data) ? data : (data.users || []);
      const tbody = document.querySelector('#usersTableBody');
      if (!tbody) return;
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${u.name || '-'}</td>
          <td>${u.email || '-'}</td>
          <td>${u.tokens || 0}</td>
          <td>${u.role || '-'}</td>
          <td>${u.created_at ? new Date(u.created_at).toLocaleString() : ''}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Fehler bei loadUsers:', err);
    }
  }

  // --- Letzte 200 Ledger laden ---
  async function loadLedger() {
    try {
      // const data = await api('/admin/ledger?limit=200');
      const data = await api('/admin/ledger-last200');
      const ledger = Array.isArray(data) ? data : (data.ledger || []);
      const tbody = document.querySelector('#ledgerTableBody');
      if (!tbody) return;
      tbody.innerHTML = ledger.map(l => `
        <tr>
          <td>${l.id}</td>
          <td>${l.user_id}</td>
          <td class="${l.delta >= 0 ? 'text-green' : 'text-red'}">${l.delta}</td>
          <td>${l.reason || ''}</td>
          <td>${l.balance_after || ''}</td>
          <td>${l.created_at ? new Date(l.created_at).toLocaleString() : ''}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Fehler bei loadLedger:', err);
    }
  }

  // --- User-Ledger (mit Paging) ---
  let ledgerPage = 1;
  const ledgerLimit = 10;
  let ledgerTotal = 0;

  async function loadUserLedger(page = 1) {
    try {
      // const data = await api(`/admin/user-ledger?page=${page}&limit=${ledgerLimit}`);
      const data = await api('/admin/ledger-detailed');
      const rows = Array.isArray(data.rows) ? data.rows : [];
      ledgerTotal = data.total || 0;
      const tbody = document.querySelector('#ledgerTableBodyUser');
      if (!tbody) return;
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${r.email || '-'}</td>
          <td class="${r.delta >= 0 ? 'text-green' : 'text-red'}">${r.delta}</td>
          <td>${r.reason || ''}</td>
          <td>${r.balance_after || ''}</td>
          <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
        </tr>
      `).join('');

      const info = document.getElementById('ledgerInfo');
      if (info) {
        const start = (page - 1) * ledgerLimit + 1;
        const end = Math.min(page * ledgerLimit, ledgerTotal);
        info.textContent = `Einträge ${start}-${end} von ${ledgerTotal}`;
      }

      document.getElementById('ledgerPrev').disabled = page <= 1;
      document.getElementById('ledgerNext').disabled = page * ledgerLimit >= ledgerTotal;
    } catch (err) {
      console.error('Fehler bei loadUserLedger:', err);
    }
  }

  // --- Prompt Playground ---
  async function loadPromptSettings() {
    try {
      const data = await api('/admin/prompt');
      const elPrompt = document.querySelector('#promptText');
      const elPunct = document.querySelector('#punctRate');
      const elTokens = document.querySelector('#maxUsedTokens');
      if (elPrompt) elPrompt.value = data.prompt || '';
      if (elPunct) elPunct.value = data.punct_rate || 1;
      if (elTokens) elTokens.value = data.max_usedtokens_per_msg || 500;
    } catch (err) {
      console.error('Fehler bei loadPromptSettings:', err);
    }
  }

  // --- Untermenü Verwaltung ---
  async function loadMenuItems() {
    try {
      // const data = await api('/admin/menu-items');
      const data = await api('/admin-menu/items');
      const items = Array.isArray(data) ? data : (data.items || []);
      const tbody = document.querySelector('#menuItemsTableBody');
      if (!tbody) return;
      tbody.innerHTML = items.map(i => `
        <tr>
          <td>${i.id}</td>
          <td>${i.title || ''}</td>
          <td>${i.location || ''}</td>
          <td>${i.created_at ? new Date(i.created_at).toLocaleString() : ''}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Fehler bei loadMenuItems:', err);
    }
  }

  // === Events für User-Ledger Blättern ===
  document.getElementById('ledgerPrev')?.addEventListener('click', () => {
    if (ledgerPage > 1) {
      ledgerPage--;
      loadUserLedger(ledgerPage);
    }
  });
  document.getElementById('ledgerNext')?.addEventListener('click', () => {
    ledgerPage++;
    loadUserLedger(ledgerPage);
  });
  document.getElementById('ledgerLoadBtn')?.addEventListener('click', () => {
    const val = parseInt(document.getElementById('ledgerUserId').value);
    ledgerPage = val > 0 ? val : 1;
    loadUserLedger(ledgerPage);
  });

  // === Initial-Load ===
  await loadStats();
  await loadUsers();
  await loadLedger();
  await loadUserLedger();
  await loadPromptSettings();
  await loadMenuItems();

})();
