import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { addAdminClient, publishReportEvent } from '../events.js';
import { loadAuthenticatedUser, requireRoles } from '../middleware/auth.js';
import { SCC_DEPARTMENTS, SCC_PRIORITIES, REPORT_STATUSES } from '../../../shared/sylhet.js';

const router = Router();
const adminRoles = ['super_admin', 'scc_officer', 'viewer'];
const writableRoles = ['super_admin', 'scc_officer'];

router.use(loadAuthenticatedUser, requireRoles(...adminRoles));

router.get('/events', (req, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  addAdminClient(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  res.on('close', () => clearInterval(heartbeat));
});

router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.user.role === 'viewer') {
    return res.status(403).json({ message: 'Viewer accounts have read-only access.' });
  }
  next();
});

router.get('/overview', async (req, res, next) => {
  try {
    const [counts] = await db.execute(
      `SELECT COUNT(*) AS total,
        SUM(DATE(created_at) = CURRENT_DATE()) AS newToday,
        SUM(status IN ('submitted', 'open', 'acknowledged', 'reopened')) AS newReports,
        SUM(status = 'in_progress') AS inProgress,
        SUM(status IN ('resolved', 'confirmed_resolved')) AS resolved,
        SUM(due_at < NOW(3) AND status NOT IN ('resolved', 'confirmed_resolved', 'rejected')) AS overdue,
        AVG(CASE WHEN status IN ('resolved', 'confirmed_resolved') AND resolved_at IS NOT NULL
          THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END) AS avgResolutionHours
       FROM complaints WHERE deleted_at IS NULL`,
    );
    const [byCategory] = await db.execute(
      'SELECT type AS name, COUNT(*) AS value FROM complaints WHERE deleted_at IS NULL GROUP BY type ORDER BY value DESC',
    );
    const [byWard] = await db.execute(
      `SELECT COALESCE(ward, 'Unassigned') AS name, COUNT(*) AS value
       FROM complaints WHERE deleted_at IS NULL GROUP BY ward ORDER BY value DESC`,
    );
    const [byStatus] = await db.execute(
      'SELECT status AS name, COUNT(*) AS value FROM complaints WHERE deleted_at IS NULL GROUP BY status ORDER BY value DESC',
    );
    const [dailyTrend] = await db.execute(
      `SELECT DATE(created_at) AS day, COUNT(*) AS value FROM complaints
       WHERE created_at >= CURRENT_DATE() - INTERVAL 13 DAY AND deleted_at IS NULL
       GROUP BY DATE(created_at) ORDER BY day`,
    );
    const count = counts[0];
    res.json({
      total: Number(count.total || 0),
      newToday: Number(count.newToday || 0),
      newReports: Number(count.newReports || 0),
      inProgress: Number(count.inProgress || 0),
      resolved: Number(count.resolved || 0),
      overdue: Number(count.overdue || 0),
      avgResolutionHours: count.avgResolutionHours === null ? null : Number(count.avgResolutionHours),
      byCategory: byCategory.map((row) => ({ ...row, value: Number(row.value) })),
      byWard: byWard.map((row) => ({ ...row, value: Number(row.value) })),
      byStatus: byStatus.map((row) => ({ ...row, value: Number(row.value) })),
      dailyTrend: dailyTrend.map((row) => ({ day: row.day, value: Number(row.value) })),
    });
  } catch (error) {
    next(error);
  }
});

