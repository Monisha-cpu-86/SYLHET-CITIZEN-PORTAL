import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { SCC_WARDS } from '../../shared/sylhet.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_PORT,
  DB_USER,
  IS_DEVELOPMENT,
  OFFICER_EMAIL,
  OFFICER_PASSWORD,
} from './config/env.js';

const db = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
});

const demoUsers = [
  {
    email: 'demo@example.com',
    name: 'Demo User',
    password: 'demo123',
    complaints: [
      { type: 'Roads', description: 'A large pothole near the main entrance to Zindabazar is slowing down traffic.', status: 'open', ward: 'Ward 12', daysAgo: 1 },
      { type: 'Street lighting', description: 'The street light outside the community library has been repaired. Thank you for the quick response.', status: 'resolved', ward: 'Ward 10', daysAgo: 6 },
      { type: 'Waste management', description: 'A waste bin at the corner of the market is overflowing and needs collection.', status: 'open', ward: 'Ward 11', daysAgo: 3 },
    ],
  },
  {
    email: 'ayesha@example.com',
    name: 'Ayesha Rahman',
    password: 'ayesha123',
    complaints: [
      { type: 'Water & drainage', description: 'Rainwater is collecting on the footpath beside Road 8 after even a short shower.', status: 'open', ward: 'Ward 14', daysAgo: 2 },
      { type: 'Parks & public spaces', description: 'The broken bench beside the playground has been replaced. The park is much safer now.', status: 'resolved', ward: 'Ward 13', daysAgo: 9 },
      { type: 'Street lighting', description: 'Two street lights on the lane beside the local clinic are not working at night.', status: 'open', ward: 'Ward 15', daysAgo: 4 },
    ],
  },
  {
    email: 'tanvir@example.com',
    name: 'Tanvir Hasan',
    password: 'tanvir123',
    complaints: [
      { type: 'Waste management', description: 'Household waste has not been collected from the south end of the block this week.', status: 'open', ward: 'Ward 20', daysAgo: 1 },
      { type: 'Roads', description: 'The damaged road marking near the school crossing has been repainted.', status: 'resolved', ward: 'Ward 19', daysAgo: 12 },
      { type: 'Water & drainage', description: 'A drain cover is missing beside the bus stop and could be hazardous for pedestrians.', status: 'open', ward: 'Ward 21', daysAgo: 5 },
    ],
  },
];

const sylhetSampleReports = [
  ['Roads', 'Deep potholes have formed near Zindabazar point and vehicles are swerving into the next lane.', 'Ward 10', 24.8945, 91.8681, 'urgent', 'in_progress', 'Roads', 1],
  ['Water & drainage', 'Water pools along the Ambarkhana footpath after rain and blocks pedestrian access.', 'Ward 4', 24.9005, 91.8708, 'normal', 'submitted', 'Water & drainage', 2],
  ['Street lighting', 'Street light outside the Ambarkhana bus stand is not working after dark.', 'Ward 5', 24.9017, 91.8701, 'urgent', 'acknowledged', 'Street lighting', 3],
  ['Waste management', 'Waste collection was missed near Subid Bazar market this morning.', 'Ward 8', 24.8867, 91.8778, 'normal', 'submitted', 'Waste management', 4],
  ['Roads', 'A damaged drain cover is creating a hazard near Mirabazar crossing.', 'Ward 16', 24.8896, 91.8829, 'safety_hazard', 'in_progress', 'Roads', 5],
  ['Parks & public spaces', 'The playground gate hinge is broken at Upashahar community park.', 'Ward 22', 24.8845, 91.8903, 'normal', 'acknowledged', 'Parks & public spaces', 6],
  ['Water & drainage', 'Drain water is overflowing beside the Tilagor residential road.', 'Ward 7', 24.9015, 91.8913, 'urgent', 'submitted', 'Water & drainage', 7],
  ['Street lighting', 'Three lamps along the Shahjalal Upashahar walking path are out.', 'Ward 24', 24.9138, 91.8922, 'normal', 'in_progress', 'Street lighting', 8],
  ['Roads', 'Loose paving stones have made the footpath uneven by the Keane Bridge entrance.', 'Ward 12', 24.8918, 91.8682, 'safety_hazard', 'submitted', 'Roads', 9],
  ['Waste management', 'Public bin near the central shopping area needs collection and cleaning.', 'Ward 11', 24.8942, 91.8695, 'normal', 'acknowledged', 'Waste management', 10],
  ['Parks & public spaces', 'Two park benches need repairs at the local family recreation area.', 'Ward 13', 24.8907, 91.8757, 'normal', 'submitted', 'Parks & public spaces', 11],
  ['Water & drainage', 'A roadside drain grate is loose close to the Subid Bazar school.', 'Ward 9', 24.8878, 91.8794, 'safety_hazard', 'in_progress', 'Water & drainage', 12],
  ['Roads', 'A traffic signal approach marking is faded near the Mirabazar junction.', 'Ward 17', 24.8902, 91.8847, 'normal', 'resolved', 'Roads', 13],
  ['Street lighting', 'The lane behind the Tilagor clinic needs a replacement street lamp.', 'Ward 6', 24.9001, 91.894, 'urgent', 'submitted', 'Street lighting', 14],
  ['Waste management', 'Litter around the Shahjalal Upashahar play area needs cleanup.', 'Ward 25', 24.9167, 91.896, 'normal', 'resolved', 'Waste management', 15],
];

