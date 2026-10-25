import db from '../db.js';

export function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  next();
}

export async function loadAuthenticatedUser(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    const [rows] = await db.execute(
      'SELECT id, email, name, role, department FROM users WHERE id = ? AND deleted_at IS NULL',
      [req.session.userId],
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    req.user = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to access this SCC administration feature.' });
    }
    next();
  };
}
