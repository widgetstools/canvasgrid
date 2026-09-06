/**
 * The one shell every feature tab renders through.
 *
 * It owns the tab's stream, the grid handle, and the plumbing between them —
 * the snapshot goes in with `setRowData`, ticks with `applyTransactionAsync`.
 * Nothing here is per-feature; what makes a tab that feature is its entry in
 * the catalog.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VelocityLabGrid, type LabGridHandle } from '../grid/VelocityLabGrid';
import { DemoConsole } from './DemoConsole';
import { Inspector } from './Inspector';
import { scenarioById } from '../data/scenarios';
import { createBlotterSsrmDatasource, type BlotterBook } from '../data/ssrmDatasource';
import { startLocalStream, type StreamController, type StreamStatus } from '../data/stream';
import { defaultColDef } from '../data/columns';
import type { GridThemeId } from './theme';
import type { LabTab as LabTabConfig } from './types';
import type { BlotterRow } from '../data/domain';

export interface LabTabProps {
  tab: LabTabConfig;
  theme: GridThemeId;
  onTheme: (id: GridThemeId) => void;
  themes: readonly { id: GridThemeId; label: string }[];
}

export function LabTab({ tab, theme, onTheme, themes }: LabTabProps) {
  const [status, setStatus] = useState<StreamStatus>({
    kind: 'local', phase: 'connecting', rowCount: 0, updatesApplied: 0, updatesPerSec: 0,
  });
  const [paused, setPaused] = useState(false);
  const [tickMs, setTickMs] = useState(tab.stream?.tickMs ?? 500);
  const [scenario, setScenario] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  const gridRef = useRef<LabGridHandle | null>(null);
  const streamRef = useRef<StreamController | null>(null);

  const columnDefs = useMemo(() => tab.columns(), [tab]);

  // One datasource per tab, reading whatever the book currently holds. It is
  // created once and kept: handing the grid a new datasource is a full purge,
  // which would throw away every loaded block on an unrelated re-render.
  const datasource = useMemo(() => {
    // Read through the controller rather than caching its array: a scenario
    // overlay replaces the book wholesale, so a captured reference would go
    // stale exactly when the demo is trying to show something changing.
    const book: BlotterBook = {
      rows: () => streamRef.current?.rows() ?? [],
      latencyMs: 24,
    };
    return createBlotterSsrmDatasource(book);
  }, [tab.id]);

  const options = useMemo(() => ({
    columnDefs,
    defaultColDef,
    getRowId: (row: BlotterRow) => row.id,
    theme,
    rowHeight: 24,
    rowModelType: 'serverSide' as const,
    serverSideDatasource: datasource,
    // Sparse: the datasource owns filter, sort, group and aggregation. Letting
    // the client pipeline run would pull the whole book across, which is the
    // one thing this row model exists to avoid.
    serverSideEnableClientSidePipeline: false,
    cacheBlockSize: 100,
    serverSideMaxCachedLeafBlocks: 20,
    groupDefaultExpanded: 0,
    ...tab.options,
  }), [columnDefs, tab, theme, datasource]);

  const onReady = useCallback((handle: LabGridHandle) => {
    gridRef.current = handle;
  }, []);

  const onTeardown = useCallback(() => { gridRef.current = null; }, []);

  // One stream per tab, torn down with the tab. Keyed on tab.id so switching
  // tabs stops the old feed rather than leaving it ticking into a dead grid.
  useEffect(() => {
    const controller = startLocalStream({
      snapshot() {
        // The rows are already reachable through `controller.rows()`; the grid
        // only needs to be told its cached blocks are void.
        gridRef.current?.ext.grid.refreshServerSide({ purge: true });
      },
      update(rows) {
        // The stream already wrote the new rows into the book it shares with
        // the datasource, so the grid needs a refresh, not a payload. This is
        // a soft refresh: it re-reads the blocks in view and leaves the rest
        // of the cache alone.
        void rows;
        gridRef.current?.ext.grid.refreshServerSide({ purge: false });
      },
      status: setStatus,
    }, { rowCount: tab.stream?.rowCount, tickMs: tab.stream?.tickMs });

    streamRef.current = controller;
    // The first snapshot fires inside startLocalStream, before the line above
    // ran, so the grid was told to purge against a book it could not yet see.
    // Ask again now that it can.
    gridRef.current?.ext.grid.refreshServerSide({ purge: true });
    setPaused(false);
    setScenario(null);
    setTickMs(tab.stream?.tickMs ?? 500);

    return () => { controller.stop(); streamRef.current = null; };
  }, [tab.id, tab.stream?.rowCount, tab.stream?.tickMs]);

  useEffect(() => {
    gridRef.current?.ext.grid.setTheme(theme);
  }, [theme]);

  const applyScenario = useCallback((id: string) => {
    const stream = streamRef.current;
    const s = scenarioById(id);
    if (!stream || !s) return;
    stream.overlay(s.apply(stream.rows()));
    setScenario(id);
  }, []);

  const rate = Math.min(1, status.updatesPerSec / 400);

  return (
    <>
      <div className="lab-main">
        <header className="lab-head">
          <div>
            <h2>{tab.title}</h2>
            <p>{tab.subtitle}</p>
          </div>
          <div className="lab-head-right">
            <div className="lab-live">
              <span className="lab-tape" data-paused={paused}>
                <span style={{ ['--rate' as string]: paused ? 0 : rate }} />
              </span>
              <b>{status.updatesPerSec.toLocaleString('en-US')}</b> rows/s
            </div>
            <label className="lab-live" htmlFor="lab-theme">
              Theme
              <select
                id="lab-theme"
                className="lab-btn"
                value={theme}
                onChange={(e) => onTheme(e.target.value as GridThemeId)}
              >
                {themes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {!railOpen && (
              <button type="button" className="lab-btn" onClick={() => setRailOpen(true)}>
                Demo console
              </button>
            )}
          </div>
        </header>

        <div className="lab-stage">
          <VelocityLabGrid
            gridId={`vg-lab-ssrm-${tab.id}`}
            title={tab.title}
            options={options}
            onReady={onReady}
            onTeardown={onTeardown}
          />
        </div>

        <Inspector guide={tab.guide} />
      </div>

      {railOpen && (
        <DemoConsole
          status={status}
          paused={paused}
          tickMs={tickMs}
          activeScenario={scenario}
          onPause={(v) => { setPaused(v); streamRef.current?.setPaused(v); }}
          onTickMs={(ms) => { setTickMs(ms); streamRef.current?.setTickMs(ms); }}
          onScenario={applyScenario}
          onClose={() => setRailOpen(false)}
        />
      )}
    </>
  );
}
