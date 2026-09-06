import { useState } from 'react';
import type { LabGuide } from './types';

type Panel = 'what' | 'try' | 'config';

export function Inspector({ guide }: { guide: LabGuide }) {
  const [panel, setPanel] = useState<Panel>('what');
  const [open, setOpen] = useState(true);

  return (
    <section className="lab-drawer" aria-label="Inspector">
      <div className="lab-drawer-tabs" role="tablist">
        {(['what', 'try', 'config'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={open && panel === id}
            onClick={() => { setPanel(id); setOpen(true); }}
          >
            {id === 'what' ? 'What this shows' : id === 'try' ? 'Try this' : 'Config'}
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
        </div>
      )}
    </section>
  );
}
