// @wellsfargo-starui/velocity-grid-ext/edit — the kernel bridge. Spec §4 (`wireEditIntoKernel`).
//
// `wireEditIntoKernel(grid, opts?)` wires the whole editing-ops feature set
// (journal, smart-edit, bulk-update, plus/minus nudges, letter shortcuts)
// onto a VelocityGrid instance via the kernel's PUBLIC API, mirroring
// packages/renderers/src/bridge.ts / packages/format/src/bridge.ts /
// packages/rules/src/bridge.ts / packages/calc/src/bridge.ts.
//
// Engine-discipline note (spec §2.3, pinned): this is the ONE module allowed
// a real `@wellsfargo-starui/velocity-grid/expression` runtime import (`makeExpressionEvaluate`
// default) and the ONE place a `Date.now()` default lives — the bridge IS
// the host boundary. Every other `@wellsfargo-starui/velocity-grid-ext/edit` module stays pure/engine-side.
// Kernel imports here are STRUCTURAL/type-only (renderers `bridge.ts:8`
// precedent: `import type { CellPainter } from '@wellsfargo-starui/velocity-grid'`) — this file
// imports NOTHING at runtime from `@wellsfargo-starui/velocity-grid`.

import type {
  CellPatch,
  EditJournalEntry,
  EditSettings,
  PlusMinusNudge,
  PatchValidator,
  ShortcutDefinition,
  SmartEditOp,
} from './types';
import { mergeEditSettings } from './settings';
import type { DeepPartial } from './settings';
import { EditJournal } from './journal';
import { dedupePatches, assertSingleColumnSelection } from './patches';
import type { CellTarget } from './patches';
import { previewPatches } from './preview';
import { collectTargetCells, buildSmartEditPatches } from './smartEdit';
import type { TargetSurface } from './smartEdit';
import { collectBulkUpdateTargets, buildBulkUpdatePatches, makeDistinctValuesFeed } from './bulkUpdate';
import { makeExpressionEvaluate, resolveNudgeForCell, buildNudgePatches } from './plusMinus';
import type { NudgeEvaluate } from './plusMinus';
import { collectShortcutKeys, matchShortcutForCell, buildShortcutPatches } from './shortcuts';

// ─── Structural KernelGridSurface — public API only (spec §4.1) ────────────
//
// Verified against the real API (plan-time recon, two corrections flagged):
//   - `isEditing()` is NOT public (`isAnyEditOpen` is private, `velocityGrid.ts:7672`)
//     → editing guard derives from the public `cellEditingStarted` /
//     `cellEditingStopped` events instead.
//   - `isCellEditable(rowIndex, colId)` is NOT public either (`velocityGrid.ts:7649`
//     is `private`) → replicated addon-side below from `getGridOption`'s
//     resolved colDefs (renderers `findLeafColDef` precedent), matching
//     `EditController.isCellEditable` (`core/editController.ts:407-428`):
//     static bool passes through; callback receives `{data, colId, rowIndex,
//     value}`; throw / unknown column → false.

interface SelectionRangeLike {
  rowStart: number;
  rowEnd: number;
  colIds: string[];
}

interface RowsChangedEventLike {
  type: 'rowsChanged';
  added: Array<{ rowId: string; row: Record<string, unknown> }>;
  updated: Array<{ rowId: string; row: Record<string, unknown>; oldRow: Record<string, unknown> }>;
  removed: Array<{ rowId: string; row: Record<string, unknown> }>;
  source: 'transaction' | 'transactionAsync' | 'edit';
}

interface CellValueChangedEventLike {
  type: 'cellValueChanged';
  rowId: string;
  colId: string;
  oldValue: unknown;
  newValue: unknown;
  source?: 'edit';
}

interface CellKeyDownEventLike {
  type: 'cellKeyDown';
  rowId: string;
  colId: string;
  value: unknown;
  event: { key: string; preventDefault(): void };
}

interface EditableCallbackParams {
  data: unknown;
  colId: string;
  rowIndex: number;
  value: unknown;
}

interface KernelColDefLike {
  colId?: string;
  field?: string;
  /** Legacy AG-style alias — kernel folds `'number' | 'text'` into `cellDataType`. */
  type?: string | string[];
  cellDataType?: string;
  children?: KernelColDefLike[];
  editable?: boolean | ((p: EditableCallbackParams) => boolean);
  valueParser?: (p: { newValue: unknown; oldValue: unknown; data: unknown; colDef: unknown }) => unknown;
  valueSetter?: (p: { data: unknown; newValue: unknown; oldValue: unknown; colDef: unknown }) => boolean | void;
}

