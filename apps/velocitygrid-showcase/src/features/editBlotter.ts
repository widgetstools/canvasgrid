import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import type { CColDef } from '@wellsfargo-starui/velocity-grid';
import {
  wireEditIntoKernel,
  applyMagnitudeColDefTransforms,
} from '@wellsfargo-starui/velocity-grid-edit';
import type {
  EditBridgeHandle,
  PlusMinusNudge,
  ShortcutDefinition,
  SmartEditOp,
} from '@wellsfargo-starui/velocity-grid-edit';
import type { Feature } from './index';

/**
 * Cycle 21g / Task 12 — Edit-blotter showcase.
 *
 * A real editable blotter wired via `wireEditIntoKernel`: journal
 * (undo/redo + live entry count), smart-edit (×÷+−= over a selected
 * range), bulk-update (free text or a distinct-values pick), an
 * expression-gated plus/minus nudge, and letter-key shortcuts.
 *
 * `qty`/`price` are editable numbers (`price` — and, incidentally,
 * `qty` since the transform maps every numeric column — accepts K/M/B
 * magnitude suffixes via `applyMagnitudeColDefTransforms`, applied to
 * the column array BEFORE construction); `trader` is editable text;
 * `settleDate` is an editable ISO date string (`dateString` built-in
 * editor); `ticker` and `status` are non-editable. `status` (active /
 * inactive) is the expression gate's row predicate.
 */

interface EditRow {
  id: string;
  ticker: string;
  status: 'active' | 'inactive';
  trader: string;
  settleDate: string;
  qty: number;
  price: number;
}

const ROWS: EditRow[] = [
  { id: 'e1', ticker: 'AAPL', status: 'active', trader: 'Alice', settleDate: '2026-07-06', qty: 100, price: 150.25 },
  { id: 'e2', ticker: 'MSFT', status: 'inactive', trader: 'Bob', settleDate: '2026-07-07', qty: 200, price: 305.5 },
  { id: 'e3', ticker: 'GOOG', status: 'active', trader: 'Carol', settleDate: '2026-07-08', qty: 50, price: 2850.1 },
  { id: 'e4', ticker: 'AMZN', status: 'active', trader: 'Alice', settleDate: '2026-07-09', qty: 75, price: 3320.0 },
  { id: 'e5', ticker: 'TSLA', status: 'inactive', trader: 'Bob', settleDate: '2026-07-10', qty: 120, price: 720.85 },
  { id: 'e6', ticker: 'NVDA', status: 'active', trader: 'Carol', settleDate: '2026-07-11', qty: 90, price: 118.3 },
  { id: 'e7', ticker: 'AAPL', status: 'inactive', trader: 'Dave', settleDate: '2026-07-12', qty: 60, price: 151.0 },
  { id: 'e8', ticker: 'MSFT', status: 'active', trader: 'Alice', settleDate: '2026-07-13', qty: 40, price: 306.2 },
  { id: 'e9', ticker: 'GOOG', status: 'active', trader: 'Bob', settleDate: '2026-07-14', qty: 30, price: 2855.0 },
  { id: 'e10', ticker: 'AMZN', status: 'inactive', trader: 'Carol', settleDate: '2026-07-15', qty: 25, price: 3310.5 },
  { id: 'e11', ticker: 'TSLA', status: 'active', trader: 'Dave', settleDate: '2026-07-16', qty: 45, price: 725.0 },
  { id: 'e12', ticker: 'NVDA', status: 'inactive', trader: 'Alice', settleDate: '2026-07-17', qty: 55, price: 119.75 },
];

// Real `[field]`-bracket grammar (docs/superpowers/specs §…-cycle-21b) — the
// showcase uses the bridge's DEFAULT `evaluate` (real `@wellsfargo-starui/velocity-grid-expression`),
// not a test fake, so the gate must parse for real.
const NUDGES: PlusMinusNudge[] = [
  {
    id: 'qty-nudge', name: 'Qty ±1', enabled: true,
    scope: { columnIds: ['qty'] }, incrementStep: 1, decrementStep: 1,
  },
  {
    id: 'price-nudge-active', name: 'Price ±0.25 (active rows only)', enabled: true,
    scope: { columnIds: ['price'] }, expression: '[status] == "active"',
    incrementStep: 0.25, decrementStep: 0.25,
  },
];

const SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'qty-add10', name: 'Qty +10', enabled: true,
    shortcutKey: 'q', operation: 'add', shortcutValue: 10, scope: { columnIds: ['qty'] },
  },
  {
    id: 'price-half', name: 'Price ×0.5', enabled: true,
    shortcutKey: 'h', operation: 'multiply', shortcutValue: 0.5, scope: { columnIds: ['price'] },
  },
];

