# Fetch.ai hackathon submission checklist

Everything a judge or a reviewer needs to run this project, and where each
submission requirement is satisfied.

## 1. What to submit

| Deliverable | Where |
| --- | --- |
| Public GitHub repository | This repository |
| Agent URL on Agentverse | The agent profile for `healthyfy-health-agent` — the address is printed by the uAgent on startup and shown in the app under **Agent Network** |
| ASI:One Chat session URL | Start a conversation with the agent in ASI:One Chat and copy the session URL |
| Demo video | Record the script in section 5 |

## 2. The three keys

### a) ASI:One API key — the model's brain

1. Go to **https://asi1.ai/developer** and sign in (the "ASI:ONE Sign up" button at the top of fetch.ai goes to the same place).
2. The developer dashboard shows your API key. Copy it.
3. Check it works before you build anything else:

```bash
curl -X POST https://api.asi1.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_KEY" \
  -d '{"model":"asi1","messages":[{"role":"user","content":"What is agentic AI?"}]}'
```

A completion means the key is good. If you get a 401, the key was copied with a stray space.

4. Put it in the **backend** `.env`:

```
AI_PROVIDER=asi-one
ASI1_API_KEY=your_key_here
ASI1_BASE_URL=https://api.asi1.ai/v1
ASI1_MODEL=asi1
```

The name in ASI:One's own docs is `ASI_ONE_API_KEY`; both spellings are accepted.

Models available: `asi1`, `asi1-ultra`, `asi1-mini`.

### b) Agentverse account and mailbox — how other agents reach yours

**You do not need an API token for this.** The mailbox is created from the
Agentverse inspector, and the uAgents library authenticates to it with a
signed attestation derived from the agent's own key.

1. Create an account at **https://agentverse.ai**.
2. Run the agent and copy the **Agent inspector** URL from the terminal:

```bash
cd services/healthyfy-agent
.venv/bin/python agent.py
```

```
INFO: [healthyfy-health-agent]: Agent inspector available at
https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8000&address=agent1q...
```

3. Open that URL → click **Connect** → **Mailbox** → **Finish**.
4. Restart the agent. The log changes from

```
WARNING: Agent mailbox not found: create one using the agent inspector
```

to

```
INFO: [mailbox]: Successfully registered as mailbox agent in Agentverse
```

5. The agent now appears under **Agentverse → My Agents** with a Mailbox tag,
   and ASI:One can route to it.

> If Chrome asks for "Local network access", click **Allow**. Recent Chrome
> and Brave versions block the inspector from reaching a local agent without it.

### c) AGENTVERSE_TOKEN — only for the alternative registration path

You need this only if you register through **Agents → Launch an Agent →
External Integration → uAgents** instead of the inspector, or if you use the
Agentverse CLI.

1. Profile avatar → **API Keys** → **+ New API Key**.
2. Name it, grant **write** access to the resources you are registering, set an
   expiry, then **Generate API Key**.
3. Agentverse asks you to re-authenticate, then shows the key **once**. Copy
   it immediately — it cannot be recovered.
4. Put it in the **agent's** `.env`:

```
AGENTVERSE_TOKEN=your_key_here
```

### d) The seed phrase — generated locally, not from a service

The seed decides the agent's address, so it has to stay the same forever.
Any string works; the convention is a 24-word BIP-39 mnemonic.

```bash
pip install mnemonic
python -c "from mnemonic import Mnemonic; print(Mnemonic('english').generate_str(256))"
```

Put it in the **agent's** `.env`:

```
HEALTHYFY_AGENT_SEED=<the 24 words>
```

**Do not lose this.** If the seed changes, the address changes, and the
Agentverse registration stops matching. Copy the address from the agent's
startup log and put it in the **backend** `.env` as `HEALTHYFY_AGENT_ADDRESS`.

## 3. Set up in five minutes

