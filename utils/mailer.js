// ===============================================
// utils/mailer.js  (Brevo Version für ESM)
// ===============================================

import 'dotenv/config';
import Brevo from "@getbrevo/brevo";

const apiKey = process.env.BREVO_API_KEY;
if (!apiKey) {
  console.error("[MAILER] ❌ Kein BREVO_API_KEY gefunden!");
}

const brevoClient = new Brevo.TransactionalEmailsApi();
brevoClient.authentications["apiKey"].apiKey = apiKey;

export async function sendMail({ to, subject, html }) {
  try {
    const sender = {
      email: process.env.MAIL_FROM || "support@poker-joker.tech",
      name: process.env.MAIL_FROM_NAME || "Poker Joker"
    };

    const mail = {
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html
    };

    const data = await brevoClient.sendTransacEmail(mail);
    console.log("[MAILER] ✅ Mail gesendet an:", to);
    return data;
  } catch (err) {
    console.error("[MAILER] ❌ Fehler beim Senden:", err.response?.text || err.message);
    throw err;
  }
}
