const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '請填寫所有欄位' });
  }

  const db = req.app.get('db');
  try {
    const [rows] = await db.execute(
      'SELECT id, name, username, password, role FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    req.session.userId = user.id;
    req.session.name = user.name;
    req.session.role = user.role;
    req.session.username = user.username;

    const redirect = ['admin', 'teacher'].includes(user.role) ? '/admin' : '/index.html';
    return res.json({ success: true, role: user.role, name: user.name, redirect });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, redirect: '/login.html' });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登入' });
  }
  res.json({
    userId: req.session.userId,
    name: req.session.name,
    role: req.session.role,
    username: req.session.username,
  });
});

module.exports = router;
