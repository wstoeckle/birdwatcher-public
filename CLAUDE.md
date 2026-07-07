# BirdWatcher — project guide

A build-it-yourself AI bird-feeder camera. A small always-on computer watches a
feeder, detects motion locally, identifies the visitor with Google Gemini Flash,
and posts the photo plus fun facts to a public gallery website — one codebase that
each household deploys as its own Vercel + Neon + Blob + domain.

This app has its **own** design language — warm, friendly, and photo-forward (cream
background, leaf-green accents, rounded cards). If you have a general-purpose or
editorial design system, it does **not** apply here.

## Repo layout

The website + API live at the **repo root**; the camera code and per-household
config sit alongside.

- `src/` — React + Vite gallery (the public website). `src/types.ts` holds the
  `Sighting` / `SightingInput` types shared by the site and the API; `src/seed.ts`
  is the built-in sample data shown when there's no database.
- `api/` — Vercel serverless functions (ingest, gallery queries, activity rollups,
  the "take a photo now" queue, admin corrections, alerts, spend). Shared helpers
  live in `api/_lib/`.
- `migrations/` — Neon Postgres schema as numbered `.sql` files, run by hand with
  `psql`.
- `camera/` — the camera-side Python service (`birdcam.py`, and `birdcam_multi.py`
  for multiple cameras) plus setup files (`install.sh`, `birdcam.service`,
  `config.example.toml`, `SETUP.md`).
- `sites/` — per-household **non-secret** config registry (one folder per
  deployment; copy `sites/example/`).
- `docs/` — setup, hardware, remote-access, API contract, and troubleshooting.

## Conventions

- **TypeScript strict.**
- **Prettier**: single quotes, 100 columns, semicolons (see `.prettierrc`).
- **Flat ESLint** config in `eslint.config.js`; `npm run lint` runs with
  `--max-warnings=0`.
- **Serverless handlers degrade gracefully** when env vars are missing. No
  `DATABASE_URL` → the API returns nothing and the client falls back to the sample
  data in `src/seed.ts` (so `npm run dev` works with zero setup). No
  `BLOB_READ_WRITE_TOKEN` → ingest requires a direct image URL. Preserve this: a
  fresh clone with no secrets must still run.
- **Run npm scripts from the repo root**: `npm run <script>`.

## Key design decisions

- **Feeder, not open yard.** The camera points at a feeder, so birds appear at a
  known spot and distance. The whole pipeline assumes this.
- **Local motion gate before any API call.** Frame-differencing on the camera side
  decides when something's worth looking at, so Gemini only runs on real visitors.
  This is what keeps the running cost negligible — don't route frames to the cloud
  just to check for motion.
- **Gemini Flash for ID + facts** (cloud). To go fully local later, swap the
  `identify()` step in `camera/birdcam.py` for an on-device classifier (e.g. a
  TFLite bird model or Frigate); the website contract stays the same.
- **One repo, per-household deploy.** Each household is its own Vercel project +
  Neon database + Blob store + domain, all built from this one repo. Keep code
  generic; keep per-deployment identity in config (below), not hardcoded.

## Testing

- `npm run test` (vitest) from the repo root. Also `npm run lint`,
  `npm run typecheck`, and `npm run build`.
- Smoke-test the camera without hardware:
  `python3 camera/birdcam.py --test-image <photo>`.
  **Warning:** if `upload_url` is configured, a bird image will POST a **real**
  sighting to that site. Use a throwaway image or an unconfigured checkout when you
  just want to exercise the pipeline.

## Personalizing your deployment

When someone sets up their own bird cam, these are the spots to edit — no code
logic needs to change:

- `src/siteConfig.ts` — site title, subtitle, public URL, contact email.
- `index.html` — the browser-tab `<title>` and `<meta name="description">`.
- `sites/` — copy `sites/example/site.toml`, rename it for the household, and fill
  in the name, device name, domain, and location hint.
- `camera/config.example.toml` — copy to `config.toml` on the device and set the
  camera source, `upload_url`, ingest token, and Gemini key.

Secrets (database URL, tokens, API keys) go in Vercel's environment variables and
on the device — never commit them. See `.env.example` for the full list.
