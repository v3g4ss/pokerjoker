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
const TMP = path.join(__dirname, '..', 'uploads_tmp');
fs.mkdirSync(TMP, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP),
    filename: (_req, file, cb) =>
      cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
  }),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// ===== Helpers =====
const toArr = (csv) =>
  (csv || '')
    .toString()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const rmSafe = (p) => { try { fs.unlinkSync(p); } catch {} };

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

    try {
      const buffer = fs.readFileSync(tmpPath);
      rmSafe(tmpPath);

      const out = await ingestOne({
        buffer,
        filename: original,
        mime,
        category,
        tags,
        title
      });

      // Falls Bild: optionale Caption speichern
      if (out?.id && out?.image && caption) {
        await pool.query(
          'UPDATE knowledge_docs SET image_caption=$1 WHERE id=$2',
          [caption, out.id]
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

    if (img && img.startsWith('/uploads/knowledge/')) {
      const full = path.join(__dirname, '..', 'public', img);
      rmSafe(full);
    }

    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('[KB delete] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
