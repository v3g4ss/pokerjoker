// test-brevo.js
import brevo from "@getbrevo/brevo";  // <-- ACHTUNG: 'import' statt 'require'
import dotenv from "dotenv";
dotenv.config(); // damit deine .env geladen wird

const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

async function run() {
  try {
    const sendSmtpEmail = {
      sender: { email: process.env.MAIL_FROM || "support@poker-joker.tech", name: process.env.MAIL_FROM_NAME || "Poker Joker" },
      to: [{ email: "deine.email@adresse.de" }], // <-- ändere auf deine echte Adresse
      subject: "✅ Brevo API Testmail",
      htmlContent: "<h3>Hallo Digga 😎</h3><p>Die Brevo-API funktioniert perfekt!</p>",
    };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Mail gesendet:", result?.messageId || "OK");
  } catch (err) {
    console.error("❌ Fehler beim Senden:", err.message || err);
  }
}

run();
