# bird-cam API contract

The contract between the Pi (`camera/birdcam.py`) and the website (`api/`). Types
live in [`src/types.ts`](../src/types.ts) and are shared by both the client and
the serverless functions.

## `POST /api/sightings` — ingest a sighting

Sent by the camera when it identifies a confident bird.

**Headers**

```
Content-Type: application/json
Authorization: Bearer <BIRDCAM_INGEST_TOKEN>   # required if the server sets one
```

**Body** (`SightingInput`)

```jsonc
{
  "capturedAt": "2026-06-01T13:45:00Z", // ISO 8601; defaults to now if omitted
  "species": "Northern Cardinal", // required
  "scientificName": "Cardinalis cardinalis",
  "confidence": 0.96, // 0–1
  "funFacts": ["…", "…"],
  "imageBase64": "<base64 JPEG, no data: prefix>", // uploaded to Blob, OR…
  "imageUrl": "https://…/photo.jpg", // …a hosted URL instead
  "device": "feeder-pi",
}
```

Provide **either** `imageBase64` (server uploads it to Vercel Blob) **or** a
public `imageUrl`. `imageBase64` requires `BLOB_READ_WRITE_TOKEN` to be set.

Two optional fields support the "take a photo now" button (below): `manual` (bool,
flags a person-requested shot) and `expiresAt` (ISO 8601 — the row auto-deletes
after this time; used for a manual snapshot that wasn't a confident bird).

`kind` (`"bird"` default, or `"critter"`) routes the sighting: birds show on the
main gallery, critters (non-bird animals/people) on the `/critters` sub-page.

`box` (optional) is a bounding box around the identified subject for the website's
"show me the bird" highlight: `[x, y, width, height]` as fractions 0–1 with
`(x, y)` at the top-left corner, relative to the stored image. Omit or send `null`
when the subject can't be localized.

**Responses**

| Status                                        | Meaning                               |
| --------------------------------------------- | ------------------------------------- |
| `200 {ok:true, persisted:true, id, imageUrl}` | Stored                                |
| `200 {ok:true, persisted:false, imageUrl}`    | Accepted but no DB configured (no-op) |
| `400`                                         | Missing `species` or no image         |
| `401`                                         | Bad/missing token                     |

## `DELETE /api/sightings` — remove a sighting

Used by the site's "Remove this photo" control to clear out the occasional
misidentification. Gated by a shared **`ADMIN_PIN`**. Unlike the capture button,
deletion is destructive, so there is **no default PIN**: if `ADMIN_PIN` is unset
the endpoint stays closed (`403`).

**Body**

```jsonc
{ "id": "123", "pin": "1234" } // id may also be passed as ?id=123
```

Deleting a row also best-effort removes its photo from Vercel Blob (when the
image was one of ours).

Deleting also best-effort records a correction feedback row (`original_species`
→ `"none"`) for the camera's future identification prompt — the "we posted this
but it was a false detection" signal (e.g. a phantom "squirrel" from an empty
frame). This is skipped for expiring manual snapshots and other manual captures
(not the motion pipeline's call) and for person/human photos (those are deleted
for privacy, not because the ID was wrong). See `GET /api/corrections` below.

**Responses**

| Status                                          | Meaning                                 |
| ----------------------------------------------- | --------------------------------------- |
| `200 {ok:true, deleted:true}`                   | Removed                                 |
| `200 {ok:true, deleted:false}`                  | No such id, or no DB configured (no-op) |
| `400`                                           | Missing `id`                            |
| `401 {error:"bad pin"}`                         | Wrong/missing PIN                       |
| `403 {error:"delete disabled (set ADMIN_PIN)"}` | `ADMIN_PIN` not configured              |

> Note: deleting a critter photo does **not** adjust the `/api/critters` tally —
> the counter is independent. Decrement it directly if needed.

## `PATCH /api/sightings` — correct a sighting's species

Used by the site's "Edit species" admin control to fix a misidentification
without deleting the photo. Gated by the same **`ADMIN_PIN`** as delete (unset →
`403`).

Changing the species triggers a refresh: the server asks Gemini for the new
species' **scientific name** and **fun facts** and saves them, so the bio matches
the corrected bird. The Wikipedia **reference photo** is fetched live by the web
client (keyed on species), so it updates on its own. If `GEMINI_API_KEY` isn't
configured (or the call fails), the species and reference photo still update but
the stale facts are **cleared** (response reports `regenerated: false`) rather
than left describing the wrong bird.

The edit also best-effort records a feedback row (`original_species` →
`corrected_species`) for the camera's future identification prompt. That feedback
is aggregate-only when read back by the Pi and does not affect whether the visible
edit succeeds.

**Body**

```jsonc
{ "id": "123", "pin": "1234", "species": "Northern Cardinal" } // id may also be ?id=123
```

**Responses**

| Status                                               | Meaning                            |
| ---------------------------------------------------- | ---------------------------------- |
| `200 {ok:true, updated:true, regenerated, sighting}` | Updated; `sighting` is the new row |
| `200 {ok:true, updated:false}`                       | No DB configured (no-op)           |
| `400`                                                | Missing `id` or `species`          |
| `401 {error:"bad pin"}`                              | Wrong/missing PIN                  |
| `403 {error:"editing disabled (set ADMIN_PIN)"}`     | `ADMIN_PIN` not configured         |
| `404 {error:"not found"}`                            | No sighting with that id           |