**Prerequisites:** Node.js 20+ (22 recommended), Python 3.10–3.13, a MongoDB
instance (Atlas or local), an [ASI:One API key](https://asi1.ai/developer), and
an [Agentverse account](https://agentverse.ai).

```bash
# 1. the web app
npm install
cp .env.example .env
#    edit .env: MONGODB_URI, JWT_SECRET, and either
#    ASI1_API_KEY (for the Fetch.ai path) or GEMINI_API_KEY
npm run start:dev            # starts MongoDB + the app, prints the URL

# 2. the uAgent
cd services/healthyfy-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env         # add ASI1_API_KEY and AGENTVERSE_TOKEN
python agent.py              # prints the agent address
```

Copy the printed address into the backend `.env`:

```
HEALTHYFY_AGENT_ADDRESS=agent1q...
```

and restart the web app. The **Agent Network** screen then links to the
agent's Agentverse profile.

### Sign in

`kartik@healthyfy.ai` / `healthyfy123`

## 3. The setup that matters most

For the Fetch.ai submission, the uAgent should run on ASI:One. It already does
by default — the agent's own provider chain is `asi-one → gemini`, and the
uAgent is a Fetch.ai agent, so ASI:One is the right brain for it.

```bash
# services/healthyfy-agent/.env
ASI1_API_KEY=<your key>
HEALTHYFY_AGENT_SEED=<a fixed seed phrase>
```

The agent's address is fixed by the seed, so it is the same on every machine
that uses the same seed:

```
agent1qfvy7fwvsrwyrh9ry562s6uyusaamv6qdxxaaczd3zpg5kvgprsnytl2clc
```

**The mailbox is live.** It was created from the Agentverse inspector
(Connect → Mailbox → Finish) and the log confirms
`Successfully registered as mailbox agent in Agentverse`, so the agent can be
messaged by ASI:One and by other agents on the network. Check it any time:

```bash
./scripts/agent-status.sh
```

To prove it over the network, exactly the way ASI:One does it — resolve the
agent through the Almanac, post to its mailbox, read the reply:

```bash
cd services/healthyfy-agent
.venv/bin/python ../../scripts/network-probe.py
```

> **Keep the agent running before you present.** The Almanac registration
> expires, and it is only refreshed when the agent starts. Start it ten
> minutes before your slot.

The **web app** is a separate concern and runs on whatever is strongest for
the job:

```bash
# .env in the repository root
AI_PROVIDER=gemini        # or asi-one
GEMINI_API_KEY=<your key> # the app's workhorse
ASI1_API_KEY=<your key>   # the app's fallback
```

Every job has a fallback chain, so a single provider outage does not take the
demo down. The **Agent Network** screen shows exactly which model is live for
each role and which are configured.

**Three free clinical APIs need no key at all** and do the grounding:
openFDA (real drug labels and boxed warnings), PubMed (the papers behind the
exercise targets) and NIH RxNorm (drug name canonicalisation).

## 4. How the requirements are met

| Fetch.ai requirement | Where |
| --- | --- |
| **Registered on Agentverse** | `services/healthyfy-agent/agent.py` — `Agent(..., mailbox=True)` and `agent.include(proto, publish_manifest=True)` |
| **Agent Chat Protocol (ACP)** | The `chat_protocol_spec` handler in the same file: acknowledges every `ChatMessage`, replies with `TextContent` |
| **Discoverable and usable through ASI:One** | The published manifest, plus a domain protocol (`HealthRequest` → `HealthResponse`) that ASI:One can route to |
| **Tool execution / multi-agent orchestration** | The uAgent's explicit ASI:One tool loop over the Healthyfy API: `get_medical_reports`, `get_medications`, `get_allergies`, `get_adherence_log`, `get_vitals`, `get_open_alerts`, `run_safety_check` |
| **Workflow completes inside an ASI:One conversation** | The ACP handler answers fully in-conversation, including the question to take to the doctor |
| **Public repository with run instructions** | This file and `README.md` |

### Beyond the minimum

- **A real safety engine.** Every medication is checked against the family's
  allergy history, other medications and recorded conditions, against a
  curated knowledge base. The check runs offline and deterministically.
- **Human-in-the-loop.** The web assistant never writes without approval; the
  action is queued and shown with Approve/Dismiss.
- **Longitudinal reasoning.** The briefing connects a rising HbA1c to the
  medication adherence log. That connection is the point of the project, and
  it is the demo beat to lead with.

## 5. Demo script (4 minutes)

**1. The insight (90 seconds).**
Open the app, Dashboard. The daily briefing says:

> HbA1c rose from 7.1% to 8.4% while doses were being missed.

Expand it: 15 of 27 doses taken over 14 days. The app generated the question
to take to the doctor. This is not a chatbot reading a PDF — it is the
adherence log and the lab trend being connected.

**2. The comparison (45 seconds).**
Open **Compare Reports** and pick Rajesh. The table shows the HbA1c panel from
February against the one from September: Estimated Average Glucose moved out of
range, HbA1c rose 1.3 points. Every row carries the reference range, and the
tests that could *not* be compared are listed with the reason rather than
dropped. Three questions to ask the doctor appear underneath.

**3. The safety engine (45 seconds).**
**Safety Ledger** → type `Amoxicillin 500mg` → the allergy cross-check fires
against the recorded penicillin allergy. Then `Ibuprofen 400mg, Naproxen
250mg` → duplicate therapy. Then switch the member to Rajesh and check
`Amoxicillin` again → **no finding**, because his allergy is sulfa. It is not
pattern-matching every antibiotic.

**4. The follow-up tracker (45 seconds).**
Open **Follow-ups**. There are tasks waiting from the September visit. Upload
or paste a set of visit instructions and press **Read the instructions**: the
app proposes the tasks, and a medication change in the text is turned into
*"ask your prescriber"* rather than an instruction. Nothing is saved until you
tick the boxes and confirm.

**5. The agent on the network (45 seconds).**
Open ASI:One Chat and ask *"What changed in my father's health recently?"*.
ASI:One discovers the Healthyfy agent on Agentverse, calls it, and the answer
comes back — the workflow completes entirely inside the ASI:One conversation.

**Backup (if the network is down):** the uAgent also exposes a local REST
endpoint, so the same call can be made directly. See
`services/healthyfy-agent/README.md`.

## 6. What a reviewer might push on

| Question | Answer |
| --- | --- |
| Is the health data on-chain? | No. Only the agent's identity and manifest are. All medical data stays in MongoDB. |
| Can another agent read my records? | Not without the Healthyfy credentials. The agent reads the account configured in its environment. In production each user authenticates to their own account. |
| How do you avoid false alerts? | The alert ladder is confirmation-first: the person is asked to cancel, and only an unacknowledged alert escalates. Heart-rate detection uses a per-person baseline, requires the reading to be sustained, and suppresses when recent activity explains it. |
| What if the AI is wrong? | The interaction engine is deterministic and offline, not generated. The AI never invents a lab value, and every extraction carries a confidence score with anything under 0.7 flagged for human verification. |
| Where does the clinical data come from? | Three free government APIs with no key, no account and no credit card: **openFDA** for the real drug labels and boxed warnings, **PubMed** for the papers behind the exercise targets, and **NIH RxNorm** for drug name canonicalisation. |
| What does it cost to run? | Two free-tier API keys (Gemini and ASI:One). Everything else is free public data. |
| Does it work without any key? | Yes. Every clinical feature — the safety engine, monitoring, exercise targets, adherence — runs deterministically. The model is only needed for the narrative layers, and each job has a fallback chain. |
| Is this a medical device? | No, and it does not claim to be. It is an educational tool, and it says so in the interface and in every agent response. |
