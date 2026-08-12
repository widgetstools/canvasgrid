# Legacy deprecation checklist (cutover)

Do **not** flip these until new demos pass parity e2e:

- [ ] `apps/cgrid-new-ext-demo` parity checklist green
- [ ] `apps/cgrid-new-perspective-ssrm` multi-tab Stop/Restart green
- [ ] Host import map documented in MIGRATION.md
- [ ] Mark legacy `package.json` with `"deprecated": true`
- [ ] Docs redirect to `packages/new/README.md`
- [ ] Remove legacy packages in a subsequent major

Until then, legacy packages remain the production path; `packages/new` is the greenfield rewrite.
