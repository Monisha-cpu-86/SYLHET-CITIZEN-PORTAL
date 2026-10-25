import { readFileSync } from 'fs';
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
export const DB_HOST = process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1';
export const DB_PORT = Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306);
export const DB_NAME = process.env.MYSQL_DATABASE || process.env.DB_NAME || 'civicpulse_bd';
export const DB_USER = process.env.MYSQL_USER || process.env.DB_USER || 'root';
export const DB_PASSWORD = process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '';
export const MYSQL_SSL = ['true', '1', 'required'].includes((process.env.MYSQL_SSL || '').toLowerCase());
export const MYSQL_CA_CERT = process.env.MYSQL_CA_CERT
  ? process.env.MYSQL_CA_CERT.replace(/\\n/g, '\n')
  : process.env.MYSQL_CA_CERT_PATH
    ? readFileSync(path.resolve(process.env.MYSQL_CA_CERT_PATH), 'utf8')
    : '';
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
if (!IS_DEVELOPMENT && !process.env.MYSQL_HOST?.trim()) {
  throw new Error('MYSQL_HOST is required in production. Set it to the Aiven hostname, not a local address.');
}
if (!IS_DEVELOPMENT && ['localhost', '127.0.0.1', '::1'].includes(DB_HOST.trim().toLowerCase())) {
  throw new Error(`MYSQL_HOST must be a remote database hostname in production; received "${DB_HOST}".`);
}
if (!IS_DEVELOPMENT && (!process.env.MYSQL_PORT || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD || !process.env.MYSQL_DATABASE)) {
  throw new Error('MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE must be set in production.');
}
if (!IS_DEVELOPMENT && !MYSQL_SSL) {
  throw new Error('MYSQL_SSL=true is required for the production database connection.');
}
if (!IS_DEVELOPMENT && !MYSQL_CA_CERT) {
  throw new Error('MYSQL_CA_CERT or MYSQL_CA_CERT_PATH is required to verify the production database certificate.');
}
if (MYSQL_SSL && !MYSQL_CA_CERT) {
  console.warn('MYSQL_SSL is enabled without MYSQL_CA_CERT; TLS certificate verification is disabled.');
}