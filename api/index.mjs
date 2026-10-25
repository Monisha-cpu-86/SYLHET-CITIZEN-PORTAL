import app from '../server/src/app.js';
import { initializeDatabase } from '../server/src/db.js';

let initialization;

export default async function handler(request, response) {
  initialization ||= initializeDatabase();
  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    console.error('Vercel API database initialization failed.', error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: 'The CivicPulse API database is unavailable.' }));
    return;
  }

  const incomingUrl = new URL(request.url, 'http://localhost');
  const apiPath = incomingUrl.searchParams.get('__api_path');
  if (!apiPath) {
    response.statusCode = 404;
    response.end();
    return;
  }

  incomingUrl.searchParams.delete('__api_path');
  request.url = `/api/${apiPath}${incomingUrl.search}`;
  return app(request, response);
}
