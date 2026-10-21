# Healthyfy AI — corrected runnable build

Healthyfy AI is a React + Express health-management demo with Gemini-powered report analysis, AI chat, nutrition planning, family records, doctor discovery/booking, fitness demo data, notifications, and account settings.

## Requirements
- Node.js 20+ (22 LTS recommended)
- npm 10+
- A Gemini API key for AI features

## Run locally

1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Install dependencies:

   `npm install`

4. Copy `.env.example` to `.env`.
5. Put your Gemini key in `GEMINI_API_KEY`.
6. Set a private `JWT_SECRET` (especially before deployment).
7. Start:

   `npm run dev`

8. Open `http://localhost:3000`.

The server runs the Vite development middleware and Express API together.

## Production build

`npm install`

`npm run build`

Set:

- `NODE_ENV=production`
- `JWT_SECRET=<long-random-secret>`
- `GEMINI_API_KEY=<your-key>`
- `PORT=3000`

Then run:

`npm start`

Open `http://localhost:3000`.

## Demo account

- Email: `kartik@healthyfy.ai`
- Password: `healthyfy123`

Create a new account if you prefer. Authentication is required for protected APIs; the server no longer silently logs unauthenticated requests in as the demo user.

## Important corrected behavior

- Family members, reports, AI context, notifications, and appointments are scoped to the authenticated user.
- Invalid/expired JWTs return 401.
- PDF and image reports are sent to Gemini as binary inline data instead of being incorrectly read as text.
- AI failure no longer invents medical lab values.
- Doctor booking uses a server endpoint and rejects conflicting slots.
- Profile and notification preferences are saved through the API.
- Fitness data remains explicitly demo/simulated data.
- The Gemini API key stays server-side; it is never placed in the React bundle.

## Medical disclaimer

Healthyfy AI is a software demo and educational health-information tool. AI output is not a diagnosis and must not replace a qualified clinician. Do not use the demo in an emergency; call local emergency services or seek urgent medical care.


## MongoDB setup

This version stores application data in MongoDB instead of keeping accounts and health records only in server memory.

1. Create a MongoDB Atlas cluster (or use a local MongoDB server).
2. Create a database user and allow your development IP in Atlas Network Access.
3. Copy `.env.example` to `.env`.
4. Set:
   - `MONGODB_URI` to your MongoDB connection string.
   - `MONGODB_DB_NAME=healthyfy`
5. Run `npm install`.
6. Run `npm run dev`.

The first startup creates the `healthyfy.app_state` document with the existing Kartik demo account and demo data. Later registrations, family members, medical reports, notifications, appointments, and fitness sync settings are persisted to MongoDB.

### Authentication behavior

- Sign Up creates a new account only from the Sign Up form.
- Sign In checks the stored bcrypt password hash.
- A wrong password is rejected with `Invalid email or password.` and cannot create an account.
- An existing email cannot be registered twice.
- Email addresses are normalized to lowercase.

---

# Fetch.ai / ASI:One integration

