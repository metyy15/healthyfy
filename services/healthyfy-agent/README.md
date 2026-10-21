# Healthyfy Health Agent (uAgent + ASI:One)

A [Fetch.ai](https://fetch.ai) **uAgent** that turns the Healthyfy family-care
app into a discoverable agent on **Agentverse**, with **ASI:One** (`asi1`) as its
brain.

The agent does not answer from memory. It reads the family's real Healthyfy
records — medical reports and lab values, medications, allergies, the 14-day
adherence log, recent vitals, open health alerts, the daily briefing, the
exercise plan — through the Healthyfy REST API, using a **real tool-calling
loop** against ASI:One, and then explains what it found in plain language.

- **Agent Chat Protocol (ACP)** — ASI:One Chat (and anything else that speaks
  ACP) can hold a conversation with the agent.
- **A domain protocol** (`healthyfy-health` v0.1.0) — other Fetch.ai agents
  can call this agent as a *tool* and get a structured `HealthResponse` back.
- **Local REST endpoints** — `GET /health` and `POST /ask` on the agent's own
  HTTP server, so the whole thing can be tested with `curl`.

---

## 1. What it is, and how it uses ASI:One

```
Agentverse / ASI:One Chat
        │  Agent Chat Protocol (ChatMessage -> ChatAcknowledgement -> ChatMessage)
        ▼
  healthyfy-health-agent  (uAgents, Python)
        │  OpenAI-compatible tool-calling loop  ->  model "asi1"
        │  tools: get_medical_reports, get_medications, get_allergies,
        │         get_adherence_log, get_vitals, get_open_alerts,
        │         run_safety_check, get_daily_briefing, get_exercise_plan,
        │         compare_reports, list_follow_ups, raise_health_alert,
        │         list_family_members
        ▼
  Healthyfy REST API  (http://localhost:3000)
```

1. A message arrives over ACP. The agent **always** replies with a
   `ChatAcknowledgement` first, so the client knows the message was received.
2. The agent picks the family member (a name in the message, else
   `HEALTHYFY_DEFAULT_MEMBER`, else the first member on the account).
3. The agent hands ASI:One the question plus the tool catalogue. ASI:One
   decides which Healthyfy tools to call.
4. Each tool call is executed against the Healthyfy API, and the result is fed
   back to the model as a `role="tool"` message. The loop runs for at most
   **6 turns**.
5. When the model stops asking for tools, its message becomes the answer.
6. The reply states the member's name and how many records were consulted, and
   ends with the educational disclaimer.

The loop is written by hand (not the experimental `ChatAgent` class) so the
behaviour is predictable and easy to demo.

### Safety rules baked into the system instruction

- The model must call the tools; it may not guess a lab value, a medication or
  a date.
- It never diagnoses and never suggests changing, starting or skipping a dose.
- Emergency symptoms (chest pain, trouble breathing, stroke signs, loss of
  consciousness, severe bleeding, a bad fall, a dangerous heart rate or SpO2)
  get an immediate "call your local emergency number" line at the top.
- A model-requested **critical** alert is downgraded to **warning** by the
  agent, so an LLM can never page a family with a critical alert on its own
  judgement.
- Every answer ends with: *"This is educational information from your own
  Healthyfy records, not a diagnosis. Please discuss it with your doctor or
  pharmacist before changing anything."*

---

## 2. Requirements

- **Python 3.10 – 3.13** (developed and tested on 3.11).
- The **Healthyfy backend running** on `http://localhost:3000` (see below).
- An **ASI:One API key** (for the brain).
- An **Agentverse token** (for the mailbox and the Agentverse profile).

---

## 3. Install and run

```bash
cd services/healthyfy-agent

# 1. virtualenv + dependencies
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 2. configuration
cp .env.example .env
$EDITOR .env                        # fill in ASI1_API_KEY and AGENTVERSE_TOKEN

# 3. run the agent
python agent.py
```

The agent prints its address on startup:

```
INFO     healthyfy.agent: Healthyfy agent healthyfy-health-agent
INFO     healthyfy.agent: Agent address: agent1q...
INFO     healthyfy.agent: ASI:One: https://api.asi1.ai/v1
INFO     healthyfy.agent: Healthyfy backend: http://localhost:3000
INFO     healthyfy.agent: Mailbox: yes
```

`HEALTHYFY_AGENT_SEED` fixes the agent address. **Set it** if you want the
same address every time you restart — otherwise the agent generates a new one
and its Agentverse profile has to be updated.

### Without a mailbox

If `AGENTVERSE_TOKEN` is empty the agent runs as a **local agent**: it still
serves the REST endpoints and still answers over the local network, it just
cannot be reached from Agentverse. This is the quickest way to test.

---

## 4. The Healthyfy backend must be running first

The agent reads the Healthyfy app over HTTP, so the app has to be up:

```bash
# from the repository root
npm run dev            # tsx server.ts, serves http://localhost:3000
```

Check it:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","uptime":12.3,"env":"development"}
```

The agent signs in with the account in `HEALTHYFY_EMAIL` /
`HEALTHYFY_PASSWORD`. The seeded demo account is `kartik@healthyfy.ai` /
`healthyfy123`, which has four family members (Kartik, Rajesh, Sunita, Ananya)
with reports, medications, allergies, vitals and alerts.

---

## 5. Getting the keys

### ASI:One API key

1. Go to **https://asi1.ai/developer** and sign up.
2. Create an API key in the developer dashboard.
3. Put it in `.env`:

   ```
   ASI1_API_KEY=sk-...
   ASI1_BASE_URL=https://api.asi1.ai/v1
   ```

The model name is `asi1` by default. Override it with `ASI1_MODEL=` if you want
a different one.

Without a key the agent still works: it falls back to a deterministic summary
built straight from the Healthyfy records and says so in the reply. You will
see the message *"ASI:One is not answering right now…"* only if the key is
present but unreachable; with **no** key at all the fallback path is used
silently and the log line `ASI:One is not configured` appears at startup.

### Agentverse token

1. Create a free account at **https://agentverse.ai** and sign in.
2. Open **Profile → API Tokens** (or *Settings → Developer → API keys*).
3. Create a token and put it in `.env`:

   ```
   AGENTVERSE_TOKEN=<your token>
   ```

The token is what lets the agent use an Agentverse mailbox, which is how
messages from ASI:One Chat reach it.

---

## 6. Test it locally

### 0) Check the registration and the mailbox

```bash
./scripts/agent-status.sh
```

This reads the public Almanac record (status, type, endpoint, published
protocols, expiry) and tells you whether the mailbox is live. The mailbox
is what lets ASI:One and other agents actually deliver a message to this
agent; the manifest alone only makes it discoverable.

### a) The agent's own REST endpoints
The uAgents framework serves these on the agent's HTTP port (8000 by default,
override with `HEALTHYFY_AGENT_PORT`).

```bash
# is the agent up, and how is it configured?
curl http://localhost:8000/health

# ask a question (this runs the full ASI:One tool loop)
curl -X POST http://localhost:8000/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"How is my father'"'"'s cholesterol doing, and is he taking his medication?"}'
```

```json
{
  "answer": "Rajesh Sharma's most recent lipid profile (18 Sep 2026) shows ...",
  "member_name": "Rajesh Sharma",
  "records": 14,
  "data_sources": ["/api/records", "/api/medications", "/api/adherence"],
  "disclaimer": "This is educational information from your own Healthyfy records, not a diagnosis. ..."
}
```

### b) A Python snippet that talks to the agent over the uAgents network

```python
# scripts/query_agent.py — run it with the same virtualenv
import asyncio

from uagents import Agent, Context
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
)

