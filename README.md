# STOMP Positions AG Grid Showcase

React + AG Grid Enterprise demo that streams synthetic fixed-income positions from the **stomp-view-server** over STOMP/WebSocket.

## Prerequisites

Start the STOMP server (from the starui monorepo):

```bash
cd /Users/develop/wfh/starui/apps/demos/stomp-view-server
npm install
npm run build
npm start
```

Health check: http://localhost:8081/health

## Run the grid

```bash
cd /Users/develop/wfh/canvasgrid
npm install
npm run dev
```

Opens at http://localhost:5174

## Features demonstrated

| Feature | Implementation |
|---------|----------------|
| STOMP snapshot + live tail | Subscribe `/snapshot/positions/TRADER001`, trigger sparse live stream |
| Real-time cell updates | `applyTransactionAsync` + sparse partial deltas merged by `positionId` |
| Cell flash on change | `enableCellChangeFlash`, 500ms flash on tick columns |
| Multi-level row grouping | Desk → Region → Instrument Type |
| Group + leaf selection | Checkbox column + `checkboxLocation: 'autoGroupColumn'`, `groupSelects: 'descendants'` |
| Aggregations | `sum` / `avg` on value columns; `groupTotalRow` + `grandTotalRow` |
| Column pinning | Position ID, CUSIP, auto-group column (left); P&L (right) |
| Multi filters + float filters | `agMultiColumnFilter` (text/number + set filter tabs), `floatingFilter: true` |
| Side bar | Columns + Filters tool panels |
| Status bar | Connection phase, row count, live update counter, aggregation component |

## STOMP configuration

Defaults in `src/types.ts`:

- WebSocket: `ws://localhost:8081`
- Client ID: `TRADER001`
- Snapshot: 3,000 rows (`snapshot-rows` header)
- Sparse live mode: ~100 partial row updates per tick at rate 7 (~143ms)

Adjust `DEFAULT_STOMP_CONFIG` to match your server tuning.

## License

AG Grid Enterprise requires a valid license key. Replace the trial key in `src/agGridSetup.ts` for production use.