This build is set up for a Fetch.ai hackathon submission: the web app can run
entirely on **ASI:One** (Fetch.ai's agentic LLM) and the health record is
published as a **uAgent** on **Agentverse**, where other agents and ASI:One
itself can discover and call it.

## 1. Run the app on ASI:One

The model backend is pluggable. `AI_PROVIDER` pins the preferred provider and
each job has its own fallback chain.

```bash
# .env
AI_PROVIDER=asi-one
ASI1_API_KEY=<your key from https://asi1.ai/developer>
AI_BASE_URL=https://api.asi1.ai/v1
AI_MODEL=asi1
```

Restart and ASI:One leads every chain. Nothing else changes.

| `AI_PROVIDER` | Backend | Key |
| --- | --- | --- |
| `gemini` | Google Gemini (default) | `GEMINI_API_KEY` |
| `asi-one` | ASI:One from Fetch.ai | `ASI1_API_KEY` |
| `openai-compatible` | Any OpenAI chat-completions endpoint | `AI_API_KEY` |

`openai-compatible` also covers OpenRouter, Groq, Together, Mistral, Ollama,
LM Studio, vLLM and Cloudflare Workers AI. Set `AI_BASE_URL` and `AI_MODEL`
and it will talk to any of them.

## 2. The provider layer

`src/server/ai/provider.ts` defines the interface every feature talks to:

```ts
interface ModelProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  generateJson<T>(options: GenerateJsonOptions): Promise<GenerateResult<T>>;
  createConversation(input): ProviderConversation;
  nextTurn(conversation, options?): Promise<{ text: string; toolCalls: ToolCall[] }>;
  submitToolResults(conversation, results): void;
}
```

Two implementations live in `src/server/ai/providers/`:

- `gemini.ts` — Google Gemini, using the native SDK (typed response schemas).
- `openaiCompatible.ts` — ASI:One and anything else OpenAI-compatible.

The OpenAI-compatible provider handles the three things the app needs:
structured output (`response_format`, with an automatic fallback to loose JSON
mode if an endpoint rejects the strict form), image input (`image_url` content
parts with data URIs, which is how the Prescription Reader sends a photo), and
tool calling (`tools` / `tool_choice`, with `tool_calls` mapped back into the
same trace the interface renders).

Feature code never imports a vendor SDK. `prescription.ts`, `briefing.ts`,
`routes/legacy.ts` and the agent loop all go through the registry in
`src/server/ai/providers/index.ts`.

### Roles and fallbacks

Different jobs want different models, so the registry keeps a **chain per
role** rather than one global model. A provider that is not configured is
skipped, and if one fails mid-request the next in the chain takes over.

| Role | Chain | Why |
| --- | --- | --- |
| `app` | Gemini → ASI:One → OpenAI-compatible | Gemini's `responseSchema` guarantees the JSON shape, which matters when the output is a lab report or a medication list. ASI:One is the fallback. |
| `vision` | Gemini → ASI:One | Reading a handwritten prescription is a vision task, and Gemini's vision is the strongest of the free tiers. |
| `agent` | ASI:One → Gemini | The reasoning *inside* the uAgent. A Fetch.ai agent powered by ASI:One is what makes the Agentverse story coherent, and ASI:One can delegate to other agents on the network. |

`AI_PROVIDER` pins the **preferred** provider — it moves that provider to the
front of every chain rather than replacing the chain. Set it to `asi-one` for
a Fetch.ai submission; the app still works if Gemini is unavailable.

## 2b. Free clinical data

Three public government APIs do the grounding, and **none of them need a key,
an account or a credit card**:

| Source | Used for | Where |
| --- | --- | --- |
| **openFDA** drug labels | The real FDA interaction section for any drug, plus boxed warnings. Expands the safety engine beyond the curated rules. | `src/server/ai/drugData.ts` |
| **PubMed** E-utilities | The published papers behind the exercise targets, with links. | `src/server/ai/literature.ts` |
| **NIH RxNorm** | Canonicalising drug names so "Glycomet" and "metformin" match. | `src/server/ai/safety.ts` |

The curated knowledge base in `drugKnowledge.ts` stays authoritative for
severity. A finding derived from an FDA label is reported as *"the label names
this"* rather than as a graded interaction, because the label text is a list
rather than a severity grading.

Example of what openFDA adds on top of the local rules:

> **Warfarin 5mg** carries an FDA boxed warning. The most important part for
> you: WARNING: BLEEDING RISK Warfarin sodium can cause major or fatal
> bleeding…

## 3. The uAgent

`services/healthyfy-agent/` holds a **uAgents** (Python) service that publishes
Healthyfy to Agentverse.

It does two things:

- **Agent Chat Protocol (ACP)** — so ASI:One Chat, or any other agent, can
  message it in plain conversation.
- **A domain protocol** (`HealthRequest` → `HealthResponse`) — so other
  agents can call it as a structured tool: question, family member, whether to
  include vitals and the adherence log. The reply carries the answer, the
  member it is about, the evidence it used, the number of open alerts and the
  list of endpoints consulted.

Its brain is ASI:One, driven by an explicit tool loop: the model is offered the
Healthyfy API operations as tools, calls the ones it needs, and the results
are fed back until it produces an answer. The tool implementations are HTTP
calls to the Healthyfy backend, so the agent always reads the real record.

### Running it

```bash
# 1. the backend must be running
npm run start:dev

# 2. install and run the agent
cd services/healthyfy-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # add ASI1_API_KEY and AGENTVERSE_TOKEN
python agent.py
```

It logs its address on startup. Copy that into the backend `.env` as
`HEALTHYFY_AGENT_ADDRESS` and restart, and the **Agent Network** screen in the
app links straight to the agent's Agentverse profile.

### Agentverse profile

| Field | Value |
| --- | --- |
| Name | Healthyfy Health Agent |
| Handle | `@healthyfy` |
| Description | Reads a family's real medical records, medication history, adherence and monitoring data, and answers questions about them. Can check a new prescription for interactions with the family's allergy and condition history, and raise a health alert for an approved caregiver. |
| Tags | health, family, medical-records, monitoring, safety |
| Category | Health & Wellness |

## 4. What the judge sees

Open the **Agent Network** screen. It shows the active model provider, the
agent's address and its Agentverse link, and a readiness checklist for the
submission requirements:

| Requirement | Where it is satisfied |
| --- | --- |
| Registered on Agentverse | `services/healthyfy-agent/agent.py` with `mailbox=True` and `publish_manifest=True` |
| Agent Chat Protocol | ACP handler in the same file |
| Discoverable via ASI:One | ASI:One routes to the published manifest |
| Tool execution / multi-agent orchestration | The uAgent's ASI:One tool loop over the Healthyfy API |
| Workflow complete inside an ASI:One conversation | The ACP handler answers fully in-conversation |
| Public repository | This repository |

The strongest demo is: ask ASI:One *"My father's HbA1c has gone up — what should
we do?"*, and it routes to the Healthyfy agent, which reads the two HbA1c
reports, reads the fourteen-day medication adherence log, notices the missed
evening doses, and answers with the connection and a question to take to the
doctor.

## 5. Verifying the provider without an ASI:One key

`npm run test:provider` starts a mock OpenAI-compatible server and checks the
provider path end to end: structured output, a tool call with its result fed
back, and image input. It is the same code path ASI:One uses, so a green run
means the integration is sound and only the key is missing.

```bash
AI_PROVIDER=openai-compatible \
AI_BASE_URL=http://localhost:4141/v1 \
AI_API_KEY=test-key \
AI_MODEL=mock-model \
npm run start:dev

npm run test:provider
```

---

# Care & monitoring features

The build now includes a family-care layer on top of the original health
companion. The backend lives in `src/server/` (the `server.ts` entry point is
now only a bootstrap).

## What was added

| Feature | Where it lives | Notes |
| --- | --- | --- |
| Structured medication ledger | `src/server/ai/safety.ts`, `/api/medications` | Dose, frequency, dose times, source, start/end date |
| Medication adherence log | `/api/adherence` | `pending` → `taken` / `skipped` / `late`, with a 14-day rate |
| Prescription reader | `src/server/ai/prescription.ts`, `/api/prescriptions/analyze` | Vision extraction of prescriptions, with confidence scoring and human verification for low-confidence fields |
| Interaction safety engine | `src/server/ai/drugKnowledge.ts` | Drug–drug, drug–allergy, drug–condition and duplicate-therapy checks against a curated local knowledge base |
| Safety ledger | `/api/safety/checks` | Append-only history of every check performed and what it found |
| Heart-rate anomaly detection | `src/server/ai/monitor.ts` | Per-member personal baseline, sustained-reading requirement, exercise suppression, deduplication |
| Fall events | `POST /api/monitor/fall` | The endpoint a watch app posts to; raises a critical alert with optional live location |
| Alert escalation | `src/server/ai/monitor.ts` | Confirmation-first ladder: owner → caregivers → SMS → failed-escalation notice |
| Caregiver links | `/api/caregivers` | Who gets notified, on which channels, with view/manage permission |
| Reminders | `/api/reminders`, `src/server/scheduler.ts` | Hydration, medication, exercise and check-in reminders driven by a background scheduler |
| Daily briefing | `src/server/ai/briefing.ts`, `/api/briefing` | Proactive narrative connecting reports, adherence and vitals |
| Exercise & step plan | `src/server/ai/exercise.ts`, `/api/exercise-plan` | Deterministic rules derived from conditions, medications and lab values |
| Device connections | `/api/devices`, `/api/devices/sync` | Wearable ingestion; this is the seam a native app plugs into |
| Tool-using assistant | `src/server/ai/loop.ts`, `src/server/ai/tools.ts` | The chat assistant can now read the record and propose actions, with human approval for anything that writes |

## New API endpoints

```
GET    /api/medications            POST /api/medications
PUT    /api/medications/:id        DELETE /api/medications/:id
GET    /api/allergies              POST /api/allergies      DELETE /api/allergies/:id
GET    /api/adherence              POST /api/adherence
GET    /api/vitals                 POST /api/vitals
GET    /api/prescriptions/analyze  POST  (same, with commit:true to persist)
GET    /api/safety/checks          POST /api/safety/check
GET    /api/alerts                 POST /api/alerts/:id/acknowledge
POST   /api/alerts/:id/resolve     POST /api/monitor/fall
POST   /api/alerts/simulate        (demo/testing panel)
GET    /api/caregivers             POST /api/caregivers      DELETE /api/caregivers/:id
GET    /api/reminders              POST /api/reminders      PUT/DELETE /api/reminders/:id
GET    /api/devices                POST /api/devices        POST /api/devices/sync
GET    /api/monitor/overview       GET  /api/briefing       GET  /api/exercise-plan
GET    /api/records/compare         GET  /api/follow-up
GET    /api/follow-up/upcoming      POST /api/follow-up/extract
POST   /api/follow-up               POST /api/follow-up/:id/complete
POST   /api/follow-up/:id/dismiss   POST /api/follow-up/:id/remind
GET    /api/ai/conversations       GET  /api/agent/pending-actions
POST   /api/agent/pending-actions/:id/approve
POST   /api/scheduler/run          (force a scheduler tick)
```

## Comparing two reports

`GET /api/records/compare?memberId=...` compares two stored reports and
returns what changed, test by test.

The comparison is **computed, not generated**. `src/server/ai/compare.ts`
parses the stored values itself, so the result is reproducible and cannot
invent a number.

What it does:

- **Parses values properly.** "6,800" is 6800, "> 400" is a bound, "Negative"
  is not a number and is skipped. The unit is read from the reference range
  when the result does not carry one.
- **Matches the right tests.** "HbA1c (Glycated Haemoglobin)" matches "HbA1c";
  "LDL (Bad Cholesterol)" matches "LDL Cholesterol"; "Total Cholesterol" matches
  "Cholesterol, Total".
- **Refuses to compare what it should not.** If the two results carry different
  units, or one of them is not a number, the pair is not compared and the reason
  is listed under "not compared" rather than being quietly dropped.
- **Flags a range that moved.** If the lab changed the reference range between
  the two reports, "in range" means two different things, so the comparison says
  so instead of pretending otherwise.
- **Judges magnitude against the test, not a fixed percentage.** A 1.3 point
  rise in HbA1c is meaningful even though it is under 20%, so well-known tests
  carry their own reference change; everything else is scaled by the reference
  range width.
- **Never interprets.** The output describes movement and produces questions for
  the doctor. It does not say what a change means.

```
Estimated Average Glucose      131     -> 189     |     58 | moved_out_of_range
Fasting Blood Glucose          112     -> 148     |     36 | notable_change
HbA1c (Glycated Haemoglobin)   7.1     -> 8.4     |    1.3 | notable_change
```

## The follow-up tracker

`POST /api/follow-up/extract` reads a visit summary and proposes tasks. Nothing
is saved until the user confirms.

- Every proposed task carries the **wording it came from**, and the server
  checks that wording against the source document. A quote that cannot be found
  is marked as possibly misread rather than accepted.
- **A medication change is never turned into an action.** The extraction is
  checked for dose-change language, and anything that matches becomes a
  question for the prescriber: *"Ask your prescriber about the medicine change
  in these notes"*. The app does not change a medication schedule.
- **The app never claims to have contacted anyone.** A task is something the
  person has to do. A reminder is only created when the task has a date *and* a
  time, and the response says plainly which of those two happened.
- `GET /api/follow-up/upcoming` answers *"what do I need to do this week?"*,
  grouped into overdue, due today, this week and later.

## Design decisions worth knowing

- **The safety engine is offline-first.** DDInter and the RxNorm interaction
  endpoints were both unavailable, so interactions are resolved against a
  curated local knowledge base in `src/server/ai/drugKnowledge.ts`. RxNorm is
  still used, when reachable, to canonicalise drug names. The trade-off is
  deliberate: a deterministic, credential-free check that always works.
- **Never invent a reading.** The interaction check only reports what the
  knowledge base contains. A drug it does not recognise is reported as
  unrecognised rather than assumed safe.
- **Alerts are confirmation-first.** A detection opens an alert that the
  person can cancel. Caregivers are notified only for unacknowledged alerts,
  and the escalation ladder is owned by the backend so it survives an app
  restart.
- **Personal baselines, not fixed thresholds.** A heart rate is compared
  against that member's own resting baseline, and a single reading is not
  enough; it has to be sustained. Recent activity suppresses the alert.
- **The assistant never writes without approval.** Tools that change state
  (`run_safety_check`, `create_reminder`, `create_alert`) are queued as
  pending actions and shown with Approve/Dismiss buttons. The model is told
  the action has not run, so it cannot claim otherwise.
- **The dose ledger is cumulative.** Medications and allergies are never
  overwritten, so the safety ledger reflects everything ever taken.

## Native device integration (not included in this build)

The backend exposes the seams a phone or watch app would use:

- `POST /api/devices/sync` ingests heart rate, steps, SpO2 and blood pressure
  samples from a wearable.
- `POST /api/monitor/fall` receives a fall detection event with a location.
- `GET /api/monitor/overview` reports monitoring and push status per member.

The watch app itself is a native project (Kotlin for Wear OS, Swift for
watchOS) and is deliberately not part of this TypeScript build. On Android,
Samsung's Health Services API exposes `FALL_DETECTED` events directly; on
watchOS, fall detection is usually implemented against `CMMotionManager`.
Health Connect and HealthKit cover step and heart-rate ingestion, and both
require a real device plus the platform's health-data declaration.

## Push delivery

Alerts always land in the in-app notification inbox. To also deliver them to
a real phone, set `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_JSON`; the push
provider then uses the FCM HTTP v1 API. SMS escalation is recorded in the
alert timeline but is not delivered until a gateway (Twilio, MSG91) is
wired in — the UI says so rather than pretending it was sent.

## Verifying the build

```
npm run lint         # tsc --noEmit across the whole project
npm run build        # production bundle
npm run start:dev    # starts MongoDB and the app, both detached
npm run test:api     # exercises every new endpoint against a running server
npm run test:render  # server-renders each new view to prove it mounts
npm run test:provider # checks the OpenAI-compatible provider path against a mock
npm run reset:demo   # wipe the demo data, restart to re-seed
```

`npm run test:api` hits a live server on `http://localhost:3000` and signs in
as the demo account. It creates real records, so point it at a throwaway
database if the seeded demo data matters. Override the target with
`node scripts/smoke-test.mjs http://localhost:3001`.

`npm run test:render` bundles each new component with esbuild and renders it
with `react-dom/server`. This catches the class of failure TypeScript cannot
see: a bad property access or a missing guard in the first render pass.

