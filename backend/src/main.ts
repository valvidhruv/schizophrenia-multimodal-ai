import dotenv from 'dotenv';

dotenv.config();

import { createApp } from './app';
import { initDatabase, checkDatabase, closeDatabase, sanitizeDatabaseError } from './db';

const PORT = process.env.BACKEND_PORT || 3001;
const SHUTDOWN_TIMEOUT_MS = 5000;

async function start(): Promise<void> {
  // Startup validation of database configuration
  try {
    const { configured } = initDatabase();
    if (configured) {
      const probe = await checkDatabase();
      if (probe.ok) {
        console.log(`Database connection OK (SELECT 1, ${probe.latencyMs} ms)`);
      } else {
        console.warn('Database is not reachable at startup; /health/db will report live status');
      }
    } else {
      console.warn('DATABASE_URL not set; database health checks will report unavailable');
    }
  } catch (err) {
    console.error('Invalid database configuration:', sanitizeDatabaseError(err));
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`${signal} received, shutting down gracefully...`);
    const forceExit = setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    server.close();
    try {
      await closeDatabase();
    } catch (err) {
      console.error('Error closing database pool:', sanitizeDatabaseError(err));
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void start();
