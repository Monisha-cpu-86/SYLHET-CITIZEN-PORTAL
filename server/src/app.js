import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { SESSION_SECRET, CLIENT_ORIGIN } from './config/env.js';
import db from './db.js';
import MySQLSessionStore from './middleware/mysqlSessionStore.js';
import authRouter from './routes/auth.routes.js';
import complaintsRouter from './routes/complaints.routes.js';
import dashboardRouter from './routes/dashboard.routes.js';
import adminRouter from './routes/admin.routes.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();
app.set('etag', false);
app.set('trust proxy', 1);
app.locals.databaseReady = false;

// Basic security middlewares
app.use(helmet());
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(cors({
  origin: CLIENT_ORIGIN,
  credentials: true,
}));
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('origin') !== CLIENT_ORIGIN) {
    return res.status(403).json({ message: 'Request origin is not allowed.' });
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || app.locals.databaseReady) return next();
  return res.status(503).json({ status: 'starting', message: 'Database is initializing.' });
});
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Rate limiting (apply to all routes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Sessions persist in the same MySQL database as reports.
app.use(session({
  name: 'civicpulse.sid',
  secret: SESSION_SECRET,
  store: new MySQLSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
}));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/complaints', complaintsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin', adminRouter);

// Health check (no auth needed)
app.get('/api/health', async (req, res, next) => {
  if (!app.locals.databaseReady) {
    return res.status(503).json({ status: 'starting', database: 'connecting' });
  }
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'mysql' });
  } catch (error) {
    next(error);
  }
});

// Error handling – must be last
app.use(errorHandler);

export default app;
