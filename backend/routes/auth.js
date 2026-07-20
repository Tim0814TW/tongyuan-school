// routes/auth.js — 登入 / 取得目前使用者

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
// body: { email, password, orgCode? }
router.post('/login', (req, res) => {
  const { email, password, orgCode } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email.trim());

  if (!user || user.status === 'disabled') {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }

  // 若前端有帶園所代碼，且角色非最高權限，驗證代碼是否相符
  if (orgCode && user.role !== 'super') {
    const inst = db
      .prepare('SELECT * FROM institutions WHERE id = ?')
      .get(user.institution_id);
    if (!inst || inst.code.toUpperCase() !== String(orgCode).toUpperCase()) {
      return res.status(401).json({ error: '園所代碼不正確' });
    }
    if (inst.status === 'disabled') {
      return res.status(403).json({ error: '此園所帳號已被停用，請聯繫系統管理員' });
    }
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      institution_id: user.institution_id,
      class_name: user.class_name,
      subject: user.subject,
    },
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,role,institution_id,class_name,subject FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  res.json({ user });
});

module.exports = router;
