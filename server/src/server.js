import app from './app.js';
import {
  DB_HOST,
  DB_NAME,
  DB_PORT,
  DB_USER,
  HOST,
  IS_DEVELOPMENT,
  MYSQL_CA_CERT,
  MYSQL_SSL,
  PORT,
} from './config/env.js';
import { initializeDatabase } from './db.js';

console.info(
  `Database configuration: host=${DB_HOST} port=${DB_PORT} user=${DB_USER} database=${DB_NAME} `
  + `ssl=${MYSQL_SSL} caCertSet=${Boolean(MYSQL_CA_CERT)}`,
);

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://localhost:${PORT} (bound to ${HOST})`);
});

async function initializeDatabaseWithRetry() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await initializeDatabase();
      app.locals.databaseReady = true;
      console.info('Database initialization completed; API is ready.');
      return;
    } catch (error) {
      if (IS_DEVELOPMENT || attempt === 30) {
        console.error(
          `Database initialization failed${IS_DEVELOPMENT ? '' : ' after 30 attempts'}.`,
          error.message,
        );
        server.close(() => {
          process.exitCode = 1;
        });
        return;
      }
      console.error(`Database is not ready (attempt ${attempt}/30); retrying in 2 seconds: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

initializeDatabaseWithRetry();
