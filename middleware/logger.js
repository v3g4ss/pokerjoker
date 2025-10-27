// middleware/logger.js
module.exports = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.cookies?.session) console.log('🟢 Session vorhanden');
  else console.log('🔴 Keine Session im Cookie');
  next();
};
