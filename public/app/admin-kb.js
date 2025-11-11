(() => {
  'use strict';

  // ===== Helpers (scoped) =====
  const q  = (sel, root = document) => root.querySelector(sel);
  const qq = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');

  function toast(msg, ok = true) {
    console[ok ? 'log':'warn'](`[KB] ${msg}`);
    let el = q('#kbToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kbToast';
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;background:#1f2937;color:#e5e7eb;padding:10px 14px;border-radius:10px;opacity:.97;box-shadow:0 6px 24px #0006;z-index:9999';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok ? '#064e3b' : '#7f1d1d';
    el.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(()=> el.style.display='none', 2200);
  }

  const fmtSize = (n) => {
    if (n == null) return '';
    const u = ['B','KB','MB','GB']; let i=0, x=Number(n);
    while (x>=1024 && i<u.length-1) { x/=1024; i++; }
    return `${x.toFixed(i?1:0)} ${u[i]}`;
  };

  async function call(method, url, body, isForm=false) {
    const opt = { method, credentials:'include', headers:{} };
    if (body && !isForm) { opt.headers['Content-Type']='application/json'; opt.body = JSON.stringify(body); }
    if (body &&  isForm) { opt.body = body; }
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json().catch(()=> ({}));
  }

  // ===== State / DOM =====
  const state = { page:1, limit:50, q:'', cat:'' }; // groß ziehen, um alles zu sehen
  let elTitle, elCat, elTags, elFiles, elBtnUpload, elStatus, elSearch, elCatFilter, elTBody;

  // ===== robuste Liste (probiert mehrere Endpoints) =====
  async function fetchDocsRobust() {
    // Filter hart resetten (verhindert leere Suche)
    state.q = ''; state.cat = '';
    elSearch && (elSearch.value = '');
    elCatFilter && (elCatFilter.value = '');

    const sp = new URLSearchParams({ page:String(state.page), limit:String(state.limit) });
    const urls = [
      `/api/admin/kb/list?${sp}`,
      `/api/admin/kb/docs?${sp}`,
      `/api/admin/kb?${sp}`,         // manche Routen liefern direkt items
      `/api/admin/kb`                // ganz schlicht
    ];
    let lastErr = null;
    for (const u of urls) {
      try {
        const j = await call('GET', u);
        // Normalisiere Formate: erwarte {items:[...], total:n}
        if (Array.isArray(j)) return { items: j, total: j.length };
        if (Array.isArray(j.items)) return { items: j.items, total: j.total ?? j.items.length };
        if (Array.isArray(j.data))  return { items: j.data,  total: j.total ?? j.data.length };
      } catch (e) {
        lastErr = e;
        console.warn('[KB] list fail @', u, e?.message || e);
      }
    }
    throw lastErr || new Error('Kein KB-Endpoint lieferte Daten');
  }

  function renderRows(items=[]) {
    if (!elTBody) return;
    if (!items.length) {
      elTBody.innerHTML = `<tr><td colspan="9" style="opacity:.7">Keine Einträge gefunden.</td></tr>`;
      return;
    }
    elTBody.innerHTML = items.map(d => {
      const idActive = `kb_enabled_${d.id}`;
      const isImg = !!d.image_url;
      const thumb = isImg
        ? `<img src="${esc(d.image_url)}" alt="img" class="kb-thumb"
               style="width:48px;height:48px;object-fit:cover;border-radius:8px;cursor:pointer"
               data-full="${esc(d.image_url)}">`
        : `<span class="mono">${esc((d.mime||'').split('/')[1] || 'txt')}</span>`;
      return `
        <tr data-id="${d.id}">
          <td class="mono">${d.id}</td>
          <td class="title">${esc(d.title || '')}</td>
          <td>${thumb}<div class="mono" style="font-size:.85rem;opacity:.8">${esc(d.filename || '')}</div></td>
          <td class="cat">${esc(d.category || '')}</td>
          <td class="tags">${esc(Array.isArray(d.tags)? d.tags.join(', '):(d.tags||''))}</td>
          <td><input type="checkbox" id="${idActive}" ${d.enabled ? 'checked':''}></td>
          <td><div style="display:flex;gap:.35rem;align-items:center">
              <button class="kbPrioDec">–</button>
              <span class="mono prio">P:${d.priority ?? 0}</span>
              <button class="kbPrioInc">+</button>
          </div></td>
          <td>
            <button class="kbSave">💾</button>
            <button class="kbDelete">🗑️</button>
          </td>
        </tr>`;
    }).join('');

    // Events je Zeile
    qq('tr', elTBody).forEach(tr => {
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
        try { await call('PATCH', `/api/admin/kb/${id}`, { enabled: chk.checked }); toast(`Doc #${id} ${chk.checked?'aktiviert':'deaktiviert'}`); }
        catch (e) { toast(e.message, false); }
      });

      inc?.addEventListener('click', async () => {
        const cur = Number(prio.textContent.replace('P:','')) || 0;
        try { await call('PATCH', `/api/admin/kb/${id}`, { priority: cur+1 }); await reloadList(); }
        catch (e) { toast(e.message, false); }
      });
      dec?.addEventListener('click', async () => {
        const cur = Number(prio.textContent.replace('P:','')) || 0;
        try { await call('PATCH', `/api/admin/kb/${id}`, { priority: cur-1 }); await reloadList(); }
        catch (e) { toast(e.message, false); }
      });

      save?.addEventListener('click', async () => {
        const body = {
          title:    q('.title', tr)?.textContent.trim() || '',
          category: q('.cat', tr)?.textContent.trim()   || null,
        };
        try { await call('PATCH', `/api/admin/kb/${id}`, body); toast(`Gespeichert (#${id})`); await reloadList(); }
        catch (e) { toast(e.message, false); }
      });

      del?.addEventListener('click', async () => {
        if (!confirm(`Wirklich löschen (#${id})?`)) return;
        try { await call('DELETE', `/api/admin/kb/${id}`); toast(`Gelöscht (#${id})`); tr.remove(); }
        catch (e) { toast(e.message, false); }
      });
    });
  }

  async function reloadList() {
    try {
      const data = await fetchDocsRobust();
      renderRows(data.items || []);
    } catch (e) {
      console.warn('[KB] list error', e);
      toast(`Liste lädt nicht: ${e.message}`, false);
      // sichtbar Platzhalter
      if (elTBody) elTBody.innerHTML = `<tr><td colspan="9" style="opacity:.7">KB-Liste konnte nicht geladen werden.</td></tr>`;
    }
  }

  // ===== Upload (mehrfach) =====
  async function handleUpload() {
    const files = elFiles?.files ? Array.from(elFiles.files) : [];
    if (!files.length) return toast('Bitte Datei(en) wählen', false);

    elBtnUpload.disabled = true;
    let ok=0, fail=0;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      elTitle?.value.trim() && fd.append('title', elTitle.value.trim());
      elCat?.value.trim()   && fd.append('category', elCat.value.trim());
      elTags?.value.trim()  && fd.append('tags', elTags.value.trim());
      try { await call('POST', '/api/admin/kb/upload', fd, true); ok++; }
      catch (e) { console.warn('upload fail', f.name, e); fail++; }
    }
    elStatus && (elStatus.textContent = `Upload: OK ${ok}, Fehler ${fail}`);
    toast(`Upload: OK ${ok}, Fehler ${fail}`, fail===0);
    elFiles && (elFiles.value = '');
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
    elStatus    = q('#kbStatus');         // optionaler Status-Span
    elSearch    = q('#kbSearch');
    elCatFilter = q('#kbCatFilter');
    elTBody     = q('#kbTable tbody');

    elBtnUpload?.addEventListener('click', handleUpload);

    // Suche/Filter: direkt reload, aber State wird beim fetch hart genullt
    elSearch?.addEventListener('input', () => reloadList());
    elCatFilter?.addEventListener('input', () => reloadList());

    await reloadList();
  });

  // monospace helper
  const st = document.createElement('style');
  st.textContent = `.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;
  document.head.appendChild(st);
})();
