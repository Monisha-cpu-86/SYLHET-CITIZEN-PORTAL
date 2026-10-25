import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import db from '../db.js';
import { publishReportEvent } from '../events.js';
import { requireAuth, loadAuthenticatedUser } from '../middleware/auth.js';
import { SCC_PRIORITIES, SCC_REPORT_CATEGORIES, SCC_WARDS, isWithinSccBounds } from '../../../shared/sylhet.js';
import { readReportImage, removeReportImage, storeReportImage } from '../services/photos.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 16, fieldSize: 12 * 1024 },
});

async function getComplaintForUser(id, userId) {
  const [rows] = await db.execute(
    `SELECT c.*, COALESCE(c.report_code, CONCAT('SCC-', YEAR(c.created_at), '-', LPAD(c.id, 6, '0'))) AS report_code
     FROM complaints c WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL`,
    [id, userId],
  );
  return rows[0];
}

async function attachCitizenDetails(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [history] = await db.execute(
    `SELECT complaint_id, from_status, to_status, public_note, created_at
     FROM complaint_status_history WHERE complaint_id IN (${placeholders}) ORDER BY created_at, id`,
    ids,
  );
  const [photos] = await db.execute(
    `SELECT id, complaint_id, mime_type, file_size, width, height, photo_kind
     FROM complaint_photos WHERE complaint_id IN (${placeholders}) ORDER BY created_at, id`,
    ids,
  );
  const historyByComplaint = new Map();
  const photosByComplaint = new Map();
  for (const entry of history) {
    const collection = historyByComplaint.get(entry.complaint_id) || [];
    collection.push(entry);
    historyByComplaint.set(entry.complaint_id, collection);
  }
  for (const photo of photos) {
    const collection = photosByComplaint.get(photo.complaint_id) || [];
    collection.push(photo);
    photosByComplaint.set(photo.complaint_id, collection);
  }
  return rows.map((row) => {
    const {
      internal_notes,
      idempotency_key,
      demo_key,
      deleted_at,
      assigned_to,
      ...citizenVisibleReport
    } = row;
    return {
    ...citizenVisibleReport,
    outsideSccBounds: row.latitude !== null && row.longitude !== null
      ? !isWithinSccBounds(Number(row.latitude), Number(row.longitude))
      : false,
    history: historyByComplaint.get(row.id) || [],
    photos: photosByComplaint.get(row.id) || [],
  };
  });
}

router.use(loadAuthenticatedUser);

