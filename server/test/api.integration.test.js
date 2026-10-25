import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import db from '../src/db.js';
import { CLIENT_ORIGIN } from '../src/config/env.js';
import { SCC_REPORT_CATEGORIES } from '../../shared/sylhet.js';

const citizens = [
  { id: 1, email: 'demo@example.com', name: 'Demo User', password: 'demo123', role: 'citizen', department: null },
  { id: 2, email: 'ayesha@example.com', name: 'Ayesha Rahman', password: 'ayesha123', role: 'citizen', department: null },
  { id: 3, email: 'tanvir@example.com', name: 'Tanvir Hasan', password: 'tanvir123', role: 'citizen', department: null },
];
const admin = {
  id: 4,
  email: 'admin@scc.local',
  name: 'SCC Super Admin',
  password: 'SCCadmin2026!',
  role: 'super_admin',
  department: null,
};

let users;
let complaints;
let history;
let sessions;
let nextComplaintId;
let nextHistoryId;

const originalExecute = db.execute;
const originalGetConnection = db.getConnection;

function userSafe(user) {
  if (!user) return undefined;
  const { id, email, name, role, department } = user;
  return { id, email, name, role, department };
}

function executeResult(rows = [], result = {}) {
  return [rows, result];
}

function writeResult(result = {}) {
  return [result, undefined];
}