interface KernelGridSurface {
  on?(type: string, handler: (event: unknown) => void): () => void;
  addEventListener?(type: string, handler: (event: unknown) => void): () => void;
  removeEventListener?(type: string, handler: (event: unknown) => void): void;
  applyTransaction(t: { update?: Record<string, unknown>[] }): unknown;
  forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void): void;
  getRowsByIndex(
    rowIndexes: number[],
  ): Promise<Array<{ rowIndex: number; rowId: string; data: Record<string, unknown> } | null>>;
  getCellRanges(): SelectionRangeLike[];
  addCellRange(range: SelectionRangeLike): void;
  clearCellRanges(): void;
  getFocusedCell(): { rowId: string; colId: string } | null;
  setFocusedCell(rowId: string, colId: string): void;
  getSelectedRowIds(): string[];
  setSelectedRowIds(ids: string[]): void;
  getDistinctValues(colId: string, limit?: number): Promise<string[]>;
  getGridOption?(key: string): unknown;
  /** Kernel-native editability resolution (public on VelocityGrid). Preferred over
   *  the bridge's own replication when present: it reads the RESOLVED colDef
   *  (defaultColDef/columnTypes already folded) and carries the pivot-mode
   *  read-only gate. Optional so bare test surfaces keep working. */
  isCellEditable?(rowIndex: number, colId: string): boolean;
  /** Cycle 21i Phase 2 / T6 — kernel module-state registry (present on
   *  VelocityGrid since Phase 2 T2). Structural + optional so the bridge keeps
   *  working against older kernels and bare test surfaces. */
  registerStateModule?(module: {
    id: string;
    version: number;
    get(): unknown;
    set(data: unknown, version: number): void;
  }): () => void;
  notifyModuleStateChanged?(id: string): void;
  __editBridgeWired?: EditBridgeHandle;
}

export interface WireEditOptions {
  settings?: Parameters<typeof mergeEditSettings>[0];
  nudges?: PlusMinusNudge[];
  shortcuts?: ShortcutDefinition[];
  validator?: PatchValidator;
  /** Host-stamped timestamps. Default: `() => Date.now()` — the bridge IS
   *  the host boundary; this is the ONLY `Date.now()` in the package. */
  now?: () => number;
  /** Default: `makeExpressionEvaluate()` (real `@wellsfargo-starui/velocity-grid/expression`). */
  evaluate?: NudgeEvaluate;
  /**
   * Replace the default `grid.applyTransaction({ update })` used by
   * smart/bulk/±/shortcut commits and journal undo/redo. SSRM hosts should
   * persist to the authoritative book and call `applyServerSideTransaction`
   * so rehydrate does not resurrect undone values.
   */
  commitUpdates?: (
    rows: Record<string, unknown>[],
    meta: { patches: CellPatch[]; direction: 'forward' | 'undo' },
  ) => void;
}

export interface EditBridgeHandle {
  journal: EditJournal;
  smartEdit: {
    collectTargets(): Promise<CellTarget[]>;
    preview(targets: CellTarget[], op: SmartEditOp, operand: number): ReturnType<typeof previewPatches>;
    apply(targets: CellTarget[], op: SmartEditOp, operand: number): Promise<{ applied: number; entry: EditJournalEntry | null }>;
  };
  bulkUpdate: {
    collectTargets(): Promise<CellTarget[]>;
    distinctValues(colId: string, cellDataType?: string): Promise<unknown[]>;
    preview(targets: CellTarget[], newValue: unknown): ReturnType<typeof previewPatches>;
    apply(targets: CellTarget[], newValue: unknown): Promise<{ applied: number; entry: EditJournalEntry | null }>;
  };
  getSettings(): EditSettings;
  updateSettings(partial: Parameters<typeof mergeEditSettings>[0]): void;
  getNudges(): PlusMinusNudge[];
  setNudges(nudges: PlusMinusNudge[]): void;
  getShortcuts(): ShortcutDefinition[];
  setShortcuts(shortcuts: ShortcutDefinition[]): void;
  destroy(): void;
}

