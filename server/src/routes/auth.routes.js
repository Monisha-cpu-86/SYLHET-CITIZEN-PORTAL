import { Router } from 'express';
import db from '../db.js';
import bcrypt from 'bcryptjs';

const router = Router();

// Helper to fetch user without password hash
async function getUserSafe(id) {
  const [rows] = await db.execute('SELECT id, email, name, role, department FROM users WHERE id = ?', [id]);
  return rows[0];
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

// Register a new user
router.post('/register', async (req, res, next) => {
  try {
    const { email, name, password } = req.body;
    if (typeof email !== 'string' || typeof name !== 'string' || typeof password !== 'string'
      || !email.trim() || !name.trim() || password.length < 8 || password.length > 128
      || email.length > 255 || name.trim().length > 120) {
      return res.status(400).json({ message: 'Enter a valid name and email, and a password of at least 8 characters.' });
    }
    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email already in use' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
      [email.trim().toLowerCase(), name.trim(), passwordHash],
    );
    await regenerateSession(req);
    req.session.userId = result.insertId;
    res.status(201).json(await getUserSafe(result.insertId));
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Email already in use' });
    }
    next(error);
  }
});

// Login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || password.length > 128) {
      return res.status(400).json({ message: 'Missing fields' });
    }
    const [rows] = await db.execute('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email.trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    res.json(await getUserSafe(user.id));
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ message: 'Failed to logout' });
    res.clearCookie('civicpulse.sid');
    res.json({ message: 'Logged out' });
  });
});

// Get current authenticated user
router.get('/me', async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const user = await getUserSafe(req.session.userId);
    if (!user) return res.status(401).json({ message: 'Not authenticated' });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

export default router;
