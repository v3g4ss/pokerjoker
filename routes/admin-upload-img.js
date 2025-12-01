// routes/admin-upload-img.js
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

  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}_${file.originalname}`;
  const targetPath = path.join('public/kb_imgs', filename);

  try {
    // Bild verschieben
    fs.renameSync(file.path, targetPath);

    // Beschreibung als .txt simulieren
    const syntheticText = `Bild: ${title}\nBeschreibung: ${description}\nDateiname: ${filename}`;
    
    // Optional: in KB speichern
    await pool.query(`
      INSERT INTO kb_chunks (title, content, filename, type)
      VALUES ($1, $2, $3, 'image')
    `, [title, syntheticText, filename]);

    res.json({ success: true, filename });
  } catch (err) {
    console.error('[UPLOAD-IMG]', err);
    res.status(500).json({ error: 'Fehler beim Upload' });
  }
});

module.exports = router;
