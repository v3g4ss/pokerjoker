// public/app/admin-editor.js
// 🃏 Poker Joker – Prompt + Menüverwaltung mit Priorität & Editor-Fix

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('mnAdd');
  if (!window.mnMenuInitDone) {
    window.mnMenuInitDone = true;
    addBtn?.addEventListener('click', createMenuItem);
    window.loadMenuItems();
  }
});

// === Globale Menü-Ladefunktion ===
window.loadMenuItems = async function () {
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
    <td><input type="number" class="mn-position" min="0" max="99" value="${item.position || 0}" /></td>
    <td><input type="checkbox" class="mn-active" ${item.is_active ? 'checked' : ''} /></td>
    <td>
      <button class="btn-save" title="Speichern" data-id="${item.id}">💾</button>
      <button class="btn-edit" title="Bearbeiten" data-id="${item.id}">✏️</button>
      <button class="btn-delete" title="Löschen" data-id="${item.id}">🗑️</button>
    </td>
  `;

  tr.querySelector('.btn-edit').addEventListener('click', () => editMenu(item.id));
  tr.querySelector('.btn-delete').addEventListener('click', () => deleteMenu(item.id));
  tr.querySelector('.btn-save').addEventListener('click', () => saveMenuRow(tr));

  tbody.appendChild(tr);
}

// === Menü speichern (Reihe) ===
async function saveMenuRow(tr) {
  const id = tr.dataset.id;
  const title = tr.querySelector('.mn-title').value.trim();
  const location = tr.querySelector('.mn-location').value;
  const position = Number(tr.querySelector('.mn-position').value);
  const is_active = tr.querySelector('.mn-active').checked;

  try {
    const res = await fetch(`/api/admin/menu/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, location, position, is_active })
    });
    const j = await res.json();
    if (j.ok) {
      tr.style.background = '#1b2b1b';
      setTimeout(() => (tr.style.background = ''), 600);
    } else alert('Fehler beim Speichern ⚠️');
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}

// === Menüpunkt anlegen ===
async function createMenuItem() {
  if (window.addLocked) return;
  window.addLocked = true;
  try {
    const res = await fetch('/api/admin/menu', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Neuer Punkt',
        content_html: '<p>Inhalt kommt später</p>',
        position: 0,
        location: 'both',
        is_active: true
      })
    });
    const j = await res.json();
    if (j.ok && j.item) drawRow(j.item);
  } catch (err) {
    console.error('[CREATE MENU ERROR]', err);
  } finally {
    window.addLocked = false;
  }
}

// === Menüpunkt bearbeiten ===
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
      <textarea id="editContent" style="width:100%;min-height:250px;background:#0f1425;color:#fff;border-radius:8px;padding:10px;">${i.content_html || ''}</textarea>
      <div style="margin-top:10px;display:flex;gap:10px;">
        <button id="btnSaveEdit">💾 Speichern</button>
        <button id="btnCancelEdit">❌ Abbrechen</button>
      </div>
    `;

    document.querySelector('.card:last-of-type').after(editorBox);

    document.getElementById('btnCancelEdit').addEventListener('click', () => editorBox.remove());

    document.getElementById('btnSaveEdit').addEventListener('click', async () => {
      const html = document.getElementById('editContent').value;
      try {
        const upd = await fetch(`/api/admin/menu/${id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: i.title,
            content_html: html,
            location: i.location,
            is_active: i.is_active,
            position: i.position
          })
        });
        const js = await upd.json();
        if (js.ok) {
          alert('Gespeichert ✅');
          editorBox.remove();
          window.loadMenuItems();
        } else alert('Fehler beim Speichern ⚠️');
      } catch (err) {
        alert('Fehler: ' + err.message);
      }
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
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}
