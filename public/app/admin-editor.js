// public/app/admin-editor.js
// 🃏 Poker Joker: Prompt UI + Menüverwaltung (DB-gesteuert)

document.addEventListener('DOMContentLoaded', () => {

  // === DOM Elemente ===
  const promptTextarea = document.getElementById('admPrompt');
  const tempInput      = document.getElementById('admTemp');
  const modelSelect    = document.getElementById('admModel');
  const testBtn        = document.getElementById('btnPromptTest');
  const saveBtn        = document.getElementById('btnPromptSave');
  const statusSpan     = document.getElementById('promptStatus');
  const outAnswer      = document.getElementById('admAnswer');
  const modeButtons    = document.querySelectorAll('input[name="chatMode"]');
  const chatModeSave   = document.getElementById('btnChatModeSave');
  const chatModeStatus = document.getElementById('chatModeStatus');
  const punctInput     = document.getElementById('punctRate');
  const maxTokInput    = document.getElementById('maxUsedTokens');
  const addBtn         = document.getElementById('mnAdd');
  let addLocked        = false;

  // === API Helper ===
  async function api(url, options = {}) {
    const opts = {
      credentials: 'include',
      headers: { 'Accept': 'application/json', ...(options.headers || {}) },
      ...options,
    };
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error((await res.json())?.error || 'Fehler');
    return res.json();
  }

  // === Prompt + Settings laden ===
  async function loadPromptSettings() {
    try {
      const j = await api('/api/admin/prompt');
      promptTextarea.value = j.system_prompt;
      tempInput.value      = j.temperature;
      modelSelect.value    = j.model;
      punctInput.value     = j.punct_rate ?? 1;
      maxTokInput.value    = j.max_usedtokens_per_msg ?? 1000;

      if (j.knowledge_mode) {
        const b = Array.from(modeButtons).find(x => x.value === j.knowledge_mode);
        if (b) b.checked = true;
      }
    } catch (err) {
      console.error(err);
      statusSpan.textContent = 'Fehler beim Laden';
    }
  }

  // === Prompt testen ===
  testBtn?.addEventListener('click', async () => {
    const payload = {
      system_prompt: promptTextarea.value.trim(),
      temperature: Number(tempInput.value),
      model: modelSelect.value,
      input: 'Was ist Poker?'
    };
    try {
      const j = await api('/api/admin/prompt/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      outAnswer.textContent = j?.output || '[Kein Output]';
    } catch (err) {
      outAnswer.textContent = 'Fehler: ' + err.message;
    }
  });

  // === Prompt speichern ===
  saveBtn?.addEventListener('click', async () => {
    const payload = {
      system_prompt: promptTextarea.value.trim(),
      temperature: Number(tempInput.value),
      model: modelSelect.value,
      punct_rate: Number(punctInput.value),
      max_usedtokens_per_msg: Number(maxTokInput.value)
    };
    try {
      const j = await api('/api/admin/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      statusSpan.textContent = j.ok ? 'Gespeichert ✅' : 'Fehler ⚠️';
    } catch (err) {
      statusSpan.textContent = 'Fehler ⚠️';
    }
  });

  // === Chat-Mode speichern ===
  chatModeSave?.addEventListener('click', async () => {
    const mode = Array.from(modeButtons).find(x => x.checked)?.value || 'LLM_ONLY';
    try {
      const j = await api('/api/admin/prompt/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      chatModeStatus.textContent = j.ok ? 'Gespeichert ✅' : 'Fehler ⚠️';
    } catch (err) {
      chatModeStatus.textContent = 'Fehler ⚠️';
    }
  });

  // === Menü initialisieren ===
  if (!window.mnMenuInitDone) {
    window.mnMenuInitDone = true;
    addBtn?.addEventListener('click', createMenuItem);
    window.loadMenuItems(); // jetzt global
  }

  loadPromptSettings();
});

// === Menü laden (global) ===
window.loadMenuItems = async function() {
  try {
    const res = await fetch('/api/admin/menu', { credentials: 'include' });
    const data = await res.json();
    const tbody = document.querySelector('#mnTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (data.items || []).forEach(drawRow);
  } catch (err) {
    console.error('[MENU LOAD ERROR]', err);
  }
};

// === Menüpunkt erstellen ===
async function createMenuItem() {
  if (window.addLocked) return;
  window.addLocked = true;

  try {
    const j = await fetch('/api/admin/menu', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Neuer Punkt',
        content_html: '<p>Inhalt kommt später</p>',
        position: 1,
        location: 'both',
        is_active: true
      })
    }).then(res => res.json());

    window.addLocked = false;

    if (j.ok && j.item) {
      drawRow(j.item);
    } else {
      console.error(j.error || j);
    }
  } catch (err) {
    window.addLocked = false;
    console.error('[CREATE MENU ERROR]', err);
  }
}

// === Menüzeile darstellen ===
function drawRow(item) {
  const tbody = document.querySelector('#mnTable tbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.dataset.id = item.id;

  tr.innerHTML = `
    <td>${item.id}</td>
    <td><input type="text" value="${item.title || ''}" class="mn-title" /></td>
    <td>
      <select class="mn-location">
        <option value="login" ${item.location === 'login' ? 'selected' : ''}>Login</option>
        <option value="live" ${item.location === 'live' ? 'selected' : ''}>Live</option>
        <option value="both" ${item.location === 'both' ? 'selected' : ''}>Beide</option>
      </select>
    </td>
    <td><input type="checkbox" class="mn-active" ${item.is_active ? 'checked' : ''} /></td>
    <td>
      <button class="btn-edit" data-id="${item.id}">✏️</button>
      <button class="btn-delete" data-id="${item.id}">🗑️</button>
    </td>
  `;

  // === Editieren ===
  tr.querySelector('.btn-edit').addEventListener('click', () => editMenu(item.id));
  tr.querySelector('.btn-delete').addEventListener('click', () => deleteMenu(item.id));

  tbody.appendChild(tr);
}

// === Menü bearbeiten ===
async function editMenu(id) {
  try {
    const res = await fetch(`/api/admin/menu/${id}`, { credentials: 'include' });
    const j = await res.json();
    if (!j.ok || !j.item) return alert('Fehler beim Laden');

    const i = j.item;
    let editorBox = document.getElementById('editorBox');
    if (editorBox) editorBox.remove();

    editorBox = document.createElement('div');
    editorBox.id = 'editorBox';
    editorBox.style.marginTop = '20px';
    editorBox.style.padding = '16px';
    editorBox.style.background = '#1a2235';
    editorBox.style.borderRadius = '10px';
    editorBox.style.boxShadow = '0 0 10px rgba(0,0,0,0.4)';
    editorBox.innerHTML = `
      <h3>📝 Inhalt bearbeiten – ${i.title}</h3>
      <textarea id="editContent" style="width:100%;min-height:200px;background:#0f1425;color:#fff;border-radius:8px;padding:10px;">${i.content_html || ''}</textarea>
      <button id="btnSaveEdit" style="margin-top:10px;">💾 Speichern</button>
    `;

    const container = document.querySelector('#mnTable')?.closest('section') || document.body;
    container.appendChild(editorBox);

    document.getElementById('btnSaveEdit').addEventListener('click', async () => {
      const html = document.getElementById('editContent').value;
      const payload = {
        title: i.title,
        content_html: html,
        location: i.location,
        is_active: i.is_active
      };
      const u = await fetch(`/api/admin/menu/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const upd = await u.json();
      if (upd.ok) {
        alert('Gespeichert ✅');
        editorBox.remove();
        window.loadMenuItems();
      } else alert('Fehler beim Speichern ⚠️');
    });

  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}

// === Menü löschen ===
async function deleteMenu(id) {
  if (!confirm('Wirklich löschen?')) return;
  try {
    const res = await fetch(`/api/admin/menu/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const j = await res.json();
    if (j.ok) document.querySelector(`tr[data-id="${id}"]`)?.remove();
    else alert('Fehler beim Löschen ⚠️');
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}
