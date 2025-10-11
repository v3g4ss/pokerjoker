// public/app/admin-editor.js
// 🃏 Poker Joker – Menüverwaltung mit Priorität & stabilem Editor

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('mnAdd');
  if (!window.mnMenuInitDone) {
    window.mnMenuInitDone = true;
    addBtn?.addEventListener('click', createMenuItem);
    window.loadMenuItems(); // global
  }
});

// === Globale Menü-Ladefunktion (für spätere Reloads aus Editor usw.) ===
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
    alert('Fehler beim Laden der Menüpunkte.');
  }
};

// === Eine Tabellenzeile rendern ===
function drawRow(item) {
  const tbody = document.querySelector('#mnTable tbody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.dataset.id = String(item.id);

  tr.innerHTML = `
    <td>${item.id}</td>
    <td><input type="text" value="${item.title || ''}" class="mn-title" /></td>
    <td>
      <select class="mn-location">
        <option value="login" ${item.location === 'login' ? 'selected' : ''}>Login</option>
        <option value="live"  ${item.location === 'live'  ? 'selected' : ''}>Live</option>
        <option value="both"  ${item.location === 'both'  ? 'selected' : ''}>Beide</option>
      </select>
    </td>
    <td><input type="number" class="mn-position" min="0" max="999" value="${item.position ?? 0}" /></td>
    <td><input type="checkbox" class="mn-active" ${item.is_active ? 'checked' : ''} /></td>
    <td>
      <button class="btn-save"   title="Speichern"  data-id="${item.id}">💾</button>
      <button class="btn-edit"   title="Bearbeiten" data-id="${item.id}">✏️</button>
      <button class="btn-delete" title="Löschen"    data-id="${item.id}">🗑️</button>
    </td>
  `;

  tr.querySelector('.btn-save').addEventListener('click', () => saveMenuRow(tr));
  tr.querySelector('.btn-edit').addEventListener('click', () => editMenu(item.id));
  tr.querySelector('.btn-delete').addEventListener('click', () => deleteMenu(item.id));

  tbody.appendChild(tr);
}

// === Speichern-Button (Titel, Ort, Position, Aktiv) ===
async function saveMenuRow(tr) {
  const id        = tr.dataset.id;
  const title     = tr.querySelector('.mn-title').value.trim();
  const location  = tr.querySelector('.mn-location').value;
  const position  = Number(tr.querySelector('.mn-position').value);
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
      // kleines visuelles Feedback
      tr.style.transition = 'background 0.3s';
      tr.style.background = '#1b2b1b';
      setTimeout(() => (tr.style.background = ''), 600);

      // neu laden, damit sortierte Reihenfolge sichtbar wird
      window.loadMenuItems();
    } else {
      alert('Fehler beim Speichern ⚠️');
    }
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}

// === Neu anlegen ===
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
    if (j.ok && j.item) {
      drawRow(j.item);
    }
  } catch (err) {
    console.error('[CREATE MENU ERROR]', err);
  } finally {
    window.addLocked = false;
  }
}

// === Editor (öffnet UNTER der Tabelle) ===
async function editMenu(id) {
  try {
    const res = await fetch(`/api/admin/menu/${id}`, { credentials: 'include' });
    const j = await res.json();
    if (!j.ok || !j.item) return alert('Fehler beim Laden des Menüpunktes.');

    const i = j.item;

    // alten Editor schließen
    document.getElementById('menuEditor')?.remove();

    // Editor-Container direkt unter der Tabelle einfügen
    const table = document.getElementById('mnTable');
    const wrapper = document.createElement('div');
    wrapper.id = 'menuEditor';
    wrapper.style.marginTop = '16px';
    wrapper.style.padding = '16px';
    wrapper.style.background = '#1a2235';
    wrapper.style.borderRadius = '10px';
    wrapper.style.boxShadow = '0 0 10px rgba(0,0,0,0.4)';
    wrapper.innerHTML = `
      <h3 style="margin-top:0">📝 Inhalt bearbeiten – ${i.title}</h3>
      <textarea id="editContent" style="width:100%;min-height:260px;background:#0f1425;color:#fff;border-radius:8px;padding:10px;">${i.content_html || ''}</textarea>
      <div style="margin-top:12px;display:flex;gap:10px;">
        <button id="btnSaveEdit">💾 Speichern</button>
        <button id="btnCancelEdit">❌ Abbrechen</button>
      </div>
    `;

    table.insertAdjacentElement('afterend', wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('btnCancelEdit').addEventListener('click', () => wrapper.remove());

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
          wrapper.remove();
          window.loadMenuItems();
        } else {
          alert('Fehler beim Speichern ⚠️');
        }
      } catch (err) {
        alert('Fehler: ' + err.message);
      }
    });
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}

// === Löschen ===
async function deleteMenu(id) {
  if (!confirm('Wirklich löschen?')) return;
  try {
    const res = await fetch(`/api/admin/menu/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const j = await res.json();
    if (j.ok) {
      document.querySelector(`tr[data-id="${id}"]`)?.remove();
    } else {
      alert('Fehler beim Löschen ⚠️');
    }
  } catch (err) {
    alert('Fehler: ' + err.message);
  }
}
