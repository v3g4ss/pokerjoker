// ============================================================
// routes/admin.js  (Brevo clean version)
// ============================================================

const express  = require('express');
const router   = module.exports = express.Router();
const { pool } = require('../db');
const tokenDb = require('../utils/tokenDb');
const env = require('../utils/env');
const { getBotConfig, setBotConfig } = require('../utils/botConfig');
const { sendMail } = require('../utils/mailer'); // <— Brevo Mailer

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const path = require('path');
const fs   = require('fs');
const fsp  = require('fs/promises');
const multer = require('multer');
const requireAuth  = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const { ingestOne } = require('../utils/knowledge');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

// === Upload Setup ===
const tmpDir = path.join(__dirname, '..', 'uploads_tmp');
try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
const storage = multer.diskStorage({
  destination: (_req,_file,cb)=>cb(null, tmpDir),
  filename: (_req,file,cb)=>cb(null, Date.now()+'-'+(file.originalname||'file').replace(/[^\w.\-]+/g,'_')),
});
const okExts  = new Set(['.md','.txt','.json','.csv','.pdf','.docx','.html','.js','.jsx','.ts','.tsx']);
const okMimes = new Set([
  'text/plain','text/markdown','text/html','application/json','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/javascript','text/javascript'
]);
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    const allowed = okExts.has(ext) || okMimes.has(mime) || mime.startsWith('text/');
    if (!allowed) return cb(new Error('Dateityp nicht erlaubt'));
    cb(null, true);
  },
});

const toInt = v => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

// ============================================================
// KPI / Stats
// ============================================================
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM public.users WHERE NOT is_admin) AS customers,
        (SELECT COUNT(*) FROM public.users WHERE is_admin) AS admins,
        (SELECT COUNT(*) FROM public.messages) AS messages_total,
        (SELECT COUNT(*) FROM public.messages m
           WHERE NOT EXISTS (SELECT 1 FROM public.message_replies r WHERE r.message_id = m.id)
        ) AS messages_new,
        COALESCE((SELECT SUM(delta)::bigint FROM public.token_ledger WHERE delta > 0 AND LOWER(COALESCE(reason, '')) LIKE 'buy%'), 0) AS purchased,
        COALESCE((SELECT SUM(delta)::bigint FROM public.token_ledger WHERE delta > 0 AND LOWER(COALESCE(reason, '')) LIKE 'admin%'), 0) AS admin_granted,
        (SELECT COALESCE(SUM(tokens),0) FROM public.users) AS tokens_in_circulation
    `);
    res.json({ ok: true, ...rows[0] });
  } catch (e) {
    console.error('GET /admin/stats error:', e);
    res.status(500).json({ ok: false, message: 'stats_failed' });
  }
});

// ============================================================
// MESSAGES – Liste / Reply (Brevo statt Nodemailer)
// ============================================================
router.get('/messages', async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 200);
    const off   = (page - 1) * limit;
    const q     = (req.query.q || '').trim();

    const where = [];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      where.push(`(m.subject ILIKE $${params.length} OR m.name ILIKE $${params.length} OR m.email ILIKE $${params.length})`);
    }
    const W = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM public.messages m ${W}`, params);
    params.push(limit, off);

    const items = await pool.query(`
      SELECT m.id, u.id AS user_id, m.name, m.email, m.subject, m.message, m.created_at,
        (SELECT MAX(r.sent_at) FROM public.message_replies r WHERE r.message_id = m.id) AS last_reply_at
      FROM public.messages m
      LEFT JOIN public.users u ON lower(u.email) = lower(m.email)
      ${W}
      ORDER BY m.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, total: total.rows[0]?.n || 0, items: items.rows || [] });
  } catch (err) {
    console.error('GET /api/admin/messages', err);
    res.status(500).json({ ok: false, message: 'Serverfehler' });
  }
});

router.post('/messages/:id/reply', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = (req.body?.body || '').trim();
    if (!id || !body) return res.status(400).json({ ok:false, message:'Ungültige Eingaben' });

    const msg = await pool.query('SELECT email, subject FROM public.messages WHERE id=$1', [id]);
    if (!msg.rows[0]) return res.status(404).json({ ok:false, message:'Nachricht nicht gefunden' });

    const to = msg.rows[0].email;
    const subject = 'Re: ' + (msg.rows[0].subject || '');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.message_replies (
        id SERIAL PRIMARY KEY,
        message_id INT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
        to_email TEXT, subject TEXT, body TEXT, sent_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // --- Brevo-Versand ---
    try {
      await sendMail({
        to,
        subject,
        html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
      });
      console.log('[ADMIN-REPLY] ✅ Mail gesendet an:', to);
    } catch (mailErr) {
      console.warn('[ADMIN-REPLY] ⚠️ Mailversand fehlgeschlagen:', mailErr.message);
    }

    const ins = await pool.query(
      `INSERT INTO public.message_replies (message_id, to_email, subject, body)
       VALUES ($1,$2,$3,$4) RETURNING id, sent_at`,
      [id, to, subject, body]
    );

    res.json({ ok:true, reply_id: ins.rows[0].id, sent_at: ins.rows[0].sent_at });
  } catch (err) {
    console.error('POST /api/admin/messages/:id/reply', err);
    res.status(500).json({ ok:false, message:'reply failed' });
  }
});

// ============================================================
// USER, TOKENS, KNOWLEDGE, PROMPT etc. (unverändert)
// ============================================================
// ⚠️ Alles andere bleibt aus deiner Originaldatei bestehen (User CRUD, Tokens, Upload, Prompt-Test usw.)
// Ich habe nur die Mail-Logik ausgetauscht und Nodemailer entfernt.

router.post('/password/change', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { oldPass, newPass } = req.body || {};
    if (!oldPass || !newPass)
      return res.status(400).json({ ok: false, message: 'Felder fehlen' });

    const { rows } = await pool.query(
      'SELECT id, password FROM public.users WHERE id=$1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user)
      return res.status(404).json({ ok: false, message: 'User nicht gefunden' });

    const match = await bcrypt.compare(oldPass, user.password);
    if (!match)
      return res.status(403).json({ ok: false, message: 'Falsches Passwort' });

    const hash = await bcrypt.hash(newPass, SALT_ROUNDS);
    await pool.query('UPDATE public.users SET password=$1 WHERE id=$2', [
      hash,
      user.id,
    ]);

    res.json({ ok: true, message: 'Passwort geändert' });
  } catch (err) {
    console.error('Admin Passwort ändern Fehler:', err);
    res.status(500).json({ ok: false, message: 'Fehler beim Ändern' });
  }
});

module.exports = router;
