# Focus / sharpness debugging guide

Living notes on the "everything is soft" problem, so anyone (human or an
on-device agent) can pick up where they left off without re-deriving it.

## TL;DR diagnosis (example case)

**The camera cannot bring anything into focus through the current enclosure —
it is an optical-path problem, NOT a focus-distance or glare problem.** The fix
is physical and requires hands at the camera; no `lens_position` value will help.

## How we know

Ran `camera/focus_calibrate.py`, which sweeps manual focus (`LensPosition`) and
measures gradient-variance sharpness on two regions: the **feeder** and a
**control** (the green tractor — close, high-contrast, NOT backlit).

- Swept the **entire** focus range, ~13 in (`lp 2.5`) to ~11 ft (`lp 0.3`).
- **Feeder** sharpness: flat, noisy, spread ~1.6× — scores bounce between
  adjacent steps (physically impossible for real focus), i.e. pure scene noise.
- **Control** (tractor) sharpness: dead flat, spread ~1.3×, with its "best"
  scores at the *extremes* of the range — no focus peak at all.
- Autofocus, when allowed to run, locks at `LensPosition≈12` (~3 in) — it finds
  its sharpest contrast **on the lid surface itself**, i.e. on something stuck to
  the glass right in front of the lens.

Because even a close, high-contrast, non-backlit subject never sharpens at any
focus distance, the light is being scrambled **before** it reaches the sensor.
That rules out: focus distance (swept all of it), and backlight/glare (the
control isn't backlit and is still flat, so re-aiming won't help).

## What changed (the clue)

An earlier indoor test shot (`orient.jpg`) through this **same plastic lid** was
sharp. So the plastic itself is fine — something changed **after** that: the unit
was shipped and mounted. Leading suspects:

1. The Camera Module shifted on its tape in transit — now shooting through the
   lid at an angle, partly behind the black foam light-mask, or pressed against /
   gapped from the lid.
2. A film/smudge on the lens front element or the inside of the lid (foam
   outgassing residue, oil, pollen) — a haze, not visible "fog" (no condensation
   was visible).

## Fix (hands at the camera) — then verify

1. Open the lid. Confirm the **lens is centered behind the clear window**, not
   behind the foam mask or the opaque rim.
2. Confirm the camera is **flush and square** to the lid — not bumped, tilted, or
   peeling off its tape.
3. **Wipe the lens front element + the inside of the lid** with a microfiber.
   Check for a leftover **protective film** on the lens.
4. Reseat, close, and re-run:

   ```bash
   sudo systemctl stop birdcam
   python3 camera/focus_calibrate.py
   ```

   Success = the **control spread jumps well above 2×** and a clear feeder peak
   appears (scores ~15k–30k+). Set `lens_position` to that peak in `config.toml`
   and `sudo systemctl restart birdcam`.

If, after cleaning/reseating, the camera focuses but the feeder still trails the
control, that's the residual plastic softness — the fix is a glass viewport: cut
an opening in the enclosure window and mount an optical-glass UV filter (a cheap
screw-on camera lens filter) over it with silicone, so the camera shoots through
real glass instead of acrylic.

## Reminder: the bar is bird ID, not a tack-sharp photo

Gemini only needs the bird reasonably in focus and large enough in frame. Once
the optics are un-degraded, let a real bird be the test rather than the static
scene.
