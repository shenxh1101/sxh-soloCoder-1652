const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data.db');

let db = null;
let SQL = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS representatives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  contact TEXT
);

CREATE TABLE IF NOT EXISTS handling_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  keywords TEXT,
  is_locked INTEGER DEFAULT 0,
  superior_id TEXT,
  contact TEXT
);

CREATE TABLE IF NOT EXISTS supervisors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  region TEXT,
  contact TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  keywords TEXT,
  representative_id TEXT NOT NULL,
  handling_unit_id TEXT,
  status TEXT DEFAULT 'submitted',
  urgency TEXT DEFAULT 'normal',
  deadline TEXT,
  reject_reason TEXT,
  rehandle_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (representative_id) REFERENCES representatives(id),
  FOREIGN KEY (handling_unit_id) REFERENCES handling_units(id)
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  handling_unit_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'submitted',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id),
  FOREIGN KEY (handling_unit_id) REFERENCES handling_units(id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  representative_id TEXT NOT NULL,
  satisfaction TEXT NOT NULL,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id),
  FOREIGN KEY (representative_id) REFERENCES representatives(id)
);

CREATE TABLE IF NOT EXISTS reminder_orders (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  handling_unit_id TEXT NOT NULL,
  level TEXT NOT NULL,
  supervisor_id TEXT,
  urgency TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id),
  FOREIGN KEY (handling_unit_id) REFERENCES handling_units(id),
  FOREIGN KEY (supervisor_id) REFERENCES supervisors(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  category TEXT,
  handling_unit_id TEXT,
  total_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  satisfied_count INTEGER DEFAULT 0,
  overdue_count INTEGER DEFAULT 0,
  rehandle_count INTEGER DEFAULT 0,
  completion_rate REAL DEFAULT 0,
  satisfaction_rate REAL DEFAULT 0,
  overdue_rate REAL DEFAULT 0,
  rehandle_rate REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

async function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function init() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    db.run(SCHEMA);
    await seedData();
    await save();
  }
  return db;
}

function getDb() {
  return db;
}

function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params) {
  db.run(sql, params);
}

async function seedData() {
  const uuidv4 = () => crypto.randomUUID();

  const units = [
    { id: uuidv4(), name: '市教育局', category: '教育', keywords: '学校,教师,课程,教育,招生', is_locked: 0, superior_id: null, contact: 'edu@gov.cn' },
    { id: uuidv4(), name: '市卫健委', category: '卫生', keywords: '医院,医疗,卫生,健康,防疫', is_locked: 0, superior_id: null, contact: 'health@gov.cn' },
    { id: uuidv4(), name: '市交通局', category: '交通', keywords: '道路,公交,交通,出行,地铁', is_locked: 0, superior_id: null, contact: 'transport@gov.cn' },
    { id: uuidv4(), name: '市住建局', category: '住房', keywords: '住房,物业,建筑,房产,棚改', is_locked: 0, superior_id: null, contact: 'housing@gov.cn' },
    { id: uuidv4(), name: '市环保局', category: '环保', keywords: '环保,污染,排放,绿化,生态', is_locked: 0, superior_id: null, contact: 'env@gov.cn' },
    { id: uuidv4(), name: '市民政局', category: '民政', keywords: '养老,低保,社区,救助,民生', is_locked: 0, superior_id: null, contact: 'civil@gov.cn' },
  ];

  units.forEach(u => {
    db.run(
      'INSERT INTO handling_units (id, name, category, keywords, is_locked, superior_id, contact) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [u.id, u.name, u.category, u.keywords, u.is_locked, u.superior_id, u.contact]
    );
  });

  const reps = [
    { id: uuidv4(), name: '张代表', region: '东城区', contact: 'zhang@rep.cn' },
    { id: uuidv4(), name: '李代表', region: '西城区', contact: 'li@rep.cn' },
    { id: uuidv4(), name: '王代表', region: '南城区', contact: 'wang@rep.cn' },
  ];
  reps.forEach(r => {
    db.run(
      'INSERT INTO representatives (id, name, region, contact) VALUES (?, ?, ?, ?)',
      [r.id, r.name, r.region, r.contact]
    );
  });

  const sups = [
    { id: uuidv4(), name: '赵督办-普通级', level: 'normal', region: '东城区', contact: 'zhao@sup.cn' },
    { id: uuidv4(), name: '钱督办-紧急级', level: 'urgent', region: '西城区', contact: 'qian@sup.cn' },
    { id: uuidv4(), name: '孙督办-特急级', level: 'critical', region: null, contact: 'sun@sup.cn' },
    { id: uuidv4(), name: '上级督查部', level: 'superior', region: null, contact: 'top@sup.cn' },
  ];
  sups.forEach(s => {
    db.run(
      'INSERT INTO supervisors (id, name, level, region, contact) VALUES (?, ?, ?, ?, ?)',
      [s.id, s.name, s.level, s.region, s.contact]
    );
  });
}

module.exports = { init, getDb, queryAll, queryOne, run, save };
