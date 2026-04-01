require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');

const authRouter = require('./routes/auth');
const examRouter = require('./routes/exam');

const app = express();
const PORT = process.env.PORT || 3000;

// 資料庫連線池
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'exam_system',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
});

app.set('db', db);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'exam-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// 靜態檔案（HTML/CSS/JS）
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api/auth', authRouter);
app.use('/api/exam', examRouter);

// 根目錄導向登入頁
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/index.html');
  }
  res.redirect('/login.html');
});

// 伺服器時間 API
app.get('/api/time', (req, res) => {
  res.json({ serverTime: new Date().toISOString() });
});

// 健康檢查
app.get('/api/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.listen(PORT, () => {
  console.log(`緯豆考試系統 Node.js 版已啟動：http://localhost:${PORT}`);
});