const schemaColumns = {
  users: [
    ['role', "VARCHAR(30) NOT NULL DEFAULT 'citizen' AFTER password_hash"],
    ['department', 'VARCHAR(120) NULL AFTER role'],
    ['deleted_at', 'DATETIME(3) NULL'],
  ],
  complaints: [
    ['ward', 'VARCHAR(32) NULL AFTER type'],
    ['report_code', 'VARCHAR(32) NULL'],
    ['priority', "VARCHAR(24) NOT NULL DEFAULT 'normal'"],
    ['latitude', 'DECIMAL(10,7) NULL'],
    ['longitude', 'DECIMAL(10,7) NULL'],
    ['location_text', 'VARCHAR(500) NULL'],
    ['location_not_shared', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ['public_response', 'TEXT NULL'],
    ['internal_notes', 'TEXT NULL'],
    ['due_at', 'DATETIME(3) NULL'],
    ['assigned_department', 'VARCHAR(120) NULL'],
    ['assigned_to', 'BIGINT UNSIGNED NULL'],
    ['resolution_reason', 'VARCHAR(1000) NULL'],
    ['reopen_reason', 'VARCHAR(1000) NULL'],
    ['confirmed_resolved_at', 'DATETIME(3) NULL'],
    ['resolved_at', 'DATETIME(3) NULL'],
    ['response_updated_at', 'DATETIME(3) NULL'],
    ['idempotency_key', 'VARCHAR(80) NULL'],
    ['deleted_at', 'DATETIME(3) NULL'],
    ['demo_key', 'VARCHAR(64) NULL'],
  ],
};

async function ensureColumn(table, name, definition) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, name],
  );
  if (Number(rows[0].count) === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
  }
}

async function ensureIndex(table, name, columns, unique = false) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS count FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name],
  );
  if (Number(rows[0].count) === 0) {
    const uniqueKeyword = unique ? 'UNIQUE ' : '';
    await db.query(`CREATE ${uniqueKeyword}INDEX \`${name}\` ON \`${table}\` (${columns})`);
  }
}