RECIPIENT = "agent1q..."  # the address your agent logged at startup


async def main() -> None:
    sender = Agent(name="tester", seed="a deterministic seed for the tester")

    @sender.on_event("startup")
    async def start(ctx: Context) -> None:
        await ctx.send(
            RECIPIENT,
            ChatMessage(content=[TextContent(text="What is in my father's latest blood test?")]),
        )

    @sender.on_message(ChatAcknowledgement)
    async def ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
        print("acknowledged")

    @sender.on_message(ChatMessage)
    async def reply(ctx: Context, sender: str, msg: ChatMessage) -> None:
        print("answer:", msg.text())
        await ctx.stop()

    await sender.run_async()


asyncio.run(main())
```

### c) The domain protocol, from another agent

```python
from uagents import Agent, Context
from protocol import HealthRequest, HealthResponse

@agent.on_message(HealthRequest)
async def handle(ctx: Context, sender: str, msg: HealthRequest) -> None:
    response = await ctx.send(
        sender,
        HealthResponse(
            answer="...",
            member_name="Rajesh Sharma",
            evidence="3 medical report(s); 2 medication(s)",
            open_alerts=1,
            data_sources=["/api/records", "/api/medications"],
            disclaimer="Educational information only, not a diagnosis.",
        ),
    )
```

The Healthyfy agent answers with the same `HealthResponse` shape.

### d) Check the Healthyfy side directly

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"kartik@healthyfy.ai","password":"healthyfy123"}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/records?memberId=fam-2"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/adherence?memberId=fam-2&days=14"
```

