# Deploying Healthyfy to Netlify

## What is where

| Piece | How Netlify runs it |
| --- | --- |
| The frontend (React + Vite) | A static build, published from `dist/` |
| The API | `netlify/functions/api.ts` — the same Express app the local server uses, wrapped with `serverless-http` |
| Reminders, medication prompts, alert escalation, the daily briefing | `netlify/functions/scheduler.ts`, run on a cron schedule |
| The uAgent | Already published on Agentverse with a live mailbox — it does not live on Netlify |

A Netlify function has no long-lived process, so the background work
cannot live inside the API function. It runs as a scheduled function
instead, which is what the cron schedule in `netlify.toml` is for.

## Before you start

Two things to have ready:

1. **A Netlify account.** <https://app.netlify.com/signup> — free is
   fine.
2. **A MongoDB Atlas cluster (free tier).** <https://www.mongodb.com/atlas/register>
   The free M0 tier is enough.

   Without Atlas the app still works: it falls back to in-memory data and
   says so in the log. The demo family, reports, medications and
   adherence history are seeded deterministically, so a judge still sees
   a populated app. Data just does not survive a cold start.

## Step 1 — Authorise the CLI

```bash
npx netlify login
```

It prints a URL and opens a browser. Approve it there. If the browser
is not on this machine, open the printed URL on your own.

**Alternative** — if the browser flow is awkward, create a personal
access token instead:
<https://app.netlify.com/user-settings/tokens> → *New token* → copy it,
then:

```bash
export NETLIFY_AUTH_TOKEN=your-token
```

## Step 2 — Create the site and link it

```bash
npx netlify sites:create --name healthyfy-ai
npx netlify link          # pick the site you just created
```

## Step 3 — Set the environment variables

```bash
npx netlify env:set MONGODB_URI "mongodb+srv://..."
npx netlify env:set JWT_SECRET "$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
npx netlify env:set GEMINI_API_KEY "your-gemini-key"
npx netlify env:set ASI1_API_KEY "your-asi-one-key"
```

`JWT_SECRET` is required: without it the app refuses to start in
production, because a default signing secret would let anyone mint a
token for any account.

Optional:

```bash
# The free tier allows 20 requests a day per model, so the app
# rotates through these names automatically. Override to change the
# order or the list.
npx netlify env:set GEMINI_MODELS "gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite"
```

## Step 4 — Deploy

```bash
npx netlify deploy --prod
```

It prints the live URL.

## Step 5 — Check it

```bash
# The API is live and the database is connected
curl <the-url>/api/health

# The frontend is served
curl -o /dev/null -w "%{http_code}\n" <the-url>/
```

## Things worth knowing

**Function timeout.** Netlify allows 26 seconds. The endpoints that
call a model are the slow ones — the assistant's tool loop can take
around 30 seconds locally — so they are the most likely to be cut off
in production. If the chat feels slow or drops out, that is the
limit, not a bug. The static parts of the app are unaffected.

**Cold starts.** The first request after a period of inactivity takes
longer while the function boots and connects to MongoDB.

**The scheduler.** The cron in `netlify.toml` runs every five minutes.
Netlify's free plan may throttle scheduled functions, so the reminders
may fire less often than they do locally. The manual
`POST /api/scheduler/run` endpoint still works and runs a tick on
demand.

**The TypeScript version.** The project is pinned to TypeScript 5.9.
Netlify's build uses `@typescript-eslint` through `precinct`, and that
cannot read the TypeScript 7 JavaScript API, so the build fails with
`Cannot read properties of undefined (reading 'Intrinsic')` on 7.

**If the build fails on the functions**, run it locally first to see
the real error:

```bash
npx netlify build
```

## If you would rather not use the functions

The frontend and the API can live on different platforms, with Netlify
proxying between them. Put the backend on any host that runs a
long-lived Node process — Render, Railway or a VPS — and then in
`netlify.toml` change the redirect:

```toml
[[redirects]]
  from = "/api/*"
  to = "https://your-backend.example.com/api/:splat"
  status = 200
  force = true
```

This is the better option if the assistant's tool loop needs more than
26 seconds, because a real server has no execution limit and the
background scheduler keeps working.
