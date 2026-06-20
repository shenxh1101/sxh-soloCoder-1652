const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, run, save } = require('../models/database');
const { pushToAllSupervisors } = require('../services/notification');

const uuidv4 = () => crypto.randomUUID();

function generateReportForDate(reportDate) {
  const results = [];

  const categories = queryAll('SELECT DISTINCT category FROM proposals WHERE category IS NOT NULL');
  const units = queryAll('SELECT * FROM handling_units');

  categories.forEach(({ category }) => {
    const total = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE category = ? AND date(created_at) <= ?',
      [category, reportDate]
    );
    const completed = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE category = ? AND status IN (\'evaluated\', \'responded\') AND date(created_at) <= ?',
      [category, reportDate]
    );
    const satisfied = queryOne(
      'SELECT COUNT(*) as count FROM evaluations e JOIN proposals p ON e.proposal_id = p.id WHERE p.category = ? AND e.satisfaction = \'satisfied\' AND date(e.created_at) <= ?',
      [category, reportDate]
    );
    const overdue = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE category = ? AND deadline < ? AND status NOT IN (\'evaluated\', \'responded\', \'rejected\') AND date(created_at) <= ?',
      [category, reportDate, reportDate]
    );
    const rehandle = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE category = ? AND rehandle_count > 0 AND date(created_at) <= ?',
      [category, reportDate]
    );

    const totalCount = total.count;
    const id = uuidv4();
    run(
      'INSERT OR REPLACE INTO daily_reports (id, report_date, category, handling_unit_id, total_count, completed_count, satisfied_count, overdue_count, rehandle_count, completion_rate, satisfaction_rate, overdue_rate, rehandle_rate) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id, reportDate, category, totalCount, completed.count, satisfied.count, overdue.count, rehandle.count,
        totalCount > 0 ? (completed.count / totalCount * 100) : 0,
        totalCount > 0 ? (satisfied.count / totalCount * 100) : 0,
        totalCount > 0 ? (overdue.count / totalCount * 100) : 0,
        totalCount > 0 ? (rehandle.count / totalCount * 100) : 0,
      ]
    );
    results.push({ category, total: totalCount, completed: completed.count, satisfied: satisfied.count, overdue: overdue.count, rehandle: rehandle.count });
  });

  units.forEach(unit => {
    const total = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE handling_unit_id = ? AND date(created_at) <= ?',
      [unit.id, reportDate]
    );
    const completed = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE handling_unit_id = ? AND status IN (\'evaluated\', \'responded\') AND date(created_at) <= ?',
      [unit.id, reportDate]
    );
    const satisfied = queryOne(
      'SELECT COUNT(*) as count FROM evaluations e JOIN proposals p ON e.proposal_id = p.id WHERE p.handling_unit_id = ? AND e.satisfaction = \'satisfied\' AND date(e.created_at) <= ?',
      [unit.id, reportDate]
    );
    const overdue = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE handling_unit_id = ? AND deadline < ? AND status NOT IN (\'evaluated\', \'responded\', \'rejected\') AND date(created_at) <= ?',
      [unit.id, reportDate, reportDate]
    );
    const rehandle = queryOne(
      'SELECT COUNT(*) as count FROM proposals WHERE handling_unit_id = ? AND rehandle_count > 0 AND date(created_at) <= ?',
      [unit.id, reportDate]
    );

    const totalCount = total.count;
    const id = uuidv4();
    run(
      'INSERT OR REPLACE INTO daily_reports (id, report_date, category, handling_unit_id, total_count, completed_count, satisfied_count, overdue_count, rehandle_count, completion_rate, satisfaction_rate, overdue_rate, rehandle_rate) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id, reportDate, unit.id, totalCount, completed.count, satisfied.count, overdue.count, rehandle.count,
        totalCount > 0 ? (completed.count / totalCount * 100) : 0,
        totalCount > 0 ? (satisfied.count / totalCount * 100) : 0,
        totalCount > 0 ? (overdue.count / totalCount * 100) : 0,
        totalCount > 0 ? (rehandle.count / totalCount * 100) : 0,
      ]
    );
    results.push({ unit: unit.name, total: totalCount, completed: completed.count, satisfied: satisfied.count, overdue: overdue.count, rehandle: rehandle.count });
  });

  save();
  return results;
}

