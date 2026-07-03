// @cgrid/edit — the kernel bridge. Spec §4 (`wireEditIntoKernel`).
//
// `wireEditIntoKernel(grid, opts?)` wires the whole editing-ops feature set
// (journal, smart-edit, bulk-update, plus/minus nudges, letter shortcuts)
// onto a CGrid instance via the kernel's PUBLIC API, mirroring
// packages/renderers/src/bridge.ts / packages/format/src/bridge.ts /
// packages/rules/src/bridge.ts / packages/calc/src/bridge.ts.
//
// Engine-discipline note (spec §2.3, pinned): this is the ONE module allowed
// a real `@cgrid/expression` runtime import (`makeExpressionEvaluate`
// default) and the ONE place a `Date.now()` default lives — the bridge IS
// the host boundary. Every other `@cgrid/edit` module stays pure/engine-side.
// Kernel imports here are STRUCTURAL/type-only (renderers `bridge.ts:8`
// precedent: `import type { CellPainter } from '@cgrid/kernel'`) — this file
// imports NOTHING at runtime from `@cgrid/kernel`.

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
//   - `isEditing()` is NOT public (`isAnyEditOpen` is private, `cgrid.ts:7672`)
//     → editing guard derives from the public `cellEditingStarted` /
//     `cellEditingStopped` events instead.
//   - `isCellEditable(rowIndex, colId)` is NOT public either (`cgrid.ts:7649`
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
  /** Default: `makeExpressionEvaluate()` (real `@cgrid/expression`). */
  evaluate?: NudgeEvaluate;
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
  setNudges(nudges: PlusMinusNudge[]): void;
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
    return { field: leaf.field, cellDataType: leaf.cellDataType };
  }

  /** Addon-side `isCellEditable` replication (`EditController.isCellEditable`,
   *  `core/editController.ts:407-428`): static bool passes through; callback
   *  gets `{data, colId, rowIndex, value}`; throw / unknown column → false. */
  function resolveEditable(
    colId: string,
    rowIndex: number,
    data: Record<string, unknown> | undefined,
    value: unknown,
  ): boolean {
    const def = findLeafColDef(colDefs(), colId);
    if (!def) return false;
    const e = def.editable;
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
  function applyDirection(patches: CellPatch[], direction: 'forward' | 'undo'): void {
    const deduped = dedupePatches(patches);
    if (deduped.length === 0) return;

    const byRowId = new Map<string, CellPatch[]>();
    for (const patch of deduped) {
      const list = byRowId.get(patch.rowId);
      if (list) list.push(patch);
      else byRowId.set(patch.rowId, [patch]);
    }

    const updates: Record<string, unknown>[] = [];
    for (const [rowId, rowPatches] of byRowId) {
      const mirrorRow = rowMirror.get(rowId);
      if (!mirrorRow) continue; // removed since recording — skip, do not throw
      const clone = { ...mirrorRow };
      for (const patch of rowPatches) {
        const def = findLeafColDef(colDefs(), patch.colId);
        const rawNewValue = direction === 'forward' ? patch.newValue : patch.oldValue;
        const rawOldValue = direction === 'forward' ? patch.oldValue : patch.newValue;
        const parsed = def?.valueParser
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
    }
    if (updates.length === 0) return;

    // Selection snapshot/restore (§3.3) around EVERY programmatic apply.
    const snapshotRanges = g.getCellRanges();
    const snapshotFocused = g.getFocusedCell();
    const snapshotSelectedRowIds = g.getSelectedRowIds();

    replaying = true;
    try {
      g.applyTransaction({ update: updates });
    } finally {
      replaying = false;
    }

    g.clearCellRanges();
    for (const range of snapshotRanges) g.addCellRange(range);
    if (snapshotFocused) g.setFocusedCell(snapshotFocused.rowId, snapshotFocused.colId);
    g.setSelectedRowIds(snapshotSelectedRowIds);
  }

  const journal = new EditJournal({
    applyPatches: applyDirection,
    getHistorySettings: () => settings.history,
    now,
  });

  function commitAndMaybeRecord(
    patches: CellPatch[],
    source: EditJournalEntry['source'],
    label: string,
    recordHistory: boolean,
  ): EditJournalEntry | null {
    applyDirection(patches, 'forward');
    if (!recordHistory) return null;
    return journal.record({ source, label, patches });
  }

  // ─── Key router (§3.1) ──────────────────────────────────────────────────

  function buildFocusedTarget(rowId: string, colId: string, value: unknown): CellTarget | null {
    const focus = synthesizeFocusedCell();
    if (!focus) return null;
    const meta = colMeta(colId);
    if (!meta) return null;
    const rowData = rowMirror.get(rowId);
    if (!rowData) return null;
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

  const smartEdit: EditBridgeHandle['smartEdit'] = {
    collectTargets: () => collectTargetCells(targetSurface),
    preview: (targets, op, operand) => previewPatches(buildSmartEditPatches(targets, op, operand), validator),
    apply: async (targets, op, operand) => {
      if (settings.smartEdit.enforceSingleColumn && !assertSingleColumnSelection(targets)) {
        return { applied: 0, entry: null };
      }
      const patches = buildSmartEditPatches(targets, op, operand);
      if (patches.length === 0) return { applied: 0, entry: null };
      const label = `${SMART_EDIT_OP_SYMBOL[op]} ${operand}`;
      const entry = commitAndMaybeRecord(patches, 'smart-edit', label, settings.smartEdit.recordHistory);
      return { applied: patches.length, entry };
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
      const patches = buildBulkUpdatePatches(targets, newValue);
      if (patches.length === 0) return { applied: 0, entry: null };
      const label = `Set = ${String(newValue)}`;
      const entry = commitAndMaybeRecord(patches, 'bulk-update', label, settings.bulkUpdate.recordHistory);
      return { applied: patches.length, entry };
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
    },
    setNudges: (next) => { nudges = next; },
    setShortcuts: (next) => {
      shortcuts = next;
      shortcutKeySet = collectShortcutKeys(shortcuts);
    },
    destroy,
  };

  g.__editBridgeWired = handle;
  return handle;
}
