# Text/MMS alerts (Twilio)

When a new bird (or, opt-in, a non-bird visitor) is posted, the site can text the
photo to whoever's subscribed. It runs from the website API (`api/_lib/notify.ts`,
called by `POST /api/sightings`) and **does nothing until the env vars below are
set** — so the site works fine with notifications off.

## One-time Twilio setup

1. Create a **Twilio** account.
2. Buy **one phone number** that supports **MMS** (US local or toll-free).
3. From the console, copy your **Account SID** and **Auth Token**.
4. **US carrier registration (required for delivery):** app-to-person texting to US
   numbers needs either **A2P 10DLC** registration (for a local number — there's a
   low-volume "sole proprietor" path) or **toll-free verification** (if you bought a
   toll-free number). Start this early; approval can take a few days. Twilio's
   console walks you through it.

## Env vars (set in the Vercel project — never in the repo)

| Var | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (`AC…`) |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_FROM` | your Twilio number, E.164 (e.g. `+15085551234`) |
| `ALERT_SMS_TO` | comma-separated recipient numbers for **bird** alerts (E.164) |
| `ALERT_SMS_CRITTERS` | comma-separated numbers that **also** want non-bird alerts (opt-in; leave empty for none) |

After setting them, **redeploy** (env changes only apply to a new deployment).

## Behavior

- Fires on a freshly-stored **bird** sighting → MMS (photo + species + a fun fact)
  to `ALERT_SMS_TO`.
- Fires on a **critter** (non-bird animal/person) only to `ALERT_SMS_CRITTERS` —
  so people opt in to the squirrel/coyote/human stream separately.
- **Skips manual "take a photo now" snapshots** — pressing the button shouldn't
  text everyone.
- Send failures are logged and swallowed; they never fail the camera's upload.

## Cost note

SMS/MMS are a fraction of a cent to a few cents each, plus ~$1–2/mo for the number.
For a feeder that posts a handful of times a day, it's negligible.
