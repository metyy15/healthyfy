import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT, isProd } from './src/server/config';
import { app } from './src/server/app';
import { connectMongoAndLoadState, seedClinicalData } from './src/server/store';
import { startScheduler, stopScheduler } from './src/server/scheduler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------------------------------------------
// Local server bootstrap.
//
// The Express app itself lives in src/server/app.ts so the same
// routes can also be served by a Netlify function. This file only
// adds the things a long-running server has and a function does not:
// the Vite dev middleware, the static file serving and the
// background scheduler.
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
