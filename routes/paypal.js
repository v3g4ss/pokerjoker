// routes/paypal.js
const express = require('express');
const router  = express.Router();
const paypal  = require('@paypal/checkout-server-sdk');
const { pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');

// === PayPal SDK-Client ===
function client() {
  const envName = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_SECRET; // ✅ angepasst!

  const env =
    envName === 'live'
      ? new paypal.core.LiveEnvironment(clientId, clientSecret)
      : new paypal.core.SandboxEnvironment(clientId, clientSecret);

  return new paypal.core.PayPalHttpClient(env);
}

// === Token-Paket ===
const PRODUCT = {
  name: 'Poker Joker – 10.000 Tokens',
  token_delta: 10000,
  price: '35.00',
  currency: 'EUR',
};

// === 1) Bestellung erstellen ===
router.post('/paypal/create', requireAuth, async (req, res) => {
  try {
    const base = process.env.APP_BASE_URL || 'http://localhost:5000';

    const request = new paypal.orders.OrdersCreateRequest();
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: PRODUCT.currency, value: PRODUCT.price },
          description: PRODUCT.name,
          custom_id: JSON.stringify({
            user_id: req.user.id,
            tokens: PRODUCT.token_delta,
          }),
        },
      ],
      application_context: {
        brand_name: 'Poker Joker',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: `${base}/api/pay/paypal/capture`,
        cancel_url: `${base}/app/pay-cancel.html`,
      },
    });

    const order = await client().execute(request);
    const approve = order.result.links?.find((l) => l.rel === 'approve')?.href;

    res.json({ ok: true, id: order.result.id, approve_url: approve });
  } catch (err) {
    console.error('[PayPal create error]', err);
    res.status(500).json({ ok: false, error: 'paypal_create_failed' });
  }
});

// === 2) Zahlung erfassen (Capture) ===
router.get('/paypal/capture', async (req, res) => { // ❌ requireAuth entfernt!
  const orderId = String(req.query?.token || '');
  if (!orderId) return res.status(400).send('Invalid capture params');

  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const captureRes = await client().execute(request);

    const status = captureRes.result?.status;
    if (status !== 'COMPLETED') return res.redirect('/app/pay-cancel.html');

    let meta = null;
    try {
      meta =
        captureRes.result?.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ||
        captureRes.result?.purchase_units?.[0]?.custom_id || null;
      if (meta) meta = JSON.parse(meta);
    } catch {
      meta = null;
    }

    const userId = Number(meta?.user_id || 0);
    const delta  = Number(meta?.tokens || PRODUCT.token_delta || 0);
    if (!(userId > 0 && delta > 0)) return res.redirect('/app/pay-success.html');

    // doppelte Gutschrift verhindern
    const reason = `buy_paypal:${orderId}`;
    const exists = await pool.query(
      'SELECT 1 FROM public.token_ledger WHERE user_id=$1 AND reason=$2 LIMIT 1',
      [userId, reason]
    );
    if (exists.rowCount > 0) return res.redirect('/app/pay-success.html');

    // Ledger + Token erhöhen
    await pool.query(
      `INSERT INTO public.token_ledger (user_id, delta, reason, created_at)
       VALUES ($1, $2, $3, now())`,
      [userId, delta, reason]
    );
    await pool.query(
      `UPDATE public.users
         SET tokens = tokens + $1,
             purchased = purchased + $1
       WHERE id = $2`,
      [delta, userId]
    );

    console.log(`[PAYPAL] +${delta} Tokens für User ${userId} (Order ${orderId})`);
    res.redirect('/app/pay-success.html');
  } catch (err) {
    console.error('[PayPal capture error]', err);
    res.redirect('/app/pay-cancel.html');
  }
});

module.exports = router;
