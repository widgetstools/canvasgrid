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
  // Ticks that arrive before the grid exists are dropped on purpose: the
  // snapshot that follows carries them anyway, and queueing them would just
  // replay stale prices into a grid that is about to be told the truth.
  const snapshotRef = useRef<BlotterRow[] | null>(null);

  const columnDefs = useMemo(() => tab.columns(), [tab]);

  const options = useMemo(() => ({
    columnDefs,
    defaultColDef,
    getRowId: (row: BlotterRow) => row.id,
    theme,
    rowHeight: 24,
    ...tab.options,
  }), [columnDefs, tab, theme]);

  const onReady = useCallback((handle: LabGridHandle) => {
    gridRef.current = handle;
    if (snapshotRef.current) {
      handle.ext.grid.setRowData(snapshotRef.current);
      snapshotRef.current = null;
    }
  }, []);

  const onTeardown = useCallback(() => { gridRef.current = null; }, []);

  // One stream per tab, torn down with the tab. Keyed on tab.id so switching
  // tabs stops the old feed rather than leaving it ticking into a dead grid.
  useEffect(() => {
    const controller = startLocalStream({
      snapshot(rows) {
        const grid = gridRef.current;
        if (grid) grid.ext.grid.setRowData(rows);
        else snapshotRef.current = rows;
      },
      update(rows) {
        const grid = gridRef.current;
        if (!grid) return;
        void grid.ext.grid.applyTransactionAsync({ update: rows });
      },
      status: setStatus,
    }, { rowCount: tab.stream?.rowCount, tickMs: tab.stream?.tickMs });

    streamRef.current = controller;
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
            gridId={`vg-lab-csrm-${tab.id}`}
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
