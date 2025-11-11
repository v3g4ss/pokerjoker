(() => {
  'use strict';

  // ===== Helpers (scoped, keine Globals) =====
  const q  = (sel, root = document) => root.querySelector(sel);
  const qq = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function toast(msg, ok = true) {
    console[ok ? 'log' : 'warn'](`[KB] ${msg}`);
    let el = q('#kbToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kbToast';
      el.style.cssText =
        'position:fixed;right:16px;bottom:16px;background:#1f2937;color:#e5e7eb;padding:10px 14px;border-radius:10px;opacity:.97;box-shadow:0 6px 24px #0006;z-index:9999';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok ? '#064e3b' : '#7f1d1d';
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.style.display = 'none'), 2200);
  }

  const fmtSize = (n) => {
    if (n == null) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, x = Number(n);
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
  };

  async function api(method, url, body, isForm = false) {
    const opt = { method, credentials: 'include', headers: {} };
    if (body && !isForm) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (body &&  isForm) { opt.body = body; }
    const r = await fetch(url, opt);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`${r.status} ${r.statusText} ${txt}`);
    }
    return r.json().catch(() => ({}));
  }

  // ===== State / DOM =====
  let state = { page: 1, limit: 20, q: '', cat: '' };
  let elTitle, elCat, elTags, elFiles, elBtnUpload, elStatus, elSearch, elCatFilter, elTableBody;

  // ===== API: Liste =====
  async function fetchDocs() {
    const sp = new URLSearchParams();
    sp.set('page', state.page);
    sp.set('limit', state.limit);
    if (state.q)  sp.set('q', state.q);
    if (state.cat) sp.set('category', state.cat);

    try { return await api('GET', `/api/admin/kb/list?${sp.toString()}`); }
    catch { return await api('GET', `/api/admin/kb/docs?${sp.toString()}`); } // Fallback
  }

  function renderRows(items = []) {
    if (!elTableBody) return;
    elTableBody.innerHTML = items.map(d => {
      const idActive = `kb_enabled_${d.id}`;
      const isImg    = !!d.image_url;
      const thumb    = isImg
        ? `<img src="${esc(d.image_url)}" alt="img" class="kb-thumb"
                 style="width:48px;height:48px;object-fit:cover;border-radius:8px;cursor:pointer"
                 data-full="${esc(d.image_url)}">`
        : `<span class="mono">${esc((d.mime||'').split('/')[1] || 'txt')}</span>`;

      return `
        <tr data-id="${d.id}">
          <td class="mono">${d.id}</td>
          <td class="title">${esc(d.title || '')}</td>
          <td>
            ${thumb}
            <div class="mono" style="font-size:.85rem;opacity:.8">${esc(d.filename || '')}</div>
          </td>
          <td class="cat">${esc(d.category || '')}</td>
          <td class="tags">${esc(Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || ''))}</td>
          <td>
            <input type="checkbox" id="${idActive}" ${d.enabled ? 'checked' : ''}>
            <label for="${idActive}" class="sr-only" style="position:absolute;left:-9999px;">aktiv</label>
          </td>
          <td>
            <div style="display:flex;gap:.35rem;align-items:center">
              <button class="kbPrioDec" title="Prio -1">–</button>
              <span class="mono prio">P:${d.priority ?? 0}</span>
              <button class="kbPrioInc" title="Prio +1">+</button>
            </div>
          </td>
          <td>
            <button class="kbSave"   title="Speichern">💾</button>
            <button class="kbDelete" title="Löschen">🗑️</button>
          </td>
        </tr>`;
    }).join('');

    // Row-Events
    qq('tr', elTableBody).forEach(tr => {
      const id   = Number(tr.dataset.id);
      const chk  = q('input[type="checkbox"]', tr);
      const inc  = q('.kbPrioInc', tr);
      const dec  = q('.kbPrioDec', tr);
      const prio = q('.prio', tr);
      const save = q('.kbSave', tr);
      const del  = q('.kbDelete', tr);
      const img  = q('img.kb-thumb', tr);

      img?.addEventListener('click', () => window.open(img.getAttribute('data-full'), '_blank'));

      chk?.addEventListener('change', async () => {
        try { await api('PATCH', `/api/admin/kb/${id}`, { enabled: chk.checked }); toast(`Doc #${id} ${chk.checked?'aktiviert':'deaktiviert'}`); }
        catch (e) { toast(e.message, false); }
      });

      inc?.addEventListener('click', async () => {
        const cur = Number(prio.textContent.replace('P:', '')) || 0;
        try { await api('PATCH', `/api/admin/kb/${id}`, { priority: cur + 1 }); await reloadList(); }
        catch (e) { toast(e.message, false); }
      });

      dec?.addEventListener('click', async () => {
        const cur = Number(prio.textContent.replace('P:', '')) || 0;
        try { await api('PATCH', `/api/admin/kb/${id}`, { priority: cur - 1 }); await reloadList(); }
        catch (e) { toast(e.message, false); }
      });

      save?.addEventListener('click', async () => {
        const body = {
          title:    q('.title', tr)?.textContent.trim() || '',
          category: q('.cat', tr)?.textContent.trim()   || null,
        };
        try { await api('PATCH', `/api/admin/kb/${id}`, body); toast(`Gespeichert (#${id})`); await reloadList(); }
        catch (e) { toast(e.message, false); }
      });

      del?.addEventListener('click', async () => {
        if (!confirm(`Wirklich löschen (#${id})?`)) return;
        try { await api('DELETE', `/api/admin/kb/${id}`); toast(`Gelöscht (#${id})`); tr.remove(); }
        catch (e) { toast(e.message, false); }
      });
    });
  }

  async function reloadList() {
    try {
      const data = await fetchDocs();
      renderRows(data.items || []);
    } catch (e) {
      toast(e.message, false);
    }
  }

  // ===== Upload =====
  async function handleUpload() {
    const files = elFiles.files ? Array.from(elFiles.files) : [];
    if (!files.length) return toast('Bitte Datei(en) wählen', false);

    elBtnUpload.disabled = true;
    let okCount = 0, failCount = 0;

    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      elTitle?.value.trim() && fd.append('title', elTitle.value.trim());
      elCat?.value.trim()   && fd.append('category', elCat.value.trim());
      elTags?.value.trim()  && fd.append('tags', elTags.value.trim());
      try {
        await api('POST', '/api/admin/kb/upload', fd, true);
        okCount++;
      } catch (e) {
        console.warn('KB upload fail', f.name, e);
        failCount++;
      }
    }

    elStatus && (elStatus.textContent = `Upload fertig: OK ${okCount}, Fehler ${failCount}`);
    toast(`Upload fertig: OK ${okCount}, Fehler ${failCount}`, failCount === 0);
    elFiles.value = '';
    await reloadList();
    elBtnUpload.disabled = false;
  }

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', async () => {
    elTitle     = q('#kbTitle');
    elCat       = q('#kbCategory');
    elTags      = q('#kbTags');
    elFiles     = q('#kbFiles');          // <input type="file" multiple>
    elBtnUpload = q('#kbUpload');         // Upload-Button
    elStatus    = q('#kbStatus');         // Status-Span
    elSearch    = q('#kbSearch');
    elCatFilter = q('#kbCatFilter');
    elTableBody = q('#kbTable tbody');    // Tabellen-Body

    elBtnUpload?.addEventListener('click', handleUpload);

    elSearch?.addEventListener('input', e => {
      state.q = e.target.value.trim(); state.page = 1; reloadList();
    });
    elCatFilter?.addEventListener('input', e => {
      state.cat = e.target.value.trim(); state.page = 1; reloadList();
    });

    await reloadList();
  });

  // monospace helper (scoped)
  const style = document.createElement('style');
  style.textContent = `.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;
  document.head.appendChild(style);
})();
