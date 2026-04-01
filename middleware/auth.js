function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '請先登入', redirect: '/login.html' });
  }
  next();
}

function requireStudent(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: '請先登入', redirect: '/login.html' });
  }
  if (req.session.role !== 'student') {
    return res.status(403).json({ error: '無權限', redirect: '/login.html' });
  }
  next();
}

module.exports = { requireLogin, requireStudent };
