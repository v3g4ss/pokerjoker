// public/app/admin.js
// ============================================================
// Admin-Frontend für Poker Joker
// ============================================================

// ---- Hilfs-API ------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
  return data;
}
const $ = s => document.querySelector(s);

// ---- Logout ---------------------------------------------------------------
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  location.href = '/login/';
});

// ---- KPIs -----------------------------------------------------------------
async function loadStats() {
  try {
    const s = await api('/admin/stats');

    const set = (sel, val) => {
      const n = document.querySelector(sel);
      if (n) n.textContent = (val ?? 0).toString();
    };

    set('#statCustomers',          s.customers);
    set('#statAdmins',             s.admins);
    set('#statMsgs',               s.messages_total);
    set('#statMsgsNew',            s.messages_new);
    set('#statPurchased',          s.purchased);
    set('#statAdminGranted',       s.admin_granted);
    set('#statTokensCirculation',  s.tokens_in_circulation);
  } catch (e) {
    console.warn('stats:', e.message);
  }
}
loadStats();

// ---- Users Liste ----------------------------------------------------------
let uPage = 1, uLimit = 10, uQ = '';

async function loadUsers() {
  const qs = new URLSearchParams({ page: uPage, limit: uLimit });
  if (uQ) qs.set('q', uQ);

  const d = await api('/admin/users?' + qs.toString());
  const tb = document.querySelector('#usersTbl tbody');
  if (!tb) return;
  tb.innerHTML = '';

  (d.items || []).forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td class="mono">${u.email}</td>
      <td>${u.is_admin ? 'Ja' : 'Nein'}</td>
      <td>${u.is_locked ? '🔒 gesperrt' : '✔ aktiv'}</td>
      <td class="mono">${u.tokens ?? 0}</td>
      <td class="mono">${u.purchased ?? 0}</td>
      <td>
        <button class="tplus"  data-id="${u.id}" data-delta="50">+50</button>
        <button class="tminus" data-id="${u.id}" data-delta="-50">-50</button>
        <button class="adm"    data-id="${u.id}" data-admin="${u.is_admin ? 0 : 1}">${u.is_admin ? 'Admin −' : 'Admin +'}</button>
        <button class="lock"   data-id="${u.id}" data-lock="${u.is_locked ? 0 : 1}">${u.is_locked ? 'Entsperren' : 'Sperren'}</button>
        <button class="del"    data-id="${u.id}" style="color:#e74c3c">Löschen</button>
      </td>`;
    tb.appendChild(tr);
  });

  $('#pageInfo') && ($('#pageInfo').textContent = d.total ? `Seite ${uPage} · ${d.total} User` : '–');
  $('#prevPage') && ($('#prevPage').disabled = uPage <= 1);
  $('#nextPage') && ($('#nextPage').disabled = uPage * uLimit >= (d.total || 0));
}

$('#btnSearch')?.addEventListener('click', () => {
  uQ = $('#userSearch')?.value?.trim() || '';
  uPage = 1;
  loadUsers();
});
$('#prevPage')?.addEventListener('click', () => { if (uPage>1){ uPage--; loadUsers(); }});
$('#nextPage')?.addEventListener('click', () => { uPage++; loadUsers(); });

// Tabellen-Click: +50 / -50 / Admin / Lock / Delete ------------------------
document.querySelector('#usersTbl tbody')?.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const id = Number(b.dataset.id);
  if (!Number.isInteger(id)) return;

  const reasonInput = document.getElementById('tokenReason');
  const baseReason  = (reasonInput?.value || '').trim();
  const statusEl    = document.getElementById('tokenStatus');

  // +/− Tokens (Backend: /admin/tokens/adjust)
  if (b.classList.contains('tplus') || b.classList.contains('tminus')) {
    const delta  = parseInt(b.dataset.delta, 10);
    const reason = baseReason || (delta > 0 ? 'admin quick +50' : 'admin quick -50');
    try {
      await api('/admin/tokens/adjust', {
        method: 'POST',
        body: JSON.stringify({ userId: id, delta, reason })
      });
      statusEl && (statusEl.textContent = `✅ Tokens aktualisiert (${delta>0?'+':''}${delta}) – Grund: ${reason}`);
      await Promise.all([loadUsers(), loadStats()]);
    } catch (err) {
      statusEl && (statusEl.textContent = '❌ ' + (err.message || 'Fehler beim Aktualisieren'));
    }
    return;
  }

  // Admin Flag
  if (b.classList.contains('adm')) {
    const is_admin = b.dataset.admin === '1';
    await api(`/admin/users/${id}/admin`, { method:'POST', body: JSON.stringify({ is_admin }) });
    await Promise.all([loadUsers(), loadStats()]);
    return;
  }

  // Lock/Unlock
  if (b.classList.contains('lock')) {
    const locked = b.dataset.lock === '1';
    await api(`/admin/users/${id}/lock`, { method:'POST', body: JSON.stringify({ locked }) });
    await loadUsers();
    return;
  }

  // Soft Delete
  if (b.classList.contains('del')) {
    if (!confirm('User wirklich löschen? (soft delete)')) return;
    await api(`/admin/users/${id}`, { method:'DELETE' });
    await loadUsers();
    return;
  }
});

loadUsers();

// ---- Tokens anpassen Kachel (mit Grund + Statusausgabe) -------------------
async function adjustTokens(deltaSign = 1) {
  const uidEl = $('#tokenUserId');
  const deltaEl = $('#tokenDelta');
  const reasonEl = $('#tokenReason');
  const st = $('#tokenStatus');

  const uid   = parseInt(uidEl?.value, 10);
  const delta = parseInt(deltaEl?.value, 10);
  const reason = String(reasonEl?.value || '').trim();

  if (!Number.isInteger(uid) || !Number.isInteger(delta)) {
    st && (st.textContent = '⚠ Bitte gültige User-ID und Token-Anzahl angeben.');
    return;
  }

  const finalDelta = deltaSign * Math.abs(delta);
  const body = {
    userId: uid,
    delta: finalDelta,
    reason: reason || (finalDelta > 0 ? `admin adjust +${Math.abs(finalDelta)}` : `admin adjust -${Math.abs(finalDelta)}`)
  };

  const btnAdd = $('#btnAddTokens'), btnRem = $('#btnRemoveTokens');
  btnAdd && (btnAdd.disabled = true);
  btnRem && (btnRem.disabled = true);
  st && (st.textContent = '⏳ Übertrage…');

  try {
    const r = await api('/admin/tokens/adjust', { method:'POST', body: JSON.stringify(body) });
    st && (st.textContent = `✅ Gespeichert. Neuer Kontostand: ${r.balance}`);
    if (deltaEl) deltaEl.value = ''; // Grund bleibt stehen
    await Promise.all([loadUsers(), loadStats()]);
  } catch (e) {
    st && (st.textContent = '❌ ' + (e.message || 'Fehler beim Anpassen'));
  } finally {
    btnAdd && (btnAdd.disabled = false);
    btnRem && (btnRem.disabled = false);
  }
}
$('#btnAddTokens')?.addEventListener('click', ()=>adjustTokens(+1));
$('#btnRemoveTokens')?.addEventListener('click', ()=>adjustTokens(-1));
$('#btnRefreshUsers')?.addEventListener('click', async ()=>{
  const b = $('#btnRefreshUsers');
  if (!b) return;
  b.disabled = true; b.textContent = 'Aktualisiere…';
  await Promise.all([loadUsers(), loadStats()]);
  b.textContent = 'Aktualisieren'; b.disabled = false;
});

// Admin ersetzt sein eigenes Passwort 
document.getElementById('btnMePass')?.addEventListener('click', async () => {
  const oldp = document.getElementById('meOldPass').value;
  const newp = document.getElementById('meNewPass').value;
  const st = document.getElementById('mePassStatus');
  if (st) st.textContent = '...';

  try {
    const r = await api('/auth/password', {
      method:'POST',
      body: JSON.stringify({ current_password: oldp, new_password: newp })
    });
    if (st) st.textContent = '✅ ' + (r.message || 'Passwort geändert. Bitte neu einloggen.');
    // kleinen Delay und auf Login-Seite
    setTimeout(()=>location.href='/login/', 800);
  } catch (e) {
    if (st) st.textContent = '❌ ' + (e.message || 'Fehler');
  }
});

// ---- User anlegen (NEU – Punkt 3) ----------------------------------------
document.getElementById('btnCreateUser')?.addEventListener('click', async ()=>{
  const email = document.getElementById('newUserEmail')?.value.trim();
  const pass  = document.getElementById('newUserPass')?.value || '';
  const adm   = !!document.getElementById('newUserAdmin')?.checked;
  const st    = document.getElementById('createUserStatus');

  if (!email || pass.length < 6) {
    st && (st.textContent = '⚠ E-Mail & mind. 6 Zeichen Passwort');
    return;
  }
  st && (st.textContent = '⏳ Anlegen…');

  try {
    await api('/admin/users', { method:'POST', body: JSON.stringify({ email, password: pass, is_admin: adm }) });
    st && (st.textContent = '✅ Angelegt');
    document.getElementById('newUserEmail').value = '';
    document.getElementById('newUserPass').value  = '';
    document.getElementById('newUserAdmin').checked = false;
    await Promise.all([loadUsers(), loadStats()]);
  } catch (e) {
    st && (st.textContent = '❌ ' + (e.message || 'Fehler'));
  }
});

// ====================== Ledger & Summary Kacheln ======================
// === Globale Einstellung für alle Ledger-Paginationen ===
const PAGE_SIZE = 10;

// Helper für Pagination-Anzeige
function renderPager(infoId, page, limit, total) {
  const el = document.getElementById(infoId);
  if (!el) return;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  el.textContent = `Einträge ${start}–${end} von ${total}`;
}

// --- helpers ---
const esc = (s) => (s ?? '').toString()
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

  function fmt(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('de-DE');
  } catch {
    return '-';
  }
}

// === User Ledger (mit Pagination) ===
let userLedgerPage = 1;
let userLedgerTotal = 0;
let userLedgerCache = [];
let currentUid = null;

async function fetchUserLedger(uid) {
  const res = await api(`/admin/ledger/user/${uid}`); // vorhandene Route
  userLedgerCache = Array.isArray(res) ? res : [];
  userLedgerTotal = userLedgerCache.length;
}

function renderUserLedger(page = 1) {
  const tb = document.querySelector('#userLedgerTbl tbody');
  if (!tb) return;

  if (!Array.isArray(userLedgerCache) || userLedgerCache.length === 0) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;">Keine Einträge gefunden</td></tr>`;
    return;
  }

  const startIdx = (page - 1) * PAGE_SIZE;
  const slice = userLedgerCache.slice(startIdx, startIdx + PAGE_SIZE);

 tb.innerHTML = slice.map(r => `
  <tr>
    <td>${esc(r.id)}</td>
    <td>${esc(r.email || '')}</td>
    <td>${esc(r.status || '')}</td>
    <td class="${r.delta >= 0 ? 'text-green' : 'text-red'}">${r.delta}</td>
    <td>${esc(r.reason || '')}</td>
    <td>${esc(r.balance_after ?? r.balance ?? '')}</td>
    <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
  </tr>
`).join('');

  const start = userLedgerTotal ? startIdx + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, userLedgerTotal);
  const info = document.getElementById('userLedgerInfo');
  if (info) info.textContent = `Einträge ${start}–${end} von ${userLedgerTotal}`;

  document.getElementById('ledgerPrev').disabled = page <= 1;
  document.getElementById('ledgerNext').disabled = page * PAGE_SIZE >= userLedgerTotal;
}

