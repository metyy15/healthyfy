#!/usr/bin/env node
/**
 * Verifies the OpenAI-compatible provider path (the one ASI:One and
 * every other OpenAI-style endpoint use) against a local mock.
 *
 * The mock implements the three things the provider relies on:
 *   - structured output via response_format
 *   - tool calling via tools / tool_choice
 *   - image input via image_url content parts
 *
 * Start the app with:
 *   AI_PROVIDER=openai-compatible \
 *   AI_BASE_URL=http://localhost:4141/v1 \
 *   AI_API_KEY=test \
 *   AI_MODEL=mock-model
 *
 * then run: node scripts/provider-test.mjs
 */
import { createServer } from 'http';

const PORT = Number(process.env.MOCK_PORT || 4141);
const BASE = `http://localhost:${PORT}`;

let sawImage = false;
let sawTools = false;
let sawJsonSchema = false;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const messages = payload.messages || [];
    const last = messages[messages.length - 1];
    const content = last?.content;
    const isImage = Array.isArray(content) && content.some((p) => p.type === 'image_url');
    if (isImage) sawImage = true;
    if (payload.tools?.length) sawTools = true;
    if (payload.response_format?.type === 'json_schema') sawJsonSchema = true;

    const hasToolResult = messages.some((m) => m.role === 'tool');

    // First turn: ask for a tool call. Second turn: answer.
    if (payload.tools?.length && !hasToolResult) {
      return send(res, {
        id: 'mock-1',
        model: payload.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_mock_1',
                  type: 'function',
                  function: { name: 'get_medical_reports', arguments: '{"memberId":"fam-2","limit":1}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });
    }

    if (payload.response_format) {
      const body = JSON.stringify(payload);
      const isPrescription = body.includes('prescription');
      const isFollowUp = body.includes('follow-up action') || body.includes('visit instructions');

      const content = isFollowUp
        ? JSON.stringify({
            visitDate: '2026-10-20',
            prescriber: 'Dr. Mock',
            tasks: [
              {
                title: 'Book the 3-month follow-up',
                kind: 'appointment',
                detail: 'Review in 3 months',
                dueDate: '2027-01-20',
                dueTime: '',
                confidence: 0.9,
              },
              {
                title: 'Repeat the lipid profile fasting',
                kind: 'test',
                detail: 'Repeat lipid profile after 3 months',
                dueDate: '2027-01-20',
                dueTime: '08:00',
                confidence: 0.85,
              },
              {
                title: 'Increase Metformin dose to 1g',
                kind: 'other',
                detail: 'Increase Metformin to 1 g twice daily',
                dueDate: '',
                dueTime: '',
                confidence: 0.8,
              },
            ],
            unreadableParts: [],
            notes: 'Mock note',
          })
        : isPrescription
          ? JSON.stringify({
              prescriber: 'Dr. Mock',
              clinic: 'Mock Clinic',
              date: '2026-10-20',
              medications: [
                { name: 'Metformin', dose: '500 mg', frequency: 'Twice daily', times: ['08:30', '20:30'], confidence: 0.9 },
              ],
              allergies: [],
              conditionsMentioned: [],
              documentQuality: 'clear',
              needsVerification: [],
            })
          : JSON.stringify({
              summary: 'Mock analysis',
              values: [
                { testName: 'HbA1c', result: '8.4', referenceRange: '< 7.0 %', status: 'Higher than reference range' },
              ],
              aiExplanation: 'Mock explanation',
              possibleIndications: [],
              suggestedQuestions: [],
              nextSteps: [],
              isUrgent: false,
              disclaimer: 'Mock disclaimer',
            });

      return send(res, {
        id: 'mock-2',
        model: payload.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
      });
    }

    send(res, {
      id: 'mock-3',
      model: payload.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Mock answer. I read the records and found an LDL of 138 mg/dL.',
          },
          finish_reason: 'stop',
        },
      ],
    });
  });
});

function send(res, payload) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

