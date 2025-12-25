// routes/admin-kb.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const { ingestOne } = require('../utils/knowledge');

const router = express.Router();

// ===== Multer: temporäres Upload-Verzeichnis =====
// Wichtig: Uploads werden (kurzzeitig) in ein temp-dir geschrieben und nach `ingestOne()` wieder gelöscht.
// Bilder werden innerhalb von `utils/knowledge.ingestOne()` final gespeichert (Render Persistent Disk /data).
const TMP_DIR = process.env.UPLOAD_TMP_DIR || path.join(process.cwd(), 'uploads_tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

// ===== Knowledge Upload Base Dir (Render Persistent Disk) =====
// Wird primär für Bild-Auslieferung & Delete-Fallbacks genutzt.
// Unter Windows (lokal) nicht auf /data schreiben.
const DEFAULT_KB_DISK_DIR = process.platform === 'win32'
  ? path.join(process.cwd(), 'public', 'uploads', 'knowledge')
  : '/data/uploads/knowledge';
const KB_DISK_DIR = process.env.KB_DISK_DIR || DEFAULT_KB_DISK_DIR;
try {
  fs.mkdirSync(KB_DISK_DIR, { recursive: true });
} catch (e) {
  console.warn('[admin-kb] cannot mkdir KB_DISK_DIR:', KB_DISK_DIR, e?.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (req, file, cb) => {
    const safe = (file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({ storage });

// ===== Helpers =====
const toArr = (csv) =>
  (csv || '')
    .toString()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const rmSafe = (p) => { try { fs.unlinkSync(p); } catch {} };

/** Normalisiert einen DB-Relativpfad wie '/uploads/knowledge/...' zu 'uploads/knowledge/...'
 * damit path.join nicht auf Root springt. */
function normalizeRel(rel) {
  return String(rel || '').replace(/^\/+/, '');
}

function isAllowedUploadPath(rel) {
  // Prevent path traversal / arbitrary file reads.
  const s = String(rel || '').replace(/\\/g, '/');
  return s.startsWith('uploads/knowledge/');
}

/** Lese image_url & enabled für ein Doc */
async function getDocImageMeta(id) {
  const { rows } = await pool.query(
    'SELECT image_url, enabled FROM knowledge_docs WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

// ===================================================================================
// PUBLIC: GET /api/admin/kb/img/:id  -> liefert Bilddatei per stabiler ID-URL
//  - kein requireAuth/Admin: soll im Live-Bot/Frontend eingebettet werden können
//  - liefert 404, wenn Doc nicht existiert, nicht enabled oder kein image_url
// ===================================================================================
router.get('/kb/img/:value', async (req, res) => {
  try {
    const value = req.params.value;
    console.log('[DEBUG] Image request for:', value);

    let doc;
    if (/^\d+$/.test(value)) {
      // → ist ID
      console.log('[DEBUG] Looking up by ID:', value);
      doc = await getDocImageMeta(parseInt(value, 10));
    } else {
      // → ist ein Dateiname
      console.log('[DEBUG] Looking up by filename:', value);

      // WICHTIG: In der DB steht image_url i.d.R. als "uploads/knowledge/<file>"
      // oder "/uploads/knowledge/<file>" – wir suchen robust nach beidem.
      const p1 = 'uploads/knowledge/' + value;
      const p2 = '/uploads/knowledge/' + value;

      const q = await pool.query(
        `SELECT * FROM knowledge_docs
         WHERE enabled = true
           AND (image_url = $1 OR image_url = $2)
         LIMIT 1`,
        [p1, p2]
      );

      doc = q.rows[0];
      console.log('[DEBUG] Found doc:', doc ? 'YES' : 'NO', doc?.id);
    }

    if (!doc || !doc.image_url) {
      console.log('[DEBUG] No doc found or no image_url');
      return res.status(404).send('Not found');
    }

    // For the ID lookup we also have `enabled`. Enforce it for public access.
    if (doc.enabled === false) {
      return res.status(404).send('Not found');
    }

    const relPath = normalizeRel(doc.image_url); // z.B. "uploads/knowledge/123-file.jpg"
    if (!isAllowedUploadPath(relPath)) {
      console.log('[DEBUG] Blocked non-knowledge path:', relPath);
      return res.status(404).send('Not found');
    }

    const filename = path.basename(relPath);
    const absDisk = path.join(KB_DISK_DIR, filename);

    // Fallbacks (Altbestand / lokale Pfade)
    const absPublic = path.join(process.cwd(), 'public', relPath);
    const absProject = path.join(process.cwd(), relPath);

    const candidates = [absDisk, absPublic, absProject];

    let foundPath = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      console.warn('[KB IMG] File not found in any location:', candidates);
      return res.status(404).send('Image not found');
    }

    console.log('[DEBUG] Serving image from:', foundPath);
    return res.sendFile(foundPath);
  } catch (err) {
    console.error('[KB IMG] Error:', err);
    return res.status(500).send('Server error');
  }
});

// ===================================================================================
// POST /api/admin/kb/upload   (multipart/form-data; field "file")
// Body (optional): title, category, tags (comma separated), caption
// ===================================================================================
router.post('/kb/upload',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Keine Datei hochgeladen' });
    }

    const tmpPath  = req.file.path;
    const original = req.file.originalname;
    const mime     = req.file.mimetype;
    const size     = req.file.size;

    const title    = (req.body?.title || original).toString();
    const category = (req.body?.category || '').toString().trim() || null;
    const tags     = toArr(req.body?.tags);
    const caption  = (req.body?.caption || '').toString().trim();
    const label    = (req.body?.label || '').toString().trim();

    try {
      const buffer = fs.readFileSync(tmpPath);
      rmSafe(tmpPath);

      const out = await ingestOne({
        buffer,
        filename: original,
        mime,
        category,
        tags,
        title,
        label  // <--- NEU!
      });

      // Falls Bild: optionale Caption speichern
if (out?.id && out?.image && caption) {
  await pool.query(
    'UPDATE knowledge_docs SET image_caption=$1 WHERE id=$2',
    [caption, out.id]
  );
}

    // === NEU: original_name zusätzlich speichern (für Bild-/File-Suche im Bot) ===
    if (out?.id) {
      await pool.query(
        `UPDATE knowledge_docs
          SET original_name = $1
        WHERE id = $2`,
        [original, out.id] // original = req.file.originalname
      );
    }

    res.json({
      ok: true,
      id: out?.id,
      chunks: out?.chunks ?? 0,
      image: out?.image || null,
      filename: original,
      size
    });
    } catch (err) {
      rmSafe(tmpPath);
      console.error('[KB upload] error:', err);
      res.status(500).json({ ok: false, error: err.message || 'Upload fehlgeschlagen' });
    }
  }
);

  // ===================================================================================
// POST /api/admin/kb/image   (NUR Bilder für Bot-Visuals)
// Pflicht: file, title, tags
// ===================================================================================
router.post('/kb/image',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Keine Datei' });
    }

    const { title, caption, tags } = req.body;
    if (!title || !tags) {
      return res.status(400).json({ ok: false, error: 'Titel und Tags sind Pflicht' });
    }

    // Basic validation: only allow images on this endpoint.
    const mime = String(req.file.mimetype || '');
    if (!mime.startsWith('image/')) {
      rmSafe(req.file.path);
      return res.status(400).json({ ok: false, error: 'Nur Bilddateien erlaubt' });
    }

    try {
      const buffer = fs.readFileSync(req.file.path);
      rmSafe(req.file.path);

      const out = await ingestOne({
  buffer,
  filename: req.file.originalname,
  mime,
  category: 'Bilder',
  tags: toArr(tags),
  title: title.toString(),
  label: null
});

// 🔥 EINMALIGES Update
if (out?.id) {
  const tagArr = toArr(tags);

  await pool.query(
    `
    UPDATE knowledge_docs
    SET
      tags = $1,
      label = $2,
      image_caption = $3
    WHERE id = $4
    `,
    [
      tagArr,
      tagArr[0] || null,
      caption ? caption.toString() : null,
      out.id
    ]
  );
}

      res.json({ ok: true, id: out?.id });
    } catch (err) {
      console.error('[KB IMAGE]', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ===================================================================================
/**
 * GET /api/admin/kb/list?page=1&limit=20&q=term
 *  - einfache Liste mit Pagination + Suchfilter (title/filename/tags/category)
 * Alias für Abwärtskompatibilität:
 * GET /api/admin/kb/docs -> gleiche Antwort
 */
// ===================================================================================
async function listHandler(req, res) {
  const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
  const off   = (page - 1) * limit;
  const q     = (req.query.q || '').toString().trim();

  try {
    const params = [];
    let where = '1=1';

    if (q) {
      // title / filename / tags / category
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      //         t                f                tags                   category
      where += ` AND (
        title ILIKE $${params.length - 3}
        OR filename ILIKE $${params.length - 2}
        OR COALESCE(array_to_string(tags, ','),'') ILIKE $${params.length - 1}
        OR COALESCE(category,'') ILIKE $${params.length}
      )`;
    }

    const { rows: items } = await pool.query(
      `
      SELECT id, title, filename, mime, size_bytes, category, tags,
             enabled, priority, image_url, image_caption, created_at
      FROM knowledge_docs
      WHERE ${where}
      ORDER BY id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, off]
    );

    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM knowledge_docs WHERE ${where}`,
      params
    );

    res.json({ ok: true, items, total: count, page, limit });
  } catch (err) {
    console.error('[KB list] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
router.get('/kb/list', requireAuth, requireAdmin, listHandler);
router.get('/kb/docs', requireAuth, requireAdmin, listHandler); // Alias

// ===================================================================================
// PATCH /api/admin/kb/:id
// Body: enabled?, priority?, title?, category?, caption?, tags?
// ===================================================================================
router.patch('/kb/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'Ungültige ID' });

  const fields = [];
  const values = [];
  let p = 1;

  const push = (col, val) => { fields.push(`${col}=$${p++}`); values.push(val); };

  if (typeof req.body?.enabled === 'boolean') push('enabled', req.body.enabled);
  if (req.body?.priority !== undefined) push('priority', parseInt(req.body.priority || 0, 10));
  if (req.body?.title !== undefined) push('title', String(req.body.title || ''));
  if (req.body?.category !== undefined) push('category', req.body.category ? String(req.body.category) : null);
  if (req.body?.caption !== undefined) push('image_caption', String(req.body.caption || ''));
  if (req.body?.tags !== undefined) push('tags', Array.isArray(req.body.tags) ? req.body.tags : toArr(req.body.tags));

  if (!fields.length) return res.json({ ok: true, updated: 0 });

  try {
    values.push(id);
    const { rowCount } = await pool.query(
      `UPDATE knowledge_docs SET ${fields.join(', ')} WHERE id=$${p}`,
      values
    );
    res.json({ ok: true, updated: rowCount });
  } catch (err) {
    console.error('[KB patch] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===================================================================================
// DELETE /api/admin/kb/:id   (löscht Doc, Chunks und ggf. Bilddatei)
// ===================================================================================
router.delete('/kb/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'Ungültige ID' });

  try {
    const { rows } = await pool.query(
      'SELECT image_url FROM knowledge_docs WHERE id=$1',
      [id]
    );
    const img = rows[0]?.image_url;

    await pool.query('BEGIN');
    await pool.query('DELETE FROM knowledge_chunks WHERE doc_id=$1', [id]);
    const { rowCount } = await pool.query('DELETE FROM knowledge_docs WHERE id=$1', [id]);
    await pool.query('COMMIT');

    if (img) {
      const rel = normalizeRel(img);
      if (isAllowedUploadPath(rel)) {
        const filename = path.basename(rel);

        rmSafe(path.join(KB_DISK_DIR, filename));                              // Persistent (oder lokaler Fallback)
        rmSafe(path.join(__dirname, '..', 'public', rel));                     // Altbestand
        rmSafe(path.join(__dirname, '..', rel));                               // Legacy
      }
    }

    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('[KB delete] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
