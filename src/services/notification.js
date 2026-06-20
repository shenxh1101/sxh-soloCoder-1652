const crypto = require('crypto');
const { queryAll, run, save } = require('../models/database');

const uuidv4 = () => crypto.randomUUID();

function pushNotification(type, title, content, targetType, targetId) {
  const id = uuidv4();
  run(
    'INSERT INTO notifications (id, type, title, content, target_type, target_id) VALUES (?, ?, ?, ?, ?, ?)',
    [id, type, title, content, targetType, targetId]
  );
  save();
  return { id, type, title, content, targetType, targetId };
}

function pushToRepresentative(type, title, content, representativeId) {
  return pushNotification(type, title, content, 'representative', representativeId);
}

function pushToHandlingUnit(type, title, content, unitId) {
  return pushNotification(type, title, content, 'handling_unit', unitId);
}

function pushToSupervisor(type, title, content, supervisorId) {
  return pushNotification(type, title, content, 'supervisor', supervisorId);
}

function pushToAllSupervisors(type, title, content) {
  const sups = queryAll('SELECT id FROM supervisors');
  return sups.map(s => pushNotification(type, title, content, 'supervisor', s.id));
}

function pushToAllRepresentatives(type, title, content) {
  const reps = queryAll('SELECT id FROM representatives');
  return reps.map(r => pushNotification(type, title, content, 'representative', r.id));
}

function pushToAllHandlingUnits(type, title, content) {
  const units = queryAll('SELECT id FROM handling_units');
  return units.map(u => pushNotification(type, title, content, 'handling_unit', u.id));
}

function pushDailyReportToAll(reportDate, recordCount) {
  const content = `${reportDate}的办理进度报表已生成，共${recordCount}条记录，请注意查看。`;
  const results = [];
  results.push(...pushToAllRepresentatives('daily_report', '每日进度报表已生成', content));
  results.push(...pushToAllHandlingUnits('daily_report', '每日进度报表已生成', content));
  results.push(...pushToAllSupervisors('daily_report', '每日进度报表已生成', content));
  return results;
}

function getNotifications(targetType, targetId) {
  return queryAll(
    'SELECT * FROM notifications WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC',
    [targetType, targetId]
  );
}

function markAsRead(notificationId) {
  run('UPDATE notifications SET is_read = 1 WHERE id = ?', [notificationId]);
  save();
}

module.exports = {
  pushToRepresentative,
  pushToHandlingUnit,
  pushToSupervisor,
  pushToAllSupervisors,
  pushToAllRepresentatives,
  pushToAllHandlingUnits,
  pushDailyReportToAll,
  getNotifications,
  markAsRead,
};