---

## 7. Register on Agentverse

1. Start the agent with `AGENTVERSE_TOKEN` set and `HEALTHYFY_AGENT_SEED` set
   (so the address stays stable).
2. Open **https://agentverse.ai** → **Profile** → **Register New Agent** (or
   *Developers → Register*).
3. Paste the agent address your terminal logged.
4. Fill in the profile with **exactly** this text:

**Name**

```
Healthyfy Health Agent
```

**Handle**

```
healthyfy-health-agent
```

**Description**

```
A family health assistant that reads your own Healthyfy medical records — lab reports and values, medications, allergies, medication adherence, recent vitals and open health alerts — and explains them in plain language.

It uses ASI:One as its brain with a real tool-calling loop: every answer is based on records it actually fetched from the Healthyfy app, never on recall. It never diagnoses and never suggests changing a dose, it points emergency symptoms to emergency services, and every answer ends with an educational disclaimer.

Talk to it in Agentverse or in ASI:One Chat, or call it from another agent over the healthyfy-health protocol.
```

**Tags**

```
health
family-care
medical-records
medication-adherence
agent-chat-protocol
acp
asi-one
```

**README / long description**

```
Healthyfy Health Agent — a uAgent on Agentverse, powered by ASI:One.

WHAT IT DOES
Ask about any family member in the Healthyfy app: "How is my father's
cholesterol doing?", "Is my mother taking her diabetes medication?", "Any
alerts open right now?". The agent reads the records through the Healthyfy
REST API and answers from them.

TOOLS
get_medical_reports, get_medications, get_allergies, get_adherence_log,
get_vitals, get_open_alerts, run_safety_check, get_daily_briefing,
get_exercise_plan, raise_health_alert, list_family_members.

PROTOCOLS
- Agent Chat Protocol (ACP) — chat with it from ASI:One Chat or Agentverse.
- healthyfy-health v0.1.0 — HealthRequest -> HealthResponse, so other agents
  can call it as a tool.

SAFETY
Educational information only, never a diagnosis. Never advises a dose
change. Emergency symptoms are routed to emergency services.

CONSENT
The agent reads the Healthyfy account configured in its environment file.
```

5. Save. The agent publishes its protocol manifests to the Almanac when it
   starts (`agent.include(..., publish_manifest=True)`), which is what makes
   the protocols discoverable.

---

## 8. Demo it in ASI:One Chat

1. Keep `python agent.py` running with `AGENTVERSE_TOKEN` set.
2. Open **https://chat.asi1.ai** (or the ASI:One Chat inside Agentverse).
3. Pick the registered agent **Healthyfy Health Agent**.
4. Try these prompts, in order — each one exercises a different tool:

   | Prompt | What it exercises |
   | --- | --- |
   | `Who is in my family and what are their ages?` | `list_family_members` |
   | `How is my father's cholesterol doing?` | `get_medical_reports` + `get_medications` |
   | `Is my mother actually taking her diabetes medicine?` | `get_adherence_log` + `get_medications` |
   | `Does my father have any allergies or drug interactions?` | `get_allergies` + `run_safety_check` |
   | `Any alerts open right now?` | `get_open_alerts` |
   | `What should I ask the doctor at the next visit?` | `get_daily_briefing` |
   | `What exercise can my sister safely do?` | `get_exercise_plan` + `get_vitals` |
   | `Compare my father's latest blood test with his previous report and explain what changed.` | `compare_reports` |
   | `What do I need to do this week?` | `list_follow_ups` |
   | `Please raise an alert that my father skipped his evening dose` | `raise_health_alert` → `POST /api/alerts` |

5. Watch the agent's terminal: every tool call is logged, e.g.
   `Tool get_medical_reports -> 3 medical report(s) (Lipid Profile, HbA1c Profile, CBC)`.

---

## 9. Consent model

**The agent reads the Healthyfy account configured in its environment file.**
`HEALTHYFY_EMAIL` and `HEALTHYFY_PASSWORD` are the credentials the agent
signs in with, and every record it shows belongs to that account. Anyone who
can reach the agent can therefore read that account's family records — the
agent itself performs no per-caller authorisation.

This is a **demo single-tenant setup**. In a real deployment:

- each user authenticates to **their own** Healthyfy account (the login step
  is a plain `POST /api/auth/login` — the token is per-account and is never
  shared between users),
- the caller's identity is bound to that token before any record is read,
- the agent only ever returns records belonging to the authenticated account,
- the Agentverse profile describes the agent's capability, not a family's data.

