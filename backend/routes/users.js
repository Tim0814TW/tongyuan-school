// routes/users.js — 老師 / 學生帳號管理
// 權限鏈：園所 建立 老師；老師 建立 學生

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users?role=teacher|student
router.get('/', requireAuth, (req, res) => {
  const { role } = req.query;

  if (role === 'teacher') {
    // 園所查看自己底下老師；最高權限可查看指定園所（用 ?institution_id=）
    const instId = req.user.role === 'super' ? req.query.institution_id : req.user.institution_id;
    if (!instId) return res.status(400).json({ error: '缺少園所資訊' });
    const rows = db.prepare(`
      SELECT u.id,u.name,u.email,u.phone,u.subject,u.class_name,u.status,u.created_at,
        (SELECT COUNT(*) FROM courses WHERE teacher_id=u.id) AS course_count
      FROM users u WHERE u.institution_id = ? AND u.role='teacher' ORDER BY u.created_at DESC
    `).all(instId);
    return res.json({ users: rows });
  }

  if (role === 'student') {
    // 老師查看自己建立的學生；園所可查看全園所學生
    let rows;
    if (req.user.role === 'teacher') {
      rows = db.prepare(`
        SELECT id,name,email,class_name,status,created_at FROM users
        WHERE role='student' AND created_by = ? ORDER BY created_at DESC
      `).all(req.user.id);
    } else if (req.user.role === 'institution') {
      rows = db.prepare(`
        SELECT id,name,email,class_name,status,created_at FROM users
        WHERE role='student' AND institution_id = ? ORDER BY created_at DESC
      `).all(req.user.institution_id);
    } else {
      return res.status(403).json({ error: '權限不足' });
    }
    return res.json({ users: rows });
  }

  res.status(400).json({ error: '請提供 role 參數 (teacher 或 student)' });
});

// POST /api/users — 建立老師（園所限定）或學生（老師限定）
// body teacher: { name, email, phone, password, subject, class_name }
// body student: { name, email, password, class_name }
router.post('/', requireAuth, requireRole('institution', 'teacher'), (req, res) => {
  const { name, email, phone, password, subject, class_name } = req.body || {};
  if (!name || !email || !password || (req.user.role === 'institution' && !phone)) {
    return res.status(400).json({ error: req.user.role === 'institution' ? '請填寫老師姓名、登入帳號、電話與密碼' : '請填寫姓名、Email 與密碼' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
  if (existing) return res.status(409).json({ error: '此 Email 已被使用' });

  const role = req.user.role === 'institution' ? 'teacher' : 'student';
  const hash = bcrypt.hashSync(password, 10);

  const info = db.prepare(`
    INSERT INTO users (institution_id, name, email, phone, password_hash, role, subject, class_name, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(req.user.institution_id, name.trim(), email.trim(), String(phone || '').trim(), hash, role, subject || null, class_name || null, req.user.id);

  const user = db.prepare('SELECT id,name,email,phone,role,subject,class_name,status,created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user });
});

// PATCH /api/users/:id — 停用/啟用帳號、編輯資料
router.patch('/:id', requireAuth, requireRole('institution', 'teacher', 'super'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: '找不到使用者' });

  // 權限範圍檢查：只能管理自己建立的帳號，或同園所下屬角色
  const canManage =
    req.user.role === 'super' ||
    (req.user.role === 'institution' && target.institution_id === req.user.institution_id && target.role === 'teacher') ||
    (req.user.role === 'teacher' && target.created_by === req.user.id && target.role === 'student');
  if (!canManage) return res.status(403).json({ error: '權限不足，無法管理此帳號' });

  const { status, name, phone, class_name, subject } = req.body || {};
  db.prepare(`
    UPDATE users SET
      status = COALESCE(?, status),
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      class_name = COALESCE(?, class_name),
      subject = COALESCE(?, subject)
    WHERE id = ?
  `).run(status || null, name || null, phone ?? null, class_name || null, subject || null, req.params.id);

  res.json({ user: db.prepare('SELECT id,name,email,phone,role,subject,class_name,status FROM users WHERE id = ?').get(req.params.id) });
});

module.exports = router;
