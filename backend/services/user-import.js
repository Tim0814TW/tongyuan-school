const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');

const MAX_IMPORT_ROWS = 1000;

const FIELD_ALIASES = {
  teacher: {
    name: ['姓名', '老師姓名', 'name', 'teachername'],
    username: ['帳號', '老師帳號', '登入帳號', 'username', 'account'],
    phone: ['電話', '聯絡電話', '老師電話', 'phone'],
    password: ['初始密碼', '密碼', '老師密碼', 'password'],
    subject: ['科目', '負責科目', 'subject'],
    className: ['班級', '負責班級', '可操作班級', 'classname', 'class'],
    status: ['狀態', '登入權限', 'status'],
  },
  student: {
    name: ['姓名', '學生姓名', 'name', 'studentname'],
    username: ['帳號', '學生帳號', '登入帳號', 'username', 'account'],
    password: ['初始密碼', '密碼', '學生密碼', 'password'],
    grade: ['年級', '就讀年級', 'grade'],
    className: ['班級', '班級名稱', 'classname', 'class'],
    guardianName: ['家長姓名', '監護人姓名', 'guardianname'],
    guardianPhone: ['家長電話', '家長聯絡電話', '監護人電話', 'guardianphone'],
    teacherUsername: ['指定老師帳號', '老師帳號', '負責老師帳號', 'teacherusername'],
    status: ['狀態', '登入權限', 'status'],
  },
};

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.text != null) return String(value.text).trim();
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/[\s_*＊：:()（）／/]/g, '');
}

function findHeader(sheet, role) {
  const aliases = FIELD_ALIASES[role];
  for (let rowIndex = 0; rowIndex < Math.min(sheet.rows.length, 10); rowIndex += 1) {
    const values = sheet.rows[rowIndex].map(normalizeHeader);
    const indexes = {};
    for (const [field, names] of Object.entries(aliases)) {
      indexes[field] = values.findIndex((value) => names.includes(value));
    }
    if (indexes.name >= 0 && indexes.username >= 0 && indexes.password >= 0) {
      return { rowIndex, rowNumber: rowIndex + 1, indexes };
    }
  }
  return null;
}

function sheetRole(sheet) {
  const teacherHeader = findHeader(sheet, 'teacher');
  const studentHeader = findHeader(sheet, 'student');
  if (/老師|teacher/i.test(sheet.name) && teacherHeader) return { role: 'teacher', header: teacherHeader };
  if (/學生|student/i.test(sheet.name) && studentHeader) return { role: 'student', header: studentHeader };
  if (studentHeader?.indexes.className >= 0) return { role: 'student', header: studentHeader };
  if (teacherHeader) return { role: 'teacher', header: teacherHeader };
  return null;
}

function rowsFromSheet(sheet, role, header) {
  const rows = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const rowNumber = rowIndex + 1;
    const cells = sheet.rows[rowIndex];
    const row = { sheet: sheet.name, rowNumber };
    for (const field of Object.keys(FIELD_ALIASES[role])) {
      const index = header.indexes[field];
      row[field] = index >= 0 ? cellText(cells[index]) : '';
    }
    if (Object.entries(row).some(([key, value]) => !['sheet', 'rowNumber'].includes(key) && value)) rows.push(row);
  }
  return rows;
}

