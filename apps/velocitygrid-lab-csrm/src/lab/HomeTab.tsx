import { LAB_TABS } from './catalog';

export function HomeTab({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div className="lab-main">
      <header className="lab-head">
        <div>
          <h2>VelocityGrid, client-side row model</h2>
          <p>A canvas grid running a fixed-income credit blotter. Every tab is one feature, on real ticking data, with the configuration that produces it shown underneath.</p>
        </div>
      </header>

      <div className="lab-home">
        <h3>The whole book lives in this tab</h3>
        <p>
          That is what <strong>client-side</strong> means here, and it is the thing to keep in mind
          while you read the rest of the lab. The grid holds every row in its own worker and does the
          filtering, sorting, grouping and aggregation there. Nothing goes back to a server when you
          expand a group or change a sort — which is why those operations feel instant, and also why the book
          size is the limit you eventually hit.
        </p>
        <p>
          The <strong>server-side lab</strong> is the same 19 tabs against the same blotter, with the
          book held once in a shared Perspective engine instead. Run them side by side to see which
          interactions change and which do not.
        </p>

        <h4>Mounting one</h4>
        <pre>{`import { VelocityGridExt, titleBarExtensions, ribbonExtensions }
  from '@wellsfargo-starui/velocity-grid-ext';
import '@wellsfargo-starui/velocity-grid/style.css';

const ext = new VelocityGridExt(host, {
  gridId: 'blotter',
  getRowId: (row) => row.id,
  columnDefs,
  theme: 'vg-theme-cursor-dark',
  ext: { extensions: [...titleBarExtensions({ name: 'Blotter' }), ...ribbonExtensions()] },
});

ext.grid.setRowData(snapshot);
ext.grid.applyTransactionAsync({ update: changedRows });`}</pre>

        <h4>Start anywhere</h4>
        <div className="lab-cards">
          {LAB_TABS.map((tab) => (
            <button key={tab.id} type="button" onClick={() => onSelect(tab.id)}>
              <b>{tab.label}</b>
              <span>{tab.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
