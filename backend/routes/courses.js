// routes/courses.js — 課程、題目、學生作答與老師批閱

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function parseOptions(row) {
  return { ...row, options: JSON.parse(row.options) };
}

function courseForUser(courseId, user) {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!course) return null;
  if (user.role === 'super') return course;
  if (user.role === 'student') {
    if (course.institution_id !== user.institution_id) return null;
    const blocked = db.prepare('SELECT 1 FROM course_blocks WHERE course_id=? AND student_id=?').get(course.id, user.id);
    return blocked ? null : course;
  }
  return course.institution_id === user.institution_id ? course : null;
}

// GET /api/courses — 依角色回傳對應課程
router.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'teacher') {
    rows = db.prepare('SELECT * FROM courses WHERE institution_id = ? ORDER BY created_at DESC').all(req.user.institution_id);
  } else if (req.user.role === 'institution' || req.user.role === 'super') {
    const instId = req.user.role === 'super' ? req.query.institution_id : req.user.institution_id;
    if (!instId) return res.status(400).json({ error: '缺少園所資訊' });
    rows = db.prepare('SELECT * FROM courses WHERE institution_id = ? ORDER BY created_at DESC').all(instId);
  } else if (req.user.role === 'student') {
    rows = db.prepare(`
      SELECT c.* FROM courses c
      WHERE c.institution_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM course_blocks cb WHERE cb.course_id = c.id AND cb.student_id = ?
        )
      ORDER BY c.created_at DESC
    `).all(req.user.institution_id, req.user.id);
  }

  // 附加完成率/題數等摘要資訊
  const withMeta = rows.map((c) => {
    const qCount = db.prepare('SELECT COUNT(*) n FROM questions WHERE course_id=?').get(c.id).n;
    const teacher = db.prepare('SELECT name,email FROM users WHERE id=?').get(c.teacher_id);
    const classRow = c.class_id ? db.prepare('SELECT name FROM classes WHERE id=?').get(c.class_id) : null;
    let myAttempt = null;
    if (req.user.role === 'student') {
      myAttempt = db.prepare('SELECT * FROM attempts WHERE course_id=? AND student_id=? ORDER BY submitted_at DESC LIMIT 1').get(c.id, req.user.id);
    }
    return {
      ...c,
      teacher_name: teacher?.name || '',
      teacher_email: teacher?.email || '',
      class_name: classRow?.name || '',
      question_count: qCount,
      can_edit: req.user.role === 'institution' || (req.user.role === 'teacher' && c.teacher_id === req.user.id),
      my_attempt: myAttempt || null,
    };
  });
  res.json({ courses: withMeta });
});

// POST /api/courses — 老師建立課程
router.post('/', requireAuth, requireRole('teacher'), (req, res) => {
  const { title, subject, class_id, youtube_url, description } = req.body || {};
  if (!title) return res.status(400).json({ error: '請輸入課程標題' });
  const selectedClass = class_id
    ? db.prepare("SELECT id FROM classes WHERE id=? AND institution_id=? AND status='active'").get(class_id, req.user.institution_id)
    : null;
  if (class_id && !selectedClass) return res.status(400).json({ error: '請選擇有效班級' });
  const info = db.prepare(`
    INSERT INTO courses (institution_id, teacher_id, class_id, title, subject, youtube_url, description)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.institution_id, req.user.id, selectedClass?.id || null, title.trim(), subject || '', youtube_url || '', description || '');
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ course });
});

// GET /api/courses/:id — 課程詳情（含題目；學生看不到正確答案，除非已作答過）
router.get('/:id', requireAuth, (req, res) => {
  const course = courseForUser(req.params.id, req.user);
  if (!course) return res.status(404).json({ error: '找不到課程或尚未開通' });

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
  if (req.user.role === 'institution' && course.institution_id !== req.user.institution_id) {
    return res.status(403).json({ error: '只能整理自己園所的課程' });
  }
  const { title, subject, class_id, youtube_url, description, teacher_id } = req.body || {};
  let nextTeacherId = null;
  if (req.user.role === 'institution' && teacher_id != null) {
    const teacher = db.prepare(
      "SELECT id FROM users WHERE id=? AND institution_id=? AND role='teacher' AND status='active'",
    ).get(teacher_id, req.user.institution_id);
    if (!teacher) return res.status(400).json({ error: '請選擇此園所仍啟用的老師' });
    nextTeacherId = teacher.id;
  }
  let nextClassId = null;
  const hasClassSelection = Object.prototype.hasOwnProperty.call(req.body || {}, 'class_id');
  if (class_id != null) {
    const selectedClass = db.prepare("SELECT id FROM classes WHERE id=? AND institution_id=? AND status='active'")
      .get(class_id, course.institution_id);
    if (!selectedClass) return res.status(400).json({ error: '請選擇有效班級' });
    nextClassId = selectedClass.id;
  }
  db.prepare(`
    UPDATE courses SET
      title = COALESCE(?, title), subject = COALESCE(?, subject),
      youtube_url = COALESCE(?, youtube_url), description = COALESCE(?, description),
      teacher_id = COALESCE(?, teacher_id),
      class_id = CASE WHEN ? THEN ? ELSE class_id END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null, subject ?? null, youtube_url ?? null, description ?? null,
    nextTeacherId, hasClassSelection ? 1 : 0, nextClassId, req.params.id,
  );
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

// ---- 課程觀看權限（預設全園開放；個別學生可被關閉） ----

// GET /api/courses/:id/access — 查詢目前可觀看此課程的學生 ID
router.get('/:id/access', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const course = courseForUser(req.params.id, req.user);
  if (!course || (req.user.role === 'teacher' && course.teacher_id !== req.user.id)) {
    return res.status(404).json({ error: '找不到可管理的課程' });
  }
  const rows = db.prepare(`
    SELECT u.id FROM users u
    WHERE u.institution_id=? AND u.role='student' AND u.status='active'
      AND NOT EXISTS (
        SELECT 1 FROM course_blocks cb WHERE cb.course_id=? AND cb.student_id=u.id
      )
    ORDER BY u.created_at DESC
  `).all(course.institution_id, course.id);
  res.json({ student_ids: rows.map((r) => r.id), default_open: true });
});

// POST /api/courses/:id/access — 恢復學生觀看權限
router.post('/:id/access', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const course = courseForUser(req.params.id, req.user);
  if (!course || (req.user.role === 'teacher' && course.teacher_id !== req.user.id)) {
    return res.status(404).json({ error: '找不到可管理的課程' });
  }
  const { student_id } = req.body || {};
  const student = db.prepare("SELECT * FROM users WHERE id=? AND institution_id=? AND role='student' AND status='active'")
    .get(student_id, course.institution_id);
  if (!student) return res.status(404).json({ error: '找不到該學生' });

  db.prepare('DELETE FROM course_blocks WHERE course_id=? AND student_id=?').run(course.id, student_id);
  res.status(201).json({ ok: true });
});

