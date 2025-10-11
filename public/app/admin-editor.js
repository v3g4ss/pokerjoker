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

/* -------------------------------- Texteditor ------------------------------- */

async function onEditRow(id) {
  // Einzelnen Menüpunkt laden (mit Fallback auf alten Alias)
  let j;
  try {
    j = await api(`/api/admin/menu/${id}`);
  } catch (_) {
    // Fallback auf alten Editor-Alias (falls bei dir noch aktiv)
    j = await api(`/api/admin/editor/${id}`);
  }
  if (!j.ok || !j.item) {
    return alert('Fehler beim Laden des Menüpunktes.');
  }

  const item = j.item;

  // Editor-Container bereitstellen
  let editor = document.getElementById('mnEditor');
  if (!editor) {
    editor = document.createElement('div');
    editor.id = 'mnEditor';
    editor.style.marginTop = '20px';
    editor.innerHTML = `
      <div class="card" style="padding:16px;">
        <h3 id="mnEditorTitle" style="margin:0 0 10px 0;">Inhalt bearbeiten</h3>
        <textarea id="mnEditorArea" rows="12" style="width:100%;"></textarea>
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button id="mnEditorSave" class="btn">Speichern</button>
          <button id="mnEditorCancel" class="btn" style="background:#555;">Schließen</button>
        </div>
      </div>
    `;
    // Hinter die Tabelle hängen
    const table = document.querySelector('#mnTable') || document.querySelector('#menuItemsTable');
    (table?.parentElement || document.body).appendChild(editor);
  }

  // Inhalte setzen
  document.getElementById('mnEditorTitle').textContent = `Inhalt: ${item.title} (ID ${item.id})`;
  document.getElementById('mnEditorArea').value = item.content_html || '';

  // Buttons
  document.getElementById('mnEditorCancel').onclick = () => editor.remove();
  document.getElementById('mnEditorSave').onclick = async () => {
    try {
      await api(`/api/admin/menu/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_html: document.getElementById('mnEditorArea').value,
        }),
      });
      toast('Inhalt gespeichert');
      editor.remove();
      await loadMenuItems();
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    }
  };
}
