// public/app/admin-editor.js
// 🃏 Poker Joker – Admin: Prompt + Menü-Editor (mit Prio & Texteditor)

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  // DOM
  const addBtn = document.getElementById('mnAdd');
  const tbody = getTbody();
  if (!tbody) return; // Seite ohne Menütabelle? -> Finish

  // Events
  addBtn?.addEventListener('click', onCreate);

  // UI laden
  await loadPromptSettings().catch(() => {});
  await loadMenuItems();
}

/* ---------------------------------- Utils ---------------------------------- */

function getTbody() {
  // kompatibel mit deinen beiden Varianten
  return (
    document.querySelector('#mnTable tbody') ||
    document.querySelector('#menuItemsTable tbody')
  );
}

async function api(url, options = {}) {
  const opts = {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  };
  const res = await fetch(url, opts);
  let json = {};
  try { json = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg =
      json?.error ||
      json?.message ||
      `${res.status} ${res.statusText || 'Fehler'}`;
    throw new Error(msg);
  }
  return json;
}

function toast(msg) {
  // sehr simple „Toast“-Variante
  console.log('[INFO]', msg);
}

/* ---------------------------- Prompt-Einstellungen -------------------------- */

async function loadPromptSettings() {
  const promptTextarea = document.getElementById('admPrompt');
  const tempInput = document.getElementById('admTemp');
  const modelSelect = document.getElementById('admModel');
  const modeButtons = document.querySelectorAll('input[name="chatMode"]');
  const chatModeSave = document.getElementById('btnChatModeSave');
  const chatModeStatus = document.getElementById('chatModeStatus');
  const punctInput = document.getElementById('punctRate');
  const maxTokInput = document.getElementById('maxUsedTokens');
  const testBtn = document.getElementById('btnPromptTest');
  const saveBtn = document.getElementById('btnPromptSave');
  const outAnswer = document.getElementById('admAnswer');
  const statusSpan = document.getElementById('promptStatus');

  // wenn diese Felder nicht existieren (andere Seite), still beenden
  if (!promptTextarea || !tempInput || !modelSelect || !saveBtn || !testBtn) return;

  // Laden
  try {
    const j = await api('/api/admin/prompt');
    promptTextarea.value = j.system_prompt || '';
    tempInput.value = j.temperature ?? 1;
    modelSelect.value = j.model || '';
    punctInput && (punctInput.value = j.punct_rate ?? 1);
    maxTokInput && (maxTokInput.value = j.max_usedtokens_per_msg ?? 1000);
    if (j.knowledge_mode) {
      const b = Array.from(modeButtons).find(x => x.value === j.knowledge_mode);
      if (b) b.checked = true;
    }
  } catch (err) {
    console.warn('Prompt laden:', err.message);
  }

  // Test
  testBtn.addEventListener('click', async () => {
    const payload = {
      system_prompt: promptTextarea.value.trim(),
      temperature: Number(tempInput.value),
      model: modelSelect.value,
      input: 'Was ist Poker?',
    };
    try {
      const j = await api('/api/admin/prompt/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      outAnswer.textContent = j?.output || '[Kein Output]';
    } catch (err) {
      outAnswer.textContent = 'Fehler: ' + err.message;
    }
  });

  // Speichern
  saveBtn.addEventListener('click', async () => {
    const payload = {
      system_prompt: promptTextarea.value.trim(),
      temperature: Number(tempInput.value),
      model: modelSelect.value,
      punct_rate: Number(punctInput?.value ?? 1),
      max_usedtokens_per_msg: Number(maxTokInput?.value ?? 1000),
    };
    try {
      const j = await api('/api/admin/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      statusSpan.textContent = j.ok ? 'Gespeichert ✅' : 'Fehler ⚠️';
    } catch (err) {
      statusSpan.textContent = 'Fehler ⚠️';
    }
  });

  // ChatMode speichern
  chatModeSave?.addEventListener('click', async () => {
    const mode =
      Array.from(modeButtons).find(x => x.checked)?.value || 'LLM_ONLY';
    try {
      const j = await api('/api/admin/prompt/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      chatModeStatus.textContent = j.ok ? 'Gespeichert ✅' : 'Fehler ⚠️';
    } catch (err) {
      chatModeStatus.textContent = 'Fehler ⚠️';
    }
  });
}

/* ------------------------------- Menüverwaltung ----------------------------- */

// Menü laden
async function loadMenuItems() {
  const tbody = getTbody();
  if (!tbody) return;

  try {
    const j = await api('/api/admin/menu');
    const items = (j.items || []).slice().sort(byPositionThenId);
    tbody.innerHTML = '';
    items.forEach(drawRow);
  } catch (err) {
    console.error('[MENU LOAD ERROR]', err.message);
  }
}

function byPositionThenId(a, b) {
  const pa = (a.position ?? 0) | 0;
  const pb = (b.position ?? 0) | 0;
  if (pa !== pb) return pa - pb;
  return (a.id | 0) - (b.id | 0);
}

// Neue Zeile zeichnen
function drawRow(item) {
  const tbody = getTbody();
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.dataset.id = item.id;

  const active = !!item.is_active;
  const pos = (item.position ?? 0);

  tr.innerHTML = `
    <td>${item.id}</td>
    <td><input type="text" class="mn-title" value="${escapeHtml(item.title || '')}" /></td>
    <td>
      <select class="mn-location">
        <option value="login" ${item.location === 'login' ? 'selected' : ''}>Login</option>
        <option value="live"  ${item.location === 'live'  ? 'selected' : ''}>Live</option>
        <option value="both"  ${item.location === 'both'  ? 'selected' : ''}>Beide</option>
      </select>
    </td>
    <td style="text-align:center;">
      <input type="checkbox" class="mn-active" ${active ? 'checked' : ''} />
    </td>
    <td style="width:92px;">
      <input type="number" min="0" step="1" class="mn-position" value="${pos}" />
    </td>
    <td>
      <button class="mn-save"   title="Speichern">💾</button>
      <button class="mn-edit"   title="Inhalt bearbeiten">✏️</button>
      <button class="mn-delete" title="Löschen">🗑</button>
    </td>
  `;

  // Events
  tr.querySelector('.mn-save')  .addEventListener('click', () => onSaveRow(tr));
  tr.querySelector('.mn-edit')  .addEventListener('click', () => onEditRow(item.id));
  tr.querySelector('.mn-delete').addEventListener('click', () => onDeleteRow(item.id));

  tbody.appendChild(tr);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])
  );
}

