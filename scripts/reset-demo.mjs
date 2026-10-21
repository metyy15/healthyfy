#!/usr/bin/env node
/**
 * Resets the Healthyfy demo data.
 *
 * Drops the app_state document so the next server start re-seeds the
 * demo account, family, reports, medications and vitals. Run the
 * server after this to rebuild the seed.
 *
 *   node scripts/reset-demo.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB_NAME || 'healthyfy';

const client = new MongoClient(uri);
await client.connect();

const db = client.db(dbName);
const dropped = await db.dropDatabase();

console.log(
  dropped
    ? `Dropped "${dbName}". Restart the server to re-seed the demo data.`
    : `Nothing to drop in "${dbName}".`
);

await client.close();