The seeded demo account contains fictional health data only.

---

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ModuleNotFoundError: No module named 'uagents'` | Activate the venv: `source .venv/bin/activate`, then `pip install -r requirements.txt`. |
| `ASI:One is not configured` | `ASI1_API_KEY` is empty. Put the key in `.env` next to the agent, or export it in the shell. |
| `ASI:One request failed: ...` | The key or the base URL is wrong, or the machine has no route to `api.asi1.ai`. The agent falls back to a raw record summary instead of crashing. |
| `Healthyfy login rejected with 401` | `HEALTHYFY_EMAIL` / `HEALTHYFY_PASSWORD` do not match an account. The demo account is `kartik@healthyfy.ai` / `healthyfy123`. |
| `Healthyfy login failed: ConnectError` | The Healthyfy backend is not running. Start it with `npm run dev` in the repository root and check `curl http://localhost:3000/api/health`. |
| The agent answers "I could not read the Healthyfy family list" | The backend is down, the credentials are wrong, or `HEALTHYFY_BASE_URL` points somewhere else. |
| `AGENTVERSE_TOKEN is not set, running as a local agent without a mailbox` | Expected without a token. The agent is reachable locally but not from Agentverse. |
| The agent cannot be reached from ASI:One Chat | The mailbox needs a valid `AGENTVERSE_TOKEN`, a stable `HEALTHYFY_AGENT_SEED`, and the agent process running. Check the `Agent address:` line in the log matches the address registered on Agentverse. |
| `Address already in use` on start | Another agent is on port 8000. Set `HEALTHYFY_AGENT_PORT=8001` in `.env`. |
| The answer has no member name | `HEALTHYFY_DEFAULT_MEMBER` is empty and the question does not name anyone, so the first member on the account is used. Set it to e.g. `Rajesh Sharma`. |
| `POST /ask` returns 404 | The REST endpoints are served on the agent's own port (8000), not on the Healthyfy app's port (3000). |
| Everything works but ASI:One never calls a tool | Check that `ASI1_BASE_URL` points at a tool-calling endpoint and that the model name in `ASI1_MODEL` supports tools. |
| ASI:One says the agent "didn't respond" | The agent received the message but threw while replying. Check the agent log for `Exception in message handler`. The two usual causes are the acknowledgement and the message history, both covered in the gotchas below. |
| ASI:One finds the agent but answers from its own knowledge | The agent has no published profile, so the planner has nothing to reason about. The description and README have to reach the Agentverse profile, not just the Almanac record. |

---

## 11. Two gotchas in the uAgents framework

Both of these stop the agent from starting, and neither produces a helpful
error, so they are worth knowing about.

**`litellm` is pulled in by an unrelated import.**
`uagents.experimental.chat_agent.protocol` looks like a harmless way to get
`build_llm_message_history`, but importing it executes
`uagents/experimental/chat_agent/__init__.py`, which imports `litellm` at
package level. Since this agent drives ASI:One through the plain `openai`
client it does not need that dependency at all, so `agent.py` tries the
import and falls back to a local copy of the ten-line helper. The result is
an install of three small packages instead of the full `uagents[llm]` extra.

**A protocol built from a `ProtocolSpecification` is locked, and the lock
check is strict.** `Protocol(spec=...)` compares the `replies` argument of
`on_message` against the specification's internal reply map, and the two are
stored in different shapes, so an equivalent set is rejected with
`Specified replies ... do not match the replies defined in the protocol
specification`. The domain protocol in `protocol.py` is therefore created
with an explicit `name=` and `version=` instead of `spec=`, which lets the
`replies={HealthResponse}` argument populate the published manifest
identically.

A related point on the chat protocol: `chat_protocol_spec` declares both
`ChatMessage` and `ChatAcknowledgement`, and a protocol is only published
once it implements every interaction in its specification. So the agent needs
a handler for `ChatAcknowledgement` even though it does nothing with it.
Without it, `include(chat_proto, publish_manifest=True)` fails with
`Protocol AgentChatProtocol:0.3.0 failed verification`.

---

## 12. Files

| File | What it does |
| --- | --- |
| `agent.py` | The uAgent: ACP chat handler, the ASI:One tool loop, the tool catalogue, the domain-protocol handler, the agent wiring. |
| `protocol.py` | `HealthRequest` / `HealthResponse` models and the `healthyfy-health` protocol. |
| `healthyfy_client.py` | Async HTTP client for the Healthyfy REST API. |
| `requirements.txt` | Python dependencies. |
| `.env.example` | Every configuration value the agent reads. |
