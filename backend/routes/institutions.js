// routes/institutions.js — 園所管理（僅最高權限可建立/管理）

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function genCode(name) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'INS' + rand;
}

// GET /api/institutions — 最高權限：全部園所；園所本身：只能看自己
router.get('/', requireAuth, (req, res) => {
  if (req.user.role === 'super') {
    const rows = db.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM users WHERE institution_id=i.id AND role='teacher') AS teacher_count,
        (SELECT COUNT(*) FROM users WHERE institution_id=i.id AND role='student') AS student_count
      FROM institutions i ORDER BY i.created_at DESC
    `).all();
    return res.json({ institutions: rows });
  }
  if (req.user.institution_id) {
    const row = db.prepare('SELECT * FROM institutions WHERE id = ?').get(req.user.institution_id);
    return res.json({ institutions: row ? [row] : [] });
  }
  res.status(403).json({ error: '權限不足' });
});

// POST /api/institutions — 最高權限建立園所 + 園所管理員帳號
// body: { name, address, contactPhone, directorName, directorPhone,
//         directorEmail, authorizationYear, authorizationPeriod,
//         plan, ownerName, ownerEmail, ownerPassword }
router.post('/', requireAuth, requireRole('super'), (req, res) => {
  const {
    name, address, contactPhone, directorName, directorPhone, directorEmail,
    authorizationYear, authorizationPeriod, plan,
    ownerName, ownerEmail, ownerPassword,
  } = req.body || {};
  if (!name || !address || !contactPhone || !directorName || !directorPhone || !directorEmail ||
      !ownerName || !ownerEmail || !ownerPassword) {
    return res.status(400).json({ error: '請填寫完整園所、主任與管理員帳號資訊' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(ownerEmail.trim());
  if (existing) return res.status(409).json({ error: '此 Email 已被使用' });

  const code = genCode(name);
  const tx = db.transaction(() => {
    const instInfo = db
      .prepare(`
        INSERT INTO institutions (
          name, code, address, contact_phone, director_name, director_phone,
          director_email, authorization_year, authorization_period, plan
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `)
      .run(
        name.trim(), code, address.trim(), contactPhone.trim(), directorName.trim(),
        directorPhone.trim(), directorEmail.trim(), String(authorizationYear || '').trim(),
        String(authorizationPeriod || '').trim(), plan || '標準方案'
      );
    const institutionId = instInfo.lastInsertRowid;

    const hash = bcrypt.hashSync(ownerPassword, 10);
    db.prepare(`
      INSERT INTO users (institution_id, name, email, password_hash, role, created_by)
      VALUES (?,?,?,?,'institution',?)
    `).run(institutionId, ownerName.trim(), ownerEmail.trim(), hash, req.user.id);

    return institutionId;
  });

  const institutionId = tx();
  const institution = db.prepare('SELECT * FROM institutions WHERE id = ?').get(institutionId);
  res.status(201).json({ institution });
});

// PATCH /api/institutions/:id — 停用/啟用、修改方案
router.patch('/:id', requireAuth, requireRole('super'), (req, res) => {
  const {
    status, plan, name, address, contactPhone, directorName, directorPhone,
    directorEmail, authorizationYear, authorizationPeriod,
  } = req.body || {};
  const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(req.params.id);
  if (!inst) return res.status(404).json({ error: '找不到園所' });

  db.prepare(`
    UPDATE institutions SET
      status = COALESCE(?, status), plan = COALESCE(?, plan), name = COALESCE(?, name),
      address = COALESCE(?, address), contact_phone = COALESCE(?, contact_phone),
      director_name = COALESCE(?, director_name), director_phone = COALESCE(?, director_phone),
      director_email = COALESCE(?, director_email),
      authorization_year = COALESCE(?, authorization_year),
      authorization_period = COALESCE(?, authorization_period)
    WHERE id = ?
  `).run(
    status || null, plan || null, name || null, address || null, contactPhone || null,
    directorName || null, directorPhone || null, directorEmail || null,
    authorizationYear ?? null, authorizationPeriod ?? null, req.params.id
  );

  res.json({ institution: db.prepare('SELECT * FROM institutions WHERE id = ?').get(req.params.id) });
});

module.exports = router;
