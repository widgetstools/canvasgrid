import { VelocityGrid, type CColDef } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-format';
import type { Feature } from './index';
import { Client, type IFrame, type IMessage } from '@stomp/stompjs';

/**
 * Realtime STOMP demo — connects cgrid to `stomp-view-server` (the
 * companion service at `/Users/develop/wfh/stomp-view-server`,
 * default port 8081). Demonstrates a high-cardinality realtime
 * feed driving the grid through `applyTransactionAsync`, with a
 * pivot-mode toggle so the same stream can be evaluated as a flat
 * blotter AND as a cross-tab pivot.
 *
 * Wire protocol (matches the view-server's contract):
 *   • SUBSCRIBE `/snapshot/positions/{clientId}` — receives MESSAGE
 *     frames with header `message-type: snapshot` (JSON array of
 *     rows) until a body that starts with `Success: All …`,
 *     followed by header `message-type: live-update` (JSON array of
 *     mutated rows).
 *   • SEND     `/snapshot/positions/{clientId}/{rate}/{batchSize}`
 *     with optional `snapshot-rows: N` header to TRIGGER the
 *     snapshot+stream after the subscription is in place.
 */

type Position = Record<string, unknown> & { positionId: string };

const COLUMNS: CColDef<Position>[] = [
  { colId: 'positionId', field: 'positionId', headerName: 'Position', cellDataType: 'text',   width: 180, filter: 'text', pinned: 'left' },
  { colId: 'ticker',     field: 'ticker',     headerName: 'Ticker',   cellDataType: 'text',   width: 100, filter: 'text', enableRowGroup: true, enablePivot: true },
  { colId: 'cusip',      field: 'cusip',      headerName: 'CUSIP',    cellDataType: 'text',   width: 130, filter: 'text' },
  { colId: 'desk',       field: 'desk',       headerName: 'Desk',     cellDataType: 'text',   width: 150, filter: 'text', enableRowGroup: true, enablePivot: true },
  { colId: 'region',     field: 'region',     headerName: 'Region',   cellDataType: 'text',   width: 110, filter: 'text', enableRowGroup: true, enablePivot: true },
  { colId: 'currency',   field: 'currency',   headerName: 'Ccy',      cellDataType: 'text',   width: 80,  filter: 'text', enableRowGroup: true, enablePivot: true },
  { colId: 'instrumentType', field: 'instrumentType', headerName: 'Instrument', cellDataType: 'text', width: 160, filter: 'text', enableRowGroup: true, enablePivot: true },
  { colId: 'notionalAmount', field: 'notionalAmount', headerName: 'Notional', cellDataType: 'number', width: 130, filter: 'number', enableValue: true, aggFunc: 'sum' },
  { colId: 'marketValue',    field: 'marketValue',    headerName: 'Market Value', cellDataType: 'number', width: 140, filter: 'number', enableValue: true, aggFunc: 'sum' },
  { colId: 'pnl',            field: 'pnl',            headerName: 'P&L',          cellDataType: 'number', width: 110, filter: 'number', enableValue: true, aggFunc: 'sum' },
  // Cycle 21c / Task 18 — two columns upgraded to @wellsfargo-starui/velocity-grid-format DSL
  // strings so the demo proves DSL rendering under live STOMP ticks:
  //   • dailyPnl — Tier 1: per-row color expression by sign.
  //   • currentPrice — Tier 0: plain Excel currency code.
  {
    colId: 'dailyPnl', field: 'dailyPnl', headerName: 'Daily P&L', cellDataType: 'number',
    width: 110, filter: 'number', enableValue: true, aggFunc: 'sum',
    valueFormatter: '[color=[dailyPnl] >= 0 ? "#16a34a" : "#dc2626"] $#,##0.00',
  },
  {
    colId: 'currentPrice', field: 'currentPrice', headerName: 'Price', cellDataType: 'number',
    width: 90, filter: 'number',
    valueFormatter: '$#,##0.00',
  },
];

