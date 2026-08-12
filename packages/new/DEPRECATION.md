# Legacy deprecation checklist (cutover)

**Legacy is the production implementation. Nothing here is flipped.**

An earlier pass marked the legacy `package.json` files `"deprecated"` and rewrote the root
README to point at `packages/new`. That was wrong — `packages/new` is a prototype at roughly
5% of legacy behavior (see [`INVENTORY.md`](INVENTORY.md)). Both changes have been reverted.

Preconditions before any of this is considered again:

- [ ] Legacy kernel tests (279 files) adapted and green against `vg-new-*`
- [ ] `apps/cgrid-new-ext-demo` parity checklist green (125 legacy e2e specs ported)
- [ ] `apps/cgrid-new-perspective-ssrm` multi-tab Stop/Restart green
- [ ] Performance budgets met vs legacy (scroll FPS, getRows latency, paint cost)
- [ ] Host import map documented in [`MIGRATION.md`](MIGRATION.md)

Only then:

- [ ] Mark legacy `package.json` with a deprecation message
- [ ] Point docs at `packages/new/README.md`
- [ ] Remove legacy packages in a subsequent major
