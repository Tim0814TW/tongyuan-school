// routes/auth.js — 登入 / 取得目前使用者

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { createIdentityClient, IdentityServiceError } = require('../services/identity');

const router = express.Router();
const identity = createIdentityClient();

function findLocalUser(shared) {
  if (shared.legacy?.userId) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(shared.legacy.userId);
  }
  const candidates = [shared.user?.username, shared.user?.email].filter(Boolean);
  for (const identifier of candidates) {
    const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(identifier);
    if (user) return user;
  }
  return null;
}

function publicLocalUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    institution_id: user.institution_id,
    class_name: user.class_name,
    subject: user.subject,
    grade: user.grade,
    guardian_name: user.guardian_name,
    guardian_phone: user.guardian_phone,
  };
}

function validateLocalAccess(user, shared) {
  if (!user || user.status === 'disabled') return { status: 401, error: '帳號尚未連結線上學院或已停用' };
  const expectedRoles = { admin: 'super', school: 'institution', teacher: 'teacher', student: 'student' };
  if (shared && expectedRoles[shared.user?.role] !== user.role) {
    return { status: 409, error: '共用帳號與線上學院身份不一致，請聯繫系統管理員' };
  }
  if (user.role !== 'super') {
    const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(user.institution_id);
    if (!inst) return { status: 401, error: '帳號尚未連結園所' };
    if (inst.status === 'disabled') return { status: 403, error: '此園所帳號已被停用，請聯繫系統管理員' };
  }
  return null;
}

// POST /api/auth/login
// body: { email, password }
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }

  let shared = null;
  try {
    shared = await identity.authenticate({ identifier: email.trim(), password });
  } catch (error) {
    if (!(error instanceof IdentityServiceError)) return next(error);
    if (!(identity.mode === 'prefer' && error.unavailable)) {
      const status = error.status === 401 ? 401 : error.status === 403 ? 403 : 503;
      return res.status(status).json({ error: status === 503 ? '共用登入服務暫時無法使用' : '帳號或密碼錯誤' });
    }
  }

  const user = shared ? findLocalUser(shared) : db
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email.trim());

  if (!shared && (!user || user.status === 'disabled' || !bcrypt.compareSync(password, user.password_hash))) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }

  const accessError = validateLocalAccess(user, shared);
  if (accessError) return res.status(accessError.status).json({ error: accessError.error });

  const token = signToken(user);
  res.json({
    token,
    user: publicLocalUser(user),
    identity: shared ? { connected: true } : { connected: false },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,role,institution_id,grade,class_name,guardian_name,guardian_phone,subject FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  res.json({ user });
});

module.exports = router;
