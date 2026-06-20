const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { queryAll, queryOne, run, save } = require('../models/database');
const { pushToAllSupervisors, pushDailyReportToAll } = require('../services/notification');

const uuidv4 = () => crypto.randomUUID();

function generateReportForDate(reportDate, region) {
  const results = [];

  let regionJoin = '';
  let regionWhere = '';
  const regionParams = [];

  if (region) {
    regionJoin = 'JOIN representatives r ON p.representative_id = r.id';
    regionWhere = ' AND r.region = ?';
    regionParams.push(region);
  }

  const categories = queryAll(
    `SELECT DISTINCT p.category FROM proposals p ${regionJoin} WHERE p.category IS NOT NULL ${regionWhere}`,
    regionParams
  );
  const units = queryAll(
    `SELECT DISTINCT hu.* FROM handling_units hu JOIN proposals p ON hu.id = p.handling_unit_id ${regionJoin} WHERE 1=1 ${regionWhere}`,
    regionParams
  );

  categories.forEach(({ category }) => {
    const total = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND date(p.created_at) <= ? ${regionWhere}`,
      [category, reportDate, ...regionParams]
    );
    const completed = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND p.status IN ('evaluated', 'responded') AND date(p.created_at) <= ? ${regionWhere}`,
      [category, reportDate, ...regionParams]
    );
    const satisfied = queryOne(
      `SELECT COUNT(*) as count FROM evaluations e JOIN proposals p ON e.proposal_id = p.id ${regionJoin} WHERE p.category = ? AND e.satisfaction = 'satisfied' AND date(e.created_at) <= ? ${regionWhere}`,
      [category, reportDate, ...regionParams]
    );
    const overdue = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND p.deadline < ? AND p.status NOT IN ('evaluated', 'responded', 'rejected') AND date(p.created_at) <= ? ${regionWhere}`,
      [category, reportDate, reportDate, ...regionParams]
    );
    const rehandle = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND p.rehandle_count > 0 AND date(p.created_at) <= ? ${regionWhere}`,
      [category, reportDate, ...regionParams]
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
    results.push({ category, total: totalCount, completed: completed.count, satisfied: satisfied.count, overdue: overdue.count, rehandle: rehandle.count, region: region || null });
  });

  units.forEach(unit => {
    const total = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND date(p.created_at) <= ? ${regionWhere}`,
      [unit.id, reportDate, ...regionParams]
    );
    const completed = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND p.status IN ('evaluated', 'responded') AND date(p.created_at) <= ? ${regionWhere}`,
      [unit.id, reportDate, ...regionParams]
    );
    const satisfied = queryOne(
      `SELECT COUNT(*) as count FROM evaluations e JOIN proposals p ON e.proposal_id = p.id ${regionJoin} WHERE p.handling_unit_id = ? AND e.satisfaction = 'satisfied' AND date(e.created_at) <= ? ${regionWhere}`,
      [unit.id, reportDate, ...regionParams]
    );
    const overdue = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND p.deadline < ? AND p.status NOT IN ('evaluated', 'responded', 'rejected') AND date(p.created_at) <= ? ${regionWhere}`,
      [unit.id, reportDate, reportDate, ...regionParams]
    );
    const rehandle = queryOne(
      `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND p.rehandle_count > 0 AND date(p.created_at) <= ? ${regionWhere}`,
      [unit.id, reportDate, ...regionParams]
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
    results.push({ unit: unit.name, total: totalCount, completed: completed.count, satisfied: satisfied.count, overdue: overdue.count, rehandle: rehandle.count, region: region || null });
  });

  save();
  return results;
}

router.post('/generate', (req, res) => {
  const reportDate = req.body.date || new Date().toISOString().slice(0, 10);
  const region = req.body.region || null;
  const results = generateReportForDate(reportDate, region);

  pushDailyReportToAll(reportDate + (region ? '（' + region + '）' : ''), results.length);

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

  let reportsData = [];

  if (region) {
    const endDate = end_date || new Date().toISOString().slice(0, 10);
    const startDate = start_date || '2000-01-01';

    let regionJoin = 'JOIN representatives r ON p.representative_id = r.id';
    let regionWhere = ' AND r.region = ?';
    const regionParams = [region];

    const dateFilter = ` AND date(p.created_at) BETWEEN ? AND ?`;
    const dateParams = [startDate, endDate];

    let catFilter = '';
    let catParams = [];
    if (category) {
      catFilter = ' AND p.category = ?';
      catParams.push(category);
    }

    let unitFilter = '';
    let unitParams = [];
    if (handling_unit_id) {
      unitFilter = ' AND p.handling_unit_id = ?';
      unitParams.push(handling_unit_id);
    }

    const categories = queryAll(
      `SELECT DISTINCT p.category FROM proposals p ${regionJoin} WHERE p.category IS NOT NULL ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
      [...regionParams, ...dateParams, ...catParams, ...unitParams]
    );
    const units = queryAll(
      `SELECT DISTINCT hu.* FROM handling_units hu JOIN proposals p ON hu.id = p.handling_unit_id ${regionJoin} WHERE 1=1 ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
      [...regionParams, ...dateParams, ...catParams, ...unitParams]
    );

    categories.forEach(({ category: cat }) => {
      const baseParams = [cat, ...regionParams, ...dateParams, ...catParams, ...unitParams];
      const total = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );
      const completed = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND p.status IN ('evaluated', 'responded') ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );
      const satisfied = queryOne(
        `SELECT COUNT(*) as count FROM evaluations e JOIN proposals p ON e.proposal_id = p.id ${regionJoin} WHERE p.category = ? AND e.satisfaction = 'satisfied' ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );
      const overdue = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND p.deadline < ? AND p.status NOT IN ('evaluated', 'responded', 'rejected') ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        [cat, endDate, ...regionParams, ...dateParams, ...catParams, ...unitParams]
      );
      const rehandle = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.category = ? AND p.rehandle_count > 0 ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );

      const totalCount = total.count;
      reportsData.push({
        report_date: endDate,
        category: cat,
        unit_name: '-',
        total_count: totalCount,
        completed_count: completed.count,
        satisfied_count: satisfied.count,
        overdue_count: overdue.count,
        rehandle_count: rehandle.count,
        completion_rate: totalCount > 0 ? (completed.count / totalCount * 100) : 0,
        satisfaction_rate: totalCount > 0 ? (satisfied.count / totalCount * 100) : 0,
        overdue_rate: totalCount > 0 ? (overdue.count / totalCount * 100) : 0,
        rehandle_rate: totalCount > 0 ? (rehandle.count / totalCount * 100) : 0,
      });
    });

    units.forEach(unit => {
      const baseParams = [unit.id, ...regionParams, ...dateParams, ...catParams, ...unitParams];
      const total = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );
      const completed = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND p.status IN ('evaluated', 'responded') ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );
      const satisfied = queryOne(
        `SELECT COUNT(*) as count FROM evaluations e JOIN proposals p ON e.proposal_id = p.id ${regionJoin} WHERE p.handling_unit_id = ? AND e.satisfaction = 'satisfied' ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );
      const overdue = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND p.deadline < ? AND p.status NOT IN ('evaluated', 'responded', 'rejected') ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        [unit.id, endDate, ...regionParams, ...dateParams, ...catParams, ...unitParams]
      );
      const rehandle = queryOne(
        `SELECT COUNT(*) as count FROM proposals p ${regionJoin} WHERE p.handling_unit_id = ? AND p.rehandle_count > 0 ${regionWhere}${dateFilter}${catFilter}${unitFilter}`,
        baseParams
      );

      const totalCount = total.count;
      reportsData.push({
        report_date: endDate,
        category: '-',
        unit_name: unit.name,
        total_count: totalCount,
        completed_count: completed.count,
        satisfied_count: satisfied.count,
        overdue_count: overdue.count,
        rehandle_count: rehandle.count,
        completion_rate: totalCount > 0 ? (completed.count / totalCount * 100) : 0,
        satisfaction_rate: totalCount > 0 ? (satisfied.count / totalCount * 100) : 0,
        overdue_rate: totalCount > 0 ? (overdue.count / totalCount * 100) : 0,
        rehandle_rate: totalCount > 0 ? (rehandle.count / totalCount * 100) : 0,
      });
    });
  } else {
    let sql = 'SELECT dr.*, hu.name as unit_name FROM daily_reports dr LEFT JOIN handling_units hu ON dr.handling_unit_id = hu.id WHERE 1=1';
    const params = [];

    if (start_date) { sql += ' AND dr.report_date >= ?'; params.push(start_date); }
    if (end_date) { sql += ' AND dr.report_date <= ?'; params.push(end_date); }
    if (category) { sql += ' AND dr.category = ?'; params.push(category); }
    if (handling_unit_id) { sql += ' AND dr.handling_unit_id = ?'; params.push(handling_unit_id); }

    sql += ' ORDER BY dr.report_date DESC';
    reportsData = queryAll(sql, params);
  }

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheetTitle = region ? `办理进度报表-${region}` : '办理进度报表';
  const sheet = workbook.addWorksheet(sheetTitle.slice(0, 31));

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
  reportsData.forEach(r => {
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
