const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const pool = require('../db');

const router = express.Router();
const upload = multer({ dest: 'uploads_tmp/' });

router.post('/', upload.single('image'), async (req, res) => {
  const { title, description } = req.body;
  const file = req.file;

  if (!file || !title || !description) {
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

    // === In Knowledge Base speichern ===
    await pool.query(`
      INSERT INTO kb_chunks (title, content, filename, type)
      VALUES ($1, $2, $3, 'image')
    `, [title, syntheticText, filename]);

    return res.json({ success: true, filename });
  } catch (err) {
    console.error('[UPLOAD-IMG]', err);
    return res.status(500).json({ error: 'Fehler beim Upload' });
  }
});

module.exports = router;
