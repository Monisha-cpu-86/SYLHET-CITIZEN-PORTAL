import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve .env relative to this file (server/.env)
const envPath = path.resolve(__dirname, '../../.env');
config({ path: envPath });

export const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';
export const PORT = process.env.PORT || 5000;
export const HOST = process.env.HOST || (IS_DEVELOPMENT ? '127.0.0.1' : '0.0.0.0');
export const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
export const DB_HOST = process.env.DB_HOST || '127.0.0.1';
export const DB_PORT = Number(process.env.DB_PORT || 3306);
export const DB_NAME = process.env.DB_NAME || 'civicpulse_bd';
export const DB_USER = process.env.DB_USER || 'root';
export const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '';
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../data/uploads');
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@scc.local';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SCCadmin2026!';
export const OFFICER_EMAIL = process.env.OFFICER_EMAIL || 'officer@scc.local';
export const OFFICER_PASSWORD = process.env.OFFICER_PASSWORD || 'SCCofficer2026!';
if (!IS_DEVELOPMENT && (!process.env.SESSION_SECRET || SESSION_SECRET === 'dev-secret')) {
  throw new Error('SESSION_SECRET must be set to a strong random value in production.');
}
if (!IS_DEVELOPMENT && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to provision the production administrator.');
}