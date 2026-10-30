# LabLend — share campus labs & equipment safely

LabLend lets university departments and community partners share underused labs, studios, rooms and specialist equipment with students, researchers and local makers — with eligibility checks, fair allocation, condition records and a tamper-evident audit trail. Owners stay in control: **the system checks, ranks and explains; people decide.**

- **Live demo:** https://lablend.onrender.com
- **Project document:** [PROJECT_DOCUMENT.md](PROJECT_DOCUMENT.md)

## Testing instructions for judges

Open the live link. The landing page explains the product; **Try the demo** leads to one-click personas; every demo account uses the password **`demo1234`**. All data is fictional.

| Persona | Email | What to try |
|---|---|---|
| Aisha Khan — student | `aisha@northfield.edu` | Check in / return the 3D print that starts now; request the laser cutter |
| Sameer Patel — lab manager | `sameer@northfield.edu` | Ranked review queue, inspections, incidents, verifications |
| Dr. Meera Iyer — resource owner | `meera@northfield.edu` | List a new resource and set its conditions |
| Priya Nair — platform admin | `priya@northfield.edu` | Verify identities, review disputes, verify the audit chain |
| Anand Kulkarni — media & library owner | `anand@northfield.edu` | Verify Aisha's media training; no-show incidents |
| Rohan Mehta — community maker | `rohan@makers.community` | Heavy laser user (low priority score), overdue camera kit |
| Kavya Reddy — researcher | `kavya@northfield.edu` | Competing laser request; CNC damage report |
| Arjun Fernandes — student, 1 strike | `arjun@northfield.edu` | Duplicate-certificate submission |
| Ishaan Malhotra — new community member | `ishaan@gmail.example` | Unverified identity → blocked until admin verifies |
| Farhan Qureshi — makerspace owner | `farhan@makers.community` | Community partner listings |

**Full lifecycle in ~8 minutes** (also shown on the Home page after signing in):

1. **Aisha** → My bookings → the 3D print starting now → **Check in** and record condition (mark one item as an issue — it is documented as pre-existing).
2. On the same booking → **Request extension** (instantly approved — nobody is waiting) → **Record return**, marking a *different* item damaged. A damage incident opens automatically and the before/after table highlights the change.
3. **Discover → Laser Cutter** → choose tomorrow 14:00–16:00. Watch the live checks, alternative slots and priority score → **Send request**.
4. **Switch persona → Sameer** → Manage → **Review queue**: three requests compete, ranked by transparent score. Approve the top one — the others move to the waitlist with a written explanation.
5. Sameer → **In use & returns** → inspect the returns; **Incidents** → open the CNC damage report, read the triage summary, decide (e.g. deposit deduction).
6. **Anand** → Verifications → verify Aisha's media training. Sameer's Verifications tab shows Arjun's laser certificate flagged as a duplicate of another user's ID.
7. Demo clock **+1 day** (Demo button, bottom-right): reminders, no-shows (with *proposed* strikes) and overdue returns are detected automatically.
8. **Priya** → Admin → verify Ishaan's identity; **Activity** → verify the hash-chained audit log. **Meera** → Manage → *List a resource*.

> **Demo clock & reset.** Bookings are time-based, so the floating **Demo** button (bottom-right) lets anyone move the clock forward, jump to their next booking, or regenerate the demo data relative to the current time. If the login page says the data is old, click **Regenerate demo data**.

## Run locally

Requires Node.js 18.17+ (tested on 20).

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. Data is stored in `data/db.json` and seeded automatically on first start.

```bash
npm test
```

runs the end-to-end lifecycle tests against a throwaway server and database.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `INSTITUTION_TZ` | `Asia/Kolkata` | Timezone for opening hours and displayed times |
| `DEMO_MODE` | `true` | One-click personas, demo clock, reset button |
| `AUTO_RESEED_HOURS` | `24` | Regenerate demo data at start-up if older than this (0 = never) |
| `ANTHROPIC_API_KEY` | — | Optional. Enables Claude-powered matching, incident triage and certificate notes |
| `AI_MODEL` | `claude-opus-5-5` | Claude model used when the key is set |
| `DB_FILE` | `data/db.json` | Database location |
| `RESET_ON_START` | — | Set to `1` to always reseed |

## Deploy

- **Render (free):** push to GitHub → Render → *New → Blueprint* → select the repo (uses [render.yaml](render.yaml)). Free instances sleep when idle and reseed on wake, which is ideal for judging.
- **Any Docker host (Railway, Fly.io, Cloud Run…):** `docker build -t lablend .` then run with `-p 3000:3000`.

## Project structure

```
server/
  index.js    HTTP API, sessions, RBAC, privacy-scoped serialisers, security headers
  logic.js    Rules engine & lifecycle: eligibility, fair use, priority, waitlist, check-in/out, incidents
  audit.js    Append-only SHA-256 hash-chained activity log + verifier
  ai.js       Claude-assisted matching / triage / certificate notes, with rule-based fallbacks
  seed.js     Fictional demo data, generated by replaying real lifecycle actions in simulated time
  time.js     Institution-timezone helpers and the demo clock
  db.js       Atomic JSON persistence, password hashing
public/
  app.js      App shell: routing, role-based sidebar, dashboards, sign-in, demo controls
  landing.js  Public landing page (built from live data)
  member.js   Discover, resource pages, booking flow, my bookings, profile, fair-use page
  staff.js    Review queue, returns, verifications, incidents, listings, insights, admin
  art.js      Original SVG illustrations for each type of equipment and space
  styles.css  Design system with light and dark themes
test/         End-to-end lifecycle tests (node:test)
```
