import { sendMail } from "./utils/mailer.js";

(async () => {
  try {
    await sendMail({
      to: "pok3rjok3r@protonmail.com",
      subject: "Poker Joker Testmail ✅",
      html: `<h2>Alles läuft, Digga!</h2><p>Deine Domain <b>poker-joker.tech</b> sendet jetzt offiziell über Brevo 🎉</p>`
    });
  } catch (err) {
    console.error("Fehler beim Test:", err.message);
  }
})();