async function parseUserImport(buffer) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false });
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relsXml) throw new Error('invalid_xlsx_workbook');
  const workbookDoc = parser.parse(workbookXml);
  const relsDoc = parser.parse(relsXml.replace(/^\uFEFF/, ''));
  const relationships = [].concat(relsDoc.Relationships?.Relationship || []);
  const targets = new Map(relationships.map((rel) => [rel['@_Id'], String(rel['@_Target'] || '').replace(/^\//, '')]));
  const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  const sharedDoc = sharedXml ? parser.parse(sharedXml) : null;
  const sharedStrings = [].concat(sharedDoc?.sst?.si || []).map((item) => {
    if (item.t != null) return cellText(item.t);
    return [].concat(item.r || []).map((run) => cellText(run.t)).join('');
  });
  const sheetDefs = [].concat(workbookDoc.workbook?.sheets?.sheet || []);
  if (sheetDefs.length > 10) throw new Error('too_many_worksheets');
  const parsed = { teachers: [], students: [], ignoredSheets: [] };
  for (const definition of sheetDefs) {
    const target = targets.get(definition['@_id']);
    const entry = target ? zip.file(target) : null;
    if (!entry) continue;
    const sheetDoc = parser.parse(await entry.async('string'));
    const xmlRows = [].concat(sheetDoc.worksheet?.sheetData?.row || []);
    const rows = [];
    for (const xmlRow of xmlRows.slice(0, MAX_IMPORT_ROWS + 12)) {
      const values = [];
      for (const cell of [].concat(xmlRow.c || [])) {
        const reference = String(cell['@_r'] || 'A1');
        const letters = reference.match(/^[A-Z]+/i)?.[0] || 'A';
        let column = 0;
        for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64;
        let value = cell.v ?? cell.is?.t ?? '';
        if (cell['@_t'] === 's') value = sharedStrings[Number(value)] || '';
        if (cell['@_t'] === 'inlineStr' && cell.is?.r) {
          value = [].concat(cell.is.r).map((run) => cellText(run.t)).join('');
        }
        values[column - 1] = cellText(value);
      }
      rows.push(values);
    }
    const sheet = { name: String(definition['@_name'] || '工作表'), rows };
    const detected = sheetRole(sheet);
    if (!detected) {
      parsed.ignoredSheets.push(sheet.name);
      continue;
    }
    const dataRows = rowsFromSheet(sheet, detected.role, detected.header);
    if (detected.role === 'teacher') parsed.teachers.push(...dataRows);
    else parsed.students.push(...dataRows);
  }
  return parsed;
}

function validateUserImport(parsed, { existingAccounts = [], existingTeachers = [] } = {}) {
  const errors = [];
  const allRows = [...parsed.teachers, ...parsed.students];
  const seen = new Map();
  const existing = new Set(existingAccounts.map((value) => String(value).trim().toLowerCase()));
  const teacherAccounts = new Set(existingTeachers.map((value) => String(value).trim().toLowerCase()));

  function add(row, field, message) {
    errors.push({ sheet: row.sheet, row: row.rowNumber, field, message });
  }

  if (!allRows.length) errors.push({ sheet: '', row: 0, field: '', message: '檔案中沒有可匯入的老師或學生資料' });
  if (allRows.length > MAX_IMPORT_ROWS) errors.push({ sheet: '', row: 0, field: '', message: `單次最多匯入 ${MAX_IMPORT_ROWS} 筆資料` });

  for (const row of allRows) {
    const role = parsed.teachers.includes(row) ? '老師' : '學生';
    if (!row.name) add(row, '姓名', `${role}姓名為必填`);
    if (!row.username) add(row, '帳號', `${role}帳號為必填`);
    if (!row.password || row.password.length < 8) add(row, '初始密碼', '初始密碼至少需要 8 個字元');
    row.status = row.status || 'active';
    if (!['active', 'disabled'].includes(row.status)) add(row, '狀態', '狀態只能填 active 或 disabled');
    const key = row.username.toLowerCase();
    if (key) {
      if (existing.has(key)) add(row, '帳號', '此帳號已存在於網校');
      if (seen.has(key)) add(row, '帳號', `與 ${seen.get(key)} 的帳號重複`);
      else seen.set(key, `${row.sheet} 第 ${row.rowNumber} 列`);
    }
  }

  parsed.teachers.forEach((row) => teacherAccounts.add(row.username.toLowerCase()));
  for (const row of parsed.students) {
    if (!row.className) add(row, '班級', '學生班級為必填');
    if (!row.teacherUsername) add(row, '指定老師帳號', '請指定負責老師帳號');
    else if (!teacherAccounts.has(row.teacherUsername.toLowerCase())) {
      add(row, '指定老師帳號', '找不到同園所既有老師或本次匯入的老師帳號');
    }
  }

  return {
    valid: errors.length === 0,
    summary: { teachers: parsed.teachers.length, students: parsed.students.length, total: allRows.length },
    errors,
  };
}

function applyDefaultTeacher(parsed, teacherUsername) {
  const fallback = String(teacherUsername || '').trim();
  if (fallback) {
    parsed.students.forEach((row) => {
      if (!row.teacherUsername) row.teacherUsername = fallback;
    });
  }
  return parsed;
}

module.exports = { parseUserImport, validateUserImport, applyDefaultTeacher, MAX_IMPORT_ROWS };