router.post('/', requireAuth, upload.array('photos', 3), async (req, res, next) => {
  const storedPhotos = [];
  let connection;
  try {
    const { type, description, ward, priority = 'normal', latitude, longitude, locationText, locationNotShared = false } = req.body;
    if (typeof type !== 'string' || !SCC_REPORT_CATEGORIES.includes(type)) {
      return res.status(400).json({ message: 'Select a valid SCC report category.' });
    }
    if (typeof description !== 'string' || description.trim().length < 8 || description.trim().length > 4000) {
      return res.status(400).json({ message: 'Description must be between 8 and 4,000 characters.' });
    }
    if (!SCC_WARDS.includes(ward)) {
      return res.status(400).json({ message: 'Select a valid Sylhet City Corporation ward.' });
    }
    if (!SCC_PRIORITIES.includes(priority)) {
      return res.status(400).json({ message: 'Select a valid report priority.' });
    }
    const privacyOptOut = locationNotShared === true || locationNotShared === 'true';
    const hasCoordinates = latitude !== undefined && latitude !== '' && longitude !== undefined && longitude !== '';
    if (!hasCoordinates && !privacyOptOut) {
      return res.status(400).json({ message: 'Share a map location or select the option to describe it without sharing your location.' });
    }
    let parsedLatitude = null;
    let parsedLongitude = null;
    if (hasCoordinates) {
      parsedLatitude = Number(latitude);
      parsedLongitude = Number(longitude);
      if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
        || parsedLatitude < -90 || parsedLatitude > 90 || parsedLongitude < -180 || parsedLongitude > 180) {
        return res.status(400).json({ message: 'Enter valid map coordinates.' });
      }
    }
    if (locationText !== undefined && (typeof locationText !== 'string' || locationText.trim().length > 500)) {
      return res.status(400).json({ message: 'Location description must be 500 characters or fewer.' });
    }

    const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || randomUUID()).slice(0, 80);
    const [previous] = await db.execute(
      'SELECT id FROM complaints WHERE user_id = ? AND idempotency_key = ?',
      [req.user.id, idempotencyKey],
    );
    if (previous.length > 0) {
      const existing = await getComplaintForUser(previous[0].id, req.user.id);
      return res.status(200).json((await attachCitizenDetails([existing]))[0]);
    }

    const [recent] = await db.execute(
      'SELECT COUNT(*) AS count FROM complaints WHERE user_id = ? AND created_at >= NOW() - INTERVAL 1 DAY',
      [req.user.id],
    );
    if (Number(recent[0].count) >= 10) {
      return res.status(429).json({ message: 'You have reached the daily limit of 10 reports. Please try again tomorrow.' });
    }

    for (const file of req.files || []) storedPhotos.push(await storeReportImage(file));
    connection = await db.getConnection();
    await connection.beginTransaction();
    const now = new Date();
    const [result] = await connection.execute(
      `INSERT INTO complaints
        (user_id, type, ward, description, status, priority, latitude, longitude, location_text,
         location_not_shared, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, type, ward, description.trim(), priority, parsedLatitude, parsedLongitude,
        locationText?.trim() || null, privacyOptOut && !hasCoordinates, idempotencyKey, now, now,
      ],
    );
    const complaintId = result.insertId;
    const reportCode = `SCC-${now.getFullYear()}-${String(complaintId).padStart(6, '0')}`;
    await connection.execute('UPDATE complaints SET report_code = ? WHERE id = ?', [reportCode, complaintId]);
    await connection.execute(
      `INSERT INTO complaint_status_history (complaint_id, changed_by, from_status, to_status, created_at)
       VALUES (?, ?, NULL, 'submitted', ?)`,
      [complaintId, req.user.id, now],
    );
    for (const photo of storedPhotos) {
      await connection.execute(
        `INSERT INTO complaint_photos (complaint_id, file_name, mime_type, file_size, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [complaintId, photo.fileName, photo.mimeType, photo.fileSize, photo.width, photo.height, now],
      );
    }
    await connection.execute(
      'INSERT INTO audit_log (actor_id, complaint_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, complaintId, 'report.submitted', JSON.stringify({ ward, priority, photos: storedPhotos.length }), now],
    );
    await connection.commit();
    const created = await getComplaintForUser(complaintId, req.user.id);
    const response = (await attachCitizenDetails([created]))[0];
    publishReportEvent({ type: 'report.created', reportCode, complaintId });
    res.status(201).json(response);
  } catch (error) {
    if (connection) await connection.rollback();
    for (const photo of storedPhotos) await removeReportImage(photo.fileName);
    if (error.code === 'ER_DUP_ENTRY' && req.get('Idempotency-Key')) {
      const [rows] = await db.execute(
        'SELECT id FROM complaints WHERE user_id = ? AND idempotency_key = ?',
        [req.user.id, req.get('Idempotency-Key')],
      );
      if (rows.length > 0) {
        const existing = await getComplaintForUser(rows[0].id, req.user.id);
        return res.status(200).json((await attachCitizenDetails([existing]))[0]);
      }
    }
    next(error);
  } finally {
    connection?.release();
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, complaint_id, message, read_at, created_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.patch('/notifications/:id/read', async (req, res, next) => {
  try {
    await db.execute(
      'UPDATE notifications SET read_at = NOW(3) WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id],
    );
    res.json({ message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
});

router.get('/photos/:photoId', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT p.file_name, p.mime_type, c.user_id
       FROM complaint_photos p JOIN complaints c ON c.id = p.complaint_id
       WHERE p.id = ? AND c.deleted_at IS NULL`,
      [req.params.photoId],
    );
    const photo = rows[0];
    if (!photo) return res.status(404).json({ message: 'Photo not found.' });
    if (photo.user_id !== req.user.id && !['super_admin', 'scc_officer', 'viewer'].includes(req.user.role)) {
      return res.status(404).json({ message: 'Photo not found.' });
    }
    const image = await readReportImage(photo.file_name);
    res.set('Cache-Control', 'private, no-store');
    res.type(photo.mime_type).send(image);
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const [rows] = await db.execute(
      `SELECT c.*, COALESCE(c.report_code, CONCAT('SCC-', YEAR(c.created_at), '-', LPAD(c.id, 6, '0'))) AS report_code
       FROM complaints c WHERE c.user_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset],
    );
    const [countRows] = await db.execute(
      'SELECT COUNT(*) AS total FROM complaints WHERE user_id = ? AND deleted_at IS NULL',
      [req.user.id],
    );
    res.json({ items: await attachCitizenDetails(rows), page, limit, total: Number(countRows[0].total) });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const complaint = await getComplaintForUser(req.params.id, req.user.id);
    if (!complaint) return res.status(404).json({ message: 'Report not found.' });
    res.json((await attachCitizenDetails([complaint]))[0]);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', (req, res) => {
  res.status(403).json({ message: 'Only authorized SCC staff can change a report status.' });
});

router.post('/:id/confirm-resolution', async (req, res, next) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, status FROM complaints WHERE id = ? AND user_id = ? AND deleted_at IS NULL FOR UPDATE',
      [req.params.id, req.user.id],
    );
    const complaint = rows[0];
    if (!complaint) {
      await connection.rollback();
      return res.status(404).json({ message: 'Report not found.' });
    }
    if (complaint.status !== 'resolved') {
      await connection.rollback();
      return res.status(409).json({ message: 'Only a report marked resolved by SCC can be confirmed.' });
    }
    const now = new Date();
    await connection.execute(
      'UPDATE complaints SET status = ?, confirmed_resolved_at = ?, updated_at = ? WHERE id = ?',
      ['confirmed_resolved', now, now, complaint.id],
    );
    await connection.execute(
      `INSERT INTO complaint_status_history (complaint_id, changed_by, from_status, to_status, public_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [complaint.id, req.user.id, 'resolved', 'confirmed_resolved', 'Citizen confirmed the issue is resolved.', now],
    );
    await connection.execute(
      'INSERT INTO audit_log (actor_id, complaint_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, complaint.id, 'report.resolution_confirmed', JSON.stringify({}), now],
    );
    await connection.commit();
    publishReportEvent({ type: 'report.updated', complaintId: complaint.id });
    const updated = await getComplaintForUser(complaint.id, req.user.id);
    res.json((await attachCitizenDetails([updated]))[0]);
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post('/:id/reopen', async (req, res, next) => {
  const reason = req.body?.reason;
  if (typeof reason !== 'string' || reason.trim().length < 8 || reason.trim().length > 1000) {
    return res.status(400).json({ message: 'Please provide a reason between 8 and 1,000 characters.' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, status, assigned_to, report_code FROM complaints WHERE id = ? AND user_id = ? AND deleted_at IS NULL FOR UPDATE',
      [req.params.id, req.user.id],
    );
    const complaint = rows[0];
    if (!complaint) {
      await connection.rollback();
      return res.status(404).json({ message: 'Report not found.' });
    }
    if (!['resolved', 'confirmed_resolved'].includes(complaint.status)) {
      await connection.rollback();
      return res.status(409).json({ message: 'Only a report marked resolved by SCC can be reopened.' });
    }
    const now = new Date();
    await connection.execute(
      'UPDATE complaints SET status = ?, reopen_reason = ?, resolved_at = NULL, confirmed_resolved_at = NULL, updated_at = ? WHERE id = ?',
      ['reopened', reason.trim(), now, complaint.id],
    );
    await connection.execute(
      `INSERT INTO complaint_status_history (complaint_id, changed_by, from_status, to_status, public_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [complaint.id, req.user.id, complaint.status, 'reopened', reason.trim(), now],
    );
    await connection.execute(
      'INSERT INTO audit_log (actor_id, complaint_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, complaint.id, 'report.reopened', JSON.stringify({ reason: reason.trim() }), now],
    );
    if (complaint.assigned_to) {
      await connection.execute(
        'INSERT INTO notifications (user_id, complaint_id, message, created_at) VALUES (?, ?, ?, ?)',
        [complaint.assigned_to, complaint.id, `Citizen reopened report ${complaint.report_code}.`, now],
      );
    }
    await connection.commit();
    publishReportEvent({ type: 'report.updated', complaintId: complaint.id });
    const updated = await getComplaintForUser(complaint.id, req.user.id);
    res.json((await attachCitizenDetails([updated]))[0]);
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
