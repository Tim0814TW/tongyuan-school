// routes/users.js — 老師 / 學生帳號管理
// 權限鏈：園所 建立 老師；老師 建立 學生

const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseUserImport, validateUserImport, applyDefaultTeacher } = require('../services/user-import');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    callback(null, /\.xlsx$/i.test(file.originalname));
  },
});
function uploadSpreadsheet(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Excel 檔案不可超過 2MB' });
    if (error) return next(error);
    next();
  });
}

// GET /api/users?role=teacher|student
router.get('/', requireAuth, (req, res) => {
  const { role } = req.query;

  if (role === 'teacher') {
    // 園所查看自己底下老師；最高權限可查看指定園所（用 ?institution_id=）
    const instId = req.user.role === 'super' ? req.query.institution_id : req.user.institution_id;
    if (!instId) return res.status(400).json({ error: '缺少園所資訊' });
    const rows = db.prepare(`
      SELECT u.id,u.name,u.email,u.phone,u.status,u.created_at,
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
        SELECT id,name,email,grade,class_id,class_name,guardian_name,guardian_phone,status,created_at FROM users
        WHERE role='student' AND institution_id = ? ORDER BY created_at DESC
      `).all(req.user.institution_id);
    } else if (req.user.role === 'institution') {
      rows = db.prepare(`
        SELECT id,name,email,grade,class_id,class_name,guardian_name,guardian_phone,status,created_at FROM users
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
// body teacher: { name, email, phone, password }
// body student: { name, email, password, grade, class_id, guardian_name, guardian_phone }
router.post('/', requireAuth, requireRole('institution', 'teacher'), (req, res) => {
  const { name, email, phone, password, grade, class_id, guardian_name, guardian_phone } = req.body || {};
  const missingTeacherFields = false;
  const missingStudentFields = req.user.role === 'teacher' && (!grade || !class_id || !guardian_name || !guardian_phone);
  if (!name || !email || !password || missingTeacherFields || missingStudentFields) {
    const error = req.user.role === 'institution'
      ? '請填寫老師姓名、登入帳號與密碼'
      : '請填寫學生姓名、登入帳號、年級、班級、家長資料與密碼';
    return res.status(400).json({ error });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
  if (existing) return res.status(409).json({ error: '此登入帳號已被使用' });

  const role = req.user.role === 'institution' ? 'teacher' : 'student';
  const selectedClass = role === 'student'
    ? db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=? AND status='active'").get(class_id, req.user.institution_id)
    : null;
  if (role === 'student' && !selectedClass) return res.status(400).json({ error: '請選擇有效班級' });
  const hash = bcrypt.hashSync(password, 10);

  const info = db.prepare(`
    INSERT INTO users (
      institution_id, name, email, phone, password_hash, role,
      grade, class_id, class_name, guardian_name, guardian_phone, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.institution_id, name.trim(), email.trim(), String(phone || '').trim(), hash, role,
    grade || null, selectedClass?.id || null, selectedClass?.name || null,
    guardian_name || null, guardian_phone || null, req.user.id
  );

  const user = db.prepare('SELECT id,name,email,phone,role,grade,class_id,class_name,guardian_name,guardian_phone,status,created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user });
});

router.post('/import', requireAuth, requireRole('institution'), uploadSpreadsheet, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '請上傳 .xlsx Excel 檔案' });
    const parsed = applyDefaultTeacher(
      await parseUserImport(req.file.buffer),
      req.body?.defaultTeacherUsername,
    );
    const existingAccounts = db.prepare('SELECT email FROM users').all().map((row) => row.email);
    const existingTeachers = db.prepare(
      "SELECT email FROM users WHERE institution_id = ? AND role = 'teacher'",
    ).all(req.user.institution_id).map((row) => row.email);
    const validation = validateUserImport(parsed, { existingAccounts, existingTeachers });
    if (!validation.valid) return res.status(422).json(validation);
    if (String(req.body?.dryRun) === 'true') return res.json(validation);

    const imported = db.transaction(() => {
      const teacherIds = new Map(
        db.prepare("SELECT id,email FROM users WHERE institution_id = ? AND role = 'teacher'")
          .all(req.user.institution_id)
          .map((row) => [row.email.toLowerCase(), row.id]),
      );
      const findClass = db.prepare('SELECT id FROM classes WHERE institution_id=? AND name=? COLLATE NOCASE');
      const insertClass = db.prepare('INSERT INTO classes (institution_id,name,grade) VALUES (?,?,?)');
      const classIdFor = (className, grade) => {
        if (!className) return null;
        const existingClass = findClass.get(req.user.institution_id, className);
        if (existingClass) return existingClass.id;
        return Number(insertClass.run(req.user.institution_id, className, grade || '').lastInsertRowid);
      };
      const insertUser = db.prepare(`
        INSERT INTO users (
          institution_id, name, email, phone, password_hash, role, subject,
          grade, class_id, class_name, guardian_name, guardian_phone, created_by, status
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const row of parsed.teachers) {
        const info = insertUser.run(
          req.user.institution_id, row.name, row.username, row.phone, bcrypt.hashSync(row.password, 10),
          'teacher', null, null, null, null, null, null, req.user.id, row.status,
        );
        teacherIds.set(row.username.toLowerCase(), Number(info.lastInsertRowid));
      }
      for (const row of parsed.students) {
        insertUser.run(
          req.user.institution_id, row.name, row.username, '', bcrypt.hashSync(row.password, 10),
          'student', null, row.grade || null, classIdFor(row.className, row.grade), row.className, row.guardianName || null,
          row.guardianPhone || null, teacherIds.get(row.teacherUsername.toLowerCase()), row.status,
        );
      }
      return validation.summary;
    })();

    res.status(201).json({ valid: true, imported, errors: [] });
  } catch (error) {
    if (/invalid_xlsx|zip|central directory|worksheets/i.test(String(error?.message || ''))) {
      return res.status(400).json({ error: 'Excel 檔案格式不正確或已損壞' });
    }
    next(error);
  }
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

  const { status, name, email, phone, password, grade, class_id, guardian_name, guardian_phone } = req.body || {};
  if (email) {
    const duplicate = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?')
      .get(email.trim(), target.id);
    if (duplicate) return res.status(409).json({ error: '此登入帳號已被使用' });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ error: '新密碼至少需要 8 個字元' });
  }
  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;
  let selectedClass = null;
  if (class_id != null && target.role === 'student') {
    selectedClass = db.prepare("SELECT * FROM classes WHERE id=? AND institution_id=? AND status='active'")
      .get(class_id, target.institution_id);
    if (!selectedClass) return res.status(400).json({ error: '請選擇有效班級' });
  }
  db.prepare(`
    UPDATE users SET
      status = COALESCE(?, status),
      name = COALESCE(?, name),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      password_hash = COALESCE(?, password_hash),
      grade = COALESCE(?, grade), class_id = COALESCE(?, class_id),
      class_name = COALESCE(?, class_name),
      guardian_name = COALESCE(?, guardian_name),
      guardian_phone = COALESCE(?, guardian_phone)
    WHERE id = ?
  `).run(
    status || null, name || null, email ? email.trim() : null, phone ?? null, passwordHash,
    grade ?? null, selectedClass?.id || null, selectedClass?.name || null,
    guardian_name ?? null, guardian_phone ?? null, req.params.id
  );

  res.json({ user: db.prepare('SELECT id,name,email,phone,role,grade,class_id,class_name,guardian_name,guardian_phone,status FROM users WHERE id = ?').get(req.params.id) });
});

module.exports = router;