// === Event Listener ===
document.getElementById('btnLoadUserLedger')?.addEventListener('click', async () => {
  const uid = parseInt(document.getElementById('ledgerUserId')?.value, 10);
  if (!uid) {
    console.warn('Keine User-ID angegeben.');
    return;
  }
  currentUid = uid;
  userLedgerPage = 1;
  await fetchUserLedger(uid);
  renderUserLedger(userLedgerPage);
});

document.getElementById('ledgerPrev')?.addEventListener('click', () => {
  if (userLedgerPage > 1) renderUserLedger(--userLedgerPage);
});

document.getElementById('ledgerNext')?.addEventListener('click', () => {
  if (userLedgerPage * PAGE_SIZE < userLedgerTotal) renderUserLedger(++userLedgerPage);
});

// === Letzte 200 Ledger (ebenfalls paginiert, gleiche Logik) ===
let lastPage = 1;
let lastTotal = 0;


async function loadLastLedger(page = 1) {
  try {
    const data = await api(`/admin/ledger?page=${page}&limit=${PAGE_SIZE}`);
    const rows = data.items || [];
    lastTotal = data.total || rows.length;

    const tb = document.querySelector('#lastTbl tbody');
    if (!tb) return;

    tb.innerHTML = rows.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.user_id}</td>
        <td class="${r.delta >= 0 ? 'text-green' : 'text-red'}">${r.delta}</td>
        <td>${r.reason || ''}</td>
        <td>${r.balance_after ?? ''}</td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
      </tr>
    `).join('');

    // Pagination info
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, lastTotal);
    const info = document.getElementById('lastLedgerInfo');
    if (info) info.textContent = `Einträge ${start}–${end} von ${lastTotal}`;

    // Sicheres Button-Handling
    const prevBtn = document.getElementById('lastLedgerPrev');
    const nextBtn = document.getElementById('lastLedgerNext');
    if (prevBtn && nextBtn) {
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page * PAGE_SIZE >= lastTotal;
    }
  } catch (e) {
    console.error('Fehler bei loadLastLedger:', e);
  }
}

// ===============================
// Initialisierung Admin Dashboard
// ===============================
document.addEventListener('DOMContentLoaded', () => {

  // === Navigation für "Letzte Ledger" ===
  const prevBtn = document.getElementById('lastLedgerPrev');
  const nextBtn = document.getElementById('lastLedgerNext');

  if (prevBtn && nextBtn) {
    prevBtn.addEventListener('click', () => {
      if (lastPage > 1) loadLastLedger(--lastPage);
    });
    nextBtn.addEventListener('click', () => {
      if (lastPage * PAGE_SIZE < lastTotal) loadLastLedger(++lastPage);
    });
  }

  // === Initialer Load Ledger ===
  loadLastLedger();

  // === User-Summary modernisiert + Pagination ===
let summaryPage = 1;
let summaryTotal = 0;
const summaryLimit = 10;

async function loadUserSummary(page = 1, search = '') {
  try {
    const q = new URLSearchParams({ page, limit: summaryLimit });
    if (search) q.set('search', search);

    const data = await api(`/admin/user-summary?${q.toString()}`);
    const rows = Array.isArray(data.items) ? data.items : [];
    summaryTotal = data.total || rows.length;

    const tbody = document.querySelector('#userSummaryTbl tbody');
    if (!tbody) return;

    tbody.innerHTML = rows.length
      ? rows.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${esc(r.email)}</td>
            <td>${fmt(r.last_activity)}</td>
            <td>${r.gekauft ?? 0}</td>
            <td>${r.ausgegeben ?? 0}</td>
            <td>${r.admin ?? 0}</td>
            <td>${r.aktuell ?? 0}</td>
          </td>
        </tr>
      `).join('')
      : `<tr><td colspan="7" class="text-center text-gray">Keine Einträge gefunden</td></tr>`;

    if (typeof renderPager === 'function') {
      renderPager('summaryInfo', page, summaryLimit, summaryTotal);
    }

    document.getElementById('summaryPrev').disabled = page <= 1;
    document.getElementById('summaryNext').disabled = page * summaryLimit >= summaryTotal;

  } catch (e) {
    console.error('Fehler bei loadUserSummary:', e);
    document.getElementById('summaryInfo').textContent = 'Fehler beim Laden';
  }
}

  // === Events ===
  document.getElementById('summaryPrev')?.addEventListener('click', () => {
    if (summaryPage > 1) loadUserSummary(--summaryPage);
  });

  document.getElementById('summaryNext')?.addEventListener('click', () => {
    if (summaryPage * summaryLimit < summaryTotal) loadUserSummary(++summaryPage);
  });

  // === User-Summary: Suche + Enter ===
