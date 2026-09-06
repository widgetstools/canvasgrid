import { SCENARIOS } from '../data/scenarios';
import type { StreamStatus } from '../data/stream';

export interface DemoConsoleProps {
  status: StreamStatus;
  paused: boolean;
  tickMs: number;
  activeScenario: string | null;
  onPause: (v: boolean) => void;
  onTickMs: (ms: number) => void;
  onScenario: (id: string) => void;
  onClose: () => void;
}

const fmt = new Intl.NumberFormat('en-US');

export function DemoConsole(p: DemoConsoleProps) {
  return (
    <aside className="lab-rail" aria-label="Demo console">
      <div className="lab-rail-head">
        <h3>Demo console</h3>
        <button type="button" className="lab-btn" onClick={p.onClose}>Hide</button>
      </div>
      <div className="lab-rail-scroll">
        <div className="lab-field">
          <label htmlFor="lab-tick">
            Tick interval <span className="val">{p.tickMs} ms</span>
          </label>
          <input
            id="lab-tick"
            type="range"
            min={100}
            max={2000}
            step={50}
            value={p.tickMs}
            onChange={(e) => p.onTickMs(Number(e.target.value))}
          />
        </div>

        <div className="lab-field">
          <button
            type="button"
            className="lab-btn"
            aria-pressed={p.paused}
            onClick={() => p.onPause(!p.paused)}
          >
            {p.paused ? 'Resume feed' : 'Pause feed'}
          </button>
        </div>

        <div className="lab-field">
          <div className="lab-stat"><span>Rows</span><b>{fmt.format(p.status.rowCount)}</b></div>
          <div className="lab-stat"><span>Updates applied</span><b>{fmt.format(p.status.updatesApplied)}</b></div>
          <div className="lab-stat"><span>Rows / sec</span><b>{fmt.format(p.status.updatesPerSec)}</b></div>
          <div className="lab-stat"><span>Source</span><b>{p.status.kind}</b></div>
        </div>

        <div className="lab-field">
          <label>Market scenarios</label>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="lab-scenario"
              data-tone={s.tone}
              aria-pressed={p.activeScenario === s.id}
              onClick={() => p.onScenario(s.id)}
            >
              <b>{s.title}</b>
              <span>{s.description}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
