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

console.log('✅ chat.js wurde geladen');

// ========= Abrechnung / Logging =========
const PUNCT_RATE  = Number(process.env.PUNCT_RATE || '1');
const PUNCT_REGEX = /[\.!,:;\?\u2026]/g;
const LOG_TOKENS  = String(process.env.LOG_TOKENS || 'true') === 'true';

// Senden erlauben, wenn mind. 1 Token vorhanden ist
const MIN_BALANCE_TO_CHAT = 100;

const MIN_MATCH_SCORE = 0.75;
const TOP_K           = 6;

const okStr = v => (typeof v === 'string' ? v : '');

// ========= OpenAI Call =========
async function llmAnswer({ userText, context, systemPrompt, model, temperature }) {
  const msgs = [];
  msgs.push({ role:'system', content: systemPrompt || 'Du bist Poker Joker. Antworte knapp.' });

  if (context) {
    msgs.push({
      role:'system',
      content:`NUTZE AUSSCHLIESSLICH DIESES WISSEN:\n${context}\n---\nAntworte präzise und nenne die Quelle.`
    });
  }

  msgs.push({ role:'user', content:userText });

  const r = await openai.chat.completions.create({
    model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: (typeof temperature === 'number') ? temperature : 0.3,
    messages: msgs
  });

  const text = r?.choices?.[0]?.message?.content?.trim() || '';
  const usedTokens =
    (r?.usage?.total_tokens != null)
      ? Number(r.usage.total_tokens)
      : Math.ceil((userText.length + text.length) / 4); // Fallback

  if (LOG_TOKENS) console.log('[DEBUG] LLM Usage:', r.usage);

  return { text, usedTokens };
}

