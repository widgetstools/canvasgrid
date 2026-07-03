// @cgrid/edit — EditJournal: dual undo/redo stacks + decoupled monitor list.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// §1.1.1 (journal), §3.5 (suspend/monitor semantics), §3.2 (undoEntry cascade — Task 3).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.1/A.2.
//
// Engine discipline (spec §2.3): no kernel imports, Date-free (host-injected
// `now`/`nextId`), the journal never touches a grid — `applyPatches` is the
// caller's injected applier.

import type { CellPatch, DataChangeHistorySettings, EditJournalEntry, EditSource } from './types';
import { shouldRecord } from './settings';

export interface EditJournalOptions {
  /** Injected applier; the journal NEVER touches a grid directly. */
  applyPatches: (patches: CellPatch[], direction: 'forward' | 'undo') => void;
  /** Read LIVE on every record — `maxEntries`/`suspended` can change between calls. */
  getHistorySettings: () => DataChangeHistorySettings;
  /** Date-free default: always `0`. */
  now?: () => number;
  /** Default: internal closure counter `'e1'`, `'e2'`, … */
  nextId?: () => string;
  /** Monitor list cap, independent of `history.maxEntries`. */
  monitorLimit?: number;
}

const DEFAULT_MONITOR_LIMIT = 100;

export class EditJournal {
  private readonly applyPatchesFn: (patches: CellPatch[], direction: 'forward' | 'undo') => void;
  private readonly getHistorySettings: () => DataChangeHistorySettings;
  private readonly now: () => number;
  private readonly nextId: () => string;
  private readonly monitorLimit: number;

  // All three stored oldest→newest; push/pop at the tail.
  private past: EditJournalEntry[] = [];
  private future: EditJournalEntry[] = [];
  private monitor: EditJournalEntry[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(opts: EditJournalOptions) {
    this.applyPatchesFn = opts.applyPatches;
    this.getHistorySettings = opts.getHistorySettings;
    this.now = opts.now ?? (() => 0);
    let counter = 0;
    this.nextId = opts.nextId ?? (() => `e${++counter}`);
    this.monitorLimit = opts.monitorLimit ?? DEFAULT_MONITOR_LIMIT;
  }

  /** Records an atomic patch batch, or returns `null` (storing nothing) when
   *  gated by `shouldRecord` or given zero patches. Clears `future` on success. */
  record(input: { source: EditSource; label: string; patches: CellPatch[] }): EditJournalEntry | null {
    if (input.patches.length === 0) return null;
    const settings = this.getHistorySettings();
    if (!shouldRecord(input.source, settings)) return null;

    const entry: EditJournalEntry = {
      id: this.nextId(),
      timestamp: this.now(),
      source: input.source,
      label: input.label,
      patches: input.patches,
    };

    this.past.push(entry);
    while (this.past.length > settings.maxEntries) this.past.shift();
    this.future = [];

    this.monitor.push(entry);
    while (this.monitor.length > this.monitorLimit) this.monitor.shift();

    this.notify();
    return entry;
  }

  undo(): EditJournalEntry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.applyPatchesFn(entry.patches, 'undo');
    this.future.push(entry);
    this.notify();
    return entry;
  }

  redo(): EditJournalEntry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.applyPatchesFn(entry.patches, 'forward');
    this.past.push(entry);
    this.notify();
    return entry;
  }

  /** STUB — cascade body lands in Task 3 (spec §3.2). Not a keystroke-path API,
   *  so the throw does not violate the null-on-failure discipline. */
  undoEntry(_entryId: string): EditJournalEntry[] {
    throw new Error('not-yet-implemented');
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Past copy, oldest→newest. */
  entries(): readonly EditJournalEntry[] {
    return [...this.past];
  }

  /** Audit copy, oldest→newest — decoupled from the undo cap (recon A.1). */
  monitorEntries(): readonly EditJournalEntry[] {
    return [...this.monitor];
  }

  /** Fires after every state mutation (record/undo/redo). Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
