const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { parseUserImport, validateUserImport, applyDefaultTeacher } = require('../services/user-import');

const templatePath = path.resolve(__dirname, '../../frontend/templates/studyseal-user-import-template.xlsx');

test('generated workbook parses teacher and student sheets', async () => {
  const parsed = await parseUserImport(await fs.readFile(templatePath));
  assert.equal(parsed.teachers.length, 1);
  assert.equal(parsed.students.length, 1);
  assert.equal(parsed.teachers[0].username, 'teacher01');
  assert.equal(parsed.students[0].teacherUsername, 'teacher01');
  const validation = validateUserImport(parsed);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.summary, { teachers: 1, students: 1, total: 2 });
});

test('existing and repeated accounts block the entire import', async () => {
  const parsed = await parseUserImport(await fs.readFile(templatePath));
  parsed.students[0].username = 'TEACHER01';
  const validation = validateUserImport(parsed, { existingAccounts: ['teacher01'] });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.message.includes('已存在於網校')));
  assert.ok(validation.errors.some((error) => error.message.includes('帳號重複')));
});

test('student must point to a teacher in the same school or workbook', async () => {
  const parsed = await parseUserImport(await fs.readFile(templatePath));
  parsed.teachers = [];
  const validation = validateUserImport(parsed, { existingTeachers: [] });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.field === '指定老師帳號'));
});

test('stock-style student rows can use one selected existing teacher', async () => {
  const parsed = await parseUserImport(await fs.readFile(templatePath));
  parsed.teachers = [];
  parsed.students[0].teacherUsername = '';
  applyDefaultTeacher(parsed, 'existing-teacher');
  const validation = validateUserImport(parsed, { existingTeachers: ['existing-teacher'] });
  assert.equal(validation.valid, true);
  assert.equal(parsed.students[0].teacherUsername, 'existing-teacher');
});
