# ADR-003 — Feed stop epoch

## Decision

Diagnostics Stop writes `vg-new:feed-stop:<schema>` to localStorage before releasing the Web Lock. Takeover of a live book resumes feeding without resnapshot.

## Consequences

BroadcastChannel alone is insufficient; shared storage is the latch waiters check.
