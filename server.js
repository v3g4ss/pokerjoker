// =========================== server.js (CommonJS + Brevo + PayPal Fix) ===========================

// --- Imports ---
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const http = require('http');
const compression = require('compression');
const { pool } = require('./db');
const { sendMailSafe: sendMail } = require('./utils/mailer');
const requireAuth = require('./middleware/requireAuth');
const requireAdmin = require('./middleware/requireAdmin');

// --- App ---
const app = express();
app.set('trust proxy', 1); // Render läuft hinter Proxy (sonst verliert er Cookies)

// --- Stripe Webhook ---
const pay = require('./routes/pay');
app.post(
  '/api/pay/stripe/webhook',
  express.raw({ type: 'application/json' }),
  pay.stripeWebhook
);

// --- PayPal Routes ---
const paypalRouter = require('./routes/paypal');

// --- Middleware ---
app.use(cors({
  origin: ['https://poker-joker.tech', 'https://www.poker-joker.tech'],
  credentials: true
}));

app.use(cookieParser()); // Cookies zuerst parsen!
app.use(require('./middleware/logger'));
app.use(compression()); // Gzip/Brotli Kompression
app.use(express.json({ limit: '1mb' }));

// === Session-Cookie Handling ===
// JWT wird in Cookies gespeichert, also wichtig: SameSite = none + secure
app.use((req, res, next) => {
  req.setSessionCookie = (payload) => {
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('session', token, {
      httpOnly: true,
      sameSite: 'none', // Muss 'none' sein für HTTPS & cross-site
      secure: true,     // Render läuft immer mit HTTPS
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 Tage
    });
  };
  next();
});

// --- Timeout-Schutz ---
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
const adminMenuRoutes = require('./routes/admin-menu');
const adminPromptRoutes = require('./routes/admin-prompt');
const adminRoutes = require('./routes/admin');
const adminBotRoutes = require('./routes/admin-bot');
const adminKbRoutes = require('./routes/admin-kb');
const adminMessagesRoutes = require('./routes/admin-messages');
const adminPayConfig = require('./routes/admin-payconfig');

app.use('/api/admin', adminPromptRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminBotRoutes);
app.use('/api/admin', adminKbRoutes);
app.use('/api/admin', adminMessagesRoutes);
app.use('/api/admin', adminMenuRoutes);
app.use('/api/admin/payconfig', adminPayConfig);
app.use('/api/admin/upload-img', require('./routes/admin-upload-img'));


// --- User APIs ---
const chatRoutes = require('./routes/chat');
const menuRoutes = require('./routes/menu');
const messagesRoutes = require('./routes/messages');
const tokensRoutes = require('./routes/tokens');
const authRouter = require('./routes/auth');
const passwordRouter = require('./routes/password');

app.use('/api/chat', chatRoutes);
app.use('/api', menuRoutes);
app.use('/api', messagesRoutes);
app.use('/api/tokens', tokensRoutes);

// --- Auth ---
app.use('/api/auth', authRouter);
app.use('/api/password', passwordRouter);

// --- Static Files (mit Browser-Caching) ---
const staticOptions = {
  maxAge: '1h',           // Browser cached 1 Stunde
  etag: true,            // ETag für Validierung
  lastModified: true     // Last-Modified Header
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/app', express.static(path.join(__dirname, 'public', 'app'), staticOptions));

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
      return res.status(400).json({ success: false, message: 'Bitte alle Felder ausfüllen.' });
    }

    await pool.query(
      `INSERT INTO public.messages(name,email,subject,message,created_at)
       VALUES ($1,$2,$3,$4,now())`,
      [name, email, subject, message]
    );

    if (process.env.CONTACT_RECEIVER) {
      try {
        await sendMail({
          to: process.env.CONTACT_RECEIVER,
          subject: `Kontaktanfrage: ${subject}`,
          html: `
            <p><b>Name:</b> ${name}</p>
            <p><b>Email:</b> ${email}</p>
            <p><b>Nachricht:</b><br>${message}</p>
          `
        });
        console.log(`[CONTACT] ✅ Nachricht gesendet an ${process.env.CONTACT_RECEIVER}`);
      } catch (e) {
        console.warn('[CONTACT] ⚠️ Mail konnte nicht gesendet werden:', e.message);
      }
    }

    res.json({ success: true, message: 'Nachricht erfolgreich gesendet!' });
  } catch (err) {
    console.error('[CONTACT] Fehler:', err);
    res.status(500).json({ success: false, message: 'Senden fehlgeschlagen!' });
  }
});

// --- Logout ---
const doLogout = (req, res) => {
  const opts = {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
  };

  try {
    res.clearCookie('session', opts);
    res.clearCookie('sid', opts);
    console.log('✅ Logout: Cookies wurden entfernt');
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Logout-Fehler:', err.message);
    res.status(500).json({ ok: false, error: 'Logout fehlgeschlagen' });
  }
};
app.post('/api/logout', doLogout);
app.post('/api/auth/logout', doLogout);

// --- 404 + Error Handler ---
app.all('/api/*', (req, res) =>
  res.status(404).json({ ok: false, error: `API '${req.originalUrl}' nicht gefunden.` })
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

process.on('unhandledRejection', (err) => console.error('UNHANDLED', err));
process.on('uncaughtException', (err) => console.error('UNCAUGHT', err));

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
