// ===================== Poker Joker - Admin Dashboard =====================
(async function () {
  const api = async (url, opt = {}) => {
    const res = await fetch('/api' + url, { credentials: 'include', ...opt });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    return res.json();
  };

  // ---- KPIs / Stats -----------------------------------------------------
  async function loadStats() {
    try {
      const s = await api('/admin/stats');
      const set = (sel, val) => {
        const n = document.querySelector(sel);
        if (n) n.textContent = (val ?? 0).toString();
      };
      set('#statCustomers', s.customers);
      set('#statAdmins', s.admins);
      set('#statMsgs', s.messages_total);
      set('#statMsgsNew', s.messages_new);
      set('#statPurchased', s.purchased);
      set('#statAdminGranted', s.admin_granted);
      set('#statTokensCirculation', s.tokens_in_circulation);
    } catch (e) {
      console.warn('stats:', e.message);
    }
  }
  loadStats();

  // ---- Users ------------------------------------------------------------
  async function loadUsers() {
    try {
      const users = await api('/admin/users');
      const tbody = document.querySelector('#usersTbl tbody');
      if (!tbody) return;
      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${u.email}</td>
          <td>${u.is_admin ? '✅' : ''}</td>
          <td>${u.tokens}</td>
          <td>${u.purchased}</td>
          <td>${u.is_locked ? '🔒' : ''}</td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('loadUsers:', e);
    }
  }
  loadUsers();

  // ---- Token Summary ----------------------------------------------------
  async function loadSummary() {
    try {
      const rows = await api('/admin/summary');
      const tbody = document.querySelector('#summaryTbl tbody');
      if (!tbody) return;
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.user_id}</td>
          <td>${r.email}</td>
          <td>${r.gekauft}</td>
          <td>${r.ausgegeben}</td>
          <td>${r.tokens}</td>
          <td>${new Date(r.last_update).toLocaleString()}</td>
        </tr>
      `).join('');
    } catch (e) {
      console.error('loadSummary:', e);
    }
  }
  loadSummary();

  // ---- User Ledger ------------------------------------------------------
  let ledgerPage = 1;
  const ledgerLimit = 10;

  async function loadUserLedger(page = 1) {
    try {
      const uid = document.getElementById('ledgerUserId')?.value.trim();
      if (!uid) return alert('Bitte User-ID angeben');
      ledgerPage = page;

      const res = await fetch(`/api/admin/ledger/user/${uid}?page=${page}&limit=${ledgerLimit}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || 'Fehler beim Laden');

      const rows = data.data || [];
      const total = data.total || 0;
      const start = (page - 1) * ledgerLimit + 1;
      const end = Math.min(start + ledgerLimit - 1, total);

      const tbody = document.querySelector('#ledgerTableBody');
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${r.email || ''}</td>
          <td style="color:${r.delta >= 0 ? 'lightgreen' : 'salmon'};">
            ${r.delta >= 0 ? '+' : ''}${r.delta}
          </td>
          <td>${r.reason || ''}</td>
          <td>${r.balance_after ?? ''}</td>
          <td>${new Date(r.created_at).toLocaleString()}</td>
        </tr>
      `).join('') || `<tr><td colspan="6" style="text-align:center;">Keine Einträge</td></tr>`;

      document.getElementById('ledgerInfo').textContent =
        `Einträge ${total ? `${start}-${end} von ${total}` : '0'}`;

      const btnPrev = document.getElementById('ledgerPrev');
      const btnNext = document.getElementById('ledgerNext');
      btnPrev.disabled = page <= 1;
      btnNext.disabled = end >= total;

      btnPrev.onclick = () => loadUserLedger(page - 1);
      btnNext.onclick = () => loadUserLedger(page + 1);
    } catch (e) {
      console.error('User-Ledger:', e);
    }
  }

  document.getElementById('ledgerLoadBtn')?.addEventListener('click', () => loadUserLedger(1));

  // ---- Letzte 200 Ledger ------------------------------------------------
  let lastLedgerPage = 1;
  const lastLedgerLimit = 10;
  let lastLedgerData = [];

  function fmtDelta(n) {
    const val = Number(n || 0);
    const s = val > 0 ? '+' : '';
    const cls = val >= 0 ? 'text-green' : 'text-red';
    return `<span class="${cls}">${s}${val}</span>`;
  }
  function fmtDate(t) {
    try { return new Date(t).toLocaleString(); }
    catch { return ''; }
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])
    );
  }

  async function loadLastLedger() {
    try {
      const data = await api('/admin/ledger/last200');
      lastLedgerData = data || [];
      lastLedgerPage = 1;
      renderLastLedger();
    } catch (e) {
      console.error('loadLastLedger:', e);
    }
  }

  function renderLastLedger() {
    const tbody = document.querySelector('#lastTbl tbody');
    const info = document.getElementById('lastLedgerInfo');
    if (!tbody || !info) return;

    const total = lastLedgerData.length;
    const start = (lastLedgerPage - 1) * lastLedgerLimit;
    const end = Math.min(start + lastLedgerLimit, total);
    const pageData = lastLedgerData.slice(start, end);

    tbody.innerHTML = pageData.map(r => `
      <tr>
        <td>${esc(r.id)}</td>
        <td>${esc(r.user_id)}</td>
        <td>${fmtDelta(r.delta)}</td>
        <td>${esc(r.reason || '')}</td>
        <td>${esc(r.balance_after)}</td>
        <td>${fmtDate(r.created_at)}</td>
      </tr>
    `).join('');

    info.textContent = total
      ? `Einträge ${start + 1}–${end} von ${total}`
      : 'Keine Einträge';

    document.getElementById('lastLedgerPrev').disabled = lastLedgerPage <= 1;
    document.getElementById('lastLedgerNext').disabled = end >= total;
  }

  document.getElementById('btnLoadLast200')?.addEventListener('click', loadLastLedger);
  document.getElementById('lastLedgerPrev')?.addEventListener('click', () => {
    if (lastLedgerPage > 1) {
      lastLedgerPage--;
      renderLastLedger();
    }
  });
  document.getElementById('lastLedgerNext')?.addEventListener('click', () => {
    if (lastLedgerPage * lastLedgerLimit < lastLedgerData.length) {
      lastLedgerPage++;
      renderLastLedger();
    }
  });

  loadLastLedger();

})();
