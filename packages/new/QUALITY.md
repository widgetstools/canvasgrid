# Quality gates

## Flake budget: zero for known SSRM races

Contract tests must cover:

1. Id-based block merge (never index merge after sort)
2. Null-safe `mergeRowFields`
3. Soft refresh pacing inside op chain + dataGen bail
4. `ensureFullyHydrated` returns false on partial book
5. Shared feed stop epoch before Web Lock release
6. STOMP/seed takeover = resume live only
7. Per-view pending live batches
8. Pivot fail-closed on sparse SSRM
9. Provider `destroy()` detaches expression host

## Demo smoke

```bash
npm run dev:new-csrm              # :5210
npm run dev:new-ext-demo          # :5211
npm run dev:new-perspective-ssrm  # :5212
npm run test:new
```

## Parity

Port `apps/cgrid-ext-demo/e2e/parity/CHECKLIST.md` → `apps/cgrid-new-ext-demo/e2e` before cutover.
