const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
// === const pool = require('../db');
const { pool } = require('../db');

const router = express.Router();
const upload = multer({ dest: 'uploads_tmp/' });

router.post('/', upload.single('image'), async (req, res) => {
  const { title, description, category } = req.body;
  const file = req.file;

  if (!file || !title || !description || !category) {
    return res.status(400).json({ error: 'Fehlende Daten' });
  }

  try {
    // === Zielordner sicherstellen ===
    const targetDir = path.join(__dirname, '..', 'public', 'kb_imgs');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // === Dateiname bereinigen ===
    const ext = path.extname(file.originalname) || '.jpg';
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_\-äöüÄÖÜß]/gi, '_');
    const filename = `${Date.now()}_${base}${ext}`;
    const targetPath = path.join(targetDir, filename);

    // === Bild verschieben ===
    fs.renameSync(file.path, targetPath);

    // === Beschreibungstext generieren ===
    const syntheticText = `Bild: ${title}\nBeschreibung: ${description}\nDateiname: ${filename}`;

    // === Metadaten extrahieren ===
    const mimeType = file.mimetype;
    const fileSize = file.size;
    const tokenCount = Math.ceil(syntheticText.length / 4); // einfache Schätzung

    // === In knowledge_docs speichern ===
    const docRes = await pool.query(`
      INSERT INTO knowledge_docs (title, filename, mime, size_bytes, category)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [title, filename, mimeType, fileSize, category]);

    const docId = docRes.rows[0].id;

    // === In knowledge_chunks eintragen ===
    await pool.query(`
      INSERT INTO knowledge_chunks (doc_id, ord, text, token_count)
      VALUES ($1, 0, $2, $3)
    `, [docId, syntheticText, tokenCount]);

    // === original_name setzen für Bot-Suche ===
    await pool.query(
      `UPDATE knowledge_docs SET original_name = $1 WHERE id = $2`,
      [file.originalname, docId]
    );

    return res.json({ success: true, filename });
  } catch (err) {
    console.error('[UPLOAD-IMG]', err);
    return res.status(500).json({ error: 'Fehler beim Upload' });
  }
});

module.exports = router;
