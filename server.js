// =========================== server.js (clean Brevo version) ===========================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import http from 'http';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { sendMail } from './utils/mailer.js';
import requireAuth from './middleware/requireAuth.js';
import requireAdmin from './middleware/requireAdmin.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// --- Stripe Webhook ---
import * as pay from './routes/pay.js';
import paypalRouter from './routes/paypal.js';
app.post(
  '/api/pay/stripe/webhook',
  express.raw({ type: 'application/json' }),
  pay.stripeWebhook
);

// --- Middleware ---
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setTimeout(15000, () => {
    if (!res.headersSent)
      res.status(503).json({ ok: false, error: 'timeout' });
  });
  next();
});

// --- Payments ---
app.use('/api/pay', pay.router);
app.use('/api/pay', paypalRouter);

// --- Admin APIs ---
import adminMenuRoutes from './routes/admin-menu.js';
import adminPromptRoutes from './routes/admin-prompt.js';
import adminRoutes from './routes/admin.js';
import adminBotRoutes from './routes/admin-bot.js';
import adminKbRoutes from './routes/admin-kb.js';
import adminMessagesRoutes from './routes/admin-messages.js';

app.use('/api/admin', adminPromptRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminBotRoutes);
app.use('/api/admin', adminKbRoutes);
app.use('/api/admin', adminMessagesRoutes);
app.use('/api/admin', adminMenuRoutes);

// --- User APIs ---
import chatRoutes from './routes/chat.js';
import menuRoutes from './routes/menu.js';
import messagesRoutes from './routes/messages.js';
import tokensRoutes from './routes/tokens.js';
import authRouter from './routes/auth.js';
import passwordRouter from './routes/password.js';

app.use('/api', chatRoutes);
app.use('/api', menuRoutes);
app.use('/api', messagesRoutes);
app.use('/api/tokens', tokensRoutes);

// --- Auth ---
app.use(
  '/api/auth',
  (req, res, next) => {
    req.setSessionCookie = (payload) => {
      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '7d',
      });
      res.cookie('session', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
    };
    next();
  },
  authRouter
);
app.use('/api/password', passwordRouter);

// --- Static Files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/app', express.static(path.join(__dirname, 'public', 'app')));

app.get('/admin', requireAuth, requireAdmin, (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);
app.get('/app', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'))
);
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'))
);
app.get('/verify', (req, res) =>
  res.redirect(`/api/auth/verify?token=${req.query.token}`)
);

// --- Kontaktformular über Brevo ---
app.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!name || !email || !subject || !message) {
      return res
        .status(400)
        .json({ success: false, message: 'Bitte alle Felder ausfüllen.' });
    }

    // Nachricht in DB speichern
    await pool.query(
      `INSERT INTO public.messages(name,email,subject,message,created_at)
       VALUES ($1,$2,$3,$4,now())`,
      [name, email, subject, message]
    );

    // Brevo Mail versenden
    if (process.env.CONTACT_RECEIVER) {
      try {
        await sendMail({
          to: process.env.CONTACT_RECEIVER,
          subject: `Kontaktanfrage: ${subject}`,
          html: `
            <p><b>Name:</b> ${name}</p>
            <p><b>Email:</b> ${email}</p>
            <p><b>Nachricht:</b><br>${message}</p>
          `,
        });
        console.log(`[CONTACT] ✅ Nachricht gesendet an ${process.env.CONTACT_RECEIVER}`);
      } catch (e) {
        console.warn('[CONTACT] ⚠️ Mail konnte nicht gesendet werden:', e.message);
      }
    }

    res.json({ success: true, message: 'Nachricht erfolgreich gesendet!' });
  } catch (err) {
    console.error('[CONTACT] Fehler:', err);
    res
      .status(500)
      .json({ success: false, message: 'Senden fehlgeschlagen!' });
  }
});

// --- Logout ---
const doLogout = (req, res) => {
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  res.clearCookie('session', opts);
  res.clearCookie('sid', opts);
  res.json({ ok: true });
};
app.post('/api/logout', doLogout);
app.post('/api/auth/logout', doLogout);

// --- 404 + Error Handler ---
app.all('/api/*', (req, res) =>
  res
    .status(404)
    .json({ ok: false, error: `API '${req.originalUrl}' nicht gefunden.` })
);
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT ERROR:', err);
  if (!res.headersSent)
    res.status(500).json({ ok: false, error: err.message || 'Serverfehler' });
});

// --- Server ---
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;
server.requestTimeout = 20000;

server.listen(PORT, () => console.log(`🎯 Server läuft auf Port ${PORT}`));

process.on('unhandledRejection', (err) =>
  console.error('UNHANDLED', err)
);
process.on('uncaughtException', (err) =>
  console.error('UNCAUGHT', err)
);

const shutdown = async (sig) => {
  try {
    console.log(`\n🧹 ${sig}: Graceful shutdown…`);
    server.close();
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('Shutdown error:', e);
    process.exit(1);
  }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
