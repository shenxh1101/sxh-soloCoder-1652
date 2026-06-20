const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run, save } = require('../models/database');

router.get('/representatives', (req, res) => {
  const { region } = req.query;
  let sql = 'SELECT * FROM representatives WHERE 1=1';
  const params = [];
  if (region) { sql += ' AND region = ?'; params.push(region); }
  const reps = queryAll(sql, params);
  res.json({ code: 200, data: reps });
});

router.get('/representatives/:id', (req, res) => {
  const rep = queryOne('SELECT * FROM representatives WHERE id = ?', [req.params.id]);
  if (!rep) return res.status(404).json({ code: 404, message: '代表不存在' });
  res.json({ code: 200, data: rep });
});

router.get('/units', (req, res) => {
  const { category, is_locked } = req.query;
  let sql = 'SELECT * FROM handling_units WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (is_locked !== undefined) { sql += ' AND is_locked = ?'; params.push(is_locked === '1' ? 1 : 0); }
  const units = queryAll(sql, params);
  res.json({ code: 200, data: units });
});

router.get('/units/:id', (req, res) => {
  const unit = queryOne('SELECT * FROM handling_units WHERE id = ?', [req.params.id]);
  if (!unit) return res.status(404).json({ code: 404, message: '承办单位不存在' });
  res.json({ code: 200, data: unit });
});

router.put('/units/:id/unlock', (req, res) => {
  run('UPDATE handling_units SET is_locked = 0 WHERE id = ?', [req.params.id]);
  save();
  res.json({ code: 200, message: '承办单位已解锁', data: queryOne('SELECT * FROM handling_units WHERE id = ?', [req.params.id]) });
});

router.get('/supervisors', (req, res) => {
  const { level, region } = req.query;
  let sql = 'SELECT * FROM supervisors WHERE 1=1';
  const params = [];
  if (level) { sql += ' AND level = ?'; params.push(level); }
  if (region) { sql += ' AND (region = ? OR region IS NULL)'; params.push(region); }
  const sups = queryAll(sql, params);
  res.json({ code: 200, data: sups });
});

router.get('/dashboard', (req, res) => {
  const totalProposals = queryOne('SELECT COUNT(*) as count FROM proposals');
  const assignedProposals = queryOne('SELECT COUNT(*) as count FROM proposals WHERE status = \'assigned\'');
  const respondedProposals = queryOne('SELECT COUNT(*) as count FROM proposals WHERE status IN (\'responded\', \'overdue_responded\')');
  const evaluatedProposals = queryOne('SELECT COUNT(*) as count FROM proposals WHERE status = \'evaluated\'');
  const rehandlingProposals = queryOne('SELECT COUNT(*) as count FROM proposals WHERE status = \'rehandling\'');
  const escalatedProposals = queryOne('SELECT COUNT(*) as count FROM proposals WHERE status = \'escalated\'');
  const overdueProposals = queryOne('SELECT COUNT(*) as count FROM proposals WHERE deadline < date(\'now\') AND status NOT IN (\'evaluated\', \'responded\', \'rejected\')');
  const lockedUnits = queryOne('SELECT COUNT(*) as count FROM handling_units WHERE is_locked = 1');
  const pendingReminders = queryOne('SELECT COUNT(*) as count FROM reminder_orders WHERE status = \'pending\'');

  res.json({
    code: 200,
    data: {
      total_proposals: totalProposals.count,
      assigned: assignedProposals.count,
      responded: respondedProposals.count,
      evaluated: evaluatedProposals.count,
      rehandling: rehandlingProposals.count,
      escalated: escalatedProposals.count,
      overdue: overdueProposals.count,
      locked_units: lockedUnits.count,
      pending_reminders: pendingReminders.count,
    },
  });
});

module.exports = router;
