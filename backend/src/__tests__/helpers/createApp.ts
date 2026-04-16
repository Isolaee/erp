import 'express-async-errors';
import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler } from '../../middleware/errorHandler';

/**
 * Builds a minimal Express app with a single router mounted at the given path.
 * Used by route tests so each suite only loads what it needs.
 */
export function createApp(mountPath: string, router: Router) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(mountPath, router);
  app.use(errorHandler);
  return app;
}
