import { IS_DEVELOPMENT } from '../config/env.js';

const databaseUnavailableCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
]);

export default function errorHandler(err, req, res, next) {
  console.error(err);
  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Each image must be 5 MB or smaller.'
      : err.code === 'LIMIT_FILE_COUNT'
        ? 'Upload no more than 3 images.'
        : 'The uploaded files could not be accepted.';
    return res.status(400).json({ message });
  }
  const databaseUnavailable = databaseUnavailableCodes.has(err.code);
  const status = err.status || (databaseUnavailable ? 503 : 500);
  const message = databaseUnavailable
    ? 'MySQL is unavailable. Check that the database server is running and server/.env has the correct DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.'
    : status >= 500 && !IS_DEVELOPMENT
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';
  res.status(status).json({ message });
}
