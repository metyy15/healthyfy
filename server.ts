import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT, isProd } from './src/server/config';
import { connectMongoAndLoadState, seedClinicalData } from './src/server/store';
import { startScheduler, stopScheduler } from './src/server/scheduler';
import { legacyRouter } from './src/server/routes/legacy';
import { clinicalRouter } from './src/server/routes/clinical';
import { careRouter } from './src/server/routes/care';
import { agentRouter } from './src/server/routes/agent';
import { compareRouter } from './src/server/routes/compare';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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

// -------------------------------------------------------------
// Vite Dev Server Integration / Static Serving
// -------------------------------------------------------------
async function startServer() {
  await connectMongoAndLoadState();

  // When running without MongoDB the clinical seed is applied in memory
  // so the monitoring and safety features have data to work with.
  seedClinicalData();

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Healthyfy server running on port ${PORT}`);
  });

  startScheduler();
}

function shutdown() {
  console.log('\nShutting down Healthyfy...');
  stopScheduler();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
