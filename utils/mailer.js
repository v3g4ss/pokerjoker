// utils/mailer.js — Brevo robust (CommonJS)
require('dotenv').config();
const Brevo = require('@getbrevo/brevo');

const apiKey = process.env.BREVO_API_KEY || '';
const client = new Brevo.TransactionalEmailsApi();

if (!apiKey) {
  console.error('[MAILER] ❌ Kein BREVO_API_KEY gesetzt!');
} else {
  try {
    client.authentications['apiKey'].apiKey = apiKey;
  } catch (e) {
    console.error('[MAILER] ❌ API-Key Setup fehlgeschlagen:', e.message);
  }
}

async function sendMail({ to, subject, html }) {
  const sender = {
    email: process.env.MAIL_FROM || 'support@poker-joker.tech',
    name: process.env.MAIL_FROM_NAME || 'Poker Joker',
  };
  const mail = { sender, to: [{ email: to }], subject, htmlContent: html };

  const res = await client.sendTransacEmail(mail);
  console.log('[MAILER] ✅ Mail gesendet an:', to);
  return res;
}

// Bricht NIE den Request-Flow. Loggt nur.
async function sendMailSafe(opts) {
  try {
    if (!apiKey) throw new Error('BREVO_API_KEY fehlt');
    return await sendMail(opts);
  } catch (err) {
    console.warn('[MAILER] ⚠️ Mailversand fehlgeschlagen:', err.response?.text || err.message);
    return null;
  }
}

module.exports = { sendMailSafe, sendMail: sendMailSafe };

