#!/usr/bin/env node
/**
 * Publishes the agent's profile to Agentverse.
 *
 * The Almanac API registration only carries geo metadata, so an agent
 * can be registered and still have an empty profile. ASI:One's planner
 * reads the profile to decide which agent to route a request to, so an
 * agent with no description gets found and then passed over in favour
 * of the model answering from its own knowledge.
 *
 * Needs an Agentverse API key with write access:
 *   Agentverse -> Profile -> API Keys -> + New API Key -> write
 *
 *   AGENTVERSE_API_KEY=av_... node scripts/publish-agent-profile.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const API_KEY = process.env.AGENTVERSE_API_KEY || process.env.AGENTVERSE_TOKEN || '';
const ADDRESS =
  process.env.HEALTHYFY_AGENT_ADDRESS ||
  'agent1qfvy7fwvsrwyrh9ry562s6uyusaamv6qdxxaaczd3zpg5kvgprsnytl2clc';

const DESCRIPTION =
  process.env.AGENT_DESCRIPTION ||
  [
    'Reads a family health record and answers questions about it: lab reports and their values,',
    'medication lists, allergy history, medication adherence, monitoring data and health alerts.',
    'Compares two lab reports and reports how each test value changed with its reference range.',
    'Checks a medication list against recorded allergies, other medications and conditions using',
    'the FDA drug labels. Lists outstanding follow-up tasks. Does not diagnose, does not change',
    'medication schedules, and never invents a value.',
  ].join(' ');

if (!API_KEY) {
  console.error(
    'No Agentverse API key found.\n' +
      '  Set AGENTVERSE_API_KEY=av_... and run this again.\n' +
      '  Create a key at Agentverse -> Profile -> API Keys -> + New API Key (write access).'
  );
  process.exit(1);
}

let readme = '';
try {
  readme = readFileSync(join(ROOT, 'services/healthyfy-agent/profile.md'), 'utf8');
} catch {
  console.warn('profile.md not found; publishing the description only.');
}

const body = {
  description: DESCRIPTION.slice(0, 300),
  readme,
  avatar_url: process.env.AGENT_AVATAR_URL || '',
  banner_url: process.env.AGENT_BANNER_URL || '',
};

console.log(`Publishing the profile for ${ADDRESS}...`);

const response = await fetch(`https://agentverse.ai/v1/agents/${ADDRESS}`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `bearer ${API_KEY}`,
  },
  body: JSON.stringify(body),
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
console.log(text.slice(0, 800));
