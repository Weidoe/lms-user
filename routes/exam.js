const express = require('express');
const router = express.Router();
const { requireStudent } = require('../middleware/auth');

// 取得可參加 & 已完成的考試列表
router.get('/list', requireStudent, async (req, res) => {
  const db = req.app.get('db');
  const userId = req.session.userId;

  try {
    const [available] = await db.execute(
      `SELECT e.*
       FROM exams e
       JOIN exam_participants ep ON e.id = ep.exam_id
       WHERE ep.student_id = ?
         AND e.status = 'published'
         AND e.end_time > NOW()
         AND NOT EXISTS (
           SELECT 1 FROM exam_submissions es
           WHERE es.exam_id = e.id AND es.user_id = ?
         )
       ORDER BY e.start_time ASC`,
      [userId, userId]
    );

    const [completed] = await db.execute(
      `SELECT e.*, es.total_score, es.submit_time,
              (SELECT SUM(points) FROM questions WHERE exam_id = e.id) AS total_possible_score
       FROM exam_submissions es
       JOIN exams e ON e.id = es.exam_id
       WHERE es.user_id = ?
       ORDER BY es.submit_time DESC`,
      [userId]
    );

    res.json({ available, completed });
  } catch (err) {
    console.error('exam/list error:', err);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// 取得考試設定是否開放查看答案
router.get('/settings', requireStudent, async (req, res) => {
  const db = req.app.get('db');
  try {
    const [rows] = await db.execute(
      "SELECT value FROM settings WHERE name = 'view_exam_record' LIMIT 1"
    );
    const canView = rows.length > 0 ? rows[0].value === '1' : false;
    res.json({ canViewRecord: canView });
  } catch {
    res.json({ canViewRecord: false });
  }
});

// 取得單一考試題目（開始考試前驗證）
router.get('/:id/questions', requireStudent, async (req, res) => {
  const db = req.app.get('db');
  const examId = parseInt(req.params.id);
  const userId = req.session.userId;

  try {
    // 驗證考試
    const [exams] = await db.execute(
      `SELECT * FROM exams
       WHERE id = ? AND status = 'published'
         AND NOW() BETWEEN start_time AND end_time`,
      [examId]
    );
    if (!exams.length) {
      return res.status(404).json({ error: '考試不存在或已結束' });
    }

    // 是否已提交
    const [subs] = await db.execute(
      'SELECT id FROM exam_submissions WHERE exam_id = ? AND user_id = ?',
      [examId, userId]
    );
    if (subs.length) {
      return res.status(403).json({ error: '您已完成此考試' });
    }

    // 取得題目與選項
    const [questions] = await db.execute(
      `SELECT q.*,
         CASE
           WHEN q.question_type != 'fill' THEN
             GROUP_CONCAT(CONCAT(o.id,'|:|',o.option_text,'|:|',COALESCE(o.blank_order,0)) SEPARATOR '||')
           ELSE NULL
         END AS options_raw
       FROM questions q
       LEFT JOIN options o ON q.id = o.question_id
       WHERE q.exam_id = ?
       GROUP BY q.id
       ORDER BY q.id`,
      [examId]
    );

    // 解析選項
    const parsed = questions.map((q) => {
      const opts = [];
      if (q.options_raw) {
        q.options_raw.split('||').forEach((part) => {
          const [id, text] = part.split('|:|');
          if (id && text) opts.push({ id, text });
        });
      }
      return {
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        points: q.points,
        image_path: q.image_path || null,
        options: opts,
      };
    });

    res.json({
      exam: exams[0],
      serverTime: new Date().toISOString(),
      questions: parsed,
    });
  } catch (err) {
    console.error('exam questions error:', err);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// 提交考試答案
router.post('/:id/submit', requireStudent, async (req, res) => {
  const db = req.app.get('db');
  const examId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { answers } = req.body; // { [questionId]: answer | answer[] }

  try {
    // 再次驗證考試
    const [exams] = await db.execute(
      `SELECT * FROM exams
       WHERE id = ? AND status = 'published'
         AND NOW() BETWEEN start_time AND end_time`,
      [examId]
    );
    if (!exams.length) {
      return res.status(404).json({ error: '考試不存在或已結束' });
    }
    const exam = exams[0];

    // 防止重複提交
    const [existing] = await db.execute(
      'SELECT id FROM exam_submissions WHERE exam_id = ? AND user_id = ?',
      [examId, userId]
    );
    if (existing.length) {
      return res.status(403).json({ error: '您已提交過此考試' });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // 建立提交記錄
      const startTime = new Date(Date.now() - exam.duration * 60 * 1000);
      const [insertResult] = await conn.execute(
        `INSERT INTO exam_submissions (exam_id, user_id, start_time, submit_time, status)
         VALUES (?, ?, ?, NOW(), 'submitted')`,
        [examId, userId, startTime]
      );
      const submissionId = insertResult.insertId;

      let totalScore = 0;

      for (const [qIdStr, answer] of Object.entries(answers || {})) {
        const questionId = parseInt(qIdStr);

        // 取題目與正確答案
        const [qRows] = await conn.execute(
          `SELECT q.*,
             CASE
               WHEN q.question_type = 'truefalse' THEN
                 (SELECT option_text FROM options WHERE question_id = q.id AND is_correct = 1 LIMIT 1)
               ELSE
                 GROUP_CONCAT(o.id ORDER BY o.id)
             END AS correct_options
           FROM questions q
           LEFT JOIN options o ON q.id = o.question_id AND o.is_correct = 1
           WHERE q.id = ?
           GROUP BY q.id`,
          [questionId]
        );
        if (!qRows.length) continue;
        const q = qRows[0];
        const qPoints = parseFloat(q.points) || 0; // 確保為數字，避免字串拼接

        let questionScore = 0;

        if (q.question_type === 'fill') {
          const [fillOpts] = await conn.execute(
            'SELECT option_text, blank_order FROM options WHERE question_id = ? ORDER BY blank_order ASC',
            [questionId]
          );
          const blankCount = fillOpts.length;
          if (blankCount > 0) {
            const ptsPerBlank = qPoints / blankCount;
            let correctCount = 0;
            const studentArr = Array.isArray(answer) ? answer : [answer];
            fillOpts.forEach((correct, idx) => {
              if (
                studentArr[idx] !== undefined &&
                String(studentArr[idx]).trim() === String(correct.option_text).trim()
              ) {
                correctCount++;
              }
            });
            questionScore = correctCount * ptsPerBlank;
          }
        } else if (q.question_type === 'truefalse') {
          if (answer === q.correct_options) {
            questionScore = qPoints;
          }
        } else if (q.question_type !== 'essay') {
          const correctOpts = q.correct_options ? q.correct_options.split(',') : [];
          const studentOpts = (Array.isArray(answer) ? answer : [answer]).map(String).sort();
          correctOpts.sort();
          if (JSON.stringify(studentOpts) === JSON.stringify(correctOpts)) {
            questionScore = qPoints;
          }
        }

        const answerText = Array.isArray(answer) ? answer.join(',') : String(answer || '');

        await conn.execute(
          'INSERT INTO submission_answers (submission_id, question_id, answer_text, score) VALUES (?,?,?,?)',
          [submissionId, questionId, answerText, questionScore]
        );

        totalScore += questionScore;
      }

      await conn.execute(
        'UPDATE exam_submissions SET total_score = ? WHERE id = ?',
        [totalScore, submissionId]
      );

      await conn.commit();
      res.json({ success: true, totalScore });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('submit error:', err);
    res.status(500).json({ error: '提交失敗：' + err.message });
  }
});

// 查看考試結果
router.get('/:id/result', requireStudent, async (req, res) => {
  const db = req.app.get('db');
  const examId = parseInt(req.params.id);
  const userId = req.session.userId;

  try {
    // 確認是否開放查看
    let canView = false;
    try {
      const [sv] = await db.execute(
        "SELECT value FROM settings WHERE name = 'view_exam_record' LIMIT 1"
      );
      canView = sv.length > 0 && sv[0].value === '1';
    } catch { canView = false; }

    if (!canView) {
      return res.status(403).json({ error: '目前不開放查看答案' });
    }

    const [examRows] = await db.execute(
      `SELECT e.*, es.total_score, es.submit_time, es.id AS submission_id
       FROM exams e
       LEFT JOIN exam_submissions es ON e.id = es.exam_id AND es.user_id = ?
       WHERE e.id = ? AND es.status = 'submitted'`,
      [userId, examId]
    );
    if (!examRows.length) {
      return res.status(404).json({ error: '找不到該考試資訊' });
    }
    const examData = examRows[0];

    // 記錄查看日誌（若表存在）
    try {
      await db.execute(
        'INSERT INTO exam_view_logs (user_id, exam_id, submission_id, view_time) VALUES (?,?,?,NOW())',
        [userId, examId, examData.submission_id]
      );
    } catch { /* ignore if table doesn't exist */ }

    // 取得題目、選項、作答
    const [rows] = await db.execute(
      `SELECT q.*,
              o.option_text, o.is_correct, o.id AS option_id,
              sa.answer_text, sa.score AS question_score
       FROM questions q
       LEFT JOIN options o ON q.id = o.question_id
       LEFT JOIN submission_answers sa ON q.id = sa.question_id AND sa.submission_id = ?
       WHERE q.exam_id = ?
       ORDER BY q.id, o.id`,
      [examData.submission_id, examId]
    );

    const questionsMap = {};
    for (const row of rows) {
      if (!questionsMap[row.id]) {
        questionsMap[row.id] = {
          question_id: row.id,
          question_text: row.question_text,
          question_type: row.question_type,
          points: row.points,
          image_path: row.image_path || null,
          answer_text: row.answer_text,
          question_score: row.question_score,
          options: [],
        };
      }
      if (row.option_text) {
        questionsMap[row.id].options.push({
          id: row.option_id,
          text: row.option_text,
          is_correct: row.is_correct,
        });
      }
    }

    res.json({
      exam: examData,
      questions: Object.values(questionsMap),
    });
  } catch (err) {
    console.error('result error:', err);
    res.status(500).json({ error: '伺服器錯誤' });
  }
});

// 記錄頁面可見性變化（防作弊）
router.post('/:id/visibility', requireStudent, async (req, res) => {
  const db = req.app.get('db');
  const examId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { action, state, timestamp } = req.body;

  try {
    await db.execute(
      `INSERT INTO visibility_logs (exam_id, user_id, action, state, created_at)
       VALUES (?,?,?,?,?)`,
      [examId, userId, action || '', state || '', timestamp || new Date().toISOString()]
    );
  } catch { /* ignore */ }

  res.json({ success: true });
});

// 記錄截圖事件
router.post('/:id/screenshot', requireStudent, async (req, res) => {
  // 可擴充儲存截圖記錄
  res.json({ success: true });
});

module.exports = router;
