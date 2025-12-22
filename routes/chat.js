// routes/chat.js
const express = require('express');
const router  = express.Router();

const requireAuth = require('../middleware/requireAuth');
const { OpenAI }  = require('openai');

const { pool }           = require('../db');
const tokenDb            = require('../utils/tokenDb');
const { getBotConfig }   = require('../utils/botConfig');
const { searchChunks }   = require('../utils/knowledge');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MIN_BALANCE_TO_CHAT = 100;
const MIN_MATCH_SCORE = 0.75;
const TOP_K = 6;

// =======================
// Helpers – Bilder Modus B
// =======================
function extractTags(text) {
  const map = ['preflop','range','cashgame','postflop','tilt','mental'];
  const t = (text || '').toLowerCase();
  return map.filter(k => t.includes(k));
}

async function hasImages(tags) {
  if (!tags.length) return false;
  const r = await pool.query(`
    SELECT 1
    FROM knowledge_docs
    WHERE category='Bilder'
      AND enabled=true
      AND tags && $1
    LIMIT 1
  `, [tags]);
  return r.rowCount > 0;
}

async function loadImage(tags) {
  const r = await pool.query(`
    SELECT id
    FROM knowledge_docs
    WHERE category='Bilder'
      AND enabled=true
      AND tags && $1
    ORDER BY priority DESC
    LIMIT 1
  `, [tags]);
  return r.rows[0]?.id || null;
}

// =======================
// OpenAI Call
// =======================
async function llmAnswer({ userText, context, systemPrompt, model, temperature }) {
  const msgs = [];
  msgs.push({ role:'system', content: systemPrompt || 'Du bist Poker Joker. Antworte knapp.' });

  if (context) {
    msgs.push({
      role:'system',
      content:`NUTZE AUSSCHLIESSLICH DIESES WISSEN:\n${context}`
    });
  }

  msgs.push({ role:'user', content:userText });

  const r = await openai.chat.completions.create({
    model: model || 'gpt-4o-mini',
    temperature: typeof temperature === 'number' ? temperature : 0.3,
    messages: msgs
  });

  const text = r?.choices?.[0]?.message?.content?.trim() || '';
  const usedTokens =
    r?.usage?.total_tokens ??
    Math.ceil((userText.length + text.length) / 4);

  return { text, usedTokens };
}

// =======================
// Chat Handler
// =======================
async function handleChat(req, res) {
  try {
    const uid = req.user?.id || req.session?.user?.id;
    const userText = (req.body?.message || '').trim();

    if (!uid) return res.status(401).json({ ok:false, reply:'Nicht eingeloggt.' });
    if (!userText) return res.status(400).json({ ok:false, reply:'' });

    // ===== Bild-Zustimmung (Modus B) =====
    if (req.session?.imageOffer && /^(ja|yes|klar|gerne|ok)/i.test(userText)) {
      const imgId = await loadImage(req.session.imageOffer.tags);
      req.session.imageOffer = null;

      return res.json({
        ok: true,
        reply: 'Alles klar 👇',
        images: imgId ? [imgId] : [],
        sources: []
      });
    }

    // ===== Balance prüfen =====
    const balRes = await pool.query(
      `SELECT balance, purchased FROM public.v_user_balances_live WHERE user_id=$1`,
      [uid]
    );
    const balanceNow = balRes.rows?.[0]?.balance ?? 0;
    const purchased  = balRes.rows?.[0]?.purchased ?? 0;

    if (balanceNow < MIN_BALANCE_TO_CHAT) {
      return res.status(402).json({
        ok:false,
        reply:'Zu wenig Tokens. Bitte Buy-in!',
        balance: balanceNow,
        purchased
      });
    }

    // ===== Bot Config =====
    const cfg  = await getBotConfig(uid);
    const sys  = cfg?.system_prompt || 'Du bist Poker Joker. Antworte knapp.';
    const mdl  = cfg?.model || 'gpt-4o-mini';
    const temp = typeof cfg?.temperature === 'number' ? cfg.temperature : 0.3;

    let answer = '';
    let usedTokens = 0;
    let usedChunks = [];

    // ===== Knowledge Retrieval =====
    const hits = await searchChunks(userText, TOP_K);
    const strong = (hits || []).filter(h => (h.score ?? 1) >= MIN_MATCH_SCORE);

    if (strong.length) {
      usedChunks = strong.map(h => ({
        id: h.id,
        title: h.title,
        source: h.source,
        category: h.category
      }));

      let context = strong.map(h => h.text).filter(Boolean).join('\n---\n');
      if (context.length > 2000) context = context.slice(0, 2000);

      const out = await llmAnswer({
        userText,
        context,
        systemPrompt: sys,
        model: mdl,
        temperature: temp
      });

      answer = out.text;
      usedTokens = out.usedTokens;
    }

    // ===== Fallback LLM =====
    if (!answer) {
      const out = await llmAnswer({
        userText,
        context: null,
        systemPrompt: sys,
        model: mdl,
        temperature: temp
      });
      answer = out.text;
      usedTokens = out.usedTokens;
    }

    // ===== Modus B: Bild anbieten =====
    const tags = extractTags(userText);
    if (await hasImages(tags)) {
      req.session.imageOffer = { tags };
      answer += '\n\n👉 Willst du dazu eine passende Grafik sehen?';
    }

    // ===== Tokenverbrauch =====
    const words = answer.split(/\s+/).length || 1;
    const punct = (answer.match(/[.!?,;:]/g) || []).length;
    const rate  = Number(cfg?.punct_rate ?? 1);
    const max   = Number(cfg?.max_usedtokens_per_msg ?? 300);
    const charge = Math.min(Math.ceil((words + punct) * rate), max);

    await tokenDb.consumeTokens(uid, charge, `chat usage`);

    const after = await tokenDb.getTokens(uid);

    // ===== History =====
    await pool.query(`
      INSERT INTO chat_history (user_id, role, message)
      VALUES ($1,'user',$2),($1,'assistant',$3)
    `, [uid, userText, answer]);

    return res.json({
      ok: true,
      reply: answer,
      balance: after.balance,
      purchased,
      sources: usedChunks,
      images: []
    });

  } catch (err) {
    console.error('CHAT ERROR:', err);
    return res.status(500).json({ ok:false, reply:'Interner Fehler.' });
  }
}

// ===== Routes =====
router.post('/', requireAuth, handleChat);
router.post('/pokerjoker', requireAuth, handleChat);

router.get('/history', requireAuth, async (req, res) => {
  const uid = req.user?.id || req.session?.user?.id;
  const { rows } = await pool.query(`
    SELECT role, message, created_at
    FROM chat_history
    WHERE user_id=$1
    ORDER BY id ASC
    LIMIT 100
  `, [uid]);
  res.json({ ok:true, history: rows });
});

module.exports = router;
