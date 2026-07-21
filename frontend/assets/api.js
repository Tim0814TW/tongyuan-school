// api.js — 前端與後端 API 溝通的共用工具
// 部署時請把 API_BASE 換成你後端的實際網址（例如 https://studyseal-api.onrender.com）

const API_BASE = window.STUDYSEAL_API_BASE || 'http://localhost:4000';

function getToken(){ return localStorage.getItem('studyseal_token'); }
function getUser(){
  try { return JSON.parse(localStorage.getItem('studyseal_user') || 'null'); }
  catch(e){ return null; }
}
function setSession(token, user){
  localStorage.setItem('studyseal_token', token);
  localStorage.setItem('studyseal_user', JSON.stringify(user));
}
function clearSession(){
  localStorage.removeItem('studyseal_token');
  localStorage.removeItem('studyseal_user');
}

async function api(path, { method='GET', body=null } = {}){
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch(e){ /* no body */ }

  if (!res.ok) {
    const err = new Error((data && data.error) || `發生錯誤 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function uploadApi(path, formData){
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, { method:'POST', headers, body:formData });
  let data = null;
  try { data = await res.json(); } catch(e){ /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `發生錯誤 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function requireLogin(){
  if (!getToken() || !getUser()){
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

function logout(){
  clearSession();
  window.location.href = 'login.html';
}

function toast(msg, type='ok'){
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
