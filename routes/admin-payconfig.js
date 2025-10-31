// routes/admin-payconfig.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');

// === GET: aktuelle Konfig ===
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings WHERE id = 1');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /payconfig]', err);
    res.status(500).json({ error: 'Serverfehler beim Laden' });
  }
});

// === POST: Update Konfig ===
router.post('/', async (req, res) => {
  try {
    const { price_eur, token_amount } = req.body;
    await pool.query(
      'UPDATE settings SET price_eur = $1, token_amount = $2, updated_at = NOW() WHERE id = 1',
      [price_eur, token_amount]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /payconfig]', err);
    res.status(500).json({ error: 'Serverfehler beim Speichern' });
  }
});

module.exports = router;