function createMockConnection() {
  return {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      if (query.startsWith('SELECT * FROM complaints WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) {
        const complaint = complaints.find((entry) => entry.id === Number(params[0]) && !entry.deleted_at);
        return executeResult(complaint ? [{ ...complaint }] : []);
      }
      if (query.startsWith('UPDATE complaints SET report_code = ? WHERE id = ?')) {
        const complaint = complaints.find((entry) => entry.id === Number(params[1]));
        complaint.report_code = params[0];
        return writeResult({ affectedRows: 1 });
      }
      if (query.startsWith('UPDATE complaints SET ')) {
        const fields = [...query.matchAll(/`([^`]+)` = \?/g)].map((match) => match[1]);
        const complaintId = Number(params[params.length - 1]);
        const complaint = complaints.find((entry) => entry.id === complaintId);
        assert.ok(complaint, `Expected complaint ${complaintId} to exist`);
        fields.forEach((field, index) => { complaint[field] = params[index]; });
        return writeResult({ affectedRows: 1 });
      }
      if (query.startsWith('INSERT INTO complaints')) {
        const [user_id, type, ward, description, priority, latitude, longitude, location_text, location_not_shared, idempotency_key, created_at, updated_at] = params;
        const complaint = {
          id: nextComplaintId++,
          user_id,
          type,
          ward,
          description,
          status: 'submitted',
          priority,
          latitude,
          longitude,
          location_text,
          location_not_shared,
          idempotency_key,
          created_at,
          updated_at,
          report_code: null,
          public_response: null,
          internal_notes: null,
          due_at: null,
          assigned_department: null,
          assigned_to: null,
          deleted_at: null,
        };
        complaints.push(complaint);
        return writeResult({ insertId: complaint.id });
      }
      if (query.startsWith('INSERT INTO complaint_status_history')) {
        const [complaint_id, changed_by, from_status, to_status, ...rest] = params;
        const includesPublicNote = query.includes('public_note');
        history.push({
          id: nextHistoryId++,
          complaint_id,
          changed_by,
          from_status,
          to_status,
          public_note: includesPublicNote ? rest[0] || null : null,
          internal_note: includesPublicNote && rest.length > 2 ? rest[1] : null,
          created_at: rest[rest.length - 1],
        });
        return writeResult({ insertId: nextHistoryId - 1 });
      }
      if (query.startsWith('INSERT INTO notifications') || query.startsWith('INSERT INTO audit_log')) {
        return writeResult({ insertId: 1 });
      }
      throw new Error(`Unexpected transactional query: ${query}`);
    },
  };
}

async function mockExecute(sql, params = []) {
  const query = sql.replace(/\s+/g, ' ').trim();
  if (query.startsWith('SELECT session_data, expires_at FROM sessions WHERE session_id = ?')) {
    const stored = sessions.get(params[0]);
    return executeResult(stored ? [{ session_data: stored.session_data, expires_at: stored.expires_at }] : []);
  }
  if (query.startsWith('INSERT INTO sessions')) {
    sessions.set(params[0], { session_data: params[1], expires_at: params[2] });
    return executeResult([], { affectedRows: 1 });
  }
  if (query.startsWith('DELETE FROM sessions WHERE session_id = ?')) {
    sessions.delete(params[0]);
    return executeResult([], { affectedRows: 1 });
  }
  if (query.startsWith('UPDATE sessions SET expires_at = ? WHERE session_id = ?')) {
    const stored = sessions.get(params[1]);
    if (stored) stored.expires_at = params[0];
    return executeResult([], { affectedRows: stored ? 1 : 0 });
  }
  if (query.startsWith('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL')) {
    const user = users.find((entry) => entry.email === params[0]);
    return executeResult(user ? [{ ...user }] : []);
  }
  if (query.startsWith('SELECT id, email, name, role, department FROM users WHERE id = ?')) {
    const user = users.find((entry) => entry.id === Number(params[0]));
    return executeResult(user ? [userSafe(user)] : []);
  }
  if (query.startsWith('SELECT id FROM complaints WHERE user_id = ? AND idempotency_key = ?')) {
    const complaint = complaints.find((entry) => entry.user_id === Number(params[0]) && entry.idempotency_key === params[1]);
    return executeResult(complaint ? [{ id: complaint.id }] : []);
  }
  if (query.startsWith('SELECT COUNT(*) AS count FROM complaints WHERE user_id = ? AND created_at')) {
    const count = complaints.filter((entry) => entry.user_id === Number(params[0])).length;
    return executeResult([{ count }]);
  }
  if (query.startsWith('INSERT INTO complaints')) {
    const [user_id, type, ward, description, priority, latitude, longitude, location_text, location_not_shared, idempotency_key, created_at, updated_at] = params;
    const complaint = {
      id: nextComplaintId++,
      user_id,
      type,
      ward,
      description,
      status: 'submitted',
      priority,
      latitude,
      longitude,
      location_text,
      location_not_shared,
      idempotency_key,
      created_at,
      updated_at,
      report_code: null,
      public_response: null,
      internal_notes: null,
      due_at: null,
      assigned_department: null,
      assigned_to: null,
      deleted_at: null,
    };
    complaints.push(complaint);
    return executeResult([], { insertId: complaint.id });
  }
  if (query.startsWith('UPDATE complaints SET report_code = ? WHERE id = ?')) {
    const complaint = complaints.find((entry) => entry.id === Number(params[1]));
    complaint.report_code = params[0];
    return executeResult([], { affectedRows: 1 });
  }
  if (query.startsWith('INSERT INTO complaint_status_history')) {
    const [complaint_id, changed_by, from_status, to_status, created_at] = params;
    history.push({ id: nextHistoryId++, complaint_id, changed_by, from_status, to_status, public_note: null, created_at });
    return executeResult([], { insertId: nextHistoryId - 1 });
  }
  if (query.startsWith('SELECT complaint_id, from_status, to_status, public_note, created_at FROM complaint_status_history')) {
    return executeResult(history.filter((entry) => params.map(Number).includes(entry.complaint_id)));
  }
  if (query.startsWith('SELECT id, complaint_id, mime_type, file_size, width, height, photo_kind FROM complaint_photos')) {
    return executeResult([]);
  }
  if (query.startsWith('SELECT c.*, COALESCE(c.report_code') && query.includes('WHERE c.id = ? AND c.user_id = ?')) {
    const complaint = complaints.find((entry) => entry.id === Number(params[0])
      && entry.user_id === Number(params[1]) && !entry.deleted_at);
    return executeResult(complaint ? [{ ...complaint }] : []);
  }
  if (query.startsWith('SELECT c.*, COALESCE(c.report_code') && query.includes('WHERE c.user_id = ?')) {
    const [userId, limit, offset] = params.map(Number);
    const rows = complaints.filter((entry) => entry.user_id === userId && !entry.deleted_at)
      .sort((left, right) => right.created_at - left.created_at)
      .slice(offset, offset + limit);
    return executeResult(rows.map((entry) => ({ ...entry })));
  }
  if (query.startsWith('SELECT COUNT(*) AS total FROM complaints WHERE user_id = ?')) {
    return executeResult([{ total: complaints.filter((entry) => entry.user_id === Number(params[0]) && !entry.deleted_at).length }]);
  }
  if (query.startsWith('SELECT c.id, c.report_code, c.user_id, u.name AS citizen_name')) {
    return executeResult(complaints.filter((entry) => !entry.deleted_at).map((entry) => {
      const citizen = users.find((user) => user.id === entry.user_id);
      return {
        ...entry,
        citizen_name: citizen.name,
        citizen_email: citizen.email,
        is_overdue: 0,
      };
    }).slice(0, Number(params[params.length - 2])));
  }
  if (query.startsWith('SELECT COUNT(*) AS total FROM complaints c JOIN users u')) {
    return executeResult([{ total: complaints.filter((entry) => !entry.deleted_at).length }]);
  }
  if (query.startsWith('SELECT c.*, u.name AS citizen_name, u.email AS citizen_email')) {
    const complaint = complaints.find((entry) => entry.id === Number(params[0]) && !entry.deleted_at);
    if (!complaint) return executeResult([]);
    const citizen = users.find((user) => user.id === complaint.user_id);
    return executeResult([{ ...complaint, citizen_name: citizen.name, citizen_email: citizen.email, assigned_name: null, is_overdue: 0 }]);
  }
  if (query.startsWith('SELECT h.*, u.name AS changed_by_name FROM complaint_status_history')) {
    return executeResult(history.filter((entry) => entry.complaint_id === Number(params[0])).map((entry) => ({
      ...entry,
      changed_by_name: users.find((user) => user.id === entry.changed_by)?.name,
    })));
  }
  if (query.startsWith('SELECT id, mime_type, file_size, width, height, photo_kind, created_at FROM complaint_photos')) {
    return executeResult([]);
  }
  if (query.startsWith('SELECT * FROM complaints WHERE id = ?')) {
    const complaint = complaints.find((entry) => entry.id === Number(params[0]));
    return executeResult(complaint ? [{ ...complaint }] : []);
  }
  throw new Error(`Unexpected query: ${query}`);
}

test('API integration: login, report visibility, ownership, and public status response', async (t) => {
  users = await Promise.all([...citizens, admin].map(async (user) => ({
    ...user,
    password_hash: await bcrypt.hash(user.password, 4),
    deleted_at: null,
  })));
  complaints = [];
  history = [];
  sessions = new Map();
  nextComplaintId = 1;
  nextHistoryId = 1;
  db.execute = mockExecute;
  db.getConnection = async () => createMockConnection();

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const previousDatabaseReady = app.locals.databaseReady;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    app.locals.databaseReady = previousDatabaseReady;
    db.execute = originalExecute;
    db.getConnection = originalGetConnection;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const startupHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(startupHealth.status, 503);
  assert.deepEqual(await startupHealth.json(), { status: 'starting', database: 'connecting' });
  app.locals.databaseReady = true;

  async function request(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json', Origin: CLIENT_ORIGIN } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      response,
      body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : null,
      cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie,
    };
  }

  const citizenSessions = new Map();
  for (const user of citizens) {
    await t.test(`login and current-user API work for ${user.email}`, async () => {
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: user.email, password: user.password },
      });
      assert.equal(login.response.status, 200);
      assert.deepEqual(login.body, userSafe(user));
      const me = await request('/api/auth/me', { cookie: login.cookie });
      assert.equal(me.response.status, 200);
      assert.deepEqual(me.body, userSafe(user));
      citizenSessions.set(user.id, login.cookie);
    });
  }

  const adminLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: admin.email, password: admin.password },
  });
  assert.equal(adminLogin.response.status, 200);
  assert.deepEqual(adminLogin.body, userSafe(admin));
  const invalidLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: citizens[0].email, password: 'incorrect' },
  });
  assert.equal(invalidLogin.response.status, 401);

  const submit = await request('/api/complaints', {
    method: 'POST',
    cookie: citizenSessions.get(citizens[0].id),
    body: {
      type: SCC_REPORT_CATEGORIES[0],
      description: 'A pothole needs repair beside the public library entrance.',
      ward: 'Ward 12',
      priority: 'normal',
      latitude: 24.8945,
      longitude: 91.8681,
      locationText: 'Beside the public library',
      idempotencyKey: 'integration-report-roundtrip',
    },
  });
  assert.equal(submit.response.status, 201);
  assert.equal(submit.body.user_id, citizens[0].id);
  assert.equal(submit.body.status, 'submitted');
  assert.equal(submit.body.report_code, 'SCC-2026-000001');
  assert.equal(submit.body.history.length, 1);
  assert.equal(submit.body.internal_notes, undefined);

  const adminReports = await request('/api/admin/reports', { cookie: adminLogin.cookie });
  assert.equal(adminReports.response.status, 200);
  assert.equal(adminReports.body.total, 1);
  assert.equal(adminReports.body.items[0].report_code, submit.body.report_code);
  assert.equal(adminReports.body.items[0].citizen_email, citizens[0].email);

  const ownerListing = await request('/api/complaints', { cookie: citizenSessions.get(citizens[0].id) });
  assert.equal(ownerListing.response.status, 200);
  assert.equal(ownerListing.body.total, 1);
  assert.equal(ownerListing.body.items[0].id, submit.body.id);
  const otherCitizenList = await request('/api/complaints', { cookie: citizenSessions.get(citizens[1].id) });
  assert.equal(otherCitizenList.response.status, 200);
  assert.equal(otherCitizenList.body.total, 0);
  const otherCitizenDetail = await request(`/api/complaints/${submit.body.id}`, {
    cookie: citizenSessions.get(citizens[1].id),
  });
  assert.equal(otherCitizenDetail.response.status, 404);

  const statusResponse = await request(`/api/admin/reports/${submit.body.id}`, {
    cookie: adminLogin.cookie,
    method: 'PATCH',
    body: {
      status: 'in_progress',
      public_response: 'The road crew has been assigned to inspect this location.',
      internal_notes: 'Integration-only private staff note.',
    },
  });
  assert.equal(statusResponse.response.status, 200);
  assert.equal(statusResponse.body.status, 'in_progress');
  assert.equal(statusResponse.body.public_response, 'The road crew has been assigned to inspect this location.');

  const citizenRoundtrip = await request(`/api/complaints/${submit.body.id}`, {
    cookie: citizenSessions.get(citizens[0].id),
  });
  assert.equal(citizenRoundtrip.response.status, 200);
  assert.equal(citizenRoundtrip.body.status, 'in_progress');
  assert.equal(citizenRoundtrip.body.public_response, statusResponse.body.public_response);
  assert.equal(citizenRoundtrip.body.internal_notes, undefined);
  assert.ok(citizenRoundtrip.body.history.some((entry) => entry.to_status === 'in_progress'));

  const adminCanReadPublicResponse = await request(`/api/admin/reports/${submit.body.id}`, { cookie: adminLogin.cookie });
  assert.equal(adminCanReadPublicResponse.response.status, 200);
  assert.equal(adminCanReadPublicResponse.body.internal_notes, 'Integration-only private staff note.');
  assert.equal(adminCanReadPublicResponse.body.public_response, statusResponse.body.public_response);
});

after(() => {
  db.execute = originalExecute;
  db.getConnection = originalGetConnection;
});
