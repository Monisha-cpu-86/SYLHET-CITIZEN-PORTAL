import app from './app.js';
import { HOST, PORT } from './config/env.js';
import { initializeDatabase } from './db.js';

try {
  await initializeDatabase();
} catch (error) {
  console.error(
    'Database initialization failed. Start MySQL, create the configured database, and check server/.env.',
    error,
  );
  process.exitCode = 1;
  throw error;
}

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT} (bound to ${HOST})`);
});
