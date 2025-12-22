const crypto = require('crypto');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');

const { JSDOM } = (() => { try { return require('jsdom'); } catch { return {}; } })();
let pdfParse = null, mammoth = null, xlsx = null;
try { pdfParse = require('pdf-parse'); } catch {}
try { mammoth = require('mammoth'); } catch {}
try { xlsx = require('xlsx'); } catch {}

const MAX_TEXT_CHARS = 400_000;

// Normalizes a DB relative path like '/uploads/knowledge/x.png' to 'uploads/knowledge/x.png'
// so path.join does not jump to drive root.
function normalizeRel(rel) {
  return String(rel || '').replace(/^\/+/g, '');
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const ext = (name = '') => (name.split('.').pop() || '').toLowerCase();
const looksSecret = (s) => /(api[_-]?key|bearer|sk-|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/i.test(s);
const approxTokens = (s = '') => Math.ceil(s.length / 4);

function chunkify(text, size = 3500, overlap = 600) {
  if (!text) return [];
  const len = text.length;
  if (len <= size) {
    return [{ ord: 0, text, token_count: approxTokens(text) }];
  }
  const step = Math.max(1, size - overlap);
  const out = [];
  let i = 0;
  while (i < len) {
    const end = Math.min(i + size, len);
    const slice = text.slice(i, end);
    out.push({ ord: out.length, text: slice, token_count: approxTokens(slice) });
    if (end >= len) break;
    i += step;
  }
  return out;
}

async function extractText(buffer, filename, mime = '') {
  const e = ext(filename);

  if (e === 'jsonl') {
    return buffer.toString('utf8').split(/\r?\n/).filter(Boolean).join('\n');
  }
  if (['csv', 'md', 'txt', 'yaml', 'yml'].includes(e)) {
    return buffer.toString('utf8');
  }
  if (e === 'html' && JSDOM) {
    const dom = new JSDOM(buffer.toString('utf8'));
    return dom.window.document.body.textContent || '';
  }
  if (e === 'pdf' && pdfParse) {
    const { text } = await pdfParse(buffer);
    return text || '';
  }
  if (e === 'docx' && mammoth) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value || '';
  }
  if (e === 'xlsx' && xlsx) {
    const wb = xlsx.read(buffer, { type: 'buffer' });
    return wb.SheetNames.map(n => xlsx.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
  }
  return buffer.toString('utf8');
}

/* =========================================================
   INGEST
========================================================= */
async function ingestOne({ buffer, filename, mime, category, tags, title, label }) {
  const hash = sha(buffer);
  const e = ext(filename || '');
  const isImage = ['png', 'jpg', 'jpeg'].includes(e);
  const normTags = Array.isArray(tags) && tags.length ? tags : null;

  const dupe = await pool.query('SELECT id FROM knowledge_docs WHERE hash=$1', [hash]);
  if (dupe.rows[0]) return { id: dupe.rows[0].id, skipped: true };

  /* ---------- IMAGE ---------- */
  if (isImage || (mime && mime.startsWith('image/'))) {
    const imgName = `${Date.now()}-${String(filename).replace(/\s+/g, '_')}`;
    const relPath = `/uploads/knowledge/${imgName}`;
    const absPath = path.join(__dirname, '..', 'public', normalizeRel(relPath));

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, buffer);

    const { rows } = await pool.query(`
      INSERT INTO knowledge_docs
        (title, filename, mime, size_bytes, category, tags, label, hash, image_url, original_name, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      RETURNING id
    `, [
      title || filename,
      filename,
      mime || `image/${e || 'png'}`,
      buffer.length,
      category || null,
      normTags,
      label || null,
      hash,
      relPath,
      filename
    ]);

    return { id: rows[0].id, image: relPath };
  }

  /* ---------- TEXT ---------- */
  let content = await extractText(buffer, filename, mime) || '';
  if (content.length > MAX_TEXT_CHARS) content = content.slice(0, MAX_TEXT_CHARS);
  if (looksSecret(content)) console.warn('[knowledge] possible secret in', filename);

  const ins = await pool.query(
    `
    INSERT INTO knowledge_docs
      (title, filename, mime, size_bytes, category, tags, hash, image_url, original_name, label, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,NOW())
    RETURNING id
    `,
    [
      title || filename,
      filename,
      mime || 'application/octet-stream',
      buffer.length,
      category || null,
      normTags,
      hash,
      filename,
      label || null
    ]
  );

  const doc_id = ins.rows[0].id;
  const chunks = chunkify(content);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of chunks) {
      await client.query(
        `INSERT INTO knowledge_chunks (doc_id, ord, text, token_count)
         VALUES ($1,$2,$3,$4)`,
        [doc_id, c.ord, c.text, c.token_count]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { id: doc_id, chunks: chunks.length };
}

/* =========================================================
   SEARCH
========================================================= */
async function searchChunks(q, categories = [], topK = 5) {
  const term = String(q || '').trim();
  if (!term) return [];

  /* ---------- TEXT ---------- */
  const params = [term];
  let where = `kc.tsv @@ websearch_to_tsquery('simple', $1) AND kd.enabled = TRUE`;
  if (categories.length) {
    where += ` AND kd.category = ANY($${params.length + 1})`;
    params.push(categories);
  }

  const sql = `
    SELECT kc.id, kc.doc_id, kc.ord, kc.text,
           kd.title, kd.filename, kd.category, kd.tags, kd.label,
           kd.priority, kd.image_url, kd.original_name,
           kd.filename AS source
    FROM knowledge_chunks kc
    JOIN knowledge_docs kd ON kd.id = kc.doc_id
    WHERE ${where}
    ORDER BY kd.priority DESC, kc.id DESC
    LIMIT $${params.length + 1};
  `;
  params.push(topK);

  const { rows } = await pool.query(sql, params);
  let out = rows;

  /* ---------- IMAGE FALLBACK ---------- */
  const needle = `%${term}%`;
  const imgSql = `
    SELECT kd.id, NULL AS ord, NULL AS text,
           kd.title, kd.filename, kd.category, kd.tags, kd.label,
           kd.priority, kd.image_url, kd.original_name,
           kd.filename AS source
    FROM knowledge_docs kd
    WHERE kd.enabled = TRUE
      AND kd.image_url IS NOT NULL
      AND (
        kd.title ILIKE $1 OR
        kd.filename ILIKE $1 OR
        kd.original_name ILIKE $1 OR
        COALESCE(array_to_string(kd.tags, ','), '') ILIKE $1 OR
        COALESCE(kd.label, '') ILIKE $1
      )
    ORDER BY kd.priority DESC, kd.id DESC
    LIMIT $2;
  `;

  const { rows: imgs } = await pool.query(imgSql, [needle, topK]);
  out = [...out, ...imgs];

  return out.slice(0, topK);
}

module.exports = { ingestOne, searchChunks };
