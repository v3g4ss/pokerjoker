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

/* ------------------------------ Texteditor ------------------------------ */

// Editor öffnen
async function onEditRow(id) {
  let j;
  try {
    j = await api(`/api/admin/menu/${id}`);
  } catch (err) {
    console.error('Fehler beim Laden des Menüpunktes:', err);
    return alert('Fehler beim Laden des Menüpunktes.');
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
          <button type="button" onclick="document.execCommand('bold',false,null)" style="font-weight:bold;">B</button>
          <button type="button" onclick="document.execCommand('italic',false,null)" style="font-style:italic;">I</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♠')">♠</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♥')">♥</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♦')">♦</button>
          <button type="button" onclick="document.execCommand('insertText',false,'♣')">♣</button>
        </div>

        <!-- Textbereich -->
        <div id="edit-area-${id}" contenteditable="true"
          style="min-height:120px;padding:10px;background:#0f1633;color:#fff;border:1px solid #333;border-radius:6px;white-space:pre-wrap;">
          ${escapeHtml(item.content_html || '')}
        </div>

        <!-- Buttons -->
        <div style="margin-top:10px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button id="cancel-${id}" style="padding:6px 12px;background:#555;color:#fff;border:none;border-radius:8px;cursor:pointer;">Schließen</button>
          <button id="save-${id}" style="padding:6px 12px;background:#ff4d00;color:#fff;border:none;border-radius:8px;cursor:pointer;">💾 Speichern</button>
        </div>
      </div>
    </td>
  `;

  tr.after(row);

  // === Aktionen ===
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
          content_html: newText
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

/* ----------------------------- Hilfsfunktionen ----------------------------- */

function getTbody() {
  return document.querySelector('#menuTable tbody');
}

// Standardisierte API-Helfer
async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'API Fehler');
  return data;
}

function toast(msg) {
  console.log('[INFO]', msg);
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

// ====================== RICHTIGER TEXTEDITOR (mit Formatierung) ======================
async function onEditRow(id) {
  let j;
  try {
    j = await api(`/api/admin/menu/${id}`);
  } catch (err) {
    console.error('Fehler beim Laden:', err);
    return alert('Fehler beim Laden des Menüpunktes.');
  }

  if (!j || !j.ok || !j.item) {
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
          <button type="button" onclick="document.execCommand('bold',false,null)">B</button>
          <button type="button" onclick="document.execCommand('italic',false,null)">I</button>
          <button type="button" onclick="document.execCommand('underline',false,null)">U</button>
          <button type="button" onclick="document.execCommand('insertUnorderedList',false,null)">• Liste</button>
          <button type="button" onclick="document.execCommand('createLink',false,prompt('URL:'))">🔗 Link</button>
        </div>

        <!-- Textfeld -->
        <div id="edit-area-${id}" contenteditable="true"
          style="min-height:140px;padding:10px;background:#0f1633;color:#fff;border:1px solid #333;border-radius:6px;white-space:pre-wrap;">
          ${item.content_html || ''}
        </div>

        <!-- Buttons -->
        <div style="margin-top:10px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button id="cancel-${id}" style="padding:6px 12px;background:#555;color:#fff;border:none;border-radius:8px;cursor:pointer;">Schließen</button>
          <button id="save-${id}" style="padding:6px 12px;background:#ff4d00;color:#fff;border:none;border-radius:8px;cursor:pointer;">💾 Speichern</button>
        </div>
      </div>
    </td>
  `;

  tr.after(row);

  // === Aktionen ===
  document.getElementById(`cancel-${id}`).onclick = () => row.remove();

  document.getElementById(`save-${id}`).onclick = async () => {
    const newLoc = document.querySelector(`#edit-loc-${id}`).value;
    const html = document.querySelector(`#edit-area-${id}`).innerHTML.trim();

    try {
      await api(`/api/admin/menu/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: newLoc, content_html: html }),
      });
      toast('✅ Gespeichert');
      row.remove();
      await loadMenuItems();
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    }
  };
}

// === Startpunkt beim Laden ===
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('[INIT] Untermenü laden...');
    await loadMenuItems(); // lädt alle Menüeinträge
  } catch (err) {
    console.error('[INIT ERROR]', err);
  }
});
