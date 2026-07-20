// routes/courses.js — 課程、題目、學生作答與老師批閱

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function parseOptions(row) {
  return { ...row, options: JSON.parse(row.options) };
}

// GET /api/courses — 依角色回傳對應課程
router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'teacher') {
    rows = db.prepare('SELECT * FROM courses WHERE teacher_id = ? ORDER BY created_at DESC').all(req.user.id);
  } else if (req.user.role === 'institution' || req.user.role === 'super') {
    const instId = req.user.role === 'super' ? req.query.institution_id : req.user.institution_id;
    if (!instId) return res.status(400).json({ error: '缺少園所資訊' });
    rows = db.prepare('SELECT * FROM courses WHERE institution_id = ? ORDER BY created_at DESC').all(instId);
  } else if (req.user.role === 'student') {
    rows = db.prepare(`
      SELECT c.* FROM courses c
      JOIN course_access ca ON ca.course_id = c.id
      WHERE ca.student_id = ? ORDER BY c.created_at DESC
    `).all(req.user.id);
  }

  // 附加完成率/題數等摘要資訊
  const withMeta = rows.map((c) => {
    const qCount = db.prepare('SELECT COUNT(*) n FROM questions WHERE course_id=?').get(c.id).n;
    let myAttempt = null;
    if (req.user.role === 'student') {
      myAttempt = db.prepare('SELECT * FROM attempts WHERE course_id=? AND student_id=? ORDER BY submitted_at DESC LIMIT 1').get(c.id, req.user.id);
    }
    return { ...c, question_count: qCount, my_attempt: myAttempt || null };
  });
  res.json({ courses: withMeta });
});

// POST /api/courses — 老師建立課程
router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const { title, subject, youtube_url, description } = req.body || {};
  if (!title) return res.status(400).json({ error: '請輸入課程標題' });
  const info = db.prepare(`
    INSERT INTO courses (institution_id, teacher_id, title, subject, youtube_url, description)
    VALUES (?,?,?,?,?,?)
  `).run(req.user.institution_id, req.user.id, title.trim(), subject || '', youtube_url || '', description || '');
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ course });
});

// GET /api/courses/:id — 課程詳情（含題目；學生看不到正確答案，除非已作答過）
router.get('/:id', requireAuth, (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course) return res.status(404).json({ error: '找不到課程' });

  if (req.user.role === 'student') {
    const access = db.prepare('SELECT 1 FROM course_access WHERE course_id=? AND student_id=?').get(course.id, req.user.id);
    if (!access) return res.status(403).json({ error: '你尚未被指派此課程' });
  }

  const questions = db.prepare('SELECT * FROM questions WHERE course_id=? ORDER BY order_index ASC, id ASC').all(course.id).map(parseOptions);

  let attempt = null;
  if (req.user.role === 'student') {
    attempt = db.prepare('SELECT * FROM attempts WHERE course_id=? AND student_id=? ORDER BY submitted_at DESC LIMIT 1').get(course.id, req.user.id);
    if (!attempt) {
      // 尚未作答：隱藏正確答案
      questions.forEach((q) => delete q.correct_index);
    }
  }

  res.json({ course, questions, attempt: attempt || null });
});