export const realtimeStomp: Feature = {
  id: 'realtimeStomp',
  label: 'Realtime (STOMP)',
  description:
    'Connects cgrid to the local stomp-view-server (ws://localhost:8081). Snapshot then live updates flow through applyTransactionAsync — toggle pivot mode to evaluate the same stream as a flat blotter or a cross-tab. Server must be running (cd stomp-view-server && npm start).',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<Position>(gridHost, {
      getRowId: (r: Position) => r.positionId,
      columnDefs: COLUMNS,
      theme,
      sideBar: { toolPanels: ['columns', 'filters'], defaultToolPanel: 'agColumnsToolPanel' },
      rowGroupPanelShow: 'always',
      pivotPanelShow: 'always',
      pivotMode: false,
      enableCellChangeFlash: true,
    } as never);

    // Cycle 21c / Task 18 — register the @wellsfargo-starui/velocity-grid-format compiler and
    // re-issue the defs: string valueFormatters compile during column
    // resolution, which already ran once during construction (before
    // the compiler existed). The re-issue recompiles the two DSL
    // columns; the rest resolve byte-identically.
    wireIntoKernel(grid);
    grid.updateGridOptions({ columnDefs: COLUMNS });

    // ─── Connection state ──────────────────────────────────────────────────
    let client: Client | null = null;
    let subscribed = false;
    const clientId = `cgrid-showcase-${Math.floor(Math.random() * 1e6).toString(16)}`;
    let snapshotRows = 5_000;
    let rate = 50;
    let batchSize = 500;
    // Counters
    let received = 0;
    let snapshotComplete = false;

    // ─── UI scaffolding ────────────────────────────────────────────────────
    const status = document.createElement('span');
    status.className = 'ctrl-btn';
    status.style.background = 'rgba(255,80,80,0.15)';
    status.style.cursor = 'default';
    status.textContent = 'Disconnected';

    const counter = document.createElement('span');
    counter.className = 'ctrl-btn';
    counter.style.cursor = 'default';
    counter.textContent = 'Rows: 0';

    const setStatus = (text: string, ok: boolean): void => {
      status.textContent = text;
      status.style.background = ok ? 'rgba(80,200,120,0.18)' : 'rgba(255,80,80,0.15)';
    };
    const refreshCounter = (): void => {
      const phase = snapshotComplete ? 'live' : 'snapshot';
      counter.textContent = `${phase}: ${received.toLocaleString()}`;
    };

    // ─── STOMP wiring ──────────────────────────────────────────────────────
    const subscribeAndTrigger = (): void => {
      if (!client?.connected || subscribed) return;
      const destination = `/snapshot/positions/${clientId}`;
      client.subscribe(destination, (msg: IMessage) => onMessage(msg));
      subscribed = true;
      // Trigger snapshot + live updates. Body carries the trigger
      // path per the view-server contract, header carries the
      // snapshot row count.
      const trigger = `/snapshot/positions/${clientId}/${rate}/${batchSize}`;
      client.publish({
        destination: trigger,
        body: trigger,
        headers: { 'snapshot-rows': String(snapshotRows) },
      });
      setStatus(`Connected · subscribed (${rate}/s)`, true);
    };

    const onMessage = (msg: IMessage): void => {
      const messageType = msg.headers['message-type'];
      const body = msg.body;
      // Snapshot-complete sentinel — body is text, not JSON.
      if (typeof body === 'string' && body.startsWith('Success: All')) {
        snapshotComplete = true;
        setStatus(`Live · ${rate} ticks/s`, true);
        refreshCounter();
        return;
      }
      if (!body) return;
      let rows: Position[];
      try {
        const parsed = JSON.parse(body);
        rows = Array.isArray(parsed) ? parsed as Position[] : [parsed as Position];
      } catch (err) {
        console.warn('[stomp] non-JSON message body, skipping', err);
        return;
      }
      if (rows.length === 0) return;
      if (messageType === 'snapshot' || !snapshotComplete) {
        grid.applyTransactionAsync({ add: rows });
      } else {
        // live-update — apply as update (worker upserts by rowId).
        grid.applyTransactionAsync({ update: rows });
      }
      received += rows.length;
      refreshCounter();
    };

    const connect = (): void => {
      if (client) return;
      client = new Client({
        brokerURL: 'ws://localhost:8081',
        reconnectDelay: 2000,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,
        onConnect: () => {
          setStatus('Connected', true);
          subscribeAndTrigger();
        },
        onStompError: (frame: IFrame) => {
          setStatus(`STOMP error: ${frame.headers.message ?? 'unknown'}`, false);
        },
        onWebSocketClose: () => {
          subscribed = false;
          setStatus('Disconnected', false);
        },
        onWebSocketError: () => {
          setStatus('WebSocket error — is view-server running?', false);
        },
      });
      client.activate();
      setStatus('Connecting…', false);
    };

    const disconnect = (): void => {
      if (!client) return;
      client.deactivate().catch(() => { /* swallow */ });
      client = null;
      subscribed = false;
      snapshotComplete = false;
      received = 0;
      refreshCounter();
      setStatus('Disconnected', false);
    };

    // ─── Controls ──────────────────────────────────────────────────────────
    const connectBtn = document.createElement('button');
    connectBtn.className = 'ctrl-btn primary';
    connectBtn.textContent = 'Connect';
    connectBtn.setAttribute('data-testid', 'btn-stomp-connect');
    connectBtn.addEventListener('click', () => {
      if (client) disconnect();
      else connect();
      connectBtn.textContent = client ? 'Disconnect' : 'Connect';
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'ctrl-btn';
    clearBtn.textContent = 'Clear grid';
    clearBtn.setAttribute('data-testid', 'btn-stomp-clear');
    clearBtn.addEventListener('click', () => {
      grid.setRowData([]);
      received = 0;
      snapshotComplete = false;
      refreshCounter();
    });

    let pivotOn = false;
    let pivotConfigured = false;
    const pivotBtn = document.createElement('button');
    pivotBtn.className = 'ctrl-btn';
    pivotBtn.textContent = 'Pivot: Off';
    pivotBtn.setAttribute('data-testid', 'btn-stomp-pivot');
    pivotBtn.addEventListener('click', () => {
      pivotOn = !pivotOn;
      // Configure row groups + pivot + value columns ONCE the first
      // time we go pivot, BEFORE flipping pivot mode. This keeps the
      // worker's colIndex synced with the role models — flipping
      // pivot mode first then setting cols runs the role mutations
      // against a transient pivot-active worker state.
      if (pivotOn && !pivotConfigured) {
        grid.setRowGroupColumns(['desk']);
        grid.setPivotColumns(['region']);
        grid.addValueColumn('pnl', 'sum');
        grid.addValueColumn('notionalAmount', 'sum');
        pivotConfigured = true;
      }
      grid.setPivotMode(pivotOn);
      pivotBtn.textContent = `Pivot: ${pivotOn ? 'On' : 'Off'}`;
    });

    // Snapshot size input
    const sizeLabel = document.createElement('label');
    sizeLabel.className = 'ctrl-btn';
    sizeLabel.style.cursor = 'default';
    sizeLabel.textContent = 'Snapshot rows: ';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.min = '100';
    sizeInput.max = '20000';
    sizeInput.step = '1000';
    sizeInput.value = String(snapshotRows);
    sizeInput.style.cssText = 'width:72px; margin-left:6px; background:transparent; border:1px solid currentColor; color:inherit; padding:2px 4px;';
    sizeInput.addEventListener('change', () => {
      const v = Number.parseInt(sizeInput.value, 10);
      if (Number.isFinite(v) && v >= 100 && v <= 20000) snapshotRows = v;
    });
    sizeLabel.appendChild(sizeInput);

    // Rate input
    const rateLabel = document.createElement('label');
    rateLabel.className = 'ctrl-btn';
    rateLabel.style.cursor = 'default';
    rateLabel.textContent = 'Rate /s: ';
    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.min = '1';
    rateInput.max = '500';
    rateInput.value = String(rate);
    rateInput.style.cssText = 'width:60px; margin-left:6px; background:transparent; border:1px solid currentColor; color:inherit; padding:2px 4px;';
    rateInput.addEventListener('change', () => {
      const v = Number.parseInt(rateInput.value, 10);
      if (Number.isFinite(v) && v >= 1 && v <= 500) rate = v;
    });
    rateLabel.appendChild(rateInput);

    controls.appendChild(connectBtn);
    controls.appendChild(pivotBtn);
    controls.appendChild(clearBtn);
    controls.appendChild(sizeLabel);
    controls.appendChild(rateLabel);
    controls.appendChild(status);
    controls.appendChild(counter);

    // Auto-disconnect when the feature unmounts. The showcase shell
    // calls grid.destroy() on tab switch; piggyback on that lifecycle
    // by patching destroy through.
    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      try { client?.deactivate(); } catch { /* swallow */ }
      origDestroy();
    };

    return grid;
  },
};
