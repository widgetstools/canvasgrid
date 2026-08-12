# ADR-001 — Row model modes

## Decision

One SSRM engine (v2 skeleton semantics). Modes:

- `clientSide` — worker/in-process CSRM pipeline
- `serverSide` sparse — host owns query; grid owns block cache
- `serverSide` + `serverSideEnableClientSidePipeline: true` — explicit full hydrate then CSRM

## Consequences

No silent auto-pipeline. Pivot fail-closed on sparse. v1 datasources adapt via shim only.