async function seedAccount({ email, name, password, role, department = null }) {
  const [rows] = await db.execute('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
  if (rows.length > 0) {
    if (role !== 'citizen') {
      await db.execute('UPDATE users SET role = ?, department = ? WHERE id = ?', [role, department, rows[0].id]);
    }
    return rows[0].id;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await db.execute(
    'INSERT INTO users (email, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
    [email, name, passwordHash, role, department],
  );
  return result.insertId;
}

async function seedHistoryIfMissing(complaintId, userId, status, createdAt) {
  const [rows] = await db.execute('SELECT id FROM complaint_status_history WHERE complaint_id = ? LIMIT 1', [complaintId]);
  if (rows.length === 0) {
    await db.execute(
      `INSERT INTO complaint_status_history
        (complaint_id, changed_by, from_status, to_status, public_note, created_at)
       VALUES (?, ?, NULL, ?, NULL, ?)`,
      [complaintId, userId, status === 'open' ? 'submitted' : status, createdAt],
    );
  }
}

export async function initializeDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(30) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      INDEX complaints_user_created_idx (user_id, created_at),
      INDEX complaints_status_idx (status),
      CONSTRAINT complaints_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  for (const [table, columns] of Object.entries(schemaColumns)) {
    for (const [name, definition] of columns) await ensureColumn(table, name, definition);
  }
  await db.execute(
    `UPDATE complaints SET resolved_at = updated_at
     WHERE status IN ('resolved', 'confirmed_resolved') AND resolved_at IS NULL`,
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS complaint_status_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      complaint_id BIGINT UNSIGNED NOT NULL,
      changed_by BIGINT UNSIGNED NULL,
      from_status VARCHAR(30) NULL,
      to_status VARCHAR(30) NOT NULL,
      public_note TEXT NULL,
      internal_note TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX complaint_history_created_idx (complaint_id, created_at),
      CONSTRAINT history_complaint_fk FOREIGN KEY(complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
      CONSTRAINT history_user_fk FOREIGN KEY(changed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS complaint_photos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      complaint_id BIGINT UNSIGNED NOT NULL,
      file_name VARCHAR(180) NOT NULL UNIQUE,
      mime_type VARCHAR(40) NOT NULL,
      file_size INT UNSIGNED NOT NULL,
      width INT UNSIGNED NOT NULL,
      height INT UNSIGNED NOT NULL,
      photo_kind VARCHAR(16) NOT NULL DEFAULT 'before',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX photos_complaint_created_idx (complaint_id, created_at),
      CONSTRAINT photos_complaint_fk FOREIGN KEY(complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_id BIGINT UNSIGNED NULL,
      complaint_id BIGINT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      details JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX audit_complaint_created_idx (complaint_id, created_at),
      CONSTRAINT audit_actor_fk FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT audit_complaint_fk FOREIGN KEY(complaint_id) REFERENCES complaints(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      complaint_id BIGINT UNSIGNED NOT NULL,
      message VARCHAR(500) NOT NULL,
      read_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX notifications_user_created_idx (user_id, read_at, created_at),
      CONSTRAINT notifications_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT notifications_complaint_fk FOREIGN KEY(complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) NOT NULL PRIMARY KEY,
      session_data MEDIUMTEXT NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      INDEX sessions_expiry_idx (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureIndex('complaints', 'complaints_report_code_unique', 'report_code', true);
  await ensureIndex('complaints', 'complaints_ward_created_idx', 'ward, created_at');
  await ensureIndex('complaints', 'complaints_category_created_idx', 'type, created_at');
  await ensureIndex('complaints', 'complaints_location_idx', 'latitude, longitude');
  await ensureIndex('complaints', 'complaints_demo_key_unique', 'demo_key', true);
  await ensureIndex('complaints', 'complaints_user_idempotency_unique', 'user_id, idempotency_key', true);

  const demoIds = new Map();
  if (IS_DEVELOPMENT || process.env.ADMIN_PASSWORD) {
    await seedAccount({ email: ADMIN_EMAIL, name: 'SCC Super Admin', password: ADMIN_PASSWORD, role: 'super_admin' });
  }

  if (IS_DEVELOPMENT) {
    for (const demoUser of demoUsers) {
      const userId = await seedAccount({ ...demoUser, role: 'citizen' });
      demoIds.set(demoUser.email, userId);
      const [existingComplaints] = await db.execute('SELECT COUNT(*) AS count FROM complaints WHERE user_id = ?', [userId]);
      if (Number(existingComplaints[0].count) === 0) {
        for (const complaint of demoUser.complaints) {
          const createdAt = new Date(Date.now() - complaint.daysAgo * 24 * 60 * 60 * 1000);
          const [result] = await db.execute(
            `INSERT INTO complaints (user_id, type, ward, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, complaint.type, SCC_WARDS.includes(complaint.ward) ? complaint.ward : null, complaint.description, complaint.status, createdAt, createdAt],
          );
          await seedHistoryIfMissing(result.insertId, userId, complaint.status, createdAt);
        }
      }
    }

    const officerId = await seedAccount({
      email: OFFICER_EMAIL,
      name: 'SCC Field Officer',
      password: OFFICER_PASSWORD,
      role: 'scc_officer',
      department: 'Roads',
    });

    for (const [index, sample] of sylhetSampleReports.entries()) {
      const [type, description, ward, latitude, longitude, priority, status, department, dayOffset] = sample;
      const demoKey = `scc-sylhet-report-${index + 1}`;
      const [existing] = await db.execute('SELECT id FROM complaints WHERE demo_key = ?', [demoKey]);
      if (existing.length > 0) continue;
      const userId = demoIds.get(demoUsers[index % demoUsers.length].email);
      const createdAt = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
      const [result] = await db.execute(
        `INSERT INTO complaints
          (user_id, type, ward, description, status, priority, latitude, longitude, location_text,
           assigned_department, assigned_to, demo_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, type, ward, description, status, priority, latitude, longitude, `${ward}, Sylhet City`, department, officerId, demoKey, createdAt, createdAt],
      );
      await seedHistoryIfMissing(result.insertId, userId, status, createdAt);
    }
  }

  const [missingCodes] = await db.execute('SELECT id FROM complaints WHERE report_code IS NULL');
  for (const complaint of missingCodes) {
    const reportCode = `SCC-${new Date().getFullYear()}-${String(complaint.id).padStart(6, '0')}`;
    await db.execute('UPDATE complaints SET report_code = ? WHERE id = ? AND report_code IS NULL', [reportCode, complaint.id]);
  }
  const [reportsWithoutHistory] = await db.execute(
    `SELECT c.id, c.user_id, c.status, c.created_at FROM complaints c
     LEFT JOIN complaint_status_history h ON h.complaint_id = c.id
     WHERE h.id IS NULL`,
  );
  for (const complaint of reportsWithoutHistory) {
    await seedHistoryIfMissing(complaint.id, complaint.user_id, complaint.status, complaint.created_at);
  }

  console.log('MariaDB schema is ready.');
}

export default db;
