import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';

import authRouter    from './routes/auth';
import usersRouter   from './routes/users';
import teamsRouter   from './routes/teams';
import invitesRouter from './routes/invites';
import listsRouter   from './routes/lists';
import tasksRouter   from './routes/tasks';
import dashboardRouter from './routes/dashboard';
import githubRouter    from './routes/github';
import aiRouter        from './routes/ai';
import eventsRouter    from './routes/events';
import docsRouter      from './routes/docs';
import webhooksRouter  from './routes/webhooks';
import testrunsRouter  from './routes/testruns';
import internalRouter  from './routes/internal';
import { errorHandler } from './middleware/errorHandler';
import { startDocSyncPoller } from './services/docSyncService';

const app = express();

app.use(cors({
  origin: config.FRONTEND_URL.length === 1 ? config.FRONTEND_URL[0] : config.FRONTEND_URL,
  credentials: true,
}));

// Webhook routes must be mounted BEFORE express.json() — they use express.raw() internally
// so that the raw body is available for GitHub HMAC-SHA256 signature validation.
app.use('/api/webhooks', webhooksRouter);

app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// API routes
app.use('/api/auth',    authRouter);
app.use('/api/users',   usersRouter);
app.use('/api/teams',   teamsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/lists',   listsRouter);
app.use('/api/tasks',     tasksRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/github',    githubRouter);
app.use('/api/ai',      aiRouter);
app.use('/api/events',  eventsRouter);
app.use('/api/docs',     docsRouter);
app.use('/api/testruns',  testrunsRouter);
app.use('/api/internal', internalRouter);

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`Backend running on port ${config.PORT}`);

  if (config.NODE_ENV !== 'test') {
    startDocSyncPoller();
  }
});
