// ============================================================
// routes/admin.js — volle Version mit Brevo-Mailer
// ============================================================

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const tokenDb = require('../utils/tokenDb');
const { getBotConfig, setBotConfig } = require('../utils/botConfig');
const { sendMail } = require('../utils/mailer'); // 💡 jetzt Brevo!
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const { ingestOne } = require('../utils/knowledge');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');
const SALT_ROUNDS = 10;

// Upload-Setup
const tmpDir = path.join(__dirname, '..', 'uploads_tmp');
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, file, cb) =>
    cb(null, Date.now() + '-' + (file.originalname || 'file').replace(/[^\w.\-]+/g, '_')),
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// Helper
const toInt = v => (Number.isNaN(parseInt(v)) ? null : parseInt(v));

// ============================================================
// KPI / Stats
// ============================================================
router.get('/stats', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE NOT is_admin) AS customers,
        (SELECT COUNT(*) FROM users WHERE is_admin) AS admins,
        (SELECT COUNT(*) FROM messages) AS messages_total,
        (SELECT COUNT(*) FROM messages m
         WHERE NOT EXISTS (SELECT 1 FROM message_replies r WHERE r.message_id = m.id)
        ) AS messages_new,
        (SELECT COALESCE(SUM(delta),0) FROM token_ledger WHERE delta > 0) AS tokens_added,
        (SELECT COALESCE(SUM(delta),0) FROM token_ledger WHERE delta < 0) AS tokens_used
    `);
    res.json({ ok: true, ...rows[0] });
  } catch (err) {
    console.error('[ADMIN] KPI Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

// ============================================================
// USERS – Liste / Anlegen / Admin / Sperren / Tokens
// ============================================================
router.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, email, is_admin, is_locked, tokens, purchased, created_at
      FROM users
      ORDER BY id DESC
      LIMIT 100
    `);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[ADMIN] Userliste Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

router.post('/users/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, isAdmin } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, message: 'Email/Passwort fehlt' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, is_admin)
       VALUES ($1,$2,$3) RETURNING id, email, is_admin, created_at`,
      [email.trim().toLowerCase(), hash, !!isAdmin]
    );

    try {
      await sendMail({
        to: email,
        subject: 'Willkommen beim Poker Joker 🃏',
        html: `<p>Hallo ${email}, dein Account wurde erfolgreich angelegt.</p>`,
      });
      console.log('[ADMIN] ✅ Willkommensmail gesendet an', email);
    } catch (e) {
      console.warn('[ADMIN] ⚠️ Mailversand fehlgeschlagen:', e.message);
    }

    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('[ADMIN] Fehler beim Anlegen eines Users:', err);
    res.status(500).json({ ok: false });
  }
});

router.post('/users/:id/lock', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { locked } = req.body;
  await pool.query('UPDATE users SET is_locked=$1 WHERE id=$2', [!!locked, id]);
  res.json({ ok: true });
});

router.post('/users/:id/admin', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { is_admin } = req.body;
  await pool.query('UPDATE users SET is_admin=$1 WHERE id=$2', [!!is_admin, id]);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  await pool.query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true });
});

// ============================================================
// TOKENS / LEDGER
// ============================================================
router.post('/tokens/adjust', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = toInt(req.body.userId);
    const delta = toInt(req.body.delta);
    const reason = req.body.reason || 'admin-adjust';
    if (!userId || !delta) return res.status(400).json({ ok: false, message: 'Ungültige Eingaben' });

    if (delta > 0) await tokenDb.buyTokens(userId, delta, reason);
    else await tokenDb.consumeTokens(userId, Math.abs(delta), reason);

    const balance = (await tokenDb.getTokens(userId)).balance;
    res.json({ ok: true, balance });
  } catch (err) {
    console.error('[ADMIN] Token Adjust Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

router.get('/ledger/last200', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.*, u.email FROM token_ledger l
      JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC
      LIMIT 200
    `);
    res.json({ ok: true, items: rows });
  } catch (err) {
    console.error('[ADMIN] Ledger Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

// ============================================================
// PROMPT TEST
// ============================================================
router.post('/prompt/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { system_prompt = '', input = '' } = req.body || {};
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: input },
      ],
      temperature: 0.7,
    });
    res.json({ ok: true, output: completion.choices[0].message.content });
  } catch (err) {
    console.error('[ADMIN] Prompt Test Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

// ============================================================
// KNOWLEDGE UPLOAD
// ============================================================
router.post('/knowledge/upload', requireAuth, requireAdmin, upload.array('files', 5), async (req, res) => {
  try {
    const results = [];
    for (const f of req.files || []) {
      const full = path.join(tmpDir, f.filename);
      const out = await ingestOne(full, f.originalname);
      results.push(out);
      await fsp.unlink(full).catch(() => {});
    }
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[ADMIN] Knowledge Upload Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

// ============================================================
// MESSAGES – REPLY über Brevo
// ============================================================
router.post('/messages/:id/reply', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const body = (req.body?.body || '').trim();
    const msg = await pool.query('SELECT email, subject FROM messages WHERE id=$1', [id]);
    if (!msg.rows[0]) return res.status(404).json({ ok: false, message: 'Nicht gefunden' });

    const to = msg.rows[0].email;
    const subject = 'Re: ' + (msg.rows[0].subject || '');

    await sendMail({
      to,
      subject,
      html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    });

    await pool.query(
      'INSERT INTO message_replies (message_id, to_email, subject, body, sent_at) VALUES ($1,$2,$3,$4,NOW())',
      [id, to, subject, body]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[ADMIN] Nachrichten-Antwort Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

// ============================================================
// ADMIN PASSWORD CHANGE
// ============================================================
router.post('/password/change', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { oldPass, newPass } = req.body;
    const { rows } = await pool.query('SELECT password FROM users WHERE id=$1', [req.user.id]);
    const match = await bcrypt.compare(oldPass, rows[0].password);
    if (!match) return res.status(403).json({ ok: false, message: 'Falsches Passwort' });

    const hash = await bcrypt.hash(newPass, SALT_ROUNDS);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ ok: true, message: 'Passwort geändert' });
  } catch (err) {
    console.error('[ADMIN] Passwort ändern Fehler:', err);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