function buildReportFilters(query) {
  const conditions = ['c.deleted_at IS NULL'];
  const params = [];
  for (const key of ['status', 'type', 'ward', 'priority', 'assigned_department']) {
    if (typeof query[key] === 'string' && query[key]) {
      conditions.push(`c.${key} = ?`);
      params.push(query[key]);
    }
  }
  if (typeof query.search === 'string' && query.search.trim()) {
    const term = `%${query.search.trim().slice(0, 100)}%`;
    conditions.push('(c.report_code LIKE ? OR c.description LIKE ? OR c.location_text LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    params.push(term, term, term, term, term);
  }
  if (query.from) {
    conditions.push('c.created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('c.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(query.to);
  }
  return { sql: conditions.join(' AND '), params };
}

router.get('/reports/export.csv', async (req, res, next) => {
  try {
    const { sql, params } = buildReportFilters(req.query);
    const [rows] = await db.execute(
      `SELECT c.report_code, c.type, c.ward, c.status, c.priority, c.created_at, c.due_at,
        c.latitude, c.longitude, c.location_text, u.name AS citizen_name, u.email AS citizen_email,
        c.assigned_department, c.public_response
       FROM complaints c JOIN users u ON u.id = c.user_id WHERE ${sql}
       ORDER BY c.created_at DESC LIMIT 10000`,
      params,
    );
    const columns = ['report_code', 'type', 'ward', 'status', 'priority', 'created_at', 'due_at', 'latitude', 'longitude', 'location_text', 'citizen_name', 'citizen_email', 'assigned_department', 'public_response'];
    const escape = (value) => {
      const text = String(value ?? '');
      const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replace(/"/g, '""')}"`;
    };
    const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\r\n');
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="scc-reports.csv"',
      'Cache-Control': 'no-store',
    });
    res.send(`\uFEFF${csv}`);
  } catch (error) {
    next(error);
  }
});

router.get('/reports', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const { sql, params } = buildReportFilters(req.query);
    const allowedSortColumns = {
      created_at: 'c.created_at',
      report_code: 'c.report_code',
      status: 'c.status',
      ward: 'c.ward',
      priority: 'c.priority',
    };
    const sort = allowedSortColumns[req.query.sort] || 'c.created_at';
    const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';
    const [rows] = await db.execute(
      `SELECT c.id, c.report_code, c.user_id, u.name AS citizen_name, u.email AS citizen_email,
        c.type, c.ward, c.description, c.status, c.priority, c.latitude, c.longitude,
        c.location_text, c.location_not_shared, c.public_response, c.internal_notes, c.due_at,
        c.assigned_department, c.assigned_to, staff.name AS assigned_name, c.created_at, c.updated_at,
        (c.due_at < NOW(3) AND c.status NOT IN ('resolved', 'confirmed_resolved', 'rejected')) AS is_overdue
       FROM complaints c JOIN users u ON u.id = c.user_id
       LEFT JOIN users staff ON staff.id = c.assigned_to
       WHERE ${sql} ORDER BY ${sort} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total FROM complaints c JOIN users u ON u.id = c.user_id WHERE ${sql}`,
      params,
    );
    res.json({
      items: req.user.role === 'viewer'
        ? rows.map(({ internal_notes, ...row }) => row)
        : rows,
      page,
      limit,
      total: Number(countRows[0].total),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/:id', async (req, res, next) => {
  try {
    const [reports] = await db.execute(
      `SELECT c.*, u.name AS citizen_name, u.email AS citizen_email,
        staff.name AS assigned_name,
        (c.due_at < NOW(3) AND c.status NOT IN ('resolved', 'confirmed_resolved', 'rejected')) AS is_overdue
       FROM complaints c JOIN users u ON u.id = c.user_id
       LEFT JOIN users staff ON staff.id = c.assigned_to
       WHERE c.id = ? AND c.deleted_at IS NULL`,
      [req.params.id],
    );
    const report = reports[0];
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    const [history] = await db.execute(
      `SELECT h.*, u.name AS changed_by_name FROM complaint_status_history h
       LEFT JOIN users u ON u.id = h.changed_by WHERE h.complaint_id = ? ORDER BY h.created_at, h.id`,
      [report.id],
    );
    const [photos] = await db.execute(
      'SELECT id, mime_type, file_size, width, height, photo_kind, created_at FROM complaint_photos WHERE complaint_id = ? ORDER BY created_at',
      [report.id],
    );
    if (req.user.role === 'viewer') {
      delete report.internal_notes;
      for (const event of history) delete event.internal_note;
    }
    res.json({ ...report, history, photos });
  } catch (error) {
    next(error);
  }
});

router.patch('/reports/:id', requireRoles('super_admin', 'scc_officer'), async (req, res, next) => {
  const allowed = new Set(['status', 'priority', 'assigned_department', 'assigned_to', 'internal_notes', 'public_response', 'resolutionDays', 'dueAt']);
  const supplied = Object.keys(req.body || {});
  if (supplied.length === 0 || supplied.some((key) => !allowed.has(key))) {
    return res.status(400).json({ message: 'The request contains unsupported report fields.' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM complaints WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    const report = rows[0];
    if (!report) {
      await connection.rollback();
      return res.status(404).json({ message: 'Report not found.' });
    }

    const updates = {};
    if ('status' in req.body) {
      if (!REPORT_STATUSES.includes(req.body.status)) {
        await connection.rollback();
        return res.status(400).json({ message: 'Select a valid report status.' });
      }
      if (req.body.status === 'confirmed_resolved') {
        await connection.rollback();
        return res.status(400).json({ message: 'Only the reporting citizen can confirm a resolution.' });
      }
      updates.status = req.body.status;
    }
    if ('priority' in req.body) {
      if (!SCC_PRIORITIES.includes(req.body.priority)) {
        await connection.rollback();
        return res.status(400).json({ message: 'Select a valid report priority.' });
      }
      updates.priority = req.body.priority;
    }
    if ('assigned_department' in req.body) {
      if (req.body.assigned_department && !SCC_DEPARTMENTS.includes(req.body.assigned_department)) {
        await connection.rollback();
        return res.status(400).json({ message: 'Select a valid SCC department.' });
      }
      updates.assigned_department = req.body.assigned_department || null;
    }
    if ('assigned_to' in req.body) {
      if (req.body.assigned_to === null || req.body.assigned_to === '') {
        updates.assigned_to = null;
      } else {
        const [staff] = await connection.execute(
          `SELECT id FROM users WHERE id = ? AND role IN ('scc_officer', 'super_admin') AND deleted_at IS NULL`,
          [req.body.assigned_to],
        );
        if (staff.length === 0) {
          await connection.rollback();
          return res.status(400).json({ message: 'Assign the report to an active SCC officer.' });
        }
        updates.assigned_to = staff[0].id;
      }
    }
    if ('internal_notes' in req.body) {
      if (typeof req.body.internal_notes !== 'string' || req.body.internal_notes.length > 10000) {
        await connection.rollback();
        return res.status(400).json({ message: 'Internal notes must be 10,000 characters or fewer.' });
      }
      updates.internal_notes = req.body.internal_notes.trim() || null;
    }
    if ('public_response' in req.body) {
      if (typeof req.body.public_response !== 'string' || (req.body.public_response.trim() && req.body.public_response.trim().length < 8)
        || req.body.public_response.length > 4000) {
        await connection.rollback();
        return res.status(400).json({ message: 'Public response must be empty or between 8 and 4,000 characters.' });
      }
      updates.public_response = req.body.public_response.trim() || null;
      updates.response_updated_at = updates.public_response ? new Date() : null;
    }
    if ('resolutionDays' in req.body) {
      const days = Number(req.body.resolutionDays);
      if (![1, 2, 3, 5, 7, 14].includes(days)) {
        await connection.rollback();
        return res.status(400).json({ message: 'Choose a supported resolution estimate or set a custom due date.' });
      }
      updates.due_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    if ('dueAt' in req.body) {
      if (req.body.dueAt === null || req.body.dueAt === '') {
        updates.due_at = null;
      } else {
      const dueAt = new Date(req.body.dueAt);
      if (Number.isNaN(dueAt.getTime())) {
        await connection.rollback();
        return res.status(400).json({ message: 'Enter a valid custom due date.' });
      }
      updates.due_at = dueAt;
      }
    }
    updates.updated_at = new Date();
    if (updates.status && updates.status !== report.status) {
      updates.resolved_at = updates.status === 'resolved'
        ? updates.updated_at
        : null;
      updates.confirmed_resolved_at = null;
    }
    const assignments = Object.keys(updates).map((key) => `\`${key}\` = ?`).join(', ');
    await connection.execute(
      `UPDATE complaints SET ${assignments} WHERE id = ?`,
      [...Object.values(updates), report.id],
    );
    const statusChanged = Boolean(updates.status && updates.status !== report.status);
    const publicResponseChanged = updates.public_response !== undefined
      && updates.public_response !== (report.public_response || null);
    if (statusChanged) {
      const publicNote = publicResponseChanged ? updates.public_response : report.public_response;
      await connection.execute(
        `INSERT INTO complaint_status_history
          (complaint_id, changed_by, from_status, to_status, public_note, internal_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [report.id, req.user.id, report.status, updates.status, publicNote || null, updates.internal_notes || null, updates.updated_at],
      );
      await connection.execute(
        'INSERT INTO notifications (user_id, complaint_id, message, created_at) VALUES (?, ?, ?, ?)',
        [report.user_id, report.id, `Your SCC report ${report.report_code} status changed to ${updates.status.replaceAll('_', ' ')}.`, updates.updated_at],
      );
    } else if (publicResponseChanged && updates.public_response) {
      await connection.execute(
        `INSERT INTO complaint_status_history
          (complaint_id, changed_by, from_status, to_status, public_note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [report.id, req.user.id, report.status, report.status, updates.public_response, updates.updated_at],
      );
      await connection.execute(
        'INSERT INTO notifications (user_id, complaint_id, message, created_at) VALUES (?, ?, ?, ?)',
        [report.user_id, report.id, `SCC has responded to report ${report.report_code}.`, updates.updated_at],
      );
    }
    await connection.execute(
      'INSERT INTO audit_log (actor_id, complaint_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, report.id, 'report.updated', JSON.stringify({ fields: Object.keys(updates) }), updates.updated_at],
    );
    await connection.commit();
    const [updated] = await db.execute('SELECT * FROM complaints WHERE id = ?', [report.id]);
    publishReportEvent({ type: 'report.updated', complaintId: report.id, reportCode: report.report_code });
    res.json(updated[0]);
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch('/reports/bulk/status', requireRoles('super_admin', 'scc_officer'), async (req, res, next) => {
  const { ids, status } = req.body || {};
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !REPORT_STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Provide 1–100 report IDs and a valid status.' });
  }
  if (status === 'confirmed_resolved') {
    return res.status(400).json({ message: 'Only reporting citizens can confirm report resolutions.' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    for (const id of ids) {
      const [rows] = await connection.execute('SELECT id, user_id, status, report_code FROM complaints WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id]);
      if (rows.length === 0) continue;
      const report = rows[0];
      if (report.status === status) continue;
      const now = new Date();
      await connection.execute(
        `UPDATE complaints SET status = ?, resolved_at = ?,
          confirmed_resolved_at = NULL, updated_at = ?
         WHERE id = ?`,
        [status, status === 'resolved' ? now : null, now, report.id],
      );
      await connection.execute(
        `INSERT INTO complaint_status_history (complaint_id, changed_by, from_status, to_status, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [report.id, req.user.id, report.status, status, now],
      );
      await connection.execute(
        'INSERT INTO notifications (user_id, complaint_id, message, created_at) VALUES (?, ?, ?, ?)',
        [report.user_id, report.id, `Your SCC report ${report.report_code} status changed to ${status.replaceAll('_', ' ')}.`, now],
      );
      await connection.execute(
        'INSERT INTO audit_log (actor_id, complaint_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, report.id, 'report.bulk_status_updated', JSON.stringify({ status }), now],
      );
    }
    await connection.commit();
    publishReportEvent({ type: 'report.updated', complaintIds: ids });
    res.json({ message: 'Selected reports updated.' });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.get('/staff', requireRoles('super_admin'), async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, email, role, department, created_at FROM users
       WHERE role IN ('super_admin', 'scc_officer', 'viewer') AND deleted_at IS NULL ORDER BY role, name`,
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/staff', requireRoles('super_admin'), async (req, res, next) => {
  const { name, email, password, role, department } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    || typeof password !== 'string' || password.length < 12 || password.length > 128
    || !['scc_officer', 'viewer'].includes(role)
    || (department && !SCC_DEPARTMENTS.includes(department))) {
    return res.status(400).json({ message: 'Provide a valid name, email, 12+ character password, staff role, and SCC department.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(
      'INSERT INTO users (email, name, password_hash, role, department) VALUES (?, ?, ?, ?, ?)',
      [email.trim().toLowerCase(), name.trim(), passwordHash, role, department || null],
    );
    await db.execute(
      'INSERT INTO audit_log (actor_id, action, details, created_at) VALUES (?, ?, ?, NOW(3))',
      [req.user.id, 'staff.created', JSON.stringify({ userId: result.insertId, role, department: department || null })],
    );
    res.status(201).json({ id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), role, department: department || null });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'An account with this email already exists.' });
    next(error);
  }
});

router.get('/audit-log', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const [rows] = await db.execute(
      `SELECT a.id, a.complaint_id, c.report_code, a.action, a.details, a.created_at, u.name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN complaints c ON c.id = a.complaint_id
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      [limit],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/duplicate-candidates', async (req, res, next) => {
  try {
    const [reports] = await db.execute(
      `SELECT id, report_code, type, ward, latitude, longitude, created_at
       FROM complaints WHERE deleted_at IS NULL AND latitude IS NOT NULL
         AND created_at >= NOW() - INTERVAL 7 DAY
       ORDER BY created_at DESC LIMIT 500`,
    );
    const candidates = [];
    const radians = (degrees) => degrees * Math.PI / 180;
    for (let left = 0; left < reports.length; left += 1) {
      for (let right = left + 1; right < reports.length; right += 1) {
        const first = reports[left];
        const second = reports[right];
        if (first.type !== second.type || first.id === second.id) continue;
        const latitudeDelta = radians(Number(second.latitude) - Number(first.latitude));
        const longitudeDelta = radians(Number(second.longitude) - Number(first.longitude));
        const a = Math.sin(latitudeDelta / 2) ** 2
          + Math.cos(radians(Number(first.latitude))) * Math.cos(radians(Number(second.latitude)))
          * Math.sin(longitudeDelta / 2) ** 2;
        const distanceMeters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (distanceMeters <= 50) candidates.push({ first, second, distanceMeters: Math.round(distanceMeters) });
      }
    }
    res.json(candidates.slice(0, 100));
  } catch (error) {
    next(error);
  }
});

export default router;