> Editing keeps the same `kind` (a bird stays on the bird gallery). The optional
> **`GEMINI_API_KEY`** env var (Vercel) powers the fact regeneration; it also
> accepts the Pi's `BIRDCAM_GEMINI_API_KEY`, and `GEMINI_MODEL` overrides the
> model (default `gemini-2.5-flash`).

## `GET /api/corrections` — correction feedback for the camera

Camera-only endpoint (same Bearer auth as ingest) that returns aggregate admin
species correction pairs. The Pi includes these in the crop-classification prompt
as local "check this known mistake" hints.

**Query:** `kind` (`bird` default, or `critter`), `limit` (1–50, default 12).

**Response**

```jsonc
{
  "corrections": [
    {
      "originalSpecies": "Common Grackle",
      "correctedSpecies": "Brown-headed Cowbird",
      "count": 3,
      "latestAt": "2026-06-30T12:00:00.000Z",
    },
  ],
}
```

No database returns `{ "corrections": [] }`; bad/missing Bearer token returns
`401`.

> A pair can have `correctedSpecies: "none"` — that means an admin **deleted**
> that post as a false detection (see `DELETE /api/sightings` above), not that
> it was re-identified as something else. The camera should treat these as "be
> extra skeptical before reporting this label" rather than a substitution hint.

## `GET /api/sightings` — list sightings (the gallery)

**Query:** `limit` (1–500, default 120), `species` (optional case-insensitive
exact filter), `kind` (optional — `bird` or `critter`).

**Response**

```jsonc
{
  "sightings": [
    /* Sighting[], newest first */
  ],
}
```

When no database is configured this returns `{ "sightings": [] }`, and the web
client falls back to built-in seed data so the page is never empty.

A `Sighting` is a `SightingInput` after storage: it always has an `id` and a
resolved `imageUrl`, and `funFacts` is always an array.

## `POST /api/capture` — request a live photo ("take a photo now")

Called by the **website** when a visitor presses the live-photo button. Gated by a
shared PIN (no Bearer token — it's a public button).

**Body**

```jsonc
{ "pin": "4434", "camera": "feeder-pi" } // camera may be "feeder-pi" or "yard-reolink"
```

The `camera` field is optional. If omitted, the request uses the original behavior:
all configured cameras take a photo.

**Responses**

| Status                                             | Meaning                               |
| -------------------------------------------------- | ------------------------------------- |
| `200 {ok:true, queued:true}`                       | Request queued for the camera         |
| `200 {ok:true, queued:false, alreadyPending:true}` | A shot is already on the way          |
| `200 {ok:true, queued:false}`                      | Accepted but no DB configured (no-op) |
| `401 {error:"bad pin"}`                            | Wrong/missing PIN                     |

## `GET /api/capture` — claim a pending request (camera only)

Polled by the **Pi**. Atomically claims the oldest pending request so the camera
knows to take a shot now (the Pi is behind a home router and can't be reached
directly, so it polls). Requires the same Bearer auth as ingest.

**Response**

```jsonc
{ "pending": true, "camera": "feeder-pi" } // true → take a photo from this camera
```

The Pi then captures a frame and POSTs it to `/api/sightings` with `manual:true`
(a confident bird) or with `manual:true` + `expiresAt` (anything else — shown
briefly, then auto-removed). Empty/no-DB returns `{ "pending": false }`.

## `POST /api/critters` — tally a non-bird visitor

Sent by the camera when it sees a critter (squirrel, chipmunk, …). No photo —
just bumps a per-category counter by one.

**Headers:** same Bearer auth as sightings.

**Body** (`CritterInput`)

```jsonc
{ "species": "squirrel" } // short lowercase label; lower-cased + trimmed server-side
```

**Responses:** `200 {ok:true, persisted:true, species, count}` (or `persisted:false`
with no DB), `400` (missing species), `401` (bad token).

## `GET /api/critters` — the tallies (for the counter)

**Response**

```jsonc
{ "critters": [ { "species": "squirrel", "count": 543, "lastSeen": "…" }, … ] }
```

Highest count first. Empty (`{ "critters": [] }`) when there's no database or no
critters yet — the site then shows a zero state (it does **not** substitute seed
data on the live site, so the counter genuinely starts at zero).

## `POST /api/usage` — record Gemini token usage

Sent by the camera after **every** `identify()` call (including the many "none"
results — that's the real spend). Aggregated per day + model for the admin-only
`/spend` page's estimated cost.

**Headers:** same Bearer auth as sightings.

**Body**

```jsonc
{ "model": "gemini-2.5-flash", "inputTokens": 1234, "outputTokens": 56 }
```

**Responses:** `200 {ok:true, persisted:true}` (or `persisted:false` with no DB),
`401` (bad token).

## `GET /api/usage` — estimated spend (admin)

Read by the `/spend` page. Gated by the shared **`ADMIN_PIN`** (same code as the
delete control); `403` if `ADMIN_PIN` isn't set.

**Query:** `pin=<ADMIN_PIN>`

**Response**

```jsonc
{
  "estimatedUsd": 0.0421,
  "totals": { "calls": 318, "inputTokens": 290144, "outputTokens": 5120 },
  "days": [ { "day": "2026-06-23", "calls": 120, "inputTokens": 110000, "outputTokens": 2000, "usd": 0.0381 }, … ]
}
```

Cost is an **estimate**: reported tokens × Google's published per-token prices
(see `PRICING` in `api/usage.ts`), not the actual bill. `401` (bad pin), `403`
(`ADMIN_PIN` unset).
