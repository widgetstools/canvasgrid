import { LAB_TABS } from './catalog';

export function HomeTab({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div className="lab-main">
      <header className="lab-head">
        <div>
          <h2>VelocityGrid, server-side row model</h2>
          <p>The same blotter and the same 19 features as the client-side lab, with the book held behind a datasource instead of in the tab. Compare the two side by side.</p>
        </div>
      </header>

      <div className="lab-home">
        <h3>The grid never holds the book</h3>
        <p>
          It holds a <strong>window</strong>. The datasource owns the filtering, sorting, grouping and
          aggregation, and the grid asks it three questions: what groups exist, what leaves sit under
          this one, and what rows fill this flat window. Everything you do in the tabs that follow goes
          through that boundary.
        </p>
        <p>
          One consequence is worth watching for, because it is the thing people expect to be slow and
          is not: <strong>expanding a group costs no request at all</strong>. The kernel owns the group
          skeleton and the expansion state, so a toggle reflows locally in the same frame and a collapse
          needs zero calls. Sorting and filtering do go to the datasource, because they change what the
          answer is.
        </p>
        <p>
          This lab answers its own queries from an in-memory book so it opens with no broker running.
          That is a stand-in, not the product: in a real deployment the same three methods are served by
          a Perspective engine in a SharedWorker, or by an HTTP endpoint. Nothing above the datasource
          boundary changes — which is the property the boundary exists to give you.
        </p>

        <h4>Mounting one</h4>
        <pre>{`const ext = new VelocityGridExt(host, {
  gridId: 'blotter',
  getRowId: (row) => row.id,
  columnDefs,
  rowModelType: 'serverSide',
  serverSideDatasource: datasource,
  serverSideEnableClientSidePipeline: false,   // never pull the whole book
  cacheBlockSize: 100,
  ext: { extensions: [...titleBarExtensions({ name: 'Blotter' }), ...ribbonExtensions()] },
});

// The datasource answers three questions:
datasource.getGroupSkeleton(params);  // every group, at every depth
datasource.getLeafRows(params);       // one window under one group
datasource.getRows(params);           // one flat window, when ungrouped`}</pre>

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
