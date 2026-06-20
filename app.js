const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');
const { init, save } = require('./src/models/database');
const { queryAll, queryOne, run } = require('./src/models/database');
const { pushToAllSupervisors, pushDailyReportToAll } = require('./src/services/notification');

const proposalsRouter = require('./src/routes/proposals');
const responsesRouter = require('./src/routes/responses');
const evaluationsRouter = require('./src/routes/evaluations');
const reportsRouter = require('./src/routes/reports');
const notificationsRouter = require('./src/routes/notifications');
const baseRouter = require('./src/routes/base');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/proposals', proposalsRouter);
app.use('/api/responses', responsesRouter);
app.use('/api/evaluations', evaluationsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', baseRouter);

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ code: 500, message: '服务器内部错误', error: err.message });
});

function generateDailyReport() {
  const reportDate = new Date().toISOString().slice(0, 10);
  console.log(`[${new Date().toISOString()}] 开始生成每日进度报表: ${reportDate}`);

  try {
    const categories = queryAll('SELECT DISTINCT category FROM proposals WHERE category IS NOT NULL');
    const units = queryAll('SELECT * FROM handling_units');
    const uuidv4 = () => crypto.randomUUID();

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
      run(
        'INSERT OR REPLACE INTO daily_reports (id, report_date, category, handling_unit_id, total_count, completed_count, satisfied_count, overdue_count, rehandle_count, completion_rate, satisfaction_rate, overdue_rate, rehandle_rate) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), reportDate, category, totalCount, completed.count, satisfied.count, overdue.count, rehandle.count,
          totalCount > 0 ? (completed.count / totalCount * 100) : 0,
          totalCount > 0 ? (satisfied.count / totalCount * 100) : 0,
          totalCount > 0 ? (overdue.count / totalCount * 100) : 0,
          totalCount > 0 ? (rehandle.count / totalCount * 100) : 0,
        ]
      );
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
      run(
        'INSERT OR REPLACE INTO daily_reports (id, report_date, category, handling_unit_id, total_count, completed_count, satisfied_count, overdue_count, rehandle_count, completion_rate, satisfaction_rate, overdue_rate, rehandle_rate) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), reportDate, unit.id, totalCount, completed.count, satisfied.count, overdue.count, rehandle.count,
          totalCount > 0 ? (completed.count / totalCount * 100) : 0,
          totalCount > 0 ? (satisfied.count / totalCount * 100) : 0,
          totalCount > 0 ? (overdue.count / totalCount * 100) : 0,
          totalCount > 0 ? (rehandle.count / totalCount * 100) : 0,
        ]
      );
    });

    save();
    const totalRecords = categories.length + units.length;
    pushDailyReportToAll(reportDate, totalRecords);
    console.log(`[${new Date().toISOString()}] 每日进度报表生成完成，共${totalRecords}条记录`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] 报表生成失败:`, err.message);
  }
}

async function start() {
  await init();
  console.log('数据库初始化完成');

  cron.schedule('0 0 * * *', () => {
    generateDailyReport();
  });
  console.log('每日凌晨定时报表任务已注册');

  app.listen(PORT, () => {
    console.log(`人大代表建议提案办理系统 API 服务已启动: http://localhost:${PORT}`);
    console.log(`API 文档地址: http://localhost:${PORT}/api/dashboard`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
