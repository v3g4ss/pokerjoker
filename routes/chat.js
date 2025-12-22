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
function buildLikePatterns(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ');

  const parts = raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
  const keep = parts.filter(w => w.length >= 3);
  const uniq = Array.from(new Set(keep));

  // If user enters a very short query, still keep the full phrase.
  if (!uniq.length && raw.trim()) uniq.push(raw.trim());

  return uniq.map(w => `%${w}%`);
}

async function findImageIdsByQuery(text, limit = 3) {
  const patterns = buildLikePatterns(text);
  if (!patterns.length) return [];

  const r = await pool.query(
    `
    SELECT id
    FROM knowledge_docs
    WHERE enabled = true
      AND image_url IS NOT NULL
      AND (
        title ILIKE ANY($1) OR
        filename ILIKE ANY($1) OR
        original_name ILIKE ANY($1) OR
        COALESCE(label, '') ILIKE ANY($1) OR
        COALESCE(array_to_string(tags, ','), '') ILIKE ANY($1)
      )
    ORDER BY priority DESC, id DESC
    LIMIT $2;
    `,
    [patterns, limit]
  );

  return r.rows.map(x => x.id);
}

function stripNoImageClaims(text) {
  // Remove typical "I can't show images" disclaimers (German/English) that confuse users,
  // because the UI *can* render images.
  let t = String(text || '');

  // 1) Whole-sentence removals.
  t = t.replace(
    /(^|\n)\s*[^\n.]{0,200}(kann|können)[^\n.]{0,120}(bild|bilder|grafik|grafiken|image|images)[^\n.]{0,120}(nicht|leider|cannot|can't)[^\n.]*[.?!](?=\s|$)/gim,
    '$1'
  );

  // 2) Mid-sentence clause removals like:
  // "Ich kann dir die Grafik nicht direkt zeigen, aber …"
  t = t.replace(
    /(ich\s+(kann|können)[^\n]{0,120}(bild|bilder|grafik|grafiken|image|images)[^\n]{0,120}(nicht|leider|cannot|can't)[^\n]{0,120}(zeigen|anzeigen|display|show)[^\n]{0,80})(\s*[,;:]\s*)?/gim,
    ''
  );

  // Cleanup whitespace artifacts.
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
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
// Chat Handler (FINAL)
// =======================
async function handleChat(req, res) {
  try {
    const uid = req.user?.id || req.session?.user?.id;
    const userText = (req.body?.message || '').trim();

    if (!uid) return res.status(401).json({ ok:false, reply:'Nicht eingeloggt.' });
    if (!userText) return res.status(400).json({ ok:false, reply:'' });

    // =======================
    // Modus B – Zustimmung (GANZ AM ANFANG)
    // =======================
    // NOTE: request objects are recreated on every HTTP call.
    // Persist the image offer state in the session, otherwise the "Ja" answer can't work.
    if (req.session) req.session.imageOffer ??= null;

    const yes = /(\bja\b|\byes\b|klar|ok|\bzeig\b|zeige|zeigen|grafik|bild)/i.test(userText);
    const no = /(\bnein\b|\bno\b|nicht|später|lass|egal)/i.test(userText);

    if (req.session?.imageOffer && yes) {
      const ids = Array.isArray(req.session.imageOffer.imageIds)
        ? req.session.imageOffer.imageIds
        : [];
      req.session.imageOffer = null;

      return res.json({
        ok: true,
        reply: 'Alles klar – ich blende dir die Grafik ein 👇',
        images: ids,
        sources: []
      });
    }

    if (req.session?.imageOffer && no) {
      req.session.imageOffer = null;
      // Continue as normal (user doesn't want the image).
    }

    // =======================
    // Balance prüfen
    // =======================
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

    // =======================
    // Bot Config / System Prompt
    // =======================
    const cfg  = await getBotConfig(uid);
    const sys = `
Du bist Poker Joker.
Du erklärst Poker klar und freundlich.

WICHTIG:
- Du sagst NIEMALS, dass du keine Bilder oder Grafiken anzeigen kannst.
- Bilder werden IMMER vom System eingeblendet.
- Du wartest auf System-Anweisungen für visuelle Inhalte.
 - Wenn der User eine Grafik will, sag: "Alles klar – ich blende dir die passende Grafik ein." (ohne Disclaimer)
    `.trim();

    const mdl  = cfg?.model || 'gpt-4o-mini';
    const temp = typeof cfg?.temperature === 'number' ? cfg.temperature : 0.3;

    let answer = '';
    let usedChunks = [];

    // =======================
    // Knowledge Retrieval
    // =======================
    // searchChunks(q, categories=[], topK=5)
    const hits = await searchChunks(userText, [], TOP_K);
    const strong = (hits || []).filter(h => (h.score ?? 1) >= MIN_MATCH_SCORE);

    // Image candidates (for offer or direct show)
    const imageCandidates = await findImageIdsByQuery(userText, 3);

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
    }

    // =======================
    // Fallback LLM
    // =======================
    if (!answer) {
      const out = await llmAnswer({
        userText,
        context: null,
        systemPrompt: sys,
        model: mdl,
        temperature: temp
      });
      answer = out.text;
    }

    // Scrub misleading "can't show images" claims.
    answer = stripNoImageClaims(answer);

    // =======================
    // Modus B – Bild anbieten (NUR WENN KEIN OFFER AKTIV)
    // =======================
    const wantsImageNow = /(grafik|bild|zeige|zeig|image)/i.test(userText);

    // If the user explicitly asks for an image, show it immediately.
    // Otherwise offer it and wait for confirmation (stored in session).
    if (imageCandidates.length) {
      if (wantsImageNow) {
        // show immediately
      } else if (req.session && !req.session.imageOffer) {
        req.session.imageOffer = {
          text: userText,
          imageIds: imageCandidates,
          createdAt: Date.now()
        };
        answer += '\n\n👉 Willst du dazu eine passende Grafik sehen? (Ja/Nein)';
      }
    }

    // =======================
    // Tokenverbrauch
    // =======================
    const words = answer.split(/\s+/).length || 1;
    const punct = (answer.match(/[.!?,;:]/g) || []).length;
    const rate  = Number(cfg?.punct_rate ?? 1);
    const max   = Number(cfg?.max_usedtokens_per_msg ?? 300);
    const charge = Math.min(Math.ceil((words + punct) * rate), max);

    await tokenDb.consumeTokens(uid, charge, `chat usage`);
    const after = await tokenDb.getTokens(uid);

    // =======================
    // History
    // =======================
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
      images: wantsImageNow ? imageCandidates : []
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
