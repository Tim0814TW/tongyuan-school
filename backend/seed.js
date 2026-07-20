// seed.js — 建立示範資料（園所／老師／學生／課程／題目）
// 執行方式：npm run seed

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

console.log('🌱 清空舊資料...');
db.exec(`
  DELETE FROM answers; DELETE FROM attempts; DELETE FROM course_access;
  DELETE FROM questions; DELETE FROM courses; DELETE FROM users; DELETE FROM institutions;
`);

console.log('🌱 建立最高權限帳號...');
db.prepare(`
  INSERT INTO users (id, institution_id, name, email, password_hash, role)
  VALUES (1, NULL, '系統管理員', 'admin@studyseal.io', ?, 'super')
`).run(hash('Admin@2026'));

console.log('🌱 建立示範園所：博智文理補習班...');
const inst = db.prepare(`
  INSERT INTO institutions (
    name, code, address, contact_phone, director_name, director_phone,
    director_email, authorization_year, authorization_period, plan, status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
`).run(
  '博智文理補習班', 'BOZI2024', '苗栗縣竹南鎮示範路 100 號', '037-123-456',
  '王主任', '0912-345-678', 'owner@bozhi.edu.tw', '2026',
  '2026/07/01 - 2027/06/30', '旗艦方案', 'active'
);
const institutionId = inst.lastInsertRowid;

const ownerInfo = db.prepare(`
  INSERT INTO users (institution_id, name, email, password_hash, role, created_by)
  VALUES (?,?,?,?, 'institution', 1)
`).run(institutionId, '園所管理員', 'owner@bozhi.edu.tw', hash('Bozhi#2026'));

console.log('🌱 建立示範老師：林曉薇...');
const teacherInfo = db.prepare(`
  INSERT INTO users (institution_id, name, email, phone, password_hash, role, subject, class_name, created_by)
  VALUES (?,?,?,?,?, 'teacher', ?, ?, ?)
`).run(institutionId, '林曉薇', 'lin.hsiaowei@bozhi.edu.tw', '0912-222-333', hash('Teach#2026'), '國中數學', '數學A班／B班', ownerInfo.lastInsertRowid);
const teacherId = teacherInfo.lastInsertRowid;

console.log('🌱 建立示範學生：王小明、李佳蓉...');
const studentInfo = db.prepare(`
  INSERT INTO users (institution_id, name, email, password_hash, role, class_name, created_by)
  VALUES (?,?,?,?, 'student', ?, ?)
`).run(institutionId, '王小明', 'A1042501', hash('Study#2026'), '數學A班', teacherId);
const studentId = studentInfo.lastInsertRowid;

const studentInfo2 = db.prepare(`
  INSERT INTO users (institution_id, name, email, password_hash, role, class_name, created_by)
  VALUES (?,?,?,?, 'student', ?, ?)
`).run(institutionId, '李佳蓉', 'A1042502', hash('Study#2026'), '數學A班', teacherId);
const studentId2 = studentInfo2.lastInsertRowid;

console.log('🌱 建立示範課程：一元二次方程式...');
const courseInfo = db.prepare(`
  INSERT INTO courses (institution_id, teacher_id, title, subject, youtube_url, description)
  VALUES (?,?,?,?,?,?)
`).run(
  institutionId, teacherId,
  '一元二次方程式：配方法解題', '國中數學',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  '介紹配方法的推導過程，並示範三種常見題型的解法。'
);
const courseId = courseInfo.lastInsertRowid;

db.prepare(`
  INSERT INTO questions (course_id, type, text, options, correct_index, order_index)
  VALUES (?, 'mc', ?, ?, ?, 1)
`).run(courseId, 'x² - 6x + 5 = 0 的兩根之和為？', JSON.stringify(['4', '5', '6', '-6']), 2);

db.prepare(`
  INSERT INTO questions (course_id, type, text, options, correct_index, order_index, image_url)
  VALUES (?, 'photo', ?, ?, ?, 2, NULL)
`).run(courseId, '如圖，拋物線頂點座標為？', JSON.stringify(['(2,-3)', '(-2,3)', '(3,-2)', '(0,5)']), 0);

console.log('🌱 指派課程權限給學生...');
db.prepare('INSERT INTO course_access (course_id, student_id) VALUES (?,?)').run(courseId, studentId);
db.prepare('INSERT INTO course_access (course_id, student_id) VALUES (?,?)').run(courseId, studentId2);

console.log('✅ 種子資料建立完成！示範帳號如下：\n');
console.table([
  { 角色: '最高權限', 帳號: 'admin@studyseal.io', 密碼: 'Admin@2026', 園所代碼: '—' },
  { 角色: '園所', 帳號: 'owner@bozhi.edu.tw', 密碼: 'Bozhi#2026', 園所代碼: 'BOZI2024' },
  { 角色: '老師', 帳號: 'lin.hsiaowei@bozhi.edu.tw', 密碼: 'Teach#2026', 園所代碼: 'BOZI2024' },
  { 角色: '學生', 帳號: 'A1042501', 密碼: 'Study#2026', 園所代碼: 'BOZI2024' },
]);