const summarySearchInput = document.getElementById('summarySearch');
const summaryReloadBtn   = document.getElementById('summaryReload');

document.getElementById('summaryReload')?.addEventListener('click', () => {
  const q = document.getElementById('summarySearch')?.value.trim() || '';
  loadUserSummary(1, q);
});

summarySearchInput?.addEventListener('keypress', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const search = summarySearchInput?.value.trim() || '';
    loadUserSummary(1, search);
  }
});

  // === Auto-Start ===
  loadUserSummary();
});

// === Buttons verbinden ===
document.getElementById('btnLoadSummary')
  ?.addEventListener('click', loadSummary);
document.getElementById('btnSearchSummary')
  ?.addEventListener('click', loadSummary);

// ---- Chat-Mode UI (KB_ONLY / KB_PREFERRED / LLM_ONLY) ---------------------
(async function(){
  const status = $('#chatModeStatus');
  const radios = [...document.querySelectorAll('input[name="chatMode"]')];
  if (!radios.length) return;
  const setUI = m => (radios.find(r=>r.value===m) || radios[1]).checked = true;

  try {
    const d = await api('/admin/bot-mode'); setUI(d.mode || 'KB_PREFERRED');
    status && (status.textContent = `Aktuell: ${d.mode}`);
  } catch {}

  $('#btnChatModeSave')?.addEventListener('click', async ()=>{
    const val = (radios.find(r=>r.checked)||{}).value;
    try {
      await api('/admin/bot-mode', { method:'PUT', body: JSON.stringify({ mode: val }) });
      status && (status.textContent = `Gespeichert: ${val}`);
    } catch(e){
      status && (status.textContent = e.message || 'Fehler');
    }
  });
})();

