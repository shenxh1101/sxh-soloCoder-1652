const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, run, save } = require('../models/database');
const { pushToRepresentative, pushToHandlingUnit, pushToAllSupervisors } = require('../services/notification');

const uuidv4 = () => crypto.randomUUID();

router.post('/', (req, res) => {
  const { proposal_id, representative_id, satisfaction, comment } = req.body;

  if (!proposal_id || !representative_id || !satisfaction) {
    return res.status(400).json({ code: 400, message: '缺少必要字段' });
  }

  const proposal = queryOne('SELECT * FROM proposals WHERE id = ?', [proposal_id]);
  if (!proposal) {
    return res.status(404).json({ code: 404, message: '建议不存在' });
  }

  const rep = queryOne('SELECT * FROM representatives WHERE id = ?', [representative_id]);
  if (!rep) {
    return res.status(404).json({ code: 404, message: '代表不存在' });
  }

  if (!['satisfied', 'neutral', 'dissatisfied'].includes(satisfaction)) {
    return res.status(400).json({ code: 400, message: '满意度值无效，可选：satisfied/neutral/dissatisfied' });
  }

  const id = uuidv4();
  run(
    'INSERT INTO evaluations (id, proposal_id, representative_id, satisfaction, comment) VALUES (?, ?, ?, ?, ?)',
    [id, proposal_id, representative_id, satisfaction, comment || '']
  );

  let newStatus = 'evaluated';
  let rehandleCount = proposal.rehandle_count || 0;
  let escalated = false;

  if (satisfaction === 'dissatisfied') {
    rehandleCount += 1;
    newStatus = 'rehandling';

    run('UPDATE proposals SET status = ?, rehandle_count = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [newStatus, rehandleCount, proposal_id]);

    pushToHandlingUnit(
      'rehandle_required',
      '需重新办理',
      `代表对建议"${proposal.title}"的答复不满意，请重新办理（第${rehandleCount}次重办）`,
      proposal.handling_unit_id
    );

    pushToRepresentative(
      'rehandle_initiated',
      '已触发重新办理',
      `您对建议"${proposal.title}"的评价已记录，已返回原承办单位重新办理`,
      representative_id
    );

    if (rehandleCount >= 2) {
      escalated = true;
      newStatus = 'escalated';

      run('UPDATE proposals SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
        [newStatus, proposal_id]);

      pushToAllSupervisors(
        'escalation_alert',
        '建议升级至上级督查',
        `建议"${proposal.title}"连续${rehandleCount}次差评，已自动升级至上级督查部门处理`
      );
    }
  } else {
    run('UPDATE proposals SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [newStatus, proposal_id]);

    if (proposal.handling_unit_id) {
      pushToHandlingUnit(
        'evaluation_result',
        '评价结果通知',
        `代表对建议"${proposal.title}"的评价为：${satisfaction === 'satisfied' ? '满意' : '一般'}`,
        proposal.handling_unit_id
      );
    }

    pushToRepresentative(
      'evaluation_confirmed',
      '评价已记录',
      `您对建议"${proposal.title}"的评价已记录`,
      representative_id
    );
  }

  save();

  const evaluation = queryOne('SELECT * FROM evaluations WHERE id = ?', [id]);
  const updatedProposal = queryOne('SELECT * FROM proposals WHERE id = ?', [proposal_id]);

  res.status(201).json({
    code: 201,
    message: satisfaction === 'dissatisfied'
      ? (escalated ? '差评已记录，连续两次差评已升级至上级督查部门' : '差评已记录，已触发重新办理')
      : '评价已记录',
    data: {
      evaluation,
      proposal: updatedProposal,
      rehandle_count: rehandleCount,
      escalated,
    },
  });
});

router.get('/', (req, res) => {
  const { proposal_id, representative_id, satisfaction } = req.query;
  let sql = 'SELECT * FROM evaluations WHERE 1=1';
  const params = [];

  if (proposal_id) { sql += ' AND proposal_id = ?'; params.push(proposal_id); }
  if (representative_id) { sql += ' AND representative_id = ?'; params.push(representative_id); }
  if (satisfaction) { sql += ' AND satisfaction = ?'; params.push(satisfaction); }

  sql += ' ORDER BY created_at DESC';
  const evaluations = queryAll(sql, params);
  res.json({ code: 200, data: evaluations });
});

router.get('/stats', (req, res) => {
  const total = queryOne('SELECT COUNT(*) as count FROM evaluations');
  const satisfied = queryOne('SELECT COUNT(*) as count FROM evaluations WHERE satisfaction = ?', ['satisfied']);
  const neutral = queryOne('SELECT COUNT(*) as count FROM evaluations WHERE satisfaction = ?', ['neutral']);
  const dissatisfied = queryOne('SELECT COUNT(*) as count FROM evaluations WHERE satisfaction = ?', ['dissatisfied']);

  const totalCount = total.count;
  res.json({
    code: 200,
    data: {
      total: totalCount,
      satisfied: satisfied.count,
      neutral: neutral.count,
      dissatisfied: dissatisfied.count,
      satisfaction_rate: totalCount > 0 ? (satisfied.count / totalCount * 100).toFixed(2) + '%' : '0%',
      dissatisfaction_rate: totalCount > 0 ? (dissatisfied.count / totalCount * 100).toFixed(2) + '%' : '0%',
    },
  });
});

module.exports = router;
