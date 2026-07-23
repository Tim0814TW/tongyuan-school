// routes/classes.js — 園所班級資料與選單

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  if (!req.user.institution_id) return res.status(400).json({ error: '缺少園所資訊' });
  const classes = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM users u WHERE u.class_id=c.id AND u.role='student') AS student_count,
      (SELECT COUNT(*) FROM courses co WHERE co.class_id=c.id) AS course_count
    FROM classes c
    WHERE c.institution_id=?
    ORDER BY c.status='active' DESC, c.grade, c.name
  `).all(req.user.institution_id);
  res.json({ classes });
});

router.post('/', requireAuth, requireRole('institution'), (req, res) => {
  const { name, grade } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '請輸入班級名稱' });
  const duplicate = db.prepare('SELECT id FROM classes WHERE institution_id=? AND name=? COLLATE NOCASE')
    .get(req.user.institution_id, name.trim());
  if (duplicate) return res.status(409).json({ error: '此班級已存在' });
  const info = db.prepare('INSERT INTO classes (institution_id,name,grade) VALUES (?,?,?)')
    .run(req.user.institution_id, name.trim(), String(grade || '').trim());
  res.status(201).json({ class: db.prepare('SELECT * FROM classes WHERE id=?').get(info.lastInsertRowid) });
});

router.patch('/:id', requireAuth, requireRole('institution'), (req, res) => {
  const target = db.prepare('SELECT * FROM classes WHERE id=? AND institution_id=?')
    .get(req.params.id, req.user.institution_id);
  if (!target) return res.status(404).json({ error: '找不到班級' });
  const { name, grade, status } = req.body || {};
  if (name?.trim()) {
    const duplicate = db.prepare('SELECT id FROM classes WHERE institution_id=? AND name=? COLLATE NOCASE AND id!=?')
      .get(req.user.institution_id, name.trim(), target.id);
    if (duplicate) return res.status(409).json({ error: '此班級已存在' });
  }
  db.prepare(`
    UPDATE classes SET name=COALESCE(?,name), grade=COALESCE(?,grade), status=COALESCE(?,status)
    WHERE id=?
  `).run(name?.trim() || null, grade ?? null, status || null, target.id);
  if (name?.trim()) {
    db.prepare('UPDATE users SET class_name=? WHERE class_id=?').run(name.trim(), target.id);
  }
  res.json({ class: db.prepare('SELECT * FROM classes WHERE id=?').get(target.id) });
});

module.exports = router;
