// ================= Poker Joker – Knowledge Admin (schlichte Tabelle) =================

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
  toast._t = setTimeout(() => { el.style.display = 'none'; }, 2200);
}

// ---- API ----
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
    const txt = await r.text().catch(() => '');
    throw new Error(`${r.status} ${r.statusText} ${txt}`);
  }
  return r.json().catch(() => ({}));
}

// ---- Helper für Dateigröße ----
function kbSizeLabel(d) {
  if (d.size_label) return d.size_label;
  if (d.size_human) return d.size_human;
  if (d.file_size_human) return d.file_size_human;

  const bytes = Number(d.size_bytes ?? d.filesize ?? d.file_size ?? d.size ?? 0);
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  const mb = kb / 1024;
  return mb.toFixed(2) + ' MB';
}

// ---- State / DOM ----
let state = { page: 1, limit: 50, q: '', cat: '' };

let elTitle, elCat, elTags, elFiles, elBtnUpload, elStatus;
let elSearch, elCatFilter, elSearchBtn, elReindex, elIndexInfo;
let elTBody;

// ---- LISTE ----
async function fetchDocs() {
  const q = new URLSearchParams();
  q.set('page', state.page);
  q.set('limit', state.limit);
  if (state.q) q.set('q', state.q);
  if (state.cat) q.set('category', state.cat);

  try {
    return await api('GET', `/api/admin/kb/list?${q.toString()}`);
  } catch {
    return await api('GET', `/api/admin/kb/docs?${q.toString()}`);
  }
}

function renderRows(items = []) {
  if (!elTBody) return;

  elTBody.innerHTML = items.map(d => {
    const idActive  = `kb_enabled_${d.id}`;
    const sizeLabel = kbSizeLabel(d);

    return `
      <tr data-id="${d.id}">
        <td class="mono">${d.id}</td>
        <td class="title" contenteditable="true">${esc(d.title || '')}</td>
        <td class="file mono">${esc(d.filename || '')}</td>
        <td class="cat" contenteditable="true">${esc(d.category || '')}</td>
        <td class="tags">${esc(Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || ''))}</td>
        <td style="text-align:center;">
          <input type="checkbox" id="${idActive}" ${d.enabled ? 'checked' : ''}>
          <label for="${idActive}" class="sr-only" style="position:absolute;left:-9999px;">aktiv</label>
        </td>
        <td>
          <input type="number" class="kbPrioInput mono" value="${d.priority ?? 0}" style="width:70px;">
        </td>
        <td>
          <button class="kbSave"   title="Speichern">💾</button>
          <button class="kbDelete" title="Löschen">🗑️</button>
        </td>
        <td class="mono size">${esc(sizeLabel)}</td>
      </tr>`;
  }).join('');

  // Interaktionen je Row
  elTBody.querySelectorAll('tr').forEach(tr => {
    const id        = Number(tr.dataset.id);
    const chk       = tr.querySelector('input[type="checkbox"]');
    const prioInput = tr.querySelector('.kbPrioInput');
    const save      = tr.querySelector('.kbSave');
    const del       = tr.querySelector('.kbDelete');

    if (chk) {
      chk.addEventListener('change', async () => {
        try {
          await api('PATCH', `/api/admin/kb/${id}`, { enabled: chk.checked });
          toast(`Doc #${id} ${chk.checked ? 'aktiviert' : 'deaktiviert'}`);
        } catch (e) {
          toast(e.message, false);
        }
      });
    }

    if (prioInput) {
      const applyPrio = async () => {
        const val = Number(prioInput.value);
        if (!Number.isFinite(val)) return;
        try {
          await api('PATCH', `/api/admin/kb/${id}`, { priority: val });
          toast(`Prio gespeichert (#${id})`);
        } catch (e) {
          toast(e.message, false);
        }
      };
      prioInput.addEventListener('change', applyPrio);
      prioInput.addEventListener('blur', applyPrio);
    }

    if (save) {
      save.addEventListener('click', async () => {
        const body = {
          title:    tr.querySelector('.title')?.textContent.trim() || '',
          category: tr.querySelector('.cat')?.textContent.trim()   || null
        };
        try {
          await api('PATCH', `/api/admin/kb/${id}`, body);
          toast(`Gespeichert (#${id})`);
        } catch (e) {
          toast(e.message, false);
        }
      });
    }

    if (del) {
      del.addEventListener('click', async () => {
        if (!confirm(`Wirklich löschen (#${id})?`)) return;
        try {
          await api('DELETE', `/api/admin/kb/${id}`);
          toast(`Gelöscht (#${id})`);
          tr.remove();
        } catch (e) {
          toast(e.message, false);
        }
      });
    }
  });
}