// PATCH /api/courses/:id — 編輯課程基本資料
router.patch('/:id', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course) return res.status(404).json({ error: '找不到課程' });
  if (req.user.role === 'teacher' && course.teacher_id !== req.user.id) {
    return res.status(403).json({ error: '只能編輯自己的課程' });
  }
  const { title, subject, youtube_url, description } = req.body || {};
  db.prepare(`
    UPDATE courses SET
      title = COALESCE(?, title), subject = COALESCE(?, subject),
      youtube_url = COALESCE(?, youtube_url), description = COALESCE(?, description),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(title || null, subject || null, youtube_url || null, description || null, req.params.id);
  res.json({ course: db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id) });
});

// ---- 題目管理 ----

// POST /api/courses/:id/questions — 新增題目（選擇題 / 照片題）
router.post('/:id/questions', requireAuth, requireRole('teacher'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course || course.teacher_id !== req.user.id) return res.status(404).json({ error: '找不到課程' });

  const { type, text, image_url, options, correct_index, order_index } = req.body || {};
  if (!['mc', 'photo'].includes(type)) return res.status(400).json({ error: '題目類型錯誤' });
  if (!text || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: '請輸入題目與至少兩個選項' });
  }
  if (correct_index == null || correct_index < 0 || correct_index >= options.length) {
    return res.status(400).json({ error: '請指定正確答案' });
  }

  const info = db.prepare(`
    INSERT INTO questions (course_id, type, text, image_url, options, correct_index, order_index)
    VALUES (?,?,?,?,?,?,?)
  `).run(course.id, type, text.trim(), image_url || null, JSON.stringify(options), correct_index, order_index || 0);

  res.status(201).json({ question: parseOptions(db.prepare('SELECT * FROM questions WHERE id=?').get(info.lastInsertRowid)) });
});

// PATCH /api/questions/:id — 編輯題目
router.patch('/questions/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: '找不到題目' });
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(q.course_id);
  if (course.teacher_id !== req.user.id) return res.status(403).json({ error: '權限不足' });

  const { text, image_url, options, correct_index } = req.body || {};
  db.prepare(`
    UPDATE questions SET
      text = COALESCE(?, text), image_url = COALESCE(?, image_url),
      options = COALESCE(?, options), correct_index = COALESCE(?, correct_index)
    WHERE id = ?
  `).run(text || null, image_url || null, options ? JSON.stringify(options) : null, correct_index ?? null, req.params.id);

  res.json({ question: parseOptions(db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id)) });
});

// DELETE /api/questions/:id
router.delete('/questions/:id', requireAuth, requireRole('teacher'), (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: '找不到題目' });
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(q.course_id);
  if (course.teacher_id !== req.user.id) return res.status(403).json({ error: '權限不足' });
  db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- 課程權限指派 ----

// GET /api/courses/:id/access — 查詢已被指派此課程的學生ID列表
router.get('/:id/access', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const rows = db.prepare('SELECT student_id FROM course_access WHERE course_id=?').all(req.params.id);
  res.json({ student_ids: rows.map((r) => r.student_id) });
});

// POST /api/courses/:id/access — 指派學生可觀看此課程
router.post('/:id/access', requireAuth, requireRole('teacher'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course || course.teacher_id !== req.user.id) return res.status(404).json({ error: '找不到課程' });
  const { student_id } = req.body || {};
  const student = db.prepare("SELECT * FROM users WHERE id=? AND role='student' AND created_by=?").get(student_id, req.user.id);
  if (!student) return res.status(404).json({ error: '找不到該學生' });

  db.prepare('INSERT OR IGNORE INTO course_access (course_id, student_id) VALUES (?,?)').run(course.id, student_id);
  res.status(201).json({ ok: true });
});

// DELETE /api/courses/:id/access/:studentId
router.delete('/:id/access/:studentId', requireAuth, requireRole('teacher'), (req, res) => {
  db.prepare('DELETE FROM course_access WHERE course_id=? AND student_id=?').run(req.params.id, req.params.studentId);
  res.json({ ok: true });
});

// ---- 學生作答 ----

// POST /api/courses/:id/submit — 學生提交測驗答案
// body: { answers: [{ question_id, selected_index }] }
router.post('/:id/submit', requireAuth, requireRole('student'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course) return res.status(404).json({ error: '找不到課程' });
  const access = db.prepare('SELECT 1 FROM course_access WHERE course_id=? AND student_id=?').get(course.id, req.user.id);
  if (!access) return res.status(403).json({ error: '你尚未被指派此課程' });

  const { answers } = req.body || {};
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: '請提供作答內容' });
  }

  const questions = db.prepare('SELECT * FROM questions WHERE course_id=?').all(course.id);
  const qMap = Object.fromEntries(questions.map((q) => [q.id, q]));

  let score = 0;
  const tx = db.transaction(() => {
    const attemptInfo = db.prepare('INSERT INTO attempts (course_id, student_id, score, total) VALUES (?,?,0,?)')
      .run(course.id, req.user.id, questions.length);
    const attemptId = attemptInfo.lastInsertRowid;

    for (const a of answers) {
      const q = qMap[a.question_id];
      if (!q) continue;
      const correct = q.correct_index === a.selected_index ? 1 : 0;
      if (correct) score++;
      db.prepare('INSERT INTO answers (attempt_id, question_id, selected_index, is_correct) VALUES (?,?,?,?)')
        .run(attemptId, a.question_id, a.selected_index, correct);
    }
    db.prepare('UPDATE attempts SET score=? WHERE id=?').run(score, attemptId);
    return attemptId;
  });

  const attemptId = tx();
  const attempt = db.prepare('SELECT * FROM attempts WHERE id=?').get(attemptId);
  const savedAnswers = db.prepare('SELECT * FROM answers WHERE attempt_id=?').all(attemptId);
  const questionsWithAnswers = questions.map(parseOptions);

  res.status(201).json({ attempt, answers: savedAnswers, questions: questionsWithAnswers });
});

// ---- 老師查看／修改批閱結果 ----

// GET /api/courses/:id/attempts — 老師查看全班作答狀況
router.get('/:id/attempts', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS student_name, u.class_name
    FROM attempts a JOIN users u ON u.id = a.student_id
    WHERE a.course_id = ? ORDER BY a.submitted_at DESC
  `).all(req.params.id);
  res.json({ attempts: rows });
});

// GET /api/attempts/:id — 單一作答詳情（含每題答案）
router.get('/attempts/:id', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const attempt = db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id);
  if (!attempt) return res.status(404).json({ error: '找不到作答紀錄' });
  const answers = db.prepare(`
    SELECT ans.*, q.text, q.options, q.correct_index, q.type, q.image_url
    FROM answers ans JOIN questions q ON q.id = ans.question_id
    WHERE ans.attempt_id = ?
  `).all(attempt.id).map((r) => ({ ...r, options: JSON.parse(r.options) }));
  res.json({ attempt, answers });
});

// PATCH /api/attempts/:attemptId/answers/:questionId — 老師修改批閱結果
router.patch('/attempts/:attemptId/answers/:questionId', requireAuth, requireRole('teacher'), (req, res) => {
  const { selected_index, is_correct } = req.body || {};
  const answer = db.prepare('SELECT * FROM answers WHERE attempt_id=? AND question_id=?').get(req.params.attemptId, req.params.questionId);
  if (!answer) return res.status(404).json({ error: '找不到該筆作答' });

  db.prepare('UPDATE answers SET selected_index = COALESCE(?, selected_index), is_correct = COALESCE(?, is_correct), overridden_by=? WHERE id=?')
    .run(selected_index ?? null, is_correct ?? null, req.user.id, answer.id);

  // 重新計算總分
  const total = db.prepare('SELECT COUNT(*) n FROM answers WHERE attempt_id=?').get(req.params.attemptId).n;
  const score = db.prepare('SELECT COUNT(*) n FROM answers WHERE attempt_id=? AND is_correct=1').get(req.params.attemptId).n;
  db.prepare('UPDATE attempts SET score=?, total=?, graded_by=? WHERE id=?').run(score, total, req.user.id, req.params.attemptId);

  res.json({ attempt: db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.attemptId) });
});

module.exports = router;
