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
import githubRouter  from './routes/github';
import aiRouter      from './routes/ai';
import eventsRouter  from './routes/events';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(cors({
  origin: config.FRONTEND_URL,
  credentials: true,
}));
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
app.use('/api/tasks',   tasksRouter);
app.use('/api/github',  githubRouter);
app.use('/api/ai',      aiRouter);
app.use('/api/events',  eventsRouter);

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`Backend running on port ${config.PORT}`);
});
