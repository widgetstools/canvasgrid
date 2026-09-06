import { useState } from 'react';
import type { LabGuide } from './types';
import type { LabSeed } from './seeds';

type Panel = 'what' | 'try' | 'config' | 'seed';

/** What actually got installed, minus the empty slices — a seed dump full of
 *  `undefined` teaches nothing about the tab you are looking at. */
function installed(seed: LabSeed): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(seed)) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

export function Inspector({ guide, seed }: { guide: LabGuide; seed: LabSeed }) {
  const [panel, setPanel] = useState<Panel>('what');
  const [open, setOpen] = useState(true);

  return (
    <section className="lab-drawer" aria-label="Inspector">
      <div className="lab-drawer-tabs" role="tablist">
        {(['what', 'try', 'config', 'seed'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={open && panel === id}
            onClick={() => { setPanel(id); setOpen(true); }}
          >
            {id === 'what' ? 'What this shows'
              : id === 'try' ? 'Try this'
              : id === 'config' ? 'Config'
              : 'Installed on this tab'}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="lab-btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {open && (
        <div className="lab-drawer-body">
          {panel === 'what' && <p>{guide.what}</p>}
          {panel === 'try' && (
            <ol>{guide.try.map((step) => <li key={step}>{step}</li>)}</ol>
          )}
          {panel === 'config' && <pre>{guide.config}</pre>}
          {panel === 'seed' && (
            Object.keys(installed(seed)).length === 0
              ? <p>This tab installs no extra configuration — it is the grid with these columns.</p>
              : (
                <>
                  <p>
                    Everything below was installed into this grid on mount. It is plain data, which is
                    the claim the lab is making: rules, calculated columns, filter pills and nudges are
                    configuration you can save, share and version, not code you deploy.
                  </p>
                  <pre>{JSON.stringify(installed(seed), null, 2)}</pre>
                </>
              )
          )}
        </div>
      )}
    </section>
  );
}