// ========= Haupt-Handler =========
async function handleChat(req, res) {
  try {
    const uid      = req.user?.id || req.session?.user?.id;
    const userText = okStr(req.body?.message).trim();
    const topK     = Math.max(1, Math.min(10, parseInt(req.body?.topK, 10) || TOP_K));

    if (!uid)      return res.status(401).json({ ok:false, reply:'Nicht eingeloggt.' });
    if (!userText) return res.status(400).json({ ok:false, reply:'', sources:[] });

    // ===== Balance prüfen =====
    const result = await pool.query(
      `SELECT balance, purchased FROM public.v_user_balances_live WHERE user_id = $1`,
      [uid]
    );
    const balanceNow = result.rows?.[0]?.balance ?? 0;
    const purchased  = result.rows?.[0]?.purchased ?? 0;

    if (balanceNow < MIN_BALANCE_TO_CHAT) {
      return res.status(402).json({
        ok: false,
        reply: 'Zu wenig Tokens. Bitte Buy-in!',
        balance: balanceNow,
        purchased,
        sources: []
      });
    }

    // ===== Bot-Config laden =====
    const cfg   = await getBotConfig(uid);
    const mode  = (cfg?.kb_mode || 'KB_PREFERRED').toUpperCase();
    const sys   = cfg?.system_prompt || 'Du bist Poker Joker. Antworte knapp.';
    const mdl   = cfg?.model || 'gpt-4o-mini';
    const temp  = (typeof cfg?.temperature === 'number') ? cfg.temperature : 0.3;

    let usedChunks = [];
    let answer     = '';
    let usedTokens = 0;
    let imageUrls  = [];

    // ===== Knowledge-Retrieval =====
    if (mode !== 'LLM_ONLY') {
      const hits = await searchChunks(userText, topK);
      const strong = (hits || []).filter(h => (h.score ?? 1) >= MIN_MATCH_SCORE).slice(0, topK);

      // === DEBUG KB-Treffer
      console.log('[DEBUG] KB-Treffer:', strong.map(s => ({
        score: s.score?.toFixed(3),
        title: s.title,
        filename: s.filename
      })));

      // === Datei-Name explizit erwähnt?
      const possibleFilename = userText.split(/\s+/).find(w => /\.(jpg|jpeg|png|json|txt)$/i.test(w));
      if (possibleFilename) {
        const fileDoc = strong.find(doc =>
          doc.original_name?.toLowerCase() === possibleFilename.toLowerCase() ||
          doc.filename?.toLowerCase() === possibleFilename.toLowerCase() ||
          doc.title?.toLowerCase() === possibleFilename.toLowerCase()
        );
        if (fileDoc?.image_url) {
          imageUrls = [`/api/admin/kb/img/${fileDoc.id}`];
          answer = `Ich habe das Bild "${fileDoc.original_name || fileDoc.filename}" gefunden.`;
        }
      }

      // === Wenn noch kein Antwort-Text erstellt wurde → normalen Prompt generieren
      if (!answer && strong.length) {
        usedChunks = strong.map(({ id, source, title, image_url, filename, category }) => ({
          id, source, title, image_url, filename, category
        }));

        // max. 3 Bilder aus KB extrahieren
        imageUrls = strong
          .map(h => h.image_url)
          .filter(u => typeof u === 'string' && u.startsWith('/'))
          .slice(0, 3);

        // Kontexttext generieren
        let context = strong.map(h => h.text).filter(Boolean).join('\n---\n');
        if (context.length > 2000) context = context.slice(0, 2000);

        const out = await llmAnswer({ userText, context, systemPrompt: sys, model: mdl, temperature: temp });
        answer     = out.text;
        usedTokens = out.usedTokens;

        // Bilder im Text erwähnen
        if (imageUrls.length) {
          answer += `\n\nIch habe relevante Bilder gefunden.`;
        }
      }

      if (mode === 'KB_ONLY' && !answer) {
        return res.json({ ok:true, reply:'Dazu finde ich nichts in der Knowledge-Base.', sources: [], images: [] });
      }
    }

    console.log(`[DEBUG] Antwort basiert auf ${usedChunks.length ? 'KB ✅' : 'LLM ❌'}`);

    // ===== Fallback nur LLM =====
    if (!answer) {
      const out = await llmAnswer({ userText, context: null, systemPrompt: sys, model: mdl, temperature: temp });
      answer     = out.text;
      usedTokens = out.usedTokens;
    }

    // ===== Token-Verbrauch berechnen =====
    const wordCount   = answer?.trim().split(/\s+/).length || 1;
    const punctCount  = (answer?.match(/[.!?,;:]/g) || []).length;
    const punctRate   = Number(cfg?.punct_rate ?? process.env.PUNCT_RATE ?? 1);
    const maxUsed     = Number(cfg?.max_usedtokens_per_msg ?? process.env.MAX_USEDTOKENS_PER_MSG ?? 300);
    const baseCost    = wordCount + punctCount;
    const toCharge    = Math.min(Math.ceil(baseCost * punctRate), maxUsed);

    console.log('[DEBUG] Tokenverbrauch (pro Wort):', {
      uid, words: wordCount, punctCount, punctRate, baseCost, toCharge
    });

    try {
      await tokenDb.consumeTokens(uid, toCharge, `chat usage=${wordCount} words + ${punctCount} punct ×${punctRate}`);
    } catch (e) {
      console.error('❌ Token-Abbuchung fehlgeschlagen:', e.message);
      return res.status(402).json({ reply: '❌ Token-Abbuchung gescheitert 😵 Buy-in nötig!' });
    }

    const after  = await tokenDb.getTokens(uid);
    const newBal = after?.balance ?? (balanceNow - toCharge);

    // ===== Quellen (Sources) extrahieren
    const seen = new Set();
    const sources = (usedChunks || [])
      .map(s => s && (s.title || s.source || s.filename) ? {
        title: s.title || s.source || s.filename,
        image_url: s.image_url || null,
        source: s.source || null,
        category: s.category || null
      } : null)
      .filter(Boolean)
      .filter(obj => obj.title && (seen.has(obj.title) ? false : (seen.add(obj.title), true)));

    // ===== Chatverlauf speichern =====
    try {
      await pool.query(`
        INSERT INTO chat_history (user_id, role, message)
        VALUES ($1, 'user', $2), ($1, 'assistant', $3)
      `, [uid, userText, answer]);
    } catch (e) {
      console.error('Fehler beim Speichern der Chat-History:', e.message);
    }

    // ===== Antwort senden =====
    return res.json({
      ok: true,
      reply: answer,
      balance: newBal,
      purchased,
      sources,
      images: imageUrls,
      meta: { usedTokens, punctCount, punctRate, charged: toCharge }
    });

  } catch (err) {
    console.error('CHAT ERROR:', err);
    return res.status(500).json({ ok:false, reply:'Interner Fehler. Versuch’s gleich nochmal.' });
  }
}

// === Chat-Verlauf abrufen ===
router.get('/history', requireAuth, async (req, res) => {
  try {
    const uid = req.user?.id || req.session?.user?.id;
    if (!uid) return res.status(401).json({ ok: false, error: 'Nicht eingeloggt' });

    const { rows } = await pool.query(`
      SELECT id, role, message, created_at
      FROM chat_history
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 100
    `, [uid]);

    // Neueste zuerst → umdrehen, damit Anzeige aufsteigend ist
    res.json({ ok: true, history: rows.reverse() });
  } catch (err) {
    console.error('Fehler beim Laden der Chat-Historie:', err.message);
    res.status(500).json({ ok: false, error: 'Interner Fehler beim Laden der Chat-Historie' });
  }
});

// === Chat senden ===
router.post('/', requireAuth, handleChat);

// (optional Alias für Rückwärtskompatibilität)
router.post('/pokerjoker', requireAuth, handleChat);

module.exports = router;
