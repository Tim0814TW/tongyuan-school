/* 童願文創網路校園：zero-dependency local MVP server */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const dataDir = path.join(root, 'data');
const dbFile = path.join(dataDir, 'db.json');
const roles = ['SUPER_ADMIN', 'ORG_ADMIN', 'TEACHER', 'STUDENT'];
const empty = () => ({ users: [], organizations: [], memberships: [], classes: [], courses: [], assignments: [], submissions: [], sessions: [] });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
let db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : empty();
const save = () => fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const validPassword = (password, stored) => { const [salt, digest] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), crypto.scryptSync(password, salt, 64)); };
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => v.trim().split('=')));
const body = req => new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 1_000_000) reject(Error('Request too large')); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Error('Invalid JSON')); } }); });
const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data)); };
const fail = (res, status, code, message) => send(res, status, { error: { code, message, requestId: id() } });
const find = (collection, key) => db[collection].find(x => x.id === key);
function current(req) {
  const token = parseCookies(req).ty_session;
  if (!token) return null;
  const session = db.sessions.find(s => s.tokenHash === hash(token) && !s.revokedAt && new Date(s.expiresAt) > new Date());
  if (!session) return null;
  const user = find('users', session.userId), membership = find('memberships', session.membershipId);
  if (!user || !membership || user.status !== 'ACTIVE' || membership.status !== 'ACTIVE') return null;
  const org = membership.tenantId ? find('organizations', membership.tenantId) : null;
  if (org && org.status !== 'ACTIVE') return null;
  return { user, membership, org, session };
}
function requireUser(req, res, allowed) {
  const actor = current(req);
  if (!actor) { fail(res, 401, 'UNAUTHENTICATED', '請先登入。'); return null; }
  if (allowed && !allowed.includes(actor.membership.role)) { fail(res, 403, 'FORBIDDEN', '你沒有執行此操作的權限。'); return null; }
  return actor;
}
function safeUser(m) { const u = find('users', m.userId); return { membershipId: m.id, userId: u.id, name: u.displayName, login: u.login, role: m.role, classIds: m.classIds || [] }; }
function createUser({ login, password, name, role, tenantId }) {
  if (!login || !password || !name || !roles.includes(role)) throw Error('請完整填寫帳號、姓名、密碼與角色。');
  if (db.users.some(u => u.login === login)) throw Error('此帳號已被使用。');
  const user = { id: id(), login, displayName: name, passwordHash: passwordHash(password), status: 'ACTIVE', createdAt: now() };
  const membership = { id: id(), userId: user.id, tenantId: tenantId || null, role, status: 'ACTIVE', classIds: [] };
  db.users.push(user); db.memberships.push(membership); save(); return { user, membership };
}
const staticFile = (res, file, type) => { try { res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(file)); } catch { res.writeHead(404); res.end(); } };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`); const route = url.pathname; const method = req.method;
  if (method === 'GET' && route === '/') return staticFile(res, path.join(root, 'public/index.html'), 'text/html; charset=utf-8');
  if (method === 'GET' && route === '/app.css') return staticFile(res, path.join(root, 'public/app.css'), 'text/css; charset=utf-8');
  if (method === 'GET' && route === '/app.js') return staticFile(res, path.join(root, 'public/app.js'), 'application/javascript; charset=utf-8');
  try {
    if (method === 'GET' && route === '/api/v1/bootstrap') return send(res, 200, { needsSetup: !db.memberships.some(m => m.role === 'SUPER_ADMIN') });
    if (method === 'POST' && route === '/api/v1/setup') {
      if (db.memberships.some(m => m.role === 'SUPER_ADMIN')) return fail(res, 409, 'ALREADY_CONFIGURED', '系統已完成初始化。');
      const payload = await body(req); const { user, membership } = createUser({ ...payload, role: 'SUPER_ADMIN' });
      return createSession(res, user, membership);
    }
    if (method === 'POST' && route === '/api/v1/auth/login') {
      const { login, password } = await body(req); const user = db.users.find(u => u.login === login && u.status === 'ACTIVE');
      if (!user || !validPassword(password || '', user.passwordHash)) return fail(res, 401, 'INVALID_CREDENTIALS', '帳號或密碼不正確。');
      const membership = db.memberships.find(m => m.userId === user.id && m.status === 'ACTIVE' && (!m.tenantId || find('organizations', m.tenantId)?.status === 'ACTIVE'));
      if (!membership) return fail(res, 403, 'NO_ACTIVE_MEMBERSHIP', '此帳號沒有可用的園所身分。');
      return createSession(res, user, membership);
    }
    if (method === 'POST' && route === '/api/v1/auth/logout') { const actor = current(req); if (actor) { actor.session.revokedAt = now(); save(); } return send(res, 200, { ok: true }, { 'Set-Cookie': 'ty_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' }); }
    if (method === 'GET' && route === '/api/v1/auth/me') { const actor = requireUser(req, res); if (!actor) return; return send(res, 200, profile(actor)); }
    if (method === 'POST' && route === '/api/v1/admin/organizations') {
      const actor = requireUser(req, res, ['SUPER_ADMIN']); if (!actor) return; const p = await body(req);
      if (!p.name || !p.adminLogin || !p.adminPassword || !p.adminName) return fail(res, 422, 'VALIDATION_ERROR', '請填寫園所及管理員資料。');
      const org = { id: id(), name: p.name, status: 'ACTIVE', timezone: 'Asia/Taipei', createdAt: now() }; db.organizations.push(org);
      try { createUser({ login: p.adminLogin, password: p.adminPassword, name: p.adminName, role: 'ORG_ADMIN', tenantId: org.id }); } catch (e) { db.organizations = db.organizations.filter(x => x.id !== org.id); save(); throw e; }
      return send(res, 201, { organization: org });
    }
    if (method === 'GET' && route === '/api/v1/admin/organizations') { const a = requireUser(req,res,['SUPER_ADMIN']); if (!a) return; return send(res,200,{ organizations: db.organizations }); }
    if (method === 'GET' && route === '/api/v1/org/overview') { const a = requireUser(req,res,['ORG_ADMIN']); if (!a) return; return send(res,200, orgOverview(a)); }
    if (method === 'POST' && route === '/api/v1/org/users') {
      const a = requireUser(req,res,['ORG_ADMIN']); if (!a) return; const p = await body(req); if (!['TEACHER','STUDENT'].includes(p.role)) return fail(res,422,'VALIDATION_ERROR','園所只能建立老師或學生帳號。');
      const created = createUser({ ...p, tenantId: a.membership.tenantId }); return send(res,201,{ user: safeUser(created.membership) });
    }
    if (method === 'POST' && route === '/api/v1/org/classes') {
      const a = requireUser(req,res,['ORG_ADMIN']); if (!a) return; const p = await body(req); if (!p.name) return fail(res,422,'VALIDATION_ERROR','請填寫班級名稱。');
      const c = { id:id(), tenantId:a.membership.tenantId, name:p.name, academicYear:p.academicYear || '115學年度', status:'ACTIVE', teacherIds:[], studentIds:[] }; db.classes.push(c); save(); return send(res,201,{ class:c });
    }
    if (method === 'PUT' && /^\/api\/v1\/org\/classes\/[^/]+\/members$/.test(route)) {
      const a = requireUser(req,res,['ORG_ADMIN']); if (!a) return; const c=find('classes',route.split('/')[5]); if (!c || c.tenantId!==a.membership.tenantId) return fail(res,404,'NOT_FOUND','找不到班級。'); const p=await body(req);
      const all=[...(p.teacherIds||[]),...(p.studentIds||[])]; if (!all.every(mid=>find('memberships',mid)?.tenantId===a.membership.tenantId)) return fail(res,403,'TENANT_SCOPE','不可加入其他園所成員。');
      c.teacherIds=p.teacherIds||[]; c.studentIds=p.studentIds||[]; for(const m of db.memberships.filter(m=>m.tenantId===a.membership.tenantId)) m.classIds=db.classes.filter(x=>x.teacherIds.includes(m.id)||x.studentIds.includes(m.id)).map(x=>x.id); save(); return send(res,200,{class:c});
    }
    if (method === 'POST' && route === '/api/v1/org/courses') {
      const a=requireUser(req,res,['ORG_ADMIN']); if(!a)return; const p=await body(req); if(!p.title||!p.teacherName||!p.gradeRange) return fail(res,422,'VALIDATION_ERROR','請填寫課程名稱、師資與年級。');
      const c={id:id(),ownerTenantId:a.membership.tenantId,title:p.title,teacherName:p.teacherName,gradeRange:p.gradeRange,status:'DRAFT',versionNo:0,draft:{lessonTitle:p.lessonTitle||'第一堂課',summary:p.summary||'',videoStatus:'UNCONFIGURED',questions:p.questions||[]},createdAt:now()}; db.courses.push(c);save();return send(res,201,{course:c});
    }
    if (method === 'POST' && /^\/api\/v1\/org\/courses\/[^/]+\/publish$/.test(route)) {
      const a=requireUser(req,res,['ORG_ADMIN']);if(!a)return;const c=find('courses',route.split('/')[5]);if(!c||c.ownerTenantId!==a.membership.tenantId)return fail(res,404,'NOT_FOUND','找不到課程。');const p=await body(req);
      const qs=c.draft.questions||[];if(!c.title||!c.teacherName||!c.gradeRange||!c.draft.summary||qs.length===0)return fail(res,422,'COURSE_NOT_READY','請完成課程資訊、學習重點與至少一題。');if(!p.classId||!find('classes',p.classId)||find('classes',p.classId).tenantId!==a.membership.tenantId)return fail(res,422,'VALIDATION_ERROR','請選擇本園所班級。');
      c.status='PUBLISHED';c.versionNo++; const assignment={id:id(),tenantId:a.membership.tenantId,courseId:c.id,classId:p.classId,versionNo:c.versionNo,dueAt:p.dueAt||null,createdAt:now()};db.assignments.push(assignment);save();return send(res,201,{assignment});
    }
    if (method === 'GET' && route === '/api/v1/student/assignments') { const a=requireUser(req,res,['STUDENT']);if(!a)return; const classIds=a.membership.classIds||[];const assignments=db.assignments.filter(x=>x.tenantId===a.membership.tenantId&&classIds.includes(x.classId)).map(x=>({ ...x,course:find('courses',x.courseId),submission:db.submissions.find(s=>s.assignmentId===x.id&&s.studentMembershipId===a.membership.id)}));return send(res,200,{assignments}); }
    if (method === 'POST' && /^\/api\/v1\/student\/assignments\/[^/]+\/submit$/.test(route)) {
      const a=requireUser(req,res,['STUDENT']);if(!a)return; const assignment=find('assignments',route.split('/')[5]);if(!assignment||assignment.tenantId!==a.membership.tenantId||!(a.membership.classIds||[]).includes(assignment.classId))return fail(res,404,'NOT_FOUND','找不到已指派課程。'); const p=await body(req); const course=find('courses',assignment.courseId);const questions=course.draft.questions||[];
      if(!questions.every(q=>String(p.answers?.[q.id]||'').trim()))return fail(res,422,'VALIDATION_ERROR','請完成所有必答題。'); let s=db.submissions.find(x=>x.assignmentId===assignment.id&&x.studentMembershipId===a.membership.id);if(s)return fail(res,409,'ALREADY_SUBMITTED','此課程已送出，請等待老師回饋。');s={id:id(),tenantId:a.membership.tenantId,assignmentId:assignment.id,studentMembershipId:a.membership.id,answers:p.answers,status:'SUBMITTED',submittedAt:now(),feedback:null,score:null};db.submissions.push(s);save();return send(res,201,{submission:s});
    }
    if (method === 'GET' && route === '/api/v1/teacher/submissions') { const a=requireUser(req,res,['TEACHER']);if(!a)return;const rows=db.submissions.filter(s=>(a.membership.classIds||[]).includes(find('assignments',s.assignmentId)?.classId)).map(s=>submissionView(s));return send(res,200,{submissions:rows}); }
    if (method === 'POST' && /^\/api\/v1\/teacher\/submissions\/[^/]+\/review$/.test(route)) { const a=requireUser(req,res,['TEACHER']);if(!a)return;const s=find('submissions',route.split('/')[5]);const assignment=s&&find('assignments',s.assignmentId);if(!s||!(a.membership.classIds||[]).includes(assignment.classId))return fail(res,404,'NOT_FOUND','找不到學生作品。');const p=await body(req);if(!p.feedback||Number.isNaN(Number(p.score)))return fail(res,422,'VALIDATION_ERROR','請填寫分數與回饋。');s.feedback=p.feedback;s.score=Math.max(0,Math.min(100,Number(p.score)));s.status=p.needsRevision?'NEEDS_REVISION':'REVIEWED';s.reviewedAt=now();save();return send(res,200,{submission:s}); }
    if (method === 'GET' && route === '/api/v1/student/feedback') { const a=requireUser(req,res,['STUDENT']);if(!a)return;return send(res,200,{submissions:db.submissions.filter(s=>s.studentMembershipId===a.membership.id).map(submissionView)}); }
    return fail(res,404,'NOT_FOUND','找不到此功能。');
  } catch (e) { console.error(e); return fail(res,422,'VALIDATION_ERROR',e.message || '資料格式不正確。'); }
});
function createSession(res,user,membership){const token=crypto.randomBytes(32).toString('base64url');db.sessions.push({id:id(),tokenHash:hash(token),userId:user.id,membershipId:membership.id,expiresAt:new Date(Date.now()+8*3600e3).toISOString()});save();const secure=process.env.NODE_ENV==='production'?'; Secure':'';send(res,200,{user:{name:user.displayName,role:membership.role}},{'Set-Cookie':`ty_session=${token}; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax${secure}`});}
function profile(a){return {user:{name:a.user.displayName,login:a.user.login,role:a.membership.role},organization:a.org&&{id:a.org.id,name:a.org.name}};}
function orgOverview(a){const tenantId=a.membership.tenantId;return {users:db.memberships.filter(m=>m.tenantId===tenantId).map(safeUser),classes:db.classes.filter(c=>c.tenantId===tenantId),courses:db.courses.filter(c=>c.ownerTenantId===tenantId),assignments:db.assignments.filter(x=>x.tenantId===tenantId)};}
function submissionView(s){const assignment=find('assignments',s.assignmentId), course=find('courses',assignment.courseId), student=safeUser(find('memberships',s.studentMembershipId));return {...s,student,course:{id:course.id,title:course.title,questions:course.draft.questions}};}
server.listen(port,()=>console.log(`童願網路校園已啟動：http://localhost:${port}`));
