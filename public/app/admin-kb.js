// public/app/admin-kb.js

document.addEventListener('DOMContentLoaded', () => {
  // ==== helpers ====
  const esc = (s) => (s ?? '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // Dateigröße schön anzeigen (40.2 KB, 1.6 KB, 2.4 MB, …)
  const sizeLabel = (d) => {
    // wenn Backend schon was Fertiges liefert
    if (d.size_label)       return d.size_label;
    if (d.size_human)       return d.size_human;
    if (d.file_size_human)  return d.file_size_human;

    const bytes = Number(
      d.size_bytes ??
      d.filesize   ??
      d.file_size  ??
      d.size       ??
      0
    );

    if (!bytes || Number.isNaN(bytes)) return '';

    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    return mb.toFixed(1) + ' MB';
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
                name="${idActive}"
                ${d.enabled ? 'checked' : ''}>
          <label for="${idActive}" class="sr-only" style="position:absolute;left:-9999px;">aktiv</label>
        </td>

        <td>
          <input type="number"
                 id="${idPrio}"
                 name="${idPrio}"
                 value="${d.priority ?? 0}"
                 style="width:60px">
        </td>

        <td>
          <button class="kbSave"   title="Speichern">💾</button>
          <button class="kbDelete" title="Löschen">🗑️</button>
        </td>

        <td class="mono">${esc(sz)}</td>
      `;

      const enabledBox = tr.querySelector(`#${idActive}`);
      const prioInput  = tr.querySelector(`#${idPrio}`);
      const saveBtn    = tr.querySelector('.kbSave');
      const delBtn     = tr.querySelector('.kbDelete');

      // Speichern
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        const enabled  = !!enabledBox?.checked;
        const priority = parseInt(prioInput?.value ?? '0', 10) || 0;

        const r = await fetch(`/api/admin/kb/${d.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled, priority }),
        });

        const j = await r.json().catch(() => ({}));
        saveBtn.disabled = false;
        alert(j.ok ? 'Gespeichert ✅' : (j.message || 'Fehler ⚠️'));
      });

      // Löschen
      delBtn.addEventListener('click', async () => {
        if (!confirm('Wirklich löschen?')) return;
        delBtn.disabled = true;

        const r = await fetch(`/api/admin/kb/${d.id}`, {
          method: 'DELETE',
          credentials: 'include'
        });

        const j = await r.json().catch(() => ({}));
        delBtn.disabled = false;
        if (j.ok) {
          tr.remove();
        } else {
          alert(j.message || 'Fehler beim Löschen');
        }
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

  // Upload-Button-Logik
  document.getElementById('kbUpload')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('kbFiles');
    const file = fileInput?.files?.[0];
    if (!file) return alert('Keine Datei ausgewählt!');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title',     document.getElementById('kbTitle')?.value || '');
    formData.append('category',  document.getElementById('kbCategory')?.value || '');
    formData.append('tags',      document.getElementById('kbTags')?.value || '');

    const kbStatus = document.getElementById('kbStatus');
    if (kbStatus) kbStatus.textContent = '⏳ Upload läuft...';

    const r = await fetch('/api/admin/kb/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    const j = await r.json().catch(() => ({}));
    if (j.ok) {
      if (kbStatus) kbStatus.textContent = `✅ Upload erfolgreich (Chunks: ${j.chunks})`;
      loadKbDocs();
      if (fileInput) fileInput.value = '';
    } else {
      if (kbStatus) kbStatus.textContent = `❌ Fehler: ${j.error || j.message || 'Unbekannt'}`;
    }
  });
});
