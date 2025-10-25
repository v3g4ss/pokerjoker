const express = require('express');
const router = express.Router();

const { pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

let OpenAI = null;
try { ({ OpenAI } = require('openai')); } catch (_) {}

console.log('ROUTE LOADED:', __filename);

// --- GET /api/admin/prompt ---
router.get('/prompt', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT id, system_prompt, temperature, model, knowledge_mode, version, updated_at,
             punct_rate, max_usedtokens_per_msg
      FROM bot_settings
      ORDER BY id
      LIMIT 1
    `);

    if (r.rowCount > 0) {
      res.json(r.rows[0]);
    } else {
      // nur wenn die Tabelle wirklich leer ist
      res.json({
        system_prompt: '',
        temperature: 0.3,
        model: 'gpt-4o-mini',
        knowledge_mode: 'LLM_ONLY',
        punct_rate: null,
        max_usedtokens_per_msg: null
      });
    }
  } catch (err) {
    console.error('Prompt load error:', err);
    res.status(500).json({ ok: false, error: 'DB Fehler beim Laden' });
  }
});

// --- PUT /api/admin/prompt ---
router.put('/prompt', requireAuth, requireAdmin, async (req, res) => {
  console.log('[DEBUG PUT /api/admin/prompt]', req.body);

  const {
    system_prompt,
    temperature,
    model,
    knowledge_mode,
    punct_rate,
    max_usedtokens_per_msg
  } = req.body || {};

  // keine Zwangsdefaults mehr
  const t = Number.isFinite(Number(temperature)) ? Number(temperature) : null;
  const m = model ? model.toString() : null;
  const km = knowledge_mode || null;
  const pr = punct_rate !== undefined && !isNaN(Number(punct_rate)) ? Number(punct_rate) : null;
  const maxTok = max_usedtokens_per_msg !== undefined && !isNaN(Number(max_usedtokens_per_msg))
    ? Number(max_usedtokens_per_msg)
    : null;

  try {
    await pool.query('BEGIN');

    // Alte Werte sichern
    const cur = await pool.query(`SELECT * FROM bot_settings ORDER BY id LIMIT 1`);
    if (cur.rowCount) {
      await pool.query(`
        INSERT INTO bot_settings_history
          (system_prompt, temperature, model, knowledge_mode, punct_rate, max_usedtokens_per_msg,
           version, updated_by, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
      `, [
        cur.rows[0].system_prompt ?? '',
        cur.rows[0].temperature ?? 0.3,
        cur.rows[0].model ?? 'gpt-4o-mini',
        cur.rows[0].knowledge_mode ?? 'LLM_ONLY',
        cur.rows[0].punct_rate,
        cur.rows[0].max_usedtokens_per_msg,
        cur.rows[0].version ?? 0,
        req.user?.id || null
      ]);
    }

    // Update nur das, was tatsächlich mitkommt
    await pool.query(`
      INSERT INTO bot_settings 
        (id, system_prompt, temperature, model, knowledge_mode, punct_rate, max_usedtokens_per_msg,
         version, updated_by, updated_at)
      VALUES 
        (1, $1, COALESCE($2, 0.3), COALESCE($3, 'gpt-4o-mini'),
         COALESCE($4, 'LLM_ONLY'), $5, $6, 1, $7, now())
      ON CONFLICT (id) DO UPDATE SET
        system_prompt = COALESCE(EXCLUDED.system_prompt, bot_settings.system_prompt),
        temperature   = COALESCE(EXCLUDED.temperature, bot_settings.temperature),
        model         = COALESCE(EXCLUDED.model, bot_settings.model),
        knowledge_mode = COALESCE(EXCLUDED.knowledge_mode, bot_settings.knowledge_mode),
        punct_rate    = COALESCE(EXCLUDED.punct_rate, bot_settings.punct_rate),
        max_usedtokens_per_msg = COALESCE(EXCLUDED.max_usedtokens_per_msg, bot_settings.max_usedtokens_per_msg),
        version       = bot_settings.version + 1,
        updated_by    = EXCLUDED.updated_by,
        updated_at    = now()
    `, [system_prompt || '', t, m, km, pr, maxTok, req.user?.id || null]);

    await pool.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Prompt save error:', err);
    res.status(500).json({ ok: false, error: 'Speichern fehlgeschlagen' });
  }
});

// --- POST /api/admin/prompt/test ---
router.post('/prompt/test', requireAuth, requireAdmin, async (req, res) => {
  console.log('HIT /api/admin/prompt/test (ECHO + optional OpenAI)');
  console.log('Prompt-Test Body:', req.body);

  const body = req.body || {};
  const system_prompt = body.system_prompt ?? '';
  const input         = body.input ?? 'Ping';
  const model         = body.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const temperature   = body.temperature ?? 0.3;

  const preview = system_prompt.toString().replace(/\s+/g, ' ').slice(0, 160);
  let output = `[SERVER OK]\nPrompt: "${preview}${system_prompt.length > 160 ? '…' : ''}"\nAntwort auf "${input}": Server antwortet.`;

  try {
    if (OpenAI && process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const r = await openai.chat.completions.create({
        model,
        temperature: Number(temperature) || 0.3,
        max_tokens: 200,
        messages: [
          { role: 'system', content: system_prompt },
          { role: 'user', content: input }
        ]
      });

      let txt = (r?.choices?.[0]?.message?.content || '').trim();
      if (txt) output = txt;
    }
  } catch (err) {
    console.warn('OpenAI Test warn:', err?.message || err);
  }

  return res.json({ ok: true, output });
});

module.exports = router;