function subscribe(
  g: KernelGridSurface,
  type: string,
  handler: (event: unknown) => void,
): () => void {
  if (g.on) return g.on(type, handler);
  g.addEventListener?.(type, handler);
  return () => g.removeEventListener?.(type, handler);
}

/** Renderers `findLeafColDef` precedent (`packages/renderers/src/bridge.ts:158-170`),
 *  verbatim walk shape. */
function findLeafColDef(colDefs: KernelColDefLike[], colId: string): KernelColDefLike | undefined {
  for (const def of colDefs) {
    if (def.children?.length) {
      const nested = findLeafColDef(def.children, colId);
      if (nested) return nested;
      continue;
    }
    if (def.colId === colId || def.field === colId) return def;
  }
  return undefined;
}

function allLeafColDefs(colDefs: KernelColDefLike[]): KernelColDefLike[] {
  const out: KernelColDefLike[] = [];
  const walk = (defs: KernelColDefLike[]): void => {
    for (const def of defs) {
      if (def.children?.length) {
        walk(def.children);
        continue;
      }
      out.push(def);
    }
  };
  walk(colDefs);
  return out;
}

const SMART_EDIT_OP_SYMBOL: Record<SmartEditOp, string> = {
  multiply: '×', divide: '÷', add: '+', subtract: '−', set: '=',
};

/** kebab-case operation → arithmetic symbol for shortcut labels (mirrors
 *  smart-edit's op symbol table). */
const SHORTCUT_OP_SYMBOL: Record<ShortcutDefinition['operation'], string> = {
  add: '+', subtract: '−', multiply: '×', divide: '÷',
};