const RAW_COLUMNS: CColDef<EditRow>[] = [
  { colId: 'ticker', field: 'ticker', headerName: 'Ticker', cellDataType: 'text', width: 90, editable: false },
  { colId: 'status', field: 'status', headerName: 'Status', cellDataType: 'text', width: 90, editable: false },
  { colId: 'trader', field: 'trader', headerName: 'Trader', cellDataType: 'text', width: 110, editable: true },
  {
    colId: 'settleDate', field: 'settleDate', headerName: 'Settle Date', cellDataType: 'text', width: 130,
    editable: true, cellEditor: 'dateString',
  },
  // NOTE: no `cellEditor` override — the kernel's default fallback for an
  // unset `cellEditor` is the TEXT editor regardless of `cellDataType`
  // (`EditController.resolveEditorName`, velocityGrid.ts), which is exactly what
  // the K/M/B magnitude demo needs: `NumberCellEditor.getValue()` returns
  // an already-parsed `number`, so a wrapped `valueParser`'s
  // `typeof params.newValue === 'string'` magnitude branch (magnitude.ts)
  // would never fire against it. The default text editor commits the RAW
  // typed string ("1.5M"), which the wrapped parser below turns into
  // `1500000`.
  { colId: 'qty', field: 'qty', headerName: 'Qty', cellDataType: 'number', width: 90, editable: true },
  { colId: 'price', field: 'price', headerName: 'Price', cellDataType: 'number', width: 100, editable: true },
];

// §4.2.5 — wraps every `cellDataType: 'number'` column's `valueParser` so a
// typed `1.5M` commits as `1500000`. Applied to the WHOLE array
// pre-construction (the documented usage shape) — `price` is the column
// this page calls out, `qty` picks up the same behavior for free.
//
// The generic's structural constraint (`{ cellDataType?: string; valueParser?:
// (p: unknown) => unknown }`) is intentionally engine-generic (magnitude.ts
// never imports `@wellsfargo-starui/velocity-grid`) — the real `CColDef.valueParser` takes a
// concrete `CValueParserParams`, which strict function-parameter variance
// won't fold into `(p: unknown) => unknown` automatically. Round-trip through
// `unknown` at both ends; the runtime shapes are identical (magnitude.ts's
// local `MagnitudeValueParserParams` mirrors `CValueParserParams` verbatim).
const COLUMNS = applyMagnitudeColDefTransforms(
  RAW_COLUMNS as unknown as Array<{ cellDataType?: string; valueParser?: (p: unknown) => unknown }>,
) as unknown as CColDef<EditRow>[];

declare global {
  interface Window {
    __cgridEdit?: EditBridgeHandle;
  }
}

const SMART_EDIT_OPS: Array<{ op: SmartEditOp; label: string }> = [
  { op: 'multiply', label: '×' },
  { op: 'divide', label: '÷' },
  { op: 'add', label: '+' },
  { op: 'subtract', label: '−' },
  { op: 'set', label: '=' },
];

