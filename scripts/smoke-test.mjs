#!/usr/bin/env node
/**
 * Healthyfy API smoke test.
 *
 * Exercises the care and monitoring endpoints end to end against a
 * running server. It creates real records, so run it against a
 * throwaway database if you care about the seeded demo data.
 *
 *   node scripts/smoke-test.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL || 'kartik@healthyfy.ai';
const PASSWORD = process.env.SMOKE_PASSWORD || 'healthyfy123';

let token = null;
let passed = 0;
let failed = 0;

function ok(label, detail = '') {
  passed++;
  console.log(`  \u2713 ${label}${detail ? ` \u2014 ${detail}` : ''}`);
}

function bad(label, detail = '') {
  failed++;
  console.log(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ''}`);
}

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

function section(name) {
  console.log(`\n${name}`);
}

async function main() {
  section('Health check');
  {
    const r = await call('GET', '/api/health');
    r.status === 200 ? ok('GET /api/health', r.body.status) : bad('GET /api/health', `HTTP ${r.status}`);
  }

  section('Authentication');
  {
    const r = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
    if (r.status === 200 && r.body.token) {
      token = r.body.token;
      ok('login', r.body.user?.name);
    } else {
      bad('login', `HTTP ${r.status} ${r.body.error || ''}`);
      return;
    }
    const unauth = await fetch(`${BASE}/api/family`);
    unauth.status === 401 ? ok('unauthenticated request rejected', 'HTTP 401') : bad('unauthenticated request rejected', `HTTP ${unauth.status}`);
  }

  section('Family and members');
  let memberId = null;
  {
    const r = await call('GET', '/api/family');
    if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) {
      memberId = r.body[0].id;
      ok('GET /api/family', `${r.body.length} members`);
    } else {
      bad('GET /api/family', `HTTP ${r.status}`);
    }
  }

  section('Structured medications');
  {
    const r = await call('GET', '/api/medications');
    r.status === 200 ? ok('GET /api/medications', `${r.body.length} records`) : bad('GET /api/medications', `HTTP ${r.status}`);
  }

  section('Interaction safety engine');
  {
    // Amoxicillin against a recorded penicillin allergy.
    const r = await call('POST', '/api/safety/check', {
      memberId,
      medications: [{ name: 'Amoxicillin 500mg' }],
    });
    if (r.status === 200 && r.body.findings?.length > 0) {
      ok('allergy cross-check fired', `${r.body.findings[0].kind} (${r.body.highestSeverity})`);
    } else {
      bad('allergy cross-check fired', JSON.stringify(r.body).slice(0, 160));
    }

    // Two NSAIDs together.
    const r2 = await call('POST', '/api/safety/check', {
      memberId,
      medications: [{ name: 'Ibuprofen 400mg' }, { name: 'Naproxen 250mg' }],
    });
    if (r2.status === 200 && r2.body.findings?.length > 0) {
      ok('duplicate therapy check fired', r2.body.findings[0].description.slice(0, 60));
    } else {
      bad('duplicate therapy check fired', JSON.stringify(r2.body).slice(0, 160));
    }
  }

  section('Vitals and heart rate monitoring');
  {
    const r = await call('POST', '/api/vitals', {
      memberId,
      type: 'heart_rate',
      value: 68,
      context: 'resting',
      source: 'manual',
    });
    r.status === 201 ? ok('POST /api/vitals', 'reading recorded') : bad('POST /api/vitals', `HTTP ${r.status}`);

    const hr = await call('GET', '/api/monitor/overview');
    hr.status === 200
      ? ok('GET /api/monitor/overview', `baseline ${hr.body.members?.[0]?.heartRate?.baseline ?? 'n/a'} bpm`)
      : bad('GET /api/monitor/overview', `HTTP ${hr.status}`);
  }

  section('Alerts and escalation');
  {
    const r = await call('POST', '/api/monitor/fall', {
      memberId,
      location: { lat: 12.9716, lng: 77.5946, accuracyM: 12, label: 'Koramangala, Bengaluru' },
      confidence: 'high',
      source: 'smoke-test',
    });
    if (r.status === 201 && r.body.severity === 'critical') {
      ok('fall event raised a critical alert', `${r.body.escalation?.length ?? 0} escalation steps`);
    } else {
      bad('fall event raised a critical alert', `HTTP ${r.status}`);
    }

    const list = await call('GET', '/api/alerts');
    list.status === 200 ? ok('GET /api/alerts', `${list.body.length} alerts`) : bad('GET /api/alerts', `HTTP ${list.status}`);

    if (list.body?.length) {
      const id = list.body[0].id;
      const ack = await call('POST', `/api/alerts/${id}/acknowledge`);
      ack.status === 200 && ack.body.status === 'acknowledged'
        ? ok('acknowledge alert', ack.body.acknowledgedBy)
        : bad('acknowledge alert', `HTTP ${ack.status}`);

      const res = await call('POST', `/api/alerts/${id}/resolve`, { note: 'Checked, all fine.' });
      res.status === 200 && res.body.status === 'resolved'
        ? ok('resolve alert')
        : bad('resolve alert', `HTTP ${res.status}`);
    }
  }

  section('Adherence');
  {
    const r = await call('GET', '/api/adherence?days=14');
    r.status === 200
      ? ok('GET /api/adherence', `rate ${r.body.summary?.adherenceRate ?? 'n/a'}%`)
      : bad('GET /api/adherence', `HTTP ${r.status}`);
  }

  section('Reminders, caregivers and devices');
  {
    for (const [label, path] of [
      ['GET /api/reminders', '/api/reminders'],
      ['GET /api/caregivers', '/api/caregivers'],
      ['GET /api/devices', '/api/devices'],
    ]) {
      const r = await call('GET', path);
      r.status === 200 ? ok(label, `${r.body.length} records`) : bad(label, `HTTP ${r.status}`);
    }
  }

  section('Briefing and activity plan');
  {
    const r = await call('GET', '/api/briefing');
    r.status === 200
      ? ok('GET /api/briefing', `${r.body.insights?.length ?? 0} insights`)
      : bad('GET /api/briefing', `HTTP ${r.status}`);

    const p = await call('GET', `/api/exercise-plan?memberId=${memberId}`);
    p.status === 200
      ? ok('GET /api/exercise-plan', `${p.body.targets?.weeklyAerobicMinutes} min/wk aerobic`)
      : bad('GET /api/exercise-plan', `HTTP ${p.status}`);
  }

  section('Agent');
  {
    const r = await call('POST', '/api/ai/chat', { message: 'What is on record?', memberId });
    r.status === 200
      ? ok('POST /api/ai/chat', r.body.error ? 'degraded (no AI key configured)' : 'answered')
      : bad('POST /api/ai/chat', `HTTP ${r.status}`);

    const c = await call('GET', '/api/ai/conversations');
    c.status === 200 ? ok('GET /api/ai/conversations', `${c.body.length} stored`) : bad('GET /api/ai/conversations', `HTTP ${c.status}`);
  }

  section('Scheduler');
  {
    const r = await call('POST', '/api/scheduler/run');
    r.status === 200
      ? ok('POST /api/scheduler/run', `${r.body.dosesOpened} doses opened, ${r.body.promptsSent} prompts`)
      : bad('POST /api/scheduler/run', `HTTP ${r.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