// ---- Prompt-Kachel: Laden/Speichern/Testen -------------------------------
(async function(){
  const txt = $('#admPrompt'), temp = $('#admTemp'), mdl = $('#admModel');
  const st  = $('#promptStatus'), btnSave = $('#btnPromptSave'), btnTest = $('#btnPromptTest');
  if (!txt || !temp || !mdl) return;

  // Laden
  try {
    const r = await fetch('/api/admin/prompt', { credentials:'include' });
    const d = await r.json();
    if (d && d.system_prompt !== undefined) {
      if (typeof d.system_prompt === 'string') txt.value = d.system_prompt;
      if (d.temperature != null) temp.value = d.temperature;
      if (d.model) mdl.value = d.model;
      st && (st.textContent = 'Geladen');
    }
  } catch {}

  // Speichern (LIVE)
  btnSave?.addEventListener('click', async ()=>{
    st && (st.textContent = 'Speichere…');
    const body = { system_prompt: txt.value, temperature: parseFloat(temp.value||'0.3'), model: mdl.value };
    try {
      const r = await fetch('/api/admin/prompt', {
        method:'PUT', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      const d = await r.json().catch(()=>({}));
      st && (st.textContent = d.ok ? 'Gespeichert' : (d.error||'Fehler'));
    } catch (e) {
      st && (st.textContent = e.message || 'Fehler');
    }
  });

  // Testen (zeigt IMMER etwas an – auch bei Server/Model-Fehlern)
  btnTest?.addEventListener('click', async ()=>{
    const outEl = document.getElementById('admAnswer');
    outEl && (outEl.textContent = '⏳ teste…');
    st && (st.textContent = 'Teste…');

    const body = {
      system_prompt: txt.value,
      temperature: parseFloat(temp.value || '0.3'),
      model: mdl.value,
      input: 'Erkläre in 1 Satz, was du kannst.'
    };

    try {
      const r  = await fetch('/api/admin/prompt/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      const ct = r.headers.get('content-type') || '';
      const d  = ct.includes('application/json') ? await r.json()
                                                 : { ok:false, output:'', error: await r.text() };

      const text = (d && (d.output || d.error)) ||
                   `[CLIENT Fallback]\nPrompt: "${(body.system_prompt||'').replace(/\s+/g,' ').slice(0,120)}${(body.system_prompt||'').length>120?'…':''}"\nAntwort: (Server gab keinen Text zurück)`;

      outEl && (outEl.textContent = text);
      st && (st.textContent = d?.ok ? 'Test ok' : 'Fehler beim Test');
      console.debug('prompt/test response:', d);
    } catch (e) {
      outEl && (outEl.textContent = `[CLIENT Error] ${e.message || String(e)}`);
      st && (st.textContent = 'Fehler');
    }
  });

  // === Lazy Load: Untermenü-Editor nur bei Bedarf laden ===
const submenuCard = document.querySelector('#submenuCard');

if (submenuCard) {
  submenuCard.addEventListener('click', async () => {
    if (!window.editorLoaded) {
      console.log('[admin] Lade admin-editor.js …');
      try {
        await import('/app/admin-editor.js?v=20250831');
        window.editorLoaded = true;
        console.log('[admin] admin-editor.js erfolgreich geladen!');
      } catch (err) {
        console.error('[admin] Fehler beim Laden von admin-editor.js:', err);
      }
    } else {
      console.log('[admin] admin-editor.js ist bereits aktiv.');
    }
  });
}

})();
