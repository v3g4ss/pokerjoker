const jwt = require('jsonwebtoken');

module.exports = function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ message: 'Nicht eingeloggt' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    
    // JWT enthält bereits id & is_admin → direkt nutzen (keine DB-Query!)
    req.user = { 
      id: payload.id, 
      is_admin: !!payload.is_admin 
    };
    next();
  } catch (err) {
    console.error('Auth Fehler:', err.message);
    return res.status(401).json({ message: 'Session ungültig' });
  }
};
