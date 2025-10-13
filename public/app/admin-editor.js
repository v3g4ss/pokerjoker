// public/app/admin-editor.js
// 🃏 Poker Joker – Admin: Prompt + Menü-Editor (mit Prio, Texteditor & Add-Funktion)

(() => {
  console.log('[admin-editor] Modul gestartet');

  init(); // direkt starten, kein Event nötig

  async function init() {
    const addBtn = document.getElementById('mnAdd');
    const tbody = getTbody();
    if (!tbody) return;

    addBtn?.addEventListener('click', onCreate);

    await loadPromptSettings().catch(() => {});
    await loadMenuItems();
  }

/* ------------------------------ Utils ------------------------------ */

function getTbody() {
  return (
    document.querySelector('#mnTable tbody') ||
    document.querySelector('#menuTable tbody') ||
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'API Fehler');
  return data;
}

function toast(msg) {
  console.log('[INFO]', msg);
}

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/* ----------------------- Prompt-Einstellungen ----------------------- */

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

  if (!promptTextarea || !tempInput || !modelSelect || !saveBtn || !testBtn) return;

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

  // Testen
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
    } catch {
      statusSpan.textContent = 'Fehler ⚠️';
    }
  });

  // ChatMode speichern
  chatModeSave?.addEventListener('click', async () => {
    const mode = Array.from(modeButtons).find(x => x.checked)?.value || 'LLM_ONLY';
    try {
      const j = await api('/api/admin/prompt/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      chatModeStatus.textContent = j.ok ? 'Gespeichert ✅' : 'Fehler ⚠️';
    } catch {
      chatModeStatus.textContent = 'Fehler ⚠️';
    }
  });
}

/* ------------------------- Menüverwaltung ------------------------- */

async function loadMenuItems() {
  const tbody = getTbody();
  if (!tbody) return;

  try {
    const j = await api('/api/admin/menu');
    if (!j.ok || !Array.isArray(j.items)) throw new Error('Keine Items geladen');

    tbody.innerHTML = '';
    j.items.sort((a, b) => a.position - b.position).forEach(drawRow);
    console.log('[INFO] Menü geladen:', j.items.length, 'Einträge');
  } catch (err) {
    console.error('[MENU LOAD ERROR]', err.message);
  }
}

// Neue Zeile hinzufügen
async function onCreate() {
  try {
    const j = await api('/api/admin/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Neues Untermenü',
        location: 'both',
        is_active: false,
        position: 0,
        content_html: '',
      }),
    });
    if (j.ok) {
      toast('➕ Neues Untermenü erstellt');
      await loadMenuItems();
    } else {
      alert('Fehler: ' + (j.message || 'Unbekannt'));
    }
  } catch (err) {
    alert('Fehler beim Erstellen: ' + err.message);
  }
}

function drawRow(item) {
  const tbody = getTbody();
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.dataset.id = item.id;
  tr.innerHTML = `
    <td>${item.id}</td>
    <td><input type="text" class="mn-title" value="${escapeHtml(item.title || '')}" /></td>
    <td>
      <select class="mn-location">
        <option value="login" ${item.location === 'login' ? 'selected' : ''}>Login</option>
        <option value="live" ${item.location === 'live' ? 'selected' : ''}>Live</option>
        <option value="both" ${item.location === 'both' ? 'selected' : ''}>Beide</option>
      </select>
    </td>
    <td style="text-align:center;">
      <input type="checkbox" class="mn-active" ${item.is_active ? 'checked' : ''} />
    </td>
    <td><input type="number" class="mn-position" value="${item.position ?? 0}" style="width:60px;" /></td>
    <td>
      <button class="mn-save">💾</button>
      <button class="mn-edit">✏️</button>
      <button class="mn-delete">🗑</button>
    </td>
  `;
  tr.querySelector('.mn-save').onclick = () => onSaveRow(tr);
  tr.querySelector('.mn-edit').onclick = () => onEditRow(item.id);
  tr.querySelector('.mn-delete').onclick = () => onDeleteRow(item.id);
  tbody.appendChild(tr);
}

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
    toast('✅ Gespeichert');
    await loadMenuItems();
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
}

async function onDeleteRow(id) {
  if (!confirm('Wirklich löschen?')) return;
  try {
    await api(`/api/admin/menu/${id}`, { method: 'DELETE' });
    toast('🗑️ Gelöscht');
    await loadMenuItems();
  } catch (err) {
    alert('Fehler beim Löschen: ' + err.message);
  }
}

/* ----------------------------- Editor ----------------------------- */

async function onEditRow(id) {
  let j;
  try {
    j = await api(`/api/admin/menu/${id}`);
  } catch (err) {
    console.error('Fehler beim Laden:', err);
    return alert('Fehler beim Laden des Menüpunktes.');
  }

  if (!j?.ok || !j.item) return alert('Konnte Menüpunkt nicht laden.');

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

        <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:6px;">
          <button type="button" onclick="document.execCommand('bold',false,null)">B</button>
          <button type="button" onclick="document.execCommand('italic',false,null)">I</button>
          <button type="button" onclick="document.execCommand('underline',false,null)">U</button>
          <button type="button" onclick="document.execCommand('insertUnorderedList',false,null)">• Liste</button>
          <button type="button" onclick="document.execCommand('createLink',false,prompt('URL:'))">🔗 Link</button>
        </div>

        <div id="edit-area-${id}" contenteditable="true"
          style="min-height:140px;padding:10px;background:#0f1633;color:#fff;border:1px solid #333;border-radius:6px;">
          ${item.content_html || ''}
        </div>

        <div style="margin-top:10px;text-align:right;display:flex;justify-content:flex-end;gap:10px;">
          <button id="cancel-${id}" style="padding:6px 12px;background:#555;color:#fff;border:none;border-radius:8px;cursor:pointer;">Schließen</button>
          <button id="save-${id}" style="padding:6px 12px;background:#ff4d00;color:#fff;border:none;border-radius:8px;cursor:pointer;">💾 Speichern</button>
        </div>
      </div>
    </td>
  `;

  tr.after(row);

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
})();