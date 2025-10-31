const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');

// === Dynamische Preissteuerung aus DB ===
async function getPayConfig() {
  const { rows } = await pool.query('SELECT price_eur, token_amount FROM settings WHERE id = 1');
  return rows[0];
}

// === STRIPE CHECKOUT erzeugen ===
router.post('/stripe/checkout', requireAuth, async (req, res) => {
  try {
    const cfg = await getPayConfig();
    const priceCents = Math.round(cfg.price_eur * 100);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Poker Joker – ${cfg.token_amount.toLocaleString()} Tokens` },
          unit_amount: priceCents,
        },
        quantity: 1,
      }],
      success_url: `${process.env.APP_BASE_URL}/app/pay-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}/app/pay-cancel.html`,
      metadata: {
        user_id: String(req.user.id),
        token_amount: String(cfg.token_amount),
        pack_price: String(cfg.price_eur),
      },
    });

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('[STRIPE CHECKOUT]', err);
    return res.status(500).json({ ok: false, error: 'stripe_error' });
  }
});

// === Session prüfen (optional) ===
router.get('/stripe/session', requireAuth, async (req, res) => {
  try {
    const sid = String(req.query.session_id || '');
    if (!sid) return res.status(400).json({ ok: false, error: 'missing_session_id' });

    const session = await stripe.checkout.sessions.retrieve(sid);
    return res.json({ ok: true, session });
  } catch (e) {
    console.error('[STRIPE SESSION]', e);
    return res.status(500).json({ ok: false, error: 'stripe_error' });
  }
});

// === Stripe Webhook Handler ===
async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.warn('[STRIPE WEBHOOK] signature fail:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = Number(session.metadata?.user_id || 0);
      const tokens = Number(session.metadata?.token_amount || 0);

      if (userId > 0 && tokens > 0) {
        await pool.query(`
          INSERT INTO public.token_ledger (user_id, delta, reason)
          VALUES ($1, $2, 'buy_tokens_stripe')
        `, [userId, tokens]);

        await pool.query(`
          UPDATE public.users
             SET tokens = tokens + $1,
                 purchased = purchased + $1
           WHERE id = $2
        `, [tokens, userId]);

        console.log(`[STRIPE WEBHOOK] +${tokens} Tokens für User ${userId} gutgeschrieben.`);
      } else {
        console.log('[STRIPE WEBHOOK] fehlendes metadata user_id/token_amount');
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[STRIPE WEBHOOK] handler error:', err);
    return res.status(500).send('handler_error');
  }
}

module.exports = { router, stripeWebhook };
