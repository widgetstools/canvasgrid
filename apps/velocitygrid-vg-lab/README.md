# VelocityGrid Feature Lab (CSRM)

Port of [MarketsGrid Feature Lab](../../../stern-bak/apps/source/markets-grid-lab) onto **VelocityGridExt** with a CSRM mock book and Markets-style live ticks.

```bash
npm run build:kernel   # once / after kernel changes
npm run dev:vg-lab     # http://localhost:5196
```

Shared shell / feature configs live in [`../lab-shared`](../lab-shared).

## Data provider UI

Open the title-bar **Settings** (gear) → **Data provider** (data category).

- Seeded catalog entry: `lab-mock-positions` (hub mock transport, in-process).
- Edit connection / schema / performance tabs, Save, then **Apply** to bind the hub feed to the grid (pauses the built-in lab tick book for that session if you stop ticks first).
