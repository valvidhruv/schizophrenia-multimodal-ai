import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { checkDatabase, DatabaseFailureReason } from './db';
import { loadConfig, type AppConfig } from './config';
import { DISCLAIMER } from './constants';
import { errorHandler } from './middleware/errorHandler';
import { createApiRouter } from './routes';
import { consoleAuditRecorder, type AuditRecorder } from './services/auditService';

export interface CreateAppOptions {
  config?: AppConfig;
  auditRecorder?: AuditRecorder;
  now?: () => number;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const config = options.config ?? loadConfig(process.env);
  const now = options.now ?? Date.now;

  const app = express();

  app.set('trust proxy', config.trustProxy);

  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    })
  );
  app.use(helmet());
  app.use(compression());
  app.use(morgan('dev'));
  app.use(express.json());

  // Process health (unchanged from Phase 1)
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      disclaimer: DISCLAIMER
    });
  });

  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'backend',
      timestamp: new Date().toISOString(),
      disclaimer: DISCLAIMER
    });
  });

  // Database health: executes SELECT 1 against PostgreSQL.
  // Responses expose only fixed status/reason values - never credentials,
  // hostnames, users, SQL, or driver error details.
  const databaseHealth = async (
    req: express.Request,
    res: express.Response
  ): Promise<void> => {
    try {
      const result = await checkDatabase();
      if (result.ok) {
        res.status(200).json({
          status: 'ok',
          service: 'backend',
          checks: {
            database: { status: 'ok', latencyMs: result.latencyMs }
          },
          timestamp: new Date().toISOString(),
          disclaimer: DISCLAIMER
        });
        return;
      }
      const reason: DatabaseFailureReason = result.reason ?? 'connection_failed';
      res.status(503).json({
        status: 'unavailable',
        service: 'backend',
        checks: {
          database: { status: 'unavailable', reason }
        },
        timestamp: new Date().toISOString(),
        disclaimer: DISCLAIMER
      });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        service: 'backend',
        checks: {
          database: { status: 'unavailable', reason: 'connection_failed' satisfies DatabaseFailureReason }
        },
        timestamp: new Date().toISOString(),
        disclaimer: DISCLAIMER
      });
    }
  };

  app.get('/health/db', databaseHealth);
  app.get('/api/health/db', databaseHealth);

  app.use(
    '/api',
    createApiRouter({
      config,
      auditRecorder: options.auditRecorder ?? consoleAuditRecorder,
      now,
    })
  );

  app.use(errorHandler);

  return app;
}
