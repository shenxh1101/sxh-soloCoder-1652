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
  getNotifications,
  markAsRead,
};
