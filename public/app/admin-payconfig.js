// public/app/js/admin-payconfig.js
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("payConfigForm");
  if (!form) return; // Sicherheitscheck

  const price = document.getElementById("price_eur");
  const tokens = document.getElementById("token_amount");

  try {
    const res = await fetch("/api/admin/payconfig");
    const data = await res.json();
    if (data) {
      price.value = data.price_eur;
      tokens.value = data.token_amount;
    }
  } catch (err) {
    console.warn("Fehler beim Laden der PayConfig:", err);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      price_eur: parseFloat(price.value),
      token_amount: parseInt(tokens.value),
    };
    try {
      const r = await fetch("/api/admin/payconfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) alert("✅ Preis & Tokens aktualisiert!");
      else alert("⚠️ Fehler beim Speichern!");
    } catch (err) {
      console.error("Fehler:", err);
      alert("❌ Netzwerkfehler!");
    }
  });
});
