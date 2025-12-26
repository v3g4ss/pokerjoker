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

const KNOWLEDGE_MODES = new Set(['KB_ONLY', 'KB_PREFERRED', 'LLM_ONLY']);

function normalizeKnowledgeMode(raw) {
  const v = String(raw || '').trim().toUpperCase();
  // Backwards compatibility with older admin UI values.
  if (v === 'ALWAYS') return 'KB_ONLY';
  if (v === 'ON-DEMAND' || v === 'ON_DEMAND' || v === 'ONDEMAND') return 'KB_PREFERRED';
  return KNOWLEDGE_MODES.has(v) ? v : 'KB_PREFERRED';
}

// =======================
// Helpers – Bilder Modus B
// =======================
const SHORT_IMAGE_TOKENS = new Set(['bb','sb','ai','utg','mp','co','btn','hj','ip','oop','3b','4b','5b']);

function buildLikePatterns(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ');

  const parts = raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
  const keep = parts.filter(w => w.length >= 3 || (w.length >= 2 && SHORT_IMAGE_TOKENS.has(w)));
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
      content: [
        'WISSENSBASIS (Knowledge Library) – VERBINDLICH:',
        context,
        '',
        'REGELN:',
        '- Verwende ausschließlich die Wissensbasis oben (keine externen Fakten, kein allgemeines Weltwissen).',
        '- Wenn etwas nicht in der Wissensbasis steht: sag das klar und stelle Rückfragen statt zu raten.'
      ].join('\n')
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

function safeJsonParse(s) {
  try { return JSON.parse(String(s || '')); } catch { return null; }
}

// KB-only answering: enforce that the assistant can ONLY answer using verbatim quotes from KB context.
// If it cannot, we return an empty answer.
async function llmKbOnlyAnswer({ userText, context, systemPrompt, model, temperature }) {
  const msgs = [];
  msgs.push({
    role: 'system',
    content: [
      systemPrompt || 'Du bist Poker Joker.',
      '',
      'STRICT KB MODE:',
      '- Output MUST be valid JSON only.',
      '- Schema: {"answer": string, "quotes": string[]}',
      '- "quotes" MUST contain exact verbatim substrings copied from the provided knowledge context.',
      '- If you cannot answer strictly from the knowledge context, respond with {"answer":"","quotes":[]}.',
      '- Do NOT use general world knowledge.'
    ].join('\n')
  });

  msgs.push({
    role: 'system',
    content: `KNOWLEDGE_CONTEXT\n${context || ''}`
  });

  msgs.push({ role: 'user', content: userText });

  const r = await openai.chat.completions.create({
    model: model || 'gpt-4o-mini',
    temperature: typeof temperature === 'number' ? temperature : 0,
    messages: msgs
  });

  const raw = r?.choices?.[0]?.message?.content?.trim() || '';
  const obj = safeJsonParse(raw);
  if (!obj || typeof obj !== 'object') return { text: '', usedTokens: r?.usage?.total_tokens };

  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  const quotes = Array.isArray(obj.quotes) ? obj.quotes.filter(q => typeof q === 'string' && q.trim()) : [];

  // Must have at least one quote and all quotes must be present in context.
  if (!answer || !quotes.length) return { text: '', usedTokens: r?.usage?.total_tokens };
  const ctx = String(context || '');
  for (const q of quotes) {
    if (!ctx.includes(q)) return { text: '', usedTokens: r?.usage?.total_tokens };
  }

  return { text: answer, usedTokens: r?.usage?.total_tokens };
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
    // Bot Config
    // =======================
    const cfg  = await getBotConfig();
    const mode = normalizeKnowledgeMode(cfg?.knowledge_mode);

    const fallbackSys = `
Du bist Poker Joker.
Du erklärst Poker klar und ruhig.
    `.trim();

    const sys = [
      (cfg?.system_prompt || '').trim() || fallbackSys,
      '---',
      'UI-CONSTRAINTS:',
      '- Never claim you cannot show images.'
    ].join('\n');

    const mdl  = cfg?.model || 'gpt-4o-mini';
    const temp = typeof cfg?.temperature === 'number' ? cfg.temperature : 0.3;

    let answer = '';
    let usedChunks = [];
    let answerSource = 'none';
    let attachedImageId = null;

    // =======================
    // Knowledge Retrieval
    // =======================
    const hits = (mode === 'LLM_ONLY') ? [] : await searchChunks(userText, [], TOP_K);
const strong = (hits || []).filter(h => (h.score ?? 1) >= MIN_MATCH_SCORE);

// =======================
// KB → Antwort → 1 Grafik
// =======================
if (strong.length) {
  usedChunks = strong.map(h => ({
    id: h.id,
    title: h.title,
    source: h.source,
    category: h.category
  }));

  let context = strong.map(h => h.text).filter(Boolean).join('\n---\n');
  if (context.length > 2000) context = context.slice(0, 2000);

  // --- 1) STRICT KB_ONLY (Zitatpflicht)
  if (mode === 'KB_ONLY') {
    const outStrict = await llmKbOnlyAnswer({
      userText,
      context,
      systemPrompt: sys,
      model: mdl,
      temperature: 0
    });

    answer = outStrict?.text || '';

    // --- 2) FALLBACK: erklärend, aber OHNE Anweisungen
    if (!answer) {
      const outExplain = await llmAnswer({
        userText,
        context,
        systemPrompt: sys + '\nERLAUBT: erklären, einordnen, beschreiben. VERBOTEN: konkrete Handlungsanweisungen.',
        model: mdl,
        temperature: 0.2
      });

      answer = outExplain?.text || '';
      if (answer) answerSource = 'kb_only_explained';
    } else {
      answerSource = 'kb_only_llm_strict';
    }

  } else {
    // --- KB_PREFERRED / LLM_ONLY
    const out = await llmAnswer({
      userText,
      context,
      systemPrompt: sys,
      model: mdl,
      temperature: temp
    });
    answer = out?.text || '';
    if (answer) answerSource = 'kb_llm';
  }

  // --- Grafik NUR wenn Antwort existiert
  if (answer) {
    const imageCandidates = await findImageIdsByQuery(userText, 3);
    if (imageCandidates?.length) {
      attachedImageId = imageCandidates[0]; // exakt eine
    }
  }
}

// =======================
// Fallback LLM (nur wenn NICHT KB_ONLY)
// =======================
if (!answer && mode !== 'KB_ONLY') {
  const out = await llmAnswer({
    userText,
    context: null,
    systemPrompt: sys,
    model: mdl,
    temperature: temp
  });
  answer = out.text;
  if (answer) answerSource = 'fallback_llm';
}

// =======================
// KB_ONLY ohne Treffer
// =======================
if (mode === 'KB_ONLY' && (!hits.length && !strong.length)) {
  answer = 'Dazu finde ich in meiner Knowledge-Bibliothek aktuell kein passendes Wissen.';
  answerSource = 'kb_only_no_answer';
}

answer = stripNoImageClaims(answer);

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
      images: attachedImageId ? [attachedImageId] : []
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