async function reloadList() {
  try {
    const data = await fetchDocs();
    renderRows(data.items || []);
    const t = $('#kbTotal');
    if (t) t.textContent = data.total ?? (data.items?.length || 0);
  } catch (e) {
    toast(e.message, false);
  }
}

// ---- UPLOAD ----
async function handleUpload() {
  const files = Array.from(elFiles?.files || []);
  if (!files.length) {
    toast('Bitte mindestens eine Datei wählen', false);
    return;
  }

  try {
    elBtnUpload.disabled = true;
    if (elStatus) elStatus.textContent = 'Upload läuft …';

    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      if (elTitle?.value.trim()) fd.append('title', elTitle.value.trim());
      if (elCat?.value.trim())   fd.append('category', elCat.value.trim());
      if (elTags?.value.trim())  fd.append('tags', elTags.value.trim());

      await api('POST', '/api/admin/kb/upload', fd, true);
    }

    toast('Upload OK');
    if (elFiles) elFiles.value = '';
    await reloadList();
  } catch (e) {
    toast(e.message, false);
  } finally {
    elBtnUpload.disabled = false;
    if (elStatus) elStatus.textContent = '';
  }
}

// ---- Reindex ----
async function handleReindex() {
  if (!elReindex) return;
  try {
    elReindex.disabled = true;
    if (elIndexInfo) elIndexInfo.textContent = 'Index wird neu aufgebaut …';
    await api('POST', '/api/admin/kb/reindex');
    if (elIndexInfo) elIndexInfo.textContent = 'Index aktualisiert ✔';
    toast('Suchindex neu aufgebaut');
  } catch (e) {
    if (elIndexInfo) elIndexInfo.textContent = 'Fehler beim Reindex';
    toast(e.message, false);
  } finally {
    elReindex.disabled = false;
    setTimeout(() => {
      if (elIndexInfo) elIndexInfo.textContent = '';
    }, 3000);
  }
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', async () => {
  elTitle      = $('#kbTitle');
  elCat        = $('#kbCategory');
  elTags       = $('#kbTags');
  elFiles      = $('#kbFiles');
  elBtnUpload  = $('#kbUpload');
  elStatus     = $('#kbStatus');
  elSearch     = $('#kbSearch');
  elCatFilter  = $('#kbCatFilter');
  elSearchBtn  = $('#kbSearchBtn');
  elReindex    = $('#kbReindex');
  elIndexInfo  = $('#kbIndexInfo');
  const kbTable = $('#kbTable');
  elTBody      = kbTable ? kbTable.querySelector('tbody') : null;

  elBtnUpload?.addEventListener('click', handleUpload);

  elSearch?.addEventListener('input', (e) => {
    state.q = e.target.value.trim();
    state.page = 1;
    reloadList();
  });

  elCatFilter?.addEventListener('input', (e) => {
    state.cat = e.target.value.trim();
    state.page = 1;
    reloadList();
  });

  elSearchBtn?.addEventListener('click', () => {
    state.page = 1;
    reloadList();
  });

  elReindex?.addEventListener('click', handleReindex);

  await reloadList();
});

// ---- kleine Hilfsklasse für Monospace ----
(function injectMono() {
  const s = document.createElement('style');
  s.textContent = `.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}`;
  document.head.appendChild(s);
})();
