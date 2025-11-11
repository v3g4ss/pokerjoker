// ================= Poker Joker – Knowledge Admin (Bild-Preview & Caption) =================

// ---- Helpers ----
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function toast(msg, ok = true) {
  console[ok ? 'log' : 'warn'](`[KB] ${msg}`);
  let el = $('#kbToast');
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
  toast._t = setTimeout(() => el.style.display = 'none', 2200);
}

function fmtSize(n) {
  if (n == null) return '';
  const u = ['B','KB','MB','GB']; let i=0, x=Number(n);
  while (x>=1024 && i<u.length-1) { x/=1024; i++; }
  return `${x.toFixed(i?1:0)} ${u[i]}`;
}

// ---- API ----
async function api(method, url, body, isForm = false) {
  const opt = { method, credentials: 'include', headers: {} };
  if (body && !isForm) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (body &&  isForm) { opt.body = body; }
  const r = await fetch(url, opt);
  if (!r.ok) {
    const txt = await r.text().catch(()=> '');
    throw new Error(`${r.status} ${r.statusText} ${txt}`);
  }
  return r.json().catch(()=> ({}));
}

// ---- State / DOM ----
let state = { page: 1, limit: 20, q: '', cat: '' };

let elTitle, elCat, elTags, elCaption, elFile, elBtnUpload;
let elSearch, elCatFilter;
let elTBody;

// ---- LISTE ----
async function fetchDocs() {
  const q = new URLSearchParams();
  q.set('page', state.page);
  q.set('limit', state.limit);
  if (state.q)  q.set('q', state.q);
  if (state.cat) q.set('category', state.cat);

  try {
    return await api('GET', `/api/admin/kb/list?${q.toString()}`);
  } catch {
    // harter Fallback
    return await api('GET', `/api/admin/kb/docs?${q.toString()}`);
  }
}

function renderRows(items = []) {
  if (!elTBody) return; // Guard
  elTBody.innerHTML = items.map(d => {
    const idActive = `kb_enabled_${d.id}`;
    const isImg    = !!d.image_url;
    const thumb    = isImg
      ? `<img src="${esc(d.image_url)}" alt="img" class="kb-thumb"
               style="width:48px;height:48px;object-fit:cover;border-radius:8px;cursor:pointer"
               data-full="${esc(d.image_url)}">`
      : `<span class="mono">${esc((d.mime||'').split('/')[1] || 'txt')}</span>`;
    const capInput = isImg
      ? `<input type="text" class="kbCaption" value="${esc(d.image_caption||'')}"
                placeholder="Caption (optional)" style="width:220px">`
      : '';

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
        <td>${capInput}</td>
        <td class="mono" title="${esc(d.mime||'')}">${fmtSize(d.size_bytes)}</td>
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

  // Interaktionen je Row
  elTBody.querySelectorAll('tr').forEach(tr => {
    const id   = Number(tr.dataset.id);
    const chk  = tr.querySelector('input[type="checkbox"]');
    const inc  = tr.querySelector('.kbPrioInc');
    const dec  = tr.querySelector('.kbPrioDec');
    const prio = tr.querySelector('.prio');
    const save = tr.querySelector('.kbSave');
    const del  = tr.querySelector('.kbDelete');
    const cap  = tr.querySelector('.kbCaption');
    const img  = tr.querySelector('img.kb-thumb');

    if (img) img.addEventListener('click', () => window.open(img.getAttribute('data-full'), '_blank'));

    if (chk) chk.addEventListener('change', async () => {
      try { await api('PATCH', `/api/admin/kb/${id}`, { enabled: chk.checked }); toast(`Doc #${id} ${chk.checked?'aktiviert':'deaktiviert'}`); }
      catch (e) { toast(e.message, false); }
    });

    if (inc) inc.addEventListener('click', async () => {
      const cur = Number(prio.textContent.replace('P:','')) || 0;
      try { await api('PATCH', `/api/admin/kb/${id}`, { priority: cur + 1 }); await reloadList(); }
      catch (e) { toast(e.message, false); }
    });
    if (dec) dec.addEventListener('click', async () => {
      const cur = Number(prio.textContent.replace('P:','')) || 0;
      try { await api('PATCH', `/api/admin/kb/${id}`, { priority: cur - 1 }); await reloadList(); }
      catch (e) { toast(e.message, false); }
    });

    if (save) save.addEventListener('click', async () => {
      const body = {
        title:    tr.querySelector('.title')?.textContent.trim() || '',
        category: tr.querySelector('.cat')?.textContent.trim()   || null,
      };
      if (cap) body.caption = cap.value.trim();
      try { await api('PATCH', `/api/admin/kb/${id}`, body); toast(`Gespeichert (#${id})`); await reloadList(); }
      catch (e) { toast(e.message, false); }
    });

    if (del) del.addEventListener('click', async () => {
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
    const t = $('#kbTotal'); if (t) t.textContent = data.total ?? (data.items?.length || 0);
  } catch (e) { toast(e.message, false); }
}

// ---- UPLOAD ----
async function handleUpload() {
  const f = elFile.files?.[0];
  if (!f) return toast('Bitte eine Datei wählen', false);

  const fd = new FormData();
  fd.append('file', f);
  if (elTitle?.value.trim())   fd.append('title',    elTitle.value.trim());
  if (elCat?.value.trim())     fd.append('category', elCat.value.trim());
  if (elTags?.value.trim())    fd.append('tags',     elTags.value.trim());
  if (elCaption?.value.trim()) fd.append('caption',  elCaption.value.trim());

  try {
    elBtnUpload.disabled = true;
    const res = await api('POST', '/api/admin/kb/upload', fd, true);
    toast(`Upload OK (#${res.id}${res.image ? ' – Bild' : ''})`);
    if (elFile) elFile.value = '';
    if (elCaption) elCaption.value = '';
    await reloadList();
  } catch (e) {
    toast(e.message, false);
  } finally {
    elBtnUpload.disabled = false;
  }
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', async () => {
  elTitle     = $('#kbTitle');
  elCat       = $('#kbCategory');
  elTags      = $('#kbTags');
  elCaption   = $('#kbCaption');
  elFile      = $('#kbFile');
  elBtnUpload = $('#kbUploadBtn');
  elSearch    = $('#kbSearch');
  elCatFilter = $('#kbCatFilter');
  elTBody     = $('#kbTableBody');

  elBtnUpload?.addEventListener('click', handleUpload);
  elSearch?.addEventListener('input', e => { state.q = e.target.value.trim(); state.page = 1; reloadList(); });
  elCatFilter?.addEventListener('change', e => { state.cat = e.target.value.trim(); state.page = 1; reloadList(); });

  await reloadList();
});

// ---- kleine Hilfsklasse für Monospace ----
(function injectMono() {
  const s = document.createElement('style');
  s.textContent = `.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;
  document.head.appendChild(s);
})();