router.post('/generate', (req, res) => {
  const reportDate = req.body.date || new Date().toISOString().slice(0, 10);
  const results = generateReportForDate(reportDate);

  pushToAllSupervisors(
    'daily_report',
    '每日进度报表已生成',
    `${reportDate}的办理进度报表已生成，共${results.length}条记录`
  );

  res.json({ code: 200, message: '报表生成成功', data: results });
});

router.get('/', (req, res) => {
  const { report_date, category, handling_unit_id, start_date, end_date } = req.query;
  let sql = 'SELECT * FROM daily_reports WHERE 1=1';
  const params = [];

  if (report_date) { sql += ' AND report_date = ?'; params.push(report_date); }
  if (start_date) { sql += ' AND report_date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND report_date <= ?'; params.push(end_date); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (handling_unit_id) { sql += ' AND handling_unit_id = ?'; params.push(handling_unit_id); }

  sql += ' ORDER BY report_date DESC, category, handling_unit_id';
  const reports = queryAll(sql, params);
  res.json({ code: 200, data: reports });
});

router.get('/export', async (req, res) => {
  const { start_date, end_date, category, handling_unit_id, region } = req.query;

  let sql = 'SELECT dr.*, hu.name as unit_name FROM daily_reports dr LEFT JOIN handling_units hu ON dr.handling_unit_id = hu.id WHERE 1=1';
  const params = [];

  if (start_date) { sql += ' AND dr.report_date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND dr.report_date <= ?'; params.push(end_date); }
  if (category) { sql += ' AND dr.category = ?'; params.push(category); }
  if (handling_unit_id) { sql += ' AND dr.handling_unit_id = ?'; params.push(handling_unit_id); }

  if (region) {
    sql = sql.replace('WHERE 1=1', 'WHERE 1=1');
    sql += ' AND (hu.id IS NULL OR hu.id IN (SELECT id FROM handling_units WHERE 1=1))';
  }

  sql += ' ORDER BY dr.report_date DESC';
  const reports = queryAll(sql, params);

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('办理进度报表');

  sheet.columns = [
    { header: '报表日期', key: 'report_date', width: 14 },
    { header: '类别', key: 'category', width: 12 },
    { header: '承办单位', key: 'unit_name', width: 18 },
    { header: '总数', key: 'total_count', width: 10 },
    { header: '已办结', key: 'completed_count', width: 10 },
    { header: '满意数', key: 'satisfied_count', width: 10 },
    { header: '超期数', key: 'overdue_count', width: 10 },
    { header: '重办数', key: 'rehandle_count', width: 10 },
    { header: '办结率(%)', key: 'completion_rate', width: 12 },
    { header: '满意率(%)', key: 'satisfaction_rate', width: 12 },
    { header: '超期率(%)', key: 'overdue_rate', width: 12 },
    { header: '重办率(%)', key: 'rehandle_rate', width: 12 },
  ];

  sheet.getRow(1).font = { bold: true };
  reports.forEach(r => {
    sheet.addRow({
      report_date: r.report_date,
      category: r.category || '-',
      unit_name: r.unit_name || '-',
      total_count: r.total_count,
      completed_count: r.completed_count,
      satisfied_count: r.satisfied_count,
      overdue_count: r.overdue_count,
      rehandle_count: r.rehandle_count,
      completion_rate: r.completion_rate ? Number(r.completion_rate).toFixed(2) : '0.00',
      satisfaction_rate: r.satisfaction_rate ? Number(r.satisfaction_rate).toFixed(2) : '0.00',
      overdue_rate: r.overdue_rate ? Number(r.overdue_rate).toFixed(2) : '0.00',
      rehandle_rate: r.rehandle_rate ? Number(r.rehandle_rate).toFixed(2) : '0.00',
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=report.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