export function wireEditIntoKernel(grid: unknown, opts?: WireEditOptions): EditBridgeHandle {
  const g = grid as KernelGridSurface;
  if (g.__editBridgeWired) return g.__editBridgeWired;

  const now = opts?.now ?? (() => Date.now());
  const evaluate = opts?.evaluate ?? makeExpressionEvaluate();
  const validator = opts?.validator;

  let settings: EditSettings = mergeEditSettings(opts?.settings);
  let nudges: PlusMinusNudge[] = opts?.nudges ?? [];
  let shortcuts: ShortcutDefinition[] = opts?.shortcuts ?? [];
  let shortcutKeySet = collectShortcutKeys(shortcuts);

  let editing = false;
  let replaying = false;

  // ─── Row mirror (§3.4) — bridge-owned, rowId → row. Seeded from
  // forEachRow, freshened on rowsChanged, cleared + reseeded on
  // modelUpdated (the 21f-hardened pattern: a same-rowId `setRowData` emits
  // `modelUpdated` only — a mirror without that clear goes permanently
  // stale; renderers `bridge.ts:344-358`). ───────────────────────────────
  const rowMirror = new Map<string, Record<string, unknown>>();
  const seedRowMirror = (): void => {
    rowMirror.clear();
    g.forEachRow((rowId, row) => rowMirror.set(rowId, row));
  };
  seedRowMirror();

  // Transient rowIndex → {rowId, data} cache, refreshed on every
  // TargetSurface.getRowsByIndex call. `collectCellsByType` (smartEdit.ts)
  // always awaits `getRowsByIndex` once, THEN synchronously calls
  // `isCellEditable(rowIndex, colId)` in the same walk with no further
  // `await` in between — so this cache is always fresh when consulted.
  const lastFetchByIndex = new Map<number, { rowId: string; data: Record<string, unknown> }>();

  function colDefs(): KernelColDefLike[] {
    return (g.getGridOption?.('columnDefs') as KernelColDefLike[] | undefined) ?? [];
  }

  function colMeta(colId: string): { field: string; cellDataType?: string } | null {
    const leaf = findLeafColDef(colDefs(), colId);
    if (!leaf?.field) return null;
    // Authored defs may use legacy `type: 'number'` (kernel folds that into
    // resolved `cellDataType`). Smart-edit reads authored defs, so mirror
    // the same alias here — otherwise toolbar ops collect 0 targets.
    return { field: leaf.field, cellDataType: resolveCellDataType(leaf) };
  }

  function resolveCellDataType(leaf: KernelColDefLike): string | undefined {
    if (leaf.cellDataType) return leaf.cellDataType;
    const typeNames = Array.isArray(leaf.type)
      ? leaf.type
      : typeof leaf.type === 'string'
        ? [leaf.type]
        : [];
    for (let i = typeNames.length - 1; i >= 0; i--) {
      const name = typeNames[i];
      if (name === 'number' || name === 'text') return name;
    }
    return undefined;
  }

  /** Addon-side `isCellEditable` replication (`EditController.isCellEditable`,
   *  `core/editController.ts:407-428`): static bool passes through; callback
   *  gets `{data, colId, rowIndex, value}`; throw / unknown column → false.
   *
   *  The kernel resolves editability against the RESOLVED colDef —
   *  `defaultColDef` (and columnTypes) are folded into every leaf at
   *  construction (`propertyChain.resolveColDef`). The bridge reads the
   *  AUTHORED defs via `getGridOption('columnDefs')`, so it must fold
   *  `defaultColDef.editable` itself: a grid authored with
   *  `defaultColDef: { editable: true }` and bare leaves is editable
   *  kernel-side, and smart-edit/bulk-update targets must agree (this was
   *  the toolbar's "0 cells on an editable grid" bug). Leaf wins over
   *  defaultColDef, matching kernel precedence. */
  function resolveEditable(
    colId: string,
    rowIndex: number,
    data: Record<string, unknown> | undefined,
    value: unknown,
  ): boolean {
    const def = findLeafColDef(colDefs(), colId);
    if (!def) return false;
    const defaultDef = g.getGridOption?.('defaultColDef') as KernelColDefLike | undefined;
    const e = def.editable ?? defaultDef?.editable;
    if (typeof e === 'boolean') return e;
    if (typeof e === 'function') {
      try {
        return e({ data: data ?? {}, colId, rowIndex, value });
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Focused-cell rowIndex adapter (plan-time discovery): focusing a cell
   *  COLLAPSES ranges to a 1×1 range at that cell
   *  (`interaction/selectionModel.ts:130-151`,
   *  `setFocusAndCollapseRanges`), so the bridge synthesizes the pinned
   *  `{rowIndex, colId} | null` shape from `getCellRanges()`: the trailing
   *  range with `rowStart === rowEnd && colIds.length === 1` → that cell; no
   *  such range (e.g. a genuinely empty selection, or a multi-cell drag as
   *  the trailing range) → null. No public kernel surface exposes a visible
   *  rowIndex for the focused cell any other way. */
  function synthesizeFocusedCell(): { rowIndex: number; colId: string } | null {
    const ranges = g.getCellRanges();
    const trailing = ranges[ranges.length - 1];
    if (trailing && trailing.rowStart === trailing.rowEnd && trailing.colIds.length === 1) {
      return { rowIndex: trailing.rowStart, colId: trailing.colIds[0]! };
    }
    return null;
  }

  const targetSurface: TargetSurface = {
    getCellRanges: () => g.getCellRanges(),
    getFocusedCell: () => synthesizeFocusedCell(),
    getRowsByIndex: async (rowIndexes) => {
      const result = await g.getRowsByIndex(rowIndexes);
      lastFetchByIndex.clear();
      for (const entry of result) {
        if (entry) lastFetchByIndex.set(entry.rowIndex, { rowId: entry.rowId, data: entry.data });
      }
      return result;
    },
    isCellEditable: (rowIndex, colId) => {
      // Prefer the kernel's own resolution when the surface exposes it —
      // resolved defs (defaultColDef/columnTypes folded) + pivot gate, with
      // zero replication drift. Bare test surfaces fall back to the local
      // replication above.
      if (typeof g.isCellEditable === 'function') {
        try {
          return g.isCellEditable(rowIndex, colId);
        } catch {
          return false;
        }
      }
      const cached = lastFetchByIndex.get(rowIndex);
      const meta = colMeta(colId);
      const value = cached && meta ? cached.data[meta.field] : undefined;
      return resolveEditable(colId, rowIndex, cached?.data, value);
    },
    colMeta,
  };

  // ─── Commit pipeline (§3.2) — the ONE writer, injected into EditJournal
  // as its applier. Forward commits (smart-edit/bulk-update/plus-minus/
  // shortcut) also call this DIRECTLY (one call per action = one
  // applyTransaction per journal entry). ─────────────────────────────────
  //
  // Parser discipline (closeout review, cycle 21g): the kernel ONLY ever
  // feeds `valueParser` FRESH editor-raw input — see
  // `editController.ts:289-330`'s `onCommit`, which parses the raw editor
  // value exactly once (`def.valueParser({ newValue, oldValue, data,
  // colDef })`) and then emits `cellValueChanged` with the ALREADY-PARSED
  // value as `newValue`. Every `CellPatch` the bridge feeds back through
  // the journal is therefore either (a) a facade/router INITIAL forward
  // apply, where `patch.newValue` is a freshly-computed raw value that has
  // never seen `valueParser` (smart-edit/bulk-update/nudge/shortcut), or
  // (b) a value that was already committed once and is being REPLAYED
  // (undo of any entry, or redo of any entry) — for `cell-editor`-sourced
  // entries specifically, `patch.newValue` is already POST-parse (mirrors
  // the kernel event above). Re-running `valueParser` on a replay would
  // double-transform non-idempotent parsers (e.g. a `/100` parser turning
  // into `/10000` on redo). Rule: the parser runs ONLY when `mode ===
  // 'initial'` — journal replay (`undo()`/`redo()`/`undoEntry()`) always
  // binds `mode: 'replay'` and never re-parses, writing the stored value
  // verbatim through the `valueSetter` path (the setter itself still runs —
  // only the parser is skipped).
  // Returns the number of patches that actually landed in a row (rows
  // missing from the mirror — removed since recording — contribute 0; see
  // the `commitAndMaybeRecord` caller, which threads this into the
  // facades' `applied` count instead of the raw pre-dedup/pre-mirror-check
  // `patches.length`).
  function applyDirection(patches: CellPatch[], direction: 'forward' | 'undo', mode: 'initial' | 'replay'): number {
    const deduped = dedupePatches(patches);
    if (deduped.length === 0) return 0;

    const byRowId = new Map<string, CellPatch[]>();
    for (const patch of deduped) {
      const list = byRowId.get(patch.rowId);
      if (list) list.push(patch);
      else byRowId.set(patch.rowId, [patch]);
    }

    const updates: Record<string, unknown>[] = [];
    // Deferred until the commit call below actually succeeds — an
    // optimistic write here would leave the mirror permanently ahead of
    // reality if `commitUpdates`/`applyTransaction` throws.
    const mirrorWrites: Array<[string, Record<string, unknown>]> = [];
    let writtenCount = 0;
    for (const [rowId, rowPatches] of byRowId) {
      const mirrorRow = rowMirror.get(rowId);
      if (!mirrorRow) continue; // removed since recording — skip, do not throw
      const clone = { ...mirrorRow };
      for (const patch of rowPatches) {
        const def = findLeafColDef(colDefs(), patch.colId);
        const rawNewValue = direction === 'forward' ? patch.newValue : patch.oldValue;
        const rawOldValue = direction === 'forward' ? patch.oldValue : patch.newValue;
        const parsed = mode === 'initial' && def?.valueParser
          ? def.valueParser({ newValue: rawNewValue, oldValue: rawOldValue, data: clone, colDef: def })
          : rawNewValue;
        if (def?.valueSetter) {
          // Kernel parity (editController.ts:289-330): the boolean return is
          // IGNORED — the setter mutates `data` in place.
          def.valueSetter({ data: clone, newValue: parsed, oldValue: rawOldValue, colDef: def });
        } else {
          clone[patch.field] = parsed;
        }
      }
      updates.push(clone);
      mirrorWrites.push([rowId, clone]);
      writtenCount += rowPatches.length;
    }
    if (updates.length === 0) return 0;

    // Selection snapshot/restore (§3.3) around EVERY programmatic apply —
    // runs on both the success AND failure path (finally), while a thrown
    // commit error still propagates to the caller.
    const snapshotRanges = g.getCellRanges();
    const snapshotFocused = g.getFocusedCell();
    const snapshotSelectedRowIds = g.getSelectedRowIds();

    replaying = true;
    try {
      if (opts?.commitUpdates) {
        opts.commitUpdates(updates, { patches: deduped, direction });
      } else {
        g.applyTransaction({ update: updates });
      }
      // Commit succeeded — now safe to fold the computed rows into the mirror.
      for (const [rowId, clone] of mirrorWrites) rowMirror.set(rowId, clone);
    } finally {
      replaying = false;
      g.clearCellRanges();
      for (const range of snapshotRanges) g.addCellRange(range);
      if (snapshotFocused) g.setFocusedCell(snapshotFocused.rowId, snapshotFocused.colId);
      g.setSelectedRowIds(snapshotSelectedRowIds);
    }
    return writtenCount;
  }

  const journal = new EditJournal({
    // Journal replay (undo/redo/undoEntry) is NEVER a facade-originated
    // fresh-input apply — always 'replay' (see the `applyDirection`
    // parser-discipline comment above). Return value discarded — `void`.
    applyPatches: (replayPatches, direction) => { applyDirection(replayPatches, direction, 'replay'); },
    getHistorySettings: () => settings.history,
    now,
  });

  function commitAndMaybeRecord(
    patches: CellPatch[],
    source: EditJournalEntry['source'],
    label: string,
    recordHistory: boolean,
  ): { applied: number; entry: EditJournalEntry | null } {
    // The ONE 'initial' apply site — every facade/router forward commit
    // (smart-edit/bulk-update/plus-minus/shortcut) is fresh-computed input,
    // so the parser runs here. `applied` is the ACTUAL written-patch count
    // (post-dedup, mirror-present rows only) — not the raw candidate count.
    const applied = applyDirection(patches, 'forward', 'initial');
    if (!recordHistory) return { applied, entry: null };
    return { applied, entry: journal.record({ source, label, patches }) };
  }

  // ─── Key router (§3.1) ──────────────────────────────────────────────────

  function buildFocusedTarget(rowId: string, colId: string, value: unknown): CellTarget | null {
    const focus = synthesizeFocusedCell();
    if (!focus) return null;
    const meta = colMeta(colId);
    if (!meta) return null;
    const rowData = rowMirror.get(rowId);
    if (!rowData) return null;
    // Spec §2.3 — every patch target passes `isCellEditable` at build. A
    // non-editable cell behaves like "no match": the caller's scope/gate
    // checks run AFTER this returns null, so `preventDefault` is never
    // called and the key falls through to normal type-to-edit.
    if (!resolveEditable(colId, focus.rowIndex, rowData, value)) return null;
    return {
      rowId, colId, field: meta.field, value,
      rowIndex: focus.rowIndex, rowData, cellDataType: meta.cellDataType,
    };
  }

  function tryNudge(e: CellKeyDownEventLike, direction: '+' | '-'): void {
    const target = buildFocusedTarget(e.rowId, e.colId, e.value);
    if (!target) return;
    const nudge = resolveNudgeForCell(
      { colId: target.colId, field: target.field, value: target.value, rowData: target.rowData },
      nudges,
      evaluate,
    );
    if (!nudge) return;
    e.event.preventDefault();
    const patches = buildNudgePatches({ targets: [target], direction, nudges, evaluate });
    if (patches.length === 0) return;
    const step = direction === '+' ? nudge.incrementStep : nudge.decrementStep ?? nudge.incrementStep;
    const label = `${target.field} ${direction}${step}`;
    commitAndMaybeRecord(patches, 'plus-minus', label, settings.plusMinus.recordHistory);
  }

  function tryShortcut(e: CellKeyDownEventLike): void {
    const target = buildFocusedTarget(e.rowId, e.colId, e.value);
    if (!target) return;
    const shortcut = matchShortcutForCell({ colId: target.colId, field: target.field }, e.event.key, shortcuts);
    if (!shortcut) return;
    e.event.preventDefault();
    const patches = buildShortcutPatches({ targets: [target], key: e.event.key, shortcuts });
    if (patches.length === 0) return;
    const label = `${target.field} ${SHORTCUT_OP_SYMBOL[shortcut.operation]}${shortcut.shortcutValue}`;
    commitAndMaybeRecord(patches, 'shortcut', label, settings.shortcuts.recordHistory);
  }

  function onCellKeyDown(raw: unknown): void {
    const e = raw as CellKeyDownEventLike;
    if (editing) return;
    const key = e.event.key;
    if ((key === '+' || key === '=' || key === '-') && settings.plusMinus.enabled) {
      tryNudge(e, key === '-' ? '-' : '+');
      return;
    }
    if (settings.shortcuts.enabled && shortcutKeySet.has(key.toLowerCase())) {
      tryShortcut(e);
    }
  }

  // ─── Journal feeds (§3.5) ───────────────────────────────────────────────

  function onCellValueChanged(raw: unknown): void {
    if (replaying) return;
    const e = raw as CellValueChangedEventLike;
    if (Object.is(e.oldValue, e.newValue)) return;
    const meta = colMeta(e.colId);
    if (!meta) return;
    const patch: CellPatch = {
      rowId: e.rowId, colId: e.colId, field: meta.field,
      oldValue: e.oldValue, newValue: e.newValue,
    };
    journal.record({ source: 'cell-editor', label: `${meta.field} = ${String(e.newValue)}`, patches: [patch] });
  }

  function buildStreamPatches(updated: RowsChangedEventLike['updated']): CellPatch[] {
    const metas = allLeafColDefs(colDefs())
      .filter((d): d is KernelColDefLike & { field: string } => typeof d.field === 'string')
      .map((d) => ({ colId: d.colId ?? d.field, field: d.field }));
    const patches: CellPatch[] = [];
    for (const { rowId, row, oldRow } of updated) {
      for (const { colId, field } of metas) {
        const oldValue = oldRow[field];
        const newValue = row[field];
        if (Object.is(oldValue, newValue)) continue;
        patches.push({ rowId, colId, field, oldValue, newValue });
      }
    }
    return patches;
  }

  function onRowsChanged(raw: unknown): void {
    const e = raw as RowsChangedEventLike;
    for (const { rowId, row } of e.added) rowMirror.set(rowId, row);
    for (const { rowId, row } of e.updated) rowMirror.set(rowId, row);
    for (const { rowId } of e.removed) rowMirror.delete(rowId);

    if (replaying || e.source === 'edit' || !settings.history.recordSources.stream) return;
    const patches = buildStreamPatches(e.updated);
    if (patches.length === 0) return;
    const rowWord = e.updated.length === 1 ? 'row' : 'rows';
    journal.record({ source: 'stream', label: `stream update (${e.updated.length} ${rowWord})`, patches });
  }

  function onModelUpdated(): void {
    seedRowMirror();
  }

  // ─── Facades (§4.2.6) ───────────────────────────────────────────────────

  // Backstop for `apply()`: `preview()` reports the full validator verdict
  // per patch (valid/warning/invalid) for the caller's confirm UI, but
  // `apply()` must not let a patch the validator marked 'invalid' reach the
  // commit pipeline even if the caller applies without previewing first.
  // 'warning' patches still commit — only 'invalid' is a hard gate.
  function dropInvalidPatches(patches: CellPatch[]): CellPatch[] {
    if (!validator) return patches;
    return patches.filter((patch) => validator(patch) !== 'invalid');
  }

  const smartEdit: EditBridgeHandle['smartEdit'] = {
    collectTargets: () => collectTargetCells(targetSurface),
    preview: (targets, op, operand) => previewPatches(buildSmartEditPatches(targets, op, operand), validator),
    apply: async (targets, op, operand) => {
      if (settings.smartEdit.enforceSingleColumn && !assertSingleColumnSelection(targets)) {
        return { applied: 0, entry: null };
      }
      const patches = dropInvalidPatches(buildSmartEditPatches(targets, op, operand));
      if (patches.length === 0) return { applied: 0, entry: null };
      const label = `${SMART_EDIT_OP_SYMBOL[op]} ${operand}`;
      return commitAndMaybeRecord(patches, 'smart-edit', label, settings.smartEdit.recordHistory);
    },
  };

  const bulkUpdate: EditBridgeHandle['bulkUpdate'] = {
    collectTargets: () => collectBulkUpdateTargets(targetSurface),
    distinctValues: (colId, cellDataType) =>
      makeDistinctValuesFeed(
        (c, limit) => g.getDistinctValues(c, limit),
        { maxDropdownValues: settings.bulkUpdate.maxDropdownValues },
      )(colId, cellDataType),
    preview: (targets, newValue) => previewPatches(buildBulkUpdatePatches(targets, newValue), validator),
    apply: async (targets, newValue) => {
      if (settings.bulkUpdate.enforceSingleColumn && !assertSingleColumnSelection(targets)) {
        return { applied: 0, entry: null };
      }
      const patches = dropInvalidPatches(buildBulkUpdatePatches(targets, newValue));
      if (patches.length === 0) return { applied: 0, entry: null };
      const label = `Set = ${String(newValue)}`;
      return commitAndMaybeRecord(patches, 'bulk-update', label, settings.bulkUpdate.recordHistory);
    },
  };

  function deepMergeOverCurrent(partial?: DeepPartial<EditSettings>): DeepPartial<EditSettings> {
    return {
      history: {
        ...settings.history,
        ...partial?.history,
        recordSources: { ...settings.history.recordSources, ...partial?.history?.recordSources },
      },
      smartEdit: { ...settings.smartEdit, ...partial?.smartEdit },
      bulkUpdate: { ...settings.bulkUpdate, ...partial?.bulkUpdate },
      plusMinus: { ...settings.plusMinus, ...partial?.plusMinus },
      shortcuts: { ...settings.shortcuts, ...partial?.shortcuts },
    };
  }

  const unsubscribers: Array<() => void> = [
    subscribe(g, 'rowsChanged', onRowsChanged),
    subscribe(g, 'modelUpdated', onModelUpdated),
    subscribe(g, 'cellValueChanged', onCellValueChanged),
    subscribe(g, 'cellKeyDown', onCellKeyDown),
    subscribe(g, 'cellEditingStarted', () => { editing = true; }),
    subscribe(g, 'cellEditingStopped', () => { editing = false; }),
  ];

  const destroy = (): void => {
    for (const unsub of unsubscribers) unsub();
    unsubscribers.length = 0;
    rowMirror.clear();
    lastFetchByIndex.clear();
    delete g.__editBridgeWired;
  };
  unsubscribers.push(subscribe(g, 'gridPreDestroyed', destroy));

  const handle: EditBridgeHandle = {
    journal,
    smartEdit,
    bulkUpdate,
    getSettings: () => mergeEditSettings(settings),
    updateSettings: (partial) => {
      settings = mergeEditSettings(deepMergeOverCurrent(partial));
      settingsTouched = true;
      // Cycle 21i Phase 2 / T6 — mark the persisted slice dirty so the
      // kernel's stateUpdated -> persistState autosave runs.
      g.notifyModuleStateChanged?.('editSettings');
    },
    getNudges: () => nudges.map((n) => ({ ...n, scope: { columnIds: [...n.scope.columnIds] } })),
    setNudges: (next) => {
      nudges = next;
      settingsTouched = true;
      g.notifyModuleStateChanged?.('editSettings');
    },
    getShortcuts: () => shortcuts.map((s) => ({ ...s, scope: { columnIds: [...s.scope.columnIds] } })),
    setShortcuts: (next) => {
      shortcuts = next;
      shortcutKeySet = collectShortcutKeys(shortcuts);
      settingsTouched = true;
      g.notifyModuleStateChanged?.('editSettings');
    },
    destroy,
  };

  // Cycle 21i Phase 2 / T6 — the edit engine's settings ride the kernel
  // module-state registry (GridState.modules.editSettings). Engine-owned
  // per the no-retroactive-layering rule: the settings panel only reads/
  // writes through the handle; persistence is intrinsic here. `get()`
  // omits the slice while settings equal the defaults so snapshots stay
  // compact; `set()` runs the same defensive merge as host-supplied
  // settings (unknown keys dropped, ops filtered).
  // Dirty flag maintained at the two mutation sites instead of a
  // JSON.stringify comparison in get(): snapshots run once per coalesced
  // stateUpdated rAF flush (column-resize / range-select drags feed the
  // bus per frame), so get() must be allocation-free.
  //
  // Phase 3 — nudges + shortcut defs ride the same envelope (optional
  // `nudges` / `shortcutDefs` keys alongside EditSettings fields).
  let settingsTouched =
    JSON.stringify(settings) !== JSON.stringify(mergeEditSettings())
    || nudges.length > 0
    || shortcuts.length > 0;
  const unregisterStateModule = g.registerStateModule?.({
    id: 'editSettings',
    version: 1,
    get: () => {
      if (!settingsTouched) return undefined;
      return {
        ...settings,
        nudges,
        shortcutDefs: shortcuts,
      };
    },
    set: (data) => {
      const raw = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
      settings = mergeEditSettings(raw as Parameters<typeof mergeEditSettings>[0]);
      if (Array.isArray(raw.nudges)) {
        nudges = raw.nudges as PlusMinusNudge[];
      }
      if (Array.isArray(raw.shortcutDefs)) {
        shortcuts = raw.shortcutDefs as ShortcutDefinition[];
        shortcutKeySet = collectShortcutKeys(shortcuts);
      }
      settingsTouched = true;
    },
  });
  unsubscribers.push(() => unregisterStateModule?.());

  g.__editBridgeWired = handle;
  return handle;
}