// Neuen Menüpunkt erstellen
async function onCreate() {
  try {
    const j = await api('/api/admin/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Neuer Punkt',
        content_html: '<p>Inhalt kommt später</p>',
        position: await nextPosition(),
        location: 'both',
        is_active: true,
      }),
    });
    toast('Menüpunkt angelegt');
    await loadMenuItems();
  } catch (err) {
    alert('Fehler beim Anlegen: ' + err.message);
  }
}

async function nextPosition() {
  try {
    const j = await api('/api/admin/menu');
    const items = j.items || [];
    const max = items.reduce((m, x) => Math.max(m, (x.position ?? 0)), 0);
    return max + 1;
  } catch {
    return 0;
  }
}

// Zeile speichern (Titel, Ort, Aktiv, Prio)
async function onSaveRow(tr) {
  const id = tr.dataset.id;
  const title = tr.querySelector('.mn-title').value.trim();
  const location = tr.querySelector('.mn-location').value;
  const is_active = tr.querySelector('.mn-active').checked;
  const position = Number(tr.querySelector('.mn-position').value || 0);

  try {
    await api(`/api/admin/menu/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, location, is_active, position }),
    });
    toast('Gespeichert');
    await loadMenuItems();
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
}

// Zeile löschen
async function onDeleteRow(id) {
  if (!confirm('Wirklich löschen?')) return;
  try {
    await api(`/api/admin/menu/${id}`, { method: 'DELETE' });
    toast('Gelöscht');
    await loadMenuItems();
  } catch (err) {
    alert('Fehler beim Löschen: ' + err.message);
  }
}

/* ------------------------------ Texteditor ------------------------------ */

async function onEditRow(id) {
  // Menüpunkt laden
  let j;
  try {
    j = await api(`/api/admin/menu/${id}`);
  } catch (_) {
    j = await api(`/api/admin/editor/${id}`);
  }

  if (!j || !j.ok || !j.item) {
    console.error('Editor-Fehler:', j);
    return alert('Konnte Menüpunkt nicht laden.');
  }

  const item = j.item;
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  const existing = document.querySelector(`#editor-${id}`);
  if (existing) existing.remove();

  const row = document.createElement('tr');
  row.id = `editor-${id}`;
  row.innerHTML = `
    <td colspan="6">
      <div style="background:#1b2341;padding:14px;border-radius:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <label style="color:#ffd600;">Ort:</label>
          <select id="edit-loc-${id}" style="flex:1;padding:6px;border-radius:6px;background:#11182a;color:#fff;">
            <option value="login" ${item.location === 'login' ? 'selected' : ''}>Login</option>
            <option value="live" ${item.location === 'live' ? 'selected' : ''}>Live</option>
            <option value="both" ${item.location === 'both' ? 'selected' : ''}>Beide</option>
          </select>
        </div>

        <!-- Toolbar -->
        <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:6px;">
          <button type="button" onclick="document.execCommand('undo',false,null)">↩️</button>
          <button type="button" onclick="document.execCommand('redo',false,null)">↪️</button>
          <button type="button" onclick="document.execCommand('bold',false,null)">B</button>
          <button type="button" onclick="document.execCommand('italic',false,null)">I</button>
          <select id="fontSize-${id}" style="padding:3px 6px;border-radius:6px;background:#11182a;color:#fff;">
            <option value="1">Klein</option>
            <option value="3" selected>Mittel</option>
            <option value="5">Groß</option>
          </select>
          <button type="button" onclick="document.execCommand('fontSize',false,document.getElementById('fontSize-${id}').value)">🔤</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♥')">♥</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♣')">♣</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♦')">♦</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♠')">♠</button>
        </div>

        <!-- Textfeld -->
        <div id="edit-area-${id}" contenteditable="true"
          style="min-height:120px;padding:10px;background:#0f1633;color:#fff;border:1px solid #333;border-radius:6px;white-space:pre-wrap;">${item.content_html
            ?.replace(/<\/?[^>]+(>|$)/g, '') || ''}</div>

        <!-- Buttons -->
        <div style="margin-top:10px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button id="cancel-${id}" style="padding:6px 12px;background:#555;color:#fff;border:none;border-radius:8px;cursor:pointer;">Schließen</button>
          <button id="save-${id}" style="padding:6px 12px;background:#ff4d00;color:#fff;border:none;border-radius:8px;cursor:pointer;">💾 Speichern</button>
        </div>
      </div>
    </td>
  `;

  tr.after(row);

  // === Buttons ===
  document.getElementById(`cancel-${id}`).onclick = () => row.remove();

  document.getElementById(`save-${id}`).onclick = async () => {
    const newLoc = document.querySelector(`#edit-loc-${id}`).value;
    const newText = document.querySelector(`#edit-area-${id}`).innerText.trim();

    try {
      await api(`/api/admin/menu/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: newLoc,
          content_html: newText // reiner Text
        }),
      });
      toast('✅ Gespeichert');
      row.remove();
      await loadMenuItems();
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    }
  };
}

console.log('Editor-Load-Debug', j);
