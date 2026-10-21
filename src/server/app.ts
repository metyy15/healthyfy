import express from 'express';
import { isProd } from './config';
import { legacyRouter } from './routes/legacy';
import { clinicalRouter } from './routes/clinical';
import { careRouter } from './routes/care';
import { agentRouter } from './routes/agent';
import { compareRouter } from './routes/compare';

// -------------------------------------------------------------
// The Express application.
//
// It is kept separate from the bootstrap so the same app can be
// served three ways: by the local server, by a Netlify function
// through serverless-http, and by anything else that can run a
// Node request handler.
// -------------------------------------------------------------

export const app = express();
app.use(express.json({ limit: '25mb' }));

// -------------------------------------------------------------
// API routes
//
// The legacy router carries its own full paths; the newer routers
// are mounted under /api and declare relative paths.
// -------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), env: isProd ? 'production' : 'development' });
});

app.use(legacyRouter);
app.use('/api', clinicalRouter);
app.use('/api', careRouter);
app.use('/api', agentRouter);
app.use('/api', compareRouter);

// Malformed JSON should come back as a JSON error, not fall through to
// the SPA handler and return HTML.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That upload is too large. The limit is 25 MB.' });
  }
  next(err);
});
