(() => {
  'use strict';

  // --- kleine Utils (scoped, keine Globals) ---
  const q  = (sel, root = document) => root.querySelector(sel);
  const qq = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const fmtSize = (n) => {
    if (n == null) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, x = +n;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
  };

  const toast = (msg, ok = true) => {
    console[ok ? 'log' : 'warn']('[KB]', msg);
    let el = q('#kbToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kbToast';
      el.style.cssText =
        'position:fixed;right:16px;bottom:16px;background:#1f2937;color:#e5e7eb;' +
        'padding:10px 14px;border-radius:10px;opacity:.97;box-shadow:0 6px 24px #0006;z-index:9999';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok ? '#064e3b' : '#7f1d1d';
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.style.display = 'none', 2200);
  };

  async function api(method, url, body, isForm = false) {
    const opt = { method, credentials: 'include', headers: {} };
    if (body && !isForm) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    if (body && isForm) {
      opt.body = body;
    }
    const r = await fetch(url, opt);
    if (!r.ok) {
      throw new Error(`${r.status} ${r.statusText}`);
    }
    return r.json().catch(() => ({}));
  }

  // --- Hilfsfunktion: Bild-URL bauen (stellt sicher: /uploads/knowledge/...) ---
  function buildImageUrl(doc) {
    let u = (doc.image_url || doc.filename || '').toString().trim();
    if (!u) return '';

    // Domain wegschneiden, falls drin
    u = u.replace(/^https?:\/\/[^/]+/i, '');

    // Wenn schon korrekt, so lassen
    if (u.startsWith('/uploads/knowledge/')) return u;

    // Wenn mit "uploads/knowledge" aber ohne leading slash
    if (u.startsWith('uploads/knowledge/')) return '/' + u;

    // Auf reinen Dateinamen reduzieren und Prefix davorhängen
    const file = u.split('/').pop();
    return `/uploads/knowledge/${file}`;
  }

  // --- DOM refs ---
  let elTitle, elCat, elTags, elFiles, elBtnUpload, elTableBody;

  // --- Liste laden (PINNED: /api/admin/kb/docs) ---
  async function loadList() {
    const sp = new URLSearchParams({ page: '1', limit: '50' });
    const data = await api('GET', `/api/admin/kb/docs?${sp.toString()}`);
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    render(items);
  }

  function render(items) {
    if (!elTableBody) return;

    if (!items.length) {
      elTableBody.innerHTML =
        `<tr><td colspan="9" style="opacity:.7">Keine Einträge gefunden.</td></tr>`;
      return;
    }

    elTableBody.innerHTML = items.map(d => {
      const isImg = !!(d.image_url || (d.mime && d.mime.startsWith('image/')));
      const imgUrl = isImg ? buildImageUrl(d) : '';

      const thumb = isImg
        ? `<img src="${esc(imgUrl)}" alt="" class="kb-thumb"
               style="width:48px;height:48px;object-fit:cover;border-radius:8px;cursor:pointer"
               data-full="${esc(imgUrl)}">`
        : `<span class="mono">${esc((d.mime || '').split('/')[1] || 'txt')}</span>`;

      return `
        <tr data-id="${d.id}">
          <td class="mono col-id">${d.id}</td>
          <td class="title col-title">${esc(d.title || '')}</td>
          <td class="col-file">
            ${thumb}
            <div class="mono filename">${esc(d.filename || '')}</div>
          </td>
          <td class="cat col-cat">${esc(d.category || '')}</td>
          <td class="tags col-tags">${esc(Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || ''))}</td>
          <td class="size col-size mono">${fmtSize(d.size_bytes)}</td>
          <td class="col-aktiv">
            <input type="checkbox" class="kb-enabled" ${d.enabled ? 'checked' : ''}>
          </td>
          <td class="col-prio">
            <div class="prio-wrap">
              <button class="kbPrioDec" title="Prio -1">–</button>
              <span class="mono prio">${d.priority ?? 0}</span>
              <button class="kbPrioInc" title="Prio +1">+</button>
            </div>
          </td>
          <td class="col-actions">
            <button class="kbSave"   title="Speichern">💾</button>
            <button class="kbDelete" title="Löschen">🗑️</button>
          </td>
        </tr>`;
    }).join('');

    // Events
    qq('tr', elTableBody).forEach(tr => {
      const id = +tr.dataset.id;
      const img = q('img[data-full]', tr);

      img?.addEventListener('click', () =>
        window.open(img.getAttribute('data-full'), '_blank')
      );

      q('.kb-enabled', tr)?.addEventListener('change', async (e) => {
        try {
          await api('PATCH', `/api/admin/kb/${id}`, { enabled: e.target.checked });
          toast(`Doc #${id} ${e.target.checked ? 'aktiviert' : 'deaktiviert'}`);
        } catch (err) {
          toast(err.message, false);
        }
      });

      q('.kbPrioInc', tr)?.addEventListener('click', async () => {
        const p = Number(q('.prio', tr).textContent.replace('P:', '')) || 0;
        try {
          await api('PATCH', `/api/admin/kb/${id}`, { priority: p + 1 });
          await loadList();
        } catch (err) {
          toast(err.message, false);
        }
      });

      q('.kbPrioDec', tr)?.addEventListener('click', async () => {
        const p = Number(q('.prio', tr).textContent.replace('P:', '')) || 0;
        try {
          await api('PATCH', `/api/admin/kb/${id}`, { priority: p - 1 });
          await loadList();
        } catch (err) {
          toast(err.message, false);
        }
      });

      q('.kbSave', tr)?.addEventListener('click', async () => {
        const body = {
          title:    q('.title', tr)?.textContent.trim() || '',
          category: q('.cat', tr)?.textContent.trim()   || null,
        };
        try {
          await api('PATCH', `/api/admin/kb/${id}`, body);
          toast(`Gespeichert (#${id})`);
        } catch (err) {
          toast(err.message, false);
        }
      });

      q('.kbDelete', tr)?.addEventListener('click', async () => {
        if (!confirm(`Wirklich löschen (#${id})?`)) return;
        try {
          await api('DELETE', `/api/admin/kb/${id}`);
          tr.remove();
          toast(`Gelöscht (#${id})`);
        } catch (err) {
          toast(err.message, false);
        }
      });
    });
  }

  // --- Upload (PINNED: /api/admin/kb/upload) ---
  async function handleUpload() {
    const files = elFiles?.files ? Array.from(elFiles.files) : [];
    if (!files.length) return toast('Bitte Datei(en) wählen', false);

    elBtnUpload.disabled = true;
    let ok = 0, fail = 0;

    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      elTitle?.value.trim() && fd.append('title', elTitle.value.trim());
      elCat?.value.trim()   && fd.append('category', elCat.value.trim());
      elTags?.value.trim()  && fd.append('tags', elTags.value.trim());
      try {
        await api('POST', '/api/admin/kb/upload', fd, true);
        ok++;
      } catch (err) {
        console.warn('upload fail', f.name, err);
        fail++;
      }
    }

    toast(`Upload: OK ${ok}, Fehler ${fail}`, fail === 0);
    elFiles.value = '';
    await loadList();
    elBtnUpload.disabled = false;
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', async () => {
    elTitle     = q('#kbTitle');
    elCat       = q('#kbCategory');
    elTags      = q('#kbTags');
    elFiles     = q('#kbFiles');          // multiple
    elBtnUpload = q('#kbUpload');         // Button
    elTableBody = q('#kbTable tbody');    // Tabelle

    elBtnUpload?.addEventListener('click', handleUpload);

    await loadList();
  });

  // monospace helper
  const st = document.createElement('style');
  st.textContent = `.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;
  document.head.appendChild(st);
})();
