# Sites registry

One folder per household. `site.toml` holds that deployment's NON-SECRET config.
Secrets (DB URL, Blob token, ingest token, Gemini key) live in that deployment's
Vercel env + the Pi's `camera/birdcam.env`. To add a camera: copy a folder, edit
it, then create a matching Vercel project + Neon + Blob + domain.
