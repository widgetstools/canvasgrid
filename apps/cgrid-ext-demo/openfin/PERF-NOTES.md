# OpenFin performance findings (2026-07-11, macOS M4 Max)

**Symptom.** The demo feels janky in OpenFin while the identical production
build is perfectly smooth in Chrome (120fps, zero long frames).

**Measured.** In OpenFin the app paces at its 60Hz cap with a median frame
of 16.6ms, but every couple of seconds a frame costs 50–210ms. Tracing shows
those frames are single `requestAnimationFrame` ticks inside the kernel's
paint loop (`tickPaint → paintNow`) — one full-viewport canvas repaint.

**Root cause.** The OpenFin runtime executes Canvas2D work ~3–10× slower
than current Chrome on the same machine (its Chromium builds don't carry
Chrome's optimized canvas pipeline/PGO). Microbenchmarks, same hardware:

| op (same test both runtimes)      | OpenFin | Chrome |
|-----------------------------------|---------|--------|
| 20k `fillText`, detached canvas   | 90–185ms| 30–34ms|
| 50k `fillRect`                    | 64ms    | 16ms   |
| 20k save/clip/restore             | 40ms    | 13ms   |
| 8k `fillText` on the grid canvas  | 12–19ms queue + ~20ms flush | 1–2ms queue + ~5ms flush |

A full cgrid repaint that fits invisibly in Chrome's frame budget therefore
costs 50–100ms in OpenFin. Every dirty event (tick batch, flash decay,
scroll, hover) can trigger one → visible hitches.

**Ruled out by experiment** (do not re-try):
- GPU acceleration off — `SystemInfo.getInfo` shows canvas + compositing
  enabled, ANGLE Metal on the M4 Max.
- `--enable-features=SkiaGraphite` — enables cleanly, no improvement.
- Runtime 44.146.101.5 (Chromium 146, Graphite default) — *more* hitches
  than 41.134.102.3 (6–11 vs 2–3 per 5s); manifest stays pinned to 41.
- `--disable-lcd-text` — no change.
- Device scale factor 1 instead of 2 — no change (hitches aren't
  pixel-bound; the cost is in command recording/raster dispatch).
- Fonts — JetBrains Mono + Inter resolve in both runtimes; `ctx.font` set
  cost is trivial.
- App-side periodic work — no `getState`/`localStorage`/`JSON.stringify`
  calls at rest; hitches persist with the STOMP feed cut.
- An empty page in OpenFin paces perfectly (60fps, zero >50ms frames):
  the runtime compositor is fine, the cost is our canvas paint volume.

**What would actually fix it** (kernel work, in impact order):
1. Dirty-region painting: repaint only the cells a tick touched instead of
   the full viewport. Ticks touch a handful of cells; this turns 50–100ms
   paints into sub-millisecond ones regardless of runtime.
2. Row-strip bitmap caching: blit unchanged rows from cached bitmaps during
   scroll repaints.
3. A paint-budget/coalescing knob (e.g. cap tick-driven repaints at 30Hz
   under load) — halves hitch frequency, doesn't shrink a single hitch.

Reproduce the measurements with `perf-probe.mjs` (hosted window via CDP
:9223) and `baseline-probe.mjs` (stock Chrome), after
`npm run build && npx vite preview --port 4188` and launching
`openfin --launch --config openfin/app.json` from a shell without
`ELECTRON_RUN_AS_NODE`.
