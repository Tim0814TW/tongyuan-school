// middleware/auth.js — JWT 驗證與角色權限控管

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '請先登入' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, role, institution_id, name, email }
    next();
  } catch (err) {
    return res.status(401).json({ error: '登入已過期，請重新登入' });
  }
}

// 用法: requireRole('super','institution')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '權限不足，無法執行此操作' });
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      institution_id: user.institution_id,
      name: user.name,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = { requireAuth, requireRole, signToken, JWT_SECRET };
