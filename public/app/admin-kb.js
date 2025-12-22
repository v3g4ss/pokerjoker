// public/app/admin-kb.js

document.addEventListener('DOMContentLoaded', () => {
  // ==== helpers ====
  const esc = (s) => (s ?? '').toString()
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');

  const sizeLabel = (d) => {
    if (d.size_label) return d.size_label;
    if (d.size_human) return d.size_human;
    if (d.file_size_human) return d.file_size_human;

    const bytes = Number(
      d.size_bytes ??
      d.filesize ??
      d.file_size ??
      d.size ??
      0
    );

    if (!bytes || Number.isNaN(bytes)) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    return (kb / 1024).toFixed(1) + ' MB';
  };

  let kbDocs = [];

  function renderKbTable() {
    const tb = document.querySelector('#kbTable tbody');
    if (!tb) return;
    tb.innerHTML = '';

    for (const d of kbDocs) {
      const idActive = `kb_active_${d.id}`;
      const idPrio   = `kb_prio_${d.id}`;
      const sz       = sizeLabel(d);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${d.id}</td>
        <td>${esc(d.title || '')}</td>
        <td class="mono">${esc(d.filename || d.file || '')}</td>
        <td>${esc(d.category || '')}</td>
        <td>${esc(Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || ''))}</td>

        <td style="text-align:center;">
          <input type="checkbox"
                 class="blue-check"
                 id="${idActive}"
                 ${d.enabled ? 'checked' : ''}>
        </td>

        <td>
          <input type="number"
                 id="${idPrio}"
                 value="${d.priority ?? 0}"
                 style="width:60px">
        </td>

        <td>
          <button class="kbSave">💾</button>
          <button class="kbDelete">🗑️</button>
        </td>

        <td class="mono">${esc(sz)}</td>
      `;

      const enabledBox = tr.querySelector(`#${idActive}`);
      const prioInput  = tr.querySelector(`#${idPrio}`);
      const saveBtn    = tr.querySelector('.kbSave');
      const delBtn     = tr.querySelector('.kbDelete');

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        const r = await fetch(`/api/admin/kb/${d.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            enabled: !!enabledBox.checked,
            priority: parseInt(prioInput.value || '0', 10)
          })
        });
        const j = await r.json().catch(() => ({}));
        saveBtn.disabled = false;
        alert(j.ok ? 'Gespeichert ✅' : 'Fehler ⚠️');
      });

      delBtn.addEventListener('click', async () => {
        if (!confirm('Wirklich löschen?')) return;
        delBtn.disabled = true;
        const r = await fetch(`/api/admin/kb/${d.id}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        const j = await r.json().catch(() => ({}));
        delBtn.disabled = false;
        if (j.ok) tr.remove();
        else alert('Fehler beim Löschen');
      });

      tb.appendChild(tr);
    }
  }

  async function loadKbDocs() {
    const r = await fetch('/api/admin/kb/docs', { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      kbDocs = j.items || [];
      renderKbTable();
    }
  }

  loadKbDocs();

  // ==============================
  // Dateien-Upload (Docs)
  // ==============================
  document.getElementById('kbUpload')?.addEventListener('click', async () => {
    const file = document.getElementById('kbFiles')?.files?.[0];
    if (!file) return alert('Keine Datei ausgewählt');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', document.getElementById('kbTitle')?.value || '');
    fd.append('category', document.getElementById('kbCategory')?.value || '');
    fd.append('tags', document.getElementById('kbTags')?.value || '');

    const r = await fetch('/api/admin/kb/upload', {
      method: 'POST',
      credentials: 'include',
      body: fd
    });

    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      loadKbDocs();
      document.getElementById('kbFiles').value = '';
    } else {
      alert('Upload fehlgeschlagen');
    }
  });

  // ==============================
  // Bilder-Upload (NUR Bilder)
  // ==============================
  document.getElementById('imgUpload')?.addEventListener('click', async () => {
    const file  = document.getElementById('imgFile')?.files?.[0];
    const title = document.getElementById('imgTitle')?.value?.trim();
    const desc  = document.getElementById('imgDesc')?.value?.trim();
    const tags  = document.getElementById('imgTags')?.value?.trim();

    if (!file)  return alert('Keine Bilddatei');
    if (!title) return alert('Titel fehlt');
    if (!tags)  return alert('Tags fehlen');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    fd.append('caption', desc);
    fd.append('tags', tags);

    const r = await fetch('/api/admin/kb/image', {
      method: 'POST',
      credentials: 'include',
      body: fd
    });

    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      loadKbDocs();
      document.getElementById('imgFile').value = '';
      document.getElementById('imgTitle').value = '';
      document.getElementById('imgDesc').value = '';
      document.getElementById('imgTags').value = '';
    } else {
      alert('Bild-Upload fehlgeschlagen');
    }
  });
});