server.listen(PORT, () => console.log(`mock openai-compatible server on ${BASE}/v1`));

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
  const res = await fetch(`http://localhost:3000${path}`, {
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

async function main() {
  const login = await call('POST', '/api/auth/login', {
    email: 'kartik@healthyfy.ai',
    password: 'healthyfy123',
  });
  token = login.body.token;

  console.log('\nStructured output');
  {
    const r = await call('POST', '/api/ai/analyze-report', {
      reportType: 'HbA1c',
      reportText: 'HbA1c 8.4',
      memberId: 'fam-2',
    });
    if (r.status === 200 && r.body.values?.[0]?.testName === 'HbA1c') {
      ok('analyze-report returned parsed JSON', r.body.summary);
    } else {
      bad('analyze-report returned parsed JSON', JSON.stringify(r.body).slice(0, 160));
    }
    if (sawJsonSchema) ok('provider sent response_format json_schema');
    else bad('provider sent response_format json_schema', 'not observed');
  }

  console.log('\nTool calling');
  {
    const r = await call('POST', '/api/ai/chat', {
      message: 'What is in the records?',
      memberId: 'fam-2',
    });
    const trace = r.body.trace || [];
    const toolStep = trace.find((t) => t.name === 'get_medical_reports');
    if (r.status === 200 && toolStep) {
      ok('agent called a tool', `step ${toolStep.step}, ${toolStep.durationMs}ms`);
      ok('tool result fed back', `${trace.length} trace entries`);
    } else {
      bad('agent called a tool', JSON.stringify(r.body).slice(0, 200));
    }
    if (sawTools) ok('provider sent tool definitions');
    else bad('provider sent tool definitions', 'not observed');
  }

  console.log('\nImage input');
  {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const r = await call('POST', '/api/prescriptions/analyze', {
      memberId: 'fam-2',
      imageBase64: png,
      imageMimeType: 'image/png',
    });
    if (r.status === 200 && r.body.extraction) {
      ok('prescription endpoint handled an image');
    } else {
      bad('prescription endpoint handled an image', JSON.stringify(r.body).slice(0, 200));
    }
    if (sawImage) ok('provider sent an image_url content part');
    else bad('provider sent an image_url content part', 'not observed');
  }

  console.log('\nFollow-up extraction');
  {
    const r = await call('POST', '/api/follow-up/extract', {
      memberId: 'fam-2',
      text: 'Review in 3 months. Repeat lipid profile after 3 months. Increase Metformin to 1 g twice daily.',
    });
    const tasks = r.body.tasks || [];
    if (r.status === 200 && tasks.length === 3) {
      ok('extracted the tasks', `${tasks.length} proposed`);
    } else {
      bad('extracted the tasks', JSON.stringify(r.body).slice(0, 200));
    }
    if (r.body.saved === false) ok('nothing was saved before confirmation');
    else bad('nothing was saved before confirmation', `saved=${r.body.saved}`);

    // The medication change must be rewritten into a question, not an action.
    const medTask = tasks.find((t) => /metformin/i.test(t.title + t.detail));
    if (medTask && medTask.kind === 'medication_review') {
      ok('medication change rewritten as a review task', medTask.title.slice(0, 60));
    } else {
      bad('medication change rewritten as a review task', JSON.stringify(medTask));
    }
    if (medTask && /^(increase|decrease|change|stop|start|reduce|raise|adjust|switch|take|double|halve)\b/i.test(medTask.title)) {
      bad('the rewritten task does not instruct a dose change', medTask.title);
    } else {
      ok('the rewritten task does not instruct a dose change', medTask?.title?.slice(0, 60));
    }
  }

  console.log('\nFollow-up tracker');
  {
    const r = await call('POST', '/api/follow-up', {
      memberId: 'fam-2',
      sourceLabel: 'Mock visit instructions',
      items: [
        { title: 'Book the 3-month follow-up', kind: 'appointment', detail: 'Review in 3 months', dueDate: '2027-01-20' },
        { title: 'Repeat the lipid profile fasting', kind: 'test', dueDate: '2027-01-20', dueTime: '08:00' },
      ],
    });
    if (r.status === 201 && r.body.created?.length === 2) {
      ok('saved the confirmed tasks', `${r.body.count} tasks`);
    } else {
      bad('saved the confirmed tasks', JSON.stringify(r.body).slice(0, 200));
    }

    const list = await call('GET', '/api/follow-up?memberId=fam-2');
    if (list.status === 200 && list.body.length >= 2) ok('GET /api/follow-up', `${list.body.length} tasks`);
    else bad('GET /api/follow-up', `HTTP ${list.status}`);

    // A task with a date and time gets a real reminder; one without does not.
    const withTime = list.body.find((t) => t.dueTime);
    const withoutTime = list.body.find((t) => !t.dueTime);
    if (withTime) {
      const rem = await call('POST', `/api/follow-up/${withTime.id}/remind`, {});
      if (rem.status === 200 && rem.body.scheduled === true) {
        ok('reminder scheduled for a dated task', rem.body.message.slice(0, 70));
      } else {
        bad('reminder scheduled for a dated task', JSON.stringify(rem.body).slice(0, 200));
      }
    } else {
      bad('reminder scheduled for a dated task', 'no task with a time found');
    }
    if (withoutTime) {
      const rem = await call('POST', `/api/follow-up/${withoutTime.id}/remind`, {});
      if (rem.status === 200 && rem.body.scheduled === false) {
        ok('no reminder claimed for an undated task', rem.body.message.slice(0, 70));
      } else {
        bad('no reminder claimed for an undated task', JSON.stringify(rem.body).slice(0, 200));
      }
    }

    const upcoming = await call('GET', '/api/follow-up/upcoming?memberId=fam-2&days=7');
    if (upcoming.status === 200 && upcoming.body.summary) {
      ok('GET /api/follow-up/upcoming', upcoming.body.summary);
    } else {
      bad('GET /api/follow-up/upcoming', `HTTP ${upcoming.status}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

setTimeout(main, 300);
