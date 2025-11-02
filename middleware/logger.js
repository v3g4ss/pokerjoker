// middleware/logger.js
const isDev = process.env.NODE_ENV !== 'production';

module.exports = (req, res, next) => {
  // Nur in Development loggen → Production bleibt schnell
  if (isDev) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.cookies?.session) console.log('🟢 Session vorhanden');
    else console.log('🔴 Keine Session im Cookie');
  }
  next();
};
