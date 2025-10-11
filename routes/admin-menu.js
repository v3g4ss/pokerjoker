// routes/admin-menu.js
const express = require('express');
const router  = express.Router();

const requireAuth  = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const { pool }     = require('../db');

// === Menü-Einträge (Admin Dashboard) ===
const listItems = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM menu_items
      ORDER BY position, id
    `);
    res.json({ ok: true, items: result.rows });
  } catch (err) {
    console.error('[ADMIN MENU] Fehler beim Laden:', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
  }
};

// === Menüpunkt erstellen ===
const createItem = async (req, res) => {
  const {
    title = 'Neuer Punkt',
    position = 0,
    content_html = '<p>Inhalt kommt später</p>',
    location = 'both',
    is_active = true
  } = req.body || {};

  const key  = 'item-' + Math.random().toString(36).substring(2, 8);
  const slug = 'slug-' + Math.random().toString(36).substring(2, 6);

  try {
    const result = await pool.query(`
      INSERT INTO menu_items (key, title, slug, position, content_html, location, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *;
    `, [key, title, slug, position, content_html, location, is_active]);

    res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error('[ADMIN MENU] Fehler beim Hinzufügen:', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Speichern' });
  }
};

// === Menüpunkt aktualisieren ===
const updateItem = async (req, res) => {
  const { id } = req.params;
  const { title, position, content_html, location, is_active } = req.body || {};

  try {
    await pool.query(`
      UPDATE menu_items SET
        title        = COALESCE($1, title),
        position     = COALESCE($2, position),
        content_html = COALESCE($3, content_html),
        location     = COALESCE($4, location),
        is_active    = COALESCE($5, is_active),
        updated_at   = NOW()
      WHERE id = $6;
    `, [title, position, content_html, location, is_active, id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[ADMIN MENU] Fehler beim Update:', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Update' });
  }
};

// === Menüpunkt löschen ===
const deleteItem = async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ADMIN MENU] Fehler beim Löschen:', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Löschen' });
  }
};

// === Einzelnes Menü laden (für Texteditor) ===
router.get('/menu/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM menu_items WHERE id = $1', [id]);
    if (!result.rows.length)
       return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error('[ADMIN MENU LOAD ERROR]', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
  }
});

// === Öffentliche Route (Login-Seite) ===
router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM menu_items
      WHERE is_active = true
      AND (location = 'login' OR location = 'both')
      ORDER BY position, id;
    `);
    res.json({ ok: true, items: result.rows });
  } catch (err) {
    console.error('[MENU PUBLIC ERROR]', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
  }
});

// === Admin-API (geschützt, aber kein requireAdmin nötig) ===
router.get   ('/menu',     requireAuth, listItems);
router.post  ('/menu',     requireAuth, createItem);
router.put   ('/menu/:id', requireAuth, updateItem);
router.delete('/menu/:id', requireAuth, deleteItem);

// === Alias für alten Admin-Editor (optional behalten) ===
router.get   ('/editor',      requireAuth, requireAdmin, listItems);
router.post  ('/editor',      requireAuth, requireAdmin, createItem);
router.put   ('/editor/:id',  requireAuth, requireAdmin, updateItem);
router.delete('/editor/:id',  requireAuth, requireAdmin, deleteItem);

// === Öffentlicher Einzelaufruf (optional für Login-Seite) ===
router.get('/public/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM menu_items
      WHERE id = $1 AND is_active = true
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Nicht gefunden' });
    res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error('[MENU PUBLIC SINGLE ERROR]', err);
    res.status(500).json({ ok: false, error: 'Fehler beim Laden' });
  }
});

module.exports = router;