export const editBlotter: Feature = {
  id: 'edit-blotter',
  label: 'Edit Blotter',
  description:
    'Cycle 21g — @wellsfargo-starui/velocity-grid-edit journal (undo/redo + live entry count), ' +
    'smart-edit (×÷+−= over a selected range), bulk-update (free text or ' +
    'a distinct-values pick), an expression-gated plus/minus nudge ' +
    '([status] == "active"), and letter-key shortcuts (q/h) — all wired ' +
    'via wireEditIntoKernel onto a real editable blotter.',

  mount(gridHost, controls, theme) {
    const grid = new VelocityGrid<EditRow>(gridHost, {
      getRowId: (r) => r.id,
      columnDefs: COLUMNS,
      theme,
      rowHeight: 32,
      headerHeight: 34,
    });
    grid.setRowData(ROWS.map((r) => ({ ...r })));

    const handle = wireEditIntoKernel(grid, {
      nudges: NUDGES,
      shortcuts: SHORTCUTS,
    });
    window.__cgridEdit = handle;

    // ─── Smart-edit controls ────────────────────────────────────────────
    let currentOp: SmartEditOp = 'multiply';
    const opButtons = new Map<SmartEditOp, HTMLButtonElement>();
    const refreshOpButtons = (): void => {
      for (const [op, btn] of opButtons) btn.classList.toggle('primary', op === currentOp);
    };
    for (const { op, label } of SMART_EDIT_OPS) {
      const btn = document.createElement('button');
      btn.className = 'ctrl-btn';
      btn.textContent = label;
      btn.setAttribute('data-testid', `btn-edit-op-${op}`);
      btn.addEventListener('click', () => { currentOp = op; refreshOpButtons(); });
      opButtons.set(op, btn);
    }
    refreshOpButtons();

    const operandInput = document.createElement('input');
    operandInput.type = 'number';
    operandInput.className = 'ctrl-input';
    operandInput.value = '2';
    operandInput.setAttribute('data-testid', 'input-edit-operand');

    const smartApplyBtn = document.createElement('button');
    smartApplyBtn.className = 'ctrl-btn primary';
    smartApplyBtn.textContent = 'Apply smart-edit';
    smartApplyBtn.setAttribute('data-testid', 'btn-edit-smartedit-apply');
    smartApplyBtn.addEventListener('click', () => {
      void (async () => {
        const targets = await handle.smartEdit.collectTargets();
        const operand = Number(operandInput.value);
        if (!Number.isFinite(operand)) return;
        await handle.smartEdit.apply(targets, currentOp, operand);
      })();
    });

    // ─── Bulk-update controls ───────────────────────────────────────────
    const bulkValueInput = document.createElement('input');
    bulkValueInput.type = 'text';
    bulkValueInput.className = 'ctrl-input';
    bulkValueInput.placeholder = 'New value…';
    bulkValueInput.setAttribute('data-testid', 'input-edit-bulk-value');

    const distinctSelect = document.createElement('select');
    distinctSelect.className = 'ctrl-btn';
    distinctSelect.setAttribute('data-testid', 'select-edit-bulk-distinct');

    const populateDistinct = (): void => {
      void (async () => {
        const values = await handle.bulkUpdate.distinctValues('trader', 'text');
        distinctSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Distinct trader…';
        distinctSelect.appendChild(placeholder);
        for (const v of values) {
          const opt = document.createElement('option');
          opt.value = String(v);
          opt.textContent = String(v);
          distinctSelect.appendChild(opt);
        }
      })();
    };
    distinctSelect.addEventListener('change', () => {
      if (distinctSelect.value) bulkValueInput.value = distinctSelect.value;
    });
    populateDistinct();

    const bulkApplyBtn = document.createElement('button');
    bulkApplyBtn.className = 'ctrl-btn primary';
    bulkApplyBtn.textContent = 'Apply bulk-update';
    bulkApplyBtn.setAttribute('data-testid', 'btn-edit-bulk-apply');
    bulkApplyBtn.addEventListener('click', () => {
      void (async () => {
        const targets = await handle.bulkUpdate.collectTargets();
        await handle.bulkUpdate.apply(targets, bulkValueInput.value);
        populateDistinct();
      })();
    });

    // ─── Undo / redo + live entry count ─────────────────────────────────
    const undoBtn = document.createElement('button');
    undoBtn.className = 'ctrl-btn';
    undoBtn.textContent = 'Undo';
    undoBtn.setAttribute('data-testid', 'btn-edit-undo');
    undoBtn.addEventListener('click', () => { handle.journal.undo(); });

    const redoBtn = document.createElement('button');
    redoBtn.className = 'ctrl-btn';
    redoBtn.textContent = 'Redo';
    redoBtn.setAttribute('data-testid', 'btn-edit-redo');
    redoBtn.addEventListener('click', () => { handle.journal.redo(); });

    const entryCount = document.createElement('span');
    entryCount.className = 'ctrl-btn';
    entryCount.style.cursor = 'default';
    entryCount.setAttribute('data-testid', 'span-edit-entry-count');

    const refreshJournalUi = (): void => {
      entryCount.textContent = `Entries: ${handle.journal.entries().length}`;
      undoBtn.disabled = !handle.journal.canUndo();
      redoBtn.disabled = !handle.journal.canRedo();
    };
    refreshJournalUi();
    const unsubJournal = handle.journal.subscribe(refreshJournalUi);

    controls.append(
      ...SMART_EDIT_OPS.map(({ op }) => opButtons.get(op)!),
      operandInput,
      smartApplyBtn,
      bulkValueInput,
      distinctSelect,
      bulkApplyBtn,
      undoBtn,
      redoBtn,
      entryCount,
    );

    const origDestroy = grid.destroy.bind(grid);
    (grid as unknown as { destroy: () => void }).destroy = () => {
      unsubJournal();
      handle.destroy();
      delete window.__cgridEdit;
      origDestroy();
    };

    return grid;
  },
};
