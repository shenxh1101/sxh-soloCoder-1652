const express = require('express');
const router = express.Router();
const { queryAll, run, save } = require('../models/database');

router.get('/', (req, res) => {
  const { target_type, target_id, is_read } = req.query;

  if (!target_type || !target_id) {
    return res.status(400).json({ code: 400, message: '需要提供target_type和target_id' });
  }

  let sql = 'SELECT * FROM notifications WHERE target_type = ? AND target_id = ?';
  const params = [target_type, target_id];

  if (is_read !== undefined) {
    sql += ' AND is_read = ?';
    params.push(is_read === '1' ? 1 : 0);
  }

  sql += ' ORDER BY created_at DESC';
  const notifications = queryAll(sql, params);
  res.json({ code: 200, data: notifications });
});

router.put('/:id/read', (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
  save();
  res.json({ code: 200, message: '已标记为已读' });
});

router.put('/read-all', (req, res) => {
  const { target_type, target_id } = req.body;
  if (!target_type || !target_id) {
    return res.status(400).json({ code: 400, message: '需要提供target_type和target_id' });
  }
  run('UPDATE notifications SET is_read = 1 WHERE target_type = ? AND target_id = ?', [target_type, target_id]);
  save();
  res.json({ code: 200, message: '全部已标记为已读' });
});

module.exports = router;
