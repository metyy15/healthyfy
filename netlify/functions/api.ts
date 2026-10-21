import serverless from 'serverless-http';
import { app } from '../../src/server/app';
import { connectMongoAndLoadState, seedClinicalData } from '../../src/server/store';

// -------------------------------------------------------------
// Netlify function: the whole API.
//
// Netlify functions have no long-lived process, so the database
// connection and the seed are prepared once per container rather
// than at import time. Everything the function needs is in the
// module scope, which Lambda keeps warm between invocations.
//
// The request handler itself is the same Express app the local
// server uses, so there is exactly one implementation of the API.
// -------------------------------------------------------------

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = connectMongoAndLoadState().then(() => {
      seedClinicalData();
    });
  }
  return ready;
}

// serverless-http wraps the Express app itself. The readiness wait
// happens outside that wrapper, because the wrapper returns the
// response as soon as it is called and the app has not run yet.
const handler_ = serverless(app);

export const handler = async (event: unknown, context: unknown) => {
  await ensureReady();
  return handler_(event as any, context as any);
};

export const config = {
  // Netlify allows up to 26 seconds. The slow endpoints time-box
  // their model calls so they always answer inside it.
  timeout: 26,
};
