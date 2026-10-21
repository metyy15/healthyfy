import { connectMongoAndLoadState, seedClinicalData } from '../../src/server/store';
import { runTick } from '../../src/server/scheduler';

// -------------------------------------------------------------
// Netlify scheduled function: the background work.
//
// A Netlify function has no long-lived process, so the reminders,
// the medication prompts, the alert escalation and the daily
// briefing cannot live inside the API function. They run here
// instead, on a cron schedule, which is what the platform is built
// for.
//
// The schedule is set in netlify.toml.
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

export const handler = async () => {
  await ensureReady();
  const result = await runTick();
  console.log('Scheduler tick:', JSON.stringify(result));
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, ...result }),
  };
};

export const config = {
  // Netlify allows up to 26 seconds for a scheduled function.
  timeout: 26,
};
