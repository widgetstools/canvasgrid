# `lib/` — vendored third-party artifacts

Pinned binary artifacts that are NOT built from this repo's source. Each lives
in its own directory beside a provenance record, because a binary you cannot
trace to a source revision is a binary you cannot reason about.

---

## `dshub-hub/dshub-hub-0.1.0.tgz`

The Rust/wasm DataSource Hub — a keyed columnar cache plus a purpose-built
query engine, hosted in a SharedWorker. Built from
[`widgetstools/rangrez`](https://github.com/widgetstools/rangrez) `hub-rust/`.

Vendored so canvasgrid can evaluate it against the SSRM and CSRM paths without
a cross-repo build step. Both repos are the same org, so **modify it in
rangrez, not here** — this directory holds an artifact, never a fork. See
`docs/velocity-grid-architecture.md` for why that distinction matters.

### What is pinned

| | |
|---|---|
| sha256 (tarball) | `6ef28b884356a4fa020f184a72159eaaac8ff5ee7f392bbbfbea02afa2e51578` |
| sha256 (`runtime/dshub_bg.wasm`) | `84042677156c7cb23a7e1efbdfd8a8a48cfcb2d9053ca8b8b71194dff7580185` |
| size | 250,042 bytes |
| built | 2026-09-08 15:37–15:42 local |
| package | `dshub-hub@0.1.0` |

### ⚠ This artifact predates rangrez's git history

It was assembled from `rangrez/dist-pkg/`, which is **gitignored**, and built
at 15:37 — nearly two hours before that repo's first commit (`a3f6844`,
17:45). It therefore corresponds to **no rangrez commit**, and its wasm
(`84042677…`) differs from the one tracked at rangrez HEAD (`82f9b890…`).

Missing from this build, at minimum — everything committed to `hub-rust/`
after it was cut:

- `b0ee7d5` feat: pivot — `splitBy` partitions each group's aggregates
- `ef87151` perf: patch a view's slot order from the touch log
- `98828fb` perf: memoize the flattened group tree per revision + expansion
- `4c325d2` perf: memoize a view's slot order per cache revision
- `4696d21` perf: one revision per ingest batch, not per row

Four of those five are performance work, which matters because the open
question about this engine **is** performance — specifically whether its
JSON-string wasm boundary beats the Perspective path. **Do not benchmark this
tarball and draw a conclusion from it.** Cut a fresh, traceable build first.

### Refreshing it

`rangrez` has no script that assembles `dist-pkg/` — it was made by hand, which
is why this pin has no revision. Refreshing therefore means fixing that first:

1. In `rangrez`, add a packaging script that emits the tarball from the tracked
   `hub-rust/pkg/` plus the `lib/`+`runtime/` sources, and stamps the producing
   commit into `runtime/artifact.json`.
2. Rebuild wasm per `hub-rust/README.md` — Rust 1.78 (pinned, load-bearing) and
   `wasm-bindgen-cli` at exactly the version in `Cargo.toml`, installed with
   `+stable`.
3. Replace the tarball here and update the table above, including the commit it
   was built from.

Until step 1 exists, treat this file as a convenience snapshot for wiring up
the integration — not as a version you can ship or measure against.
