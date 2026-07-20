// server.js — 學印 StudySeal API 進入點

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const institutionRoutes = require('./routes/institutions');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'studyseal-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);

// 統一錯誤處理，避免未預期錯誤直接把 stack trace 洩漏給前端
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '伺服器發生錯誤，請稍後再試' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ StudySeal API 已啟動：http://localhost:${PORT}`);
});
