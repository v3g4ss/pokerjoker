import express from "express";
import pool from "../db.js";

const router = express.Router();

// === GET: aktuelle Konfig ===
router.get("/", async (req, res) => {
  const result = await pool.query("SELECT * FROM settings WHERE id = 1");
  res.json(result.rows[0]);
});

// === POST: Update Konfig ===
router.post("/", async (req, res) => {
  const { price_eur, token_amount } = req.body;
  await pool.query(
    "UPDATE settings SET price_eur = $1, token_amount = $2, updated_at = NOW() WHERE id = 1",
    [price_eur, token_amount]
  );
  res.json({ ok: true });
});

export default router;
