const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, run, save } = require('../models/database');
const { pushToRepresentative, pushToHandlingUnit, pushToSupervisor } = require('../services/notification');

const uuidv4 = () => crypto.randomUUID();

function getUrgencyLevel(urgency) {
  const map = { 'normal': 'normal', 'urgent': 'urgent', 'critical': 'critical' };
  return map[urgency] || 'normal';
}

function getSupervisorForUrgency(urgency, region) {
  let sql = 'SELECT * FROM supervisors WHERE level = ?';
  const params = [urgency];
  if (region) {
    sql += ' AND (region = ? OR region IS NULL)';
    params.push(region);
  }
  sql += ' LIMIT 1';
  return queryOne(sql, params);
}

function createReminderOrder(proposal, unit, urgency) {
  const level = proposal.overdue_days > 30 ? 'critical' : proposal.overdue_days > 15 ? 'urgent' : 'normal';
  const supervisor = getSupervisorForUrgency(level, null);

  const id = uuidv4();
  run(
    'INSERT INTO reminder_orders (id, proposal_id, handling_unit_id, level, supervisor_id, urgency, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, proposal.id, unit.id, level, supervisor ? supervisor.id : null, urgency || 'normal', 'pending']
  );
  save();

  if (supervisor) {
    pushToSupervisor(
      'reminder_created',
      '新催办工单',
      `建议"${proposal.title}"已超期${proposal.overdue_days}天，催办等级：${level}，请及时督办`,
      supervisor.id
    );
  }

  pushToHandlingUnit(
    'reminder_notice',
    '催办通知',
    `您承办的建议"${proposal.title}"已超期${proposal.overdue_days}天，催办等级：${level}，请尽快办理`,
    unit.id
  );

  return queryOne('SELECT * FROM reminder_orders WHERE id = ?', [id]);
}

router.post('/', (req, res) => {
  const { proposal_id, handling_unit_id, content } = req.body;

  if (!proposal_id || !handling_unit_id || !content) {
    return res.status(400).json({ code: 400, message: '缺少必要字段' });
  }

  const proposal = queryOne('SELECT * FROM proposals WHERE id = ?', [proposal_id]);
  if (!proposal) {
    return res.status(404).json({ code: 404, message: '建议不存在' });
  }

  const unit = queryOne('SELECT * FROM handling_units WHERE id = ?', [handling_unit_id]);
  if (!unit) {
    return res.status(404).json({ code: 404, message: '承办单位不存在' });
  }

  if (unit.is_locked) {
    return res.status(403).json({ code: 403, message: '该承办单位已被锁定，无法提交答复' });
  }

  const now = new Date();
  const deadline = new Date(proposal.deadline);
  const isOverdue = now > deadline;
  const overdueDays = isOverdue ? Math.ceil((now - deadline) / (1000 * 60 * 60 * 24)) : 0;

  const id = uuidv4();
  run(
    'INSERT INTO responses (id, proposal_id, handling_unit_id, content, status) VALUES (?, ?, ?, ?, ?)',
    [id, proposal_id, handling_unit_id, content, isOverdue ? 'overdue_submitted' : 'submitted']
  );

  run('UPDATE proposals SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
    [isOverdue ? 'overdue_responded' : 'responded', proposal_id]);
  save();

  pushToRepresentative(
    'response_submitted',
    '收到答复',
    `您提交的建议"${proposal.title}"已收到${unit.name}的答复，请及时评价`,
    proposal.representative_id
  );

  if (isOverdue) {
    const proposalWithOverdue = { ...proposal, overdue_days: overdueDays };
    const reminder = createReminderOrder(proposalWithOverdue, unit, proposal.urgency);

    if (overdueDays > 30) {
      run('UPDATE handling_units SET is_locked = 1 WHERE id = ?', [handling_unit_id]);
      save();

      pushToHandlingUnit(
        'unit_locked',
        '接收权限已锁定',
        `由于建议"${proposal.title}"超期${overdueDays}天未办理，您单位的接收权限已被锁定`,
        handling_unit_id
      );
    }

    return res.status(201).json({
      code: 201,
      message: '答复已提交（超期），已生成催办工单',
      data: {
        response: queryOne('SELECT * FROM responses WHERE id = ?', [id]),
        reminder_order: reminder,
        overdue_days: overdueDays,
      },
    });
  }

  res.status(201).json({
    code: 201,
    message: '答复提交成功',
    data: queryOne('SELECT * FROM responses WHERE id = ?', [id]),
  });
});

router.get('/', (req, res) => {
  const { proposal_id, handling_unit_id, status } = req.query;
  let sql = 'SELECT * FROM responses WHERE 1=1';
  const params = [];

  if (proposal_id) { sql += ' AND proposal_id = ?'; params.push(proposal_id); }
  if (handling_unit_id) { sql += ' AND handling_unit_id = ?'; params.push(handling_unit_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }

  sql += ' ORDER BY created_at DESC';
  const responses = queryAll(sql, params);
  res.json({ code: 200, data: responses });
});

router.get('/reminders', (req, res) => {
  const { status, level, handling_unit_id, supervisor_id } = req.query;
  let sql = 'SELECT * FROM reminder_orders WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (level) { sql += ' AND level = ?'; params.push(level); }
  if (handling_unit_id) { sql += ' AND handling_unit_id = ?'; params.push(handling_unit_id); }
  if (supervisor_id) { sql += ' AND supervisor_id = ?'; params.push(supervisor_id); }

  sql += ' ORDER BY created_at DESC';
  const reminders = queryAll(sql, params);
  res.json({ code: 200, data: reminders });
});

router.put('/reminders/:id/process', (req, res) => {
  const reminder = queryOne('SELECT * FROM reminder_orders WHERE id = ?', [req.params.id]);
  if (!reminder) {
    return res.status(404).json({ code: 404, message: '催办工单不存在' });
  }

  run('UPDATE reminder_orders SET status = ? WHERE id = ?', ['processed', req.params.id]);
  save();

  res.json({ code: 200, message: '催办工单已处理', data: queryOne('SELECT * FROM reminder_orders WHERE id = ?', [req.params.id]) });
});

router.post('/check-overdue', (req, res) => {
  const now = new Date().toISOString().slice(0, 10);
  const overdueProposals = queryAll(
    'SELECT p.*, julianday(\'now\') - julianday(p.deadline) as overdue_days FROM proposals p WHERE p.status IN (\'assigned\', \'pending\') AND p.deadline < ?',
    [now]
  );

  const results = [];
  overdueProposals.forEach(proposal => {
    const unit = queryOne('SELECT * FROM handling_units WHERE id = ?', [proposal.handling_unit_id]);
    if (!unit) return;

    const existing = queryOne(
      'SELECT * FROM reminder_orders WHERE proposal_id = ? AND status = ?',
      [proposal.id, 'pending']
    );
    if (!existing) {
      const reminder = createReminderOrder(proposal, unit, proposal.urgency);
      results.push(reminder);

      if (proposal.overdue_days > 30) {
        run('UPDATE handling_units SET is_locked = 1 WHERE id = ?', [unit.id]);
      }
    }
  });

  save();
  res.json({ code: 200, message: `检查完成，生成${results.length}条催办工单`, data: results });
});

module.exports = router;
