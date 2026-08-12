# Legacy deprecation checklist (cutover)

- [x] Host import map documented in [`MIGRATION.md`](MIGRATION.md)
- [x] `migrateLegacyPersistence()` copies LS planes fail-safe
- [x] Mark legacy `package.json` with `"deprecated"` message → `vg-new-*`
- [x] Root / package docs point at `packages/new/README.md`
- [ ] `apps/cgrid-new-ext-demo` Playwright parity checklist green
- [ ] `apps/cgrid-new-perspective-ssrm` multi-tab Stop/Restart green
- [ ] Remove legacy packages in a subsequent major

Until Playwright parity is green, **legacy demos remain runnable** for comparison;
new work should land on `vg-new-*` only.
