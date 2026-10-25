import session from 'express-session';

export default class MySQLSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.cleanupTimer = setInterval(() => {
      this.db.execute('DELETE FROM sessions WHERE expires_at <= NOW(3)')
        .catch((error) => console.error('Failed to clean expired sessions.', error));
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.db.execute('SELECT session_data, expires_at FROM sessions WHERE session_id = ?', [sessionId])
      .then(([rows]) => {
        const stored = rows[0];
        if (!stored || new Date(stored.expires_at).getTime() <= Date.now()) {
          if (stored) this.destroy(sessionId, () => {});
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(stored.session_data));
      })
      .catch(callback);
  }

  set(sessionId, sessionValue, callback = () => {}) {
    const expiresAt = sessionValue.cookie?.expires
      ? new Date(sessionValue.cookie.expires)
      : new Date(Date.now() + (sessionValue.cookie?.maxAge || 24 * 60 * 60 * 1000));
    this.db.execute(
      `INSERT INTO sessions (session_id, session_data, expires_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), expires_at = VALUES(expires_at)`,
      [sessionId, JSON.stringify(sessionValue), expiresAt],
    ).then(() => callback(null)).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.db.execute('DELETE FROM sessions WHERE session_id = ?', [sessionId])
      .then(() => callback(null)).catch(callback);
  }

  touch(sessionId, sessionValue, callback = () => {}) {
    const expiresAt = sessionValue.cookie?.expires
      ? new Date(sessionValue.cookie.expires)
      : new Date(Date.now() + (sessionValue.cookie?.maxAge || 24 * 60 * 60 * 1000));
    this.db.execute('UPDATE sessions SET expires_at = ? WHERE session_id = ?', [expiresAt, sessionId])
      .then(() => callback(null)).catch(callback);
  }
}
