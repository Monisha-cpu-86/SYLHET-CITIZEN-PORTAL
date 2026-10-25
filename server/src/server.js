import app from './app.js';
import { HOST, IS_DEVELOPMENT, PORT } from './config/env.js';
import { initializeDatabase } from './db.js';

let databaseReady = false;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    await initializeDatabase();
    databaseReady = true;
    break;
  } catch (error) {
    if (IS_DEVELOPMENT || attempt === 30) {
      console.error(
        'Database initialization failed. Check MySQL availability and the configured connection settings.',
        error,
      );
      process.exitCode = 1;
      throw error;
    }
    console.error(`Database is not ready (attempt ${attempt}/30); retrying in 2 seconds.`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

if (!databaseReady) {
  throw new Error('Database initialization did not complete.');
}

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT} (bound to ${HOST})`);
});