// DELETE /api/courses/:id/access/:studentId — 關閉特定學生觀看權限
router.delete('/:id/access/:studentId', requireAuth, requireRole('teacher', 'institution'), (req, res) => {
  const course = courseForUser(req.params.id, req.user);
  if (!course || (req.user.role === 'teacher' && course.teacher_id !== req.user.id)) {
    return res.status(404).json({ error: '找不到可管理的課程' });
  }
  const student = db.prepare("SELECT id FROM users WHERE id=? AND institution_id=? AND role='student'")
    .get(req.params.studentId, course.institution_id);
  if (!student) return res.status(404).json({ error: '找不到該學生' });
  db.prepare("INSERT OR IGNORE INTO course_blocks (course_id, student_id, blocked_by, blocked_at) VALUES (?,?,?,datetime('now'))")
    .run(course.id, student.id, req.user.id);
  res.json({ ok: true });
});

// ---- 學生作答 ----

// POST /api/courses/:id/submit — 學生提交測驗答案
// body: { answers: [{ question_id, selected_index }] }
router.post('/:id/submit', requireAuth, requireRole('student'), (req, res) => {
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course) return res.status(404).json({ error: '找不到課程' });
  if (!courseForUser(course.id, req.user)) return res.status(403).json({ error: '此課程已對你的帳號關閉' });

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
  const course = courseForUser(req.params.id, req.user);
  if (!course || (req.user.role === 'teacher' && course.teacher_id !== req.user.id)) {
    return res.status(404).json({ error: '找不到可管理的課程' });
  }
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
  const course = courseForUser(attempt.course_id, req.user);
  if (!course || (req.user.role === 'teacher' && course.teacher_id !== req.user.id)) {
    return res.status(404).json({ error: '找不到可管理的作答紀錄' });
  }
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
  const question = db.prepare('SELECT course_id FROM questions WHERE id=?').get(req.params.questionId);
  const course = question && db.prepare('SELECT * FROM courses WHERE id=?').get(question.course_id);
  if (!course || course.teacher_id !== req.user.id) return res.status(403).json({ error: '只能批閱自己課程的作答' });

  db.prepare('UPDATE answers SET selected_index = COALESCE(?, selected_index), is_correct = COALESCE(?, is_correct), overridden_by=? WHERE id=?')
    .run(selected_index ?? null, is_correct ?? null, req.user.id, answer.id);

  // 重新計算總分
  const total = db.prepare('SELECT COUNT(*) n FROM answers WHERE attempt_id=?').get(req.params.attemptId).n;
  const score = db.prepare('SELECT COUNT(*) n FROM answers WHERE attempt_id=? AND is_correct=1').get(req.params.attemptId).n;
  db.prepare('UPDATE attempts SET score=?, total=?, graded_by=? WHERE id=?').run(score, total, req.user.id, req.params.attemptId);

  res.json({ attempt: db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.attemptId) });
});

module.exports = router;
