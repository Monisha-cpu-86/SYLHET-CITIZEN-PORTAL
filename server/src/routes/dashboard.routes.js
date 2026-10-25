import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Require authentication for dashboard data
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  next();
}

// Get statistics for the logged-in user's reports
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const [counts] = await db.execute(
      `SELECT COUNT(*) AS total,
        SUM(status = 'open') AS open,
        SUM(status = 'resolved') AS resolved
       FROM complaints WHERE user_id = ?`,
      [req.session.userId],
    );
    const [byType] = await db.execute(
      'SELECT type, COUNT(*) AS count FROM complaints WHERE user_id = ? GROUP BY type',
      [req.session.userId],
    );
    res.json({
      total: Number(counts[0].total),
      open: Number(counts[0].open),
      resolved: Number(counts[0].resolved),
      byType: byType.map((row) => ({ type: row.type, count: Number(row.count) })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
