const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, run, save } = require('../models/database');
const { pushToRepresentative, pushToHandlingUnit, pushToAllSupervisors } = require('../services/notification');

const uuidv4 = () => crypto.randomUUID();

const REQUIRED_FIELDS = ['title', 'content', 'representative_id'];
const FIELD_LABELS = {
  title: '建议标题',
  content: '建议内容',
  representative_id: '代表ID',
  category: '建议类别',
};

function validateProposal(body) {
  const missing = [];
  REQUIRED_FIELDS.forEach(f => {
    if (!body[f] || String(body[f]).trim() === '') {
      missing.push(FIELD_LABELS[f] || f);
    }
  });
  if (!body.category && !body.keywords) {
    missing.push('建议类别或关键词(至少提供一项)');
  }
  return missing;
}

function matchHandlingUnit(category, keywords) {
  const units = queryAll('SELECT * FROM handling_units WHERE is_locked = 0');
  if (!units.length) return null;

  let bestUnit = null;
  let bestScore = 0;

  units.forEach(unit => {
    let score = 0;
    if (category && unit.category === category) {
      score += 10;
    }
    if (keywords && unit.keywords) {
      const inputKws = keywords.split(/[,，、\s]+/).filter(k => k.trim());
      const unitKws = unit.keywords.split(/[,，、\s]+/).filter(k => k.trim());
      inputKws.forEach(ik => {
        unitKws.forEach(uk => {
          if (ik.includes(uk) || uk.includes(ik)) {
            score += 3;
          }
        });
      });
    }
    if (score > bestScore) {
      bestScore = score;
      bestUnit = unit;
    }
  });

  return bestScore > 0 ? bestUnit : units[0];
}

function determineCategory(keywords) {
  if (!keywords) return '其他';
  const kw = keywords.toLowerCase();
  const map = {
    '教育': ['学校', '教师', '课程', '教育', '招生'],
    '卫生': ['医院', '医疗', '卫生', '健康', '防疫'],
    '交通': ['道路', '公交', '交通', '出行', '地铁'],
    '住房': ['住房', '物业', '建筑', '房产', '棚改'],
    '环保': ['环保', '污染', '排放', '绿化', '生态'],
    '民政': ['养老', '低保', '社区', '救助', '民生'],
  };
  for (const [cat, kws] of Object.entries(map)) {
    if (kws.some(k => kw.includes(k))) return cat;
  }
  return '其他';
}

router.post('/', (req, res) => {
  const missing = validateProposal(req.body);
  if (missing.length > 0) {
    return res.status(400).json({
      code: 400,
      message: '建议内容不完整，已退回',
      missing_fields: missing,
    });
  }

  const { title, content, representative_id, category, keywords, urgency } = req.body;

  const rep = queryOne('SELECT * FROM representatives WHERE id = ?', [representative_id]);
  if (!rep) {
    return res.status(404).json({ code: 404, message: '代表不存在' });
  }

  const finalCategory = category || determineCategory(keywords);
  const unit = matchHandlingUnit(finalCategory, keywords);

  const id = uuidv4();
  const now = new Date();
  const deadline = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const status = unit ? 'assigned' : 'pending';

  run(
    'INSERT INTO proposals (id, title, content, category, keywords, representative_id, handling_unit_id, status, urgency, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, content, finalCategory, keywords || '', representative_id, unit ? unit.id : null, status, urgency || 'normal', deadline]
  );
  save();

  pushToRepresentative(
    'proposal_submitted',
    '建议已提交',
    `您的建议"${title}"已提交，状态：${status === 'assigned' ? '已分配至' + unit.name : '待分配'}`,
    representative_id
  );

  if (unit) {
    pushToHandlingUnit(
      'proposal_assigned',
      '收到新建议',
      `收到代表${rep.name}的建议"${title}"，请及时办理，截止日期：${deadline}`,
      unit.id
    );
  }

  const proposal = queryOne('SELECT * FROM proposals WHERE id = ?', [id]);
  res.status(201).json({ code: 201, message: '建议提交成功', data: proposal });
});

router.get('/', (req, res) => {
  const { status, category, representative_id, handling_unit_id } = req.query;
  let sql = 'SELECT * FROM proposals WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (representative_id) { sql += ' AND representative_id = ?'; params.push(representative_id); }
  if (handling_unit_id) { sql += ' AND handling_unit_id = ?'; params.push(handling_unit_id); }

  sql += ' ORDER BY created_at DESC';
  const proposals = queryAll(sql, params);
  res.json({ code: 200, data: proposals });
});

router.get('/:id', (req, res) => {
  const proposal = queryOne('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
  if (!proposal) {
    return res.status(404).json({ code: 404, message: '建议不存在' });
  }
  res.json({ code: 200, data: proposal });
});

router.put('/:id/reject', (req, res) => {
  const proposal = queryOne('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
  if (!proposal) {
    return res.status(404).json({ code: 404, message: '建议不存在' });
  }

  const { reason } = req.body;
  run('UPDATE proposals SET status = ?, reject_reason = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
    ['rejected', reason || '文本不完整', req.params.id]);
  save();

  pushToRepresentative(
    'proposal_rejected',
    '建议已退回',
    `您的建议"${proposal.title}"已退回，原因：${reason || '文本不完整'}`,
    proposal.representative_id
  );

  const updated = queryOne('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
  res.json({ code: 200, message: '建议已退回', data: updated });
});

module.exports = router;
