/**
 * Edit History — Customize sheet module for Data Change History settings
 * + live journal monitor (starui customizer-ui #11).
 *
 * Settings ride `@wellsfargo-starui/velocity-grid-edit`'s `editSettings` state module via the wired
 * edit handle. Journal stacks are session-only (never persisted). Suspend
 * syncs live; other fields wait for Save.
 */
import type { DataChangeHistorySettings, EditJournalEntry, EditSource } from '@wellsfargo-starui/velocity-grid-edit';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import {
  band, chip, el, injectCockpitStyles, lucideSvg, numberInput, row, switchToggle,
} from '../ui/cockpit';
import { clone, editHandle } from './editHandle';

const SOURCE_LABEL: Record<EditSource, string> = {
  'smart-edit': 'Smart Edit',
  'bulk-update': 'Bulk Update',
  'plus-minus': 'Plus / Minus',
  shortcut: 'Shortcut',
  'cell-editor': 'Cell Editor',
  stream: 'Stream',
};

const RECORD_SOURCE_ROWS: Array<{
  key: keyof DataChangeHistorySettings['recordSources'];
  label: string;
  hint?: string;
}> = [
  { key: 'smartEdit', label: 'Smart Edit' },
  { key: 'bulkUpdate', label: 'Bulk Update' },
  { key: 'plusMinus', label: 'Plus / Minus' },
  { key: 'shortcuts', label: 'Shortcuts' },
  { key: 'cellEditor', label: 'Cell Editor' },
  { key: 'stream', label: 'Stream Updates', hint: 'Live ticker writes — off by default' },
];

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return String(ts);
  }
}

function entrySummary(entry: EditJournalEntry): string {
  const cells = entry.patches.length;
  const cellWord = cells === 1 ? 'cell' : 'cells';
  return `${SOURCE_LABEL[entry.source] ?? entry.source} · ${formatTime(entry.timestamp)} · ${entry.label} (${cells} ${cellWord})`;
}

export function dataChangeHistoryModule(): SettingsModule {
  return {
    id: 'data-change-history',
    kind: 'settings-module',
    title: 'Edit History',
    icon: 'history',
    category: 'editing',

    init(): void {
      injectCockpitStyles();
    },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      let committed: DataChangeHistorySettings | null = null;
      let draft: DataChangeHistorySettings | null = null;
      let unsubJournal: (() => void) | null = null;

      const root = el('div', 'ckp ckp-flat');
      host.appendChild(root);

      const load = (): void => {
        const handle = editHandle(ctx.grid);
        if (!handle) {
          committed = null;
          draft = null;
          return;
        }
        committed = clone(handle.getSettings().history);
        draft = clone(committed);
      };

      const isDirty = (): boolean => {
        if (!draft || !committed) return false;
        return JSON.stringify(draft) !== JSON.stringify(committed);
      };

      const save = (): void => {
        const handle = editHandle(ctx.grid);
        if (!handle || !draft) return;
        handle.updateSettings({ history: clone(draft) });
        ctx.profiles.markDirty();
        committed = clone(draft);
        renderAll();
      };

      const reset = (): void => {
        if (!committed) return;
        draft = clone(committed);
        renderAll();
      };

      /** Suspend applies immediately (Markets: pause recording NOW). */
      const setSuspendedLive = (suspended: boolean): void => {
        const handle = editHandle(ctx.grid);
        if (!handle || !draft) return;
        draft.suspended = suspended;
        handle.updateSettings({ history: { suspended } });
        if (committed) committed.suspended = suspended;
        ctx.profiles.markDirty();
        renderAll();
      };

      const renderMonitor = (body: HTMLElement): void => {
        body.replaceChildren();
        const handle = editHandle(ctx.grid);
        if (!handle) {
          body.appendChild(el('div', 'ckp-empty', 'Edit engine is not wired.'));
          return;
        }
        const entries = [...handle.journal.monitorEntries()].reverse();
        if (entries.length === 0) {
          body.appendChild(el('div', 'ckp-empty', 'No edits recorded this session.'));
          return;
        }
        const list = el('div', 'ckp-monitor-list');
        list.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:220px;overflow:auto;';
        for (const entry of entries) {
          const rowEl = el('div', 'ckp-monitor-row');
          rowEl.style.cssText =
            'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;' +
            'background:var(--ckp-surface, transparent);';
          const text = el('div', 'ckp-monitor-text', entrySummary(entry));
          text.style.cssText = 'flex:1;min-width:0;font-size:12px;line-height:1.35;';
          const undoBtn = el('button', 'ckp-mini', 'Undo') as HTMLButtonElement;
          undoBtn.type = 'button';
          undoBtn.title = 'Undo this entry and everything since';
          const canUndo = handle.journal.entries().some((e) => e.id === entry.id);
          undoBtn.disabled = !canUndo;
          undoBtn.addEventListener('click', () => {
            handle.journal.undoEntry(entry.id);
          });
          rowEl.append(text, undoBtn);
          list.appendChild(rowEl);
        }
        body.appendChild(list);
      };

      const renderAll = (): void => {
        root.replaceChildren();
        const handle = editHandle(ctx.grid);
        if (!handle || !draft) {
          root.appendChild(el('div', 'ckp-empty', 'Edit History requires wireEditIntoKernel(grid).'));
          return;
        }

        const head = el('div', 'ckp-pane-head');
        const title = el('div', 'ckp-title', 'Edit History');
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.gap = '10px';
        title.appendChild(chip('Stack', String(handle.journal.entries().length), 'info').root);
        const resetBtn = el('button', 'ckp-actbtn') as HTMLButtonElement;
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.addEventListener('click', reset);
        const saveBtn = el('button', 'ckp-actbtn') as HTMLButtonElement;
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.addEventListener('click', save);
        const dirty = isDirty();
        saveBtn.disabled = !dirty;
        resetBtn.disabled = !dirty;
        head.append(title, resetBtn, saveBtn);
        root.appendChild(head);

        const scroll = el('div', 'ckp-flat-body');

        const global = band('01', 'Global');
        global.body.append(
          row('Enabled', switchToggle(draft.enabled, (v) => { draft!.enabled = v; renderAll(); })),
          row(
            'Suspended',
            switchToggle(draft.suspended, setSuspendedLive),
            'Pauses recording immediately — does not wait for Save',
          ),
          row(
            'Max Entries',
            numberInput(draft.maxEntries, (v) => {
              if (v === undefined || !Number.isFinite(v)) return;
              draft!.maxEntries = Math.max(5, Math.floor(v));
              renderAll();
            }),
          ),
          row(
            'Unify Undo',
            switchToggle(draft.unifyUndo, (v) => { draft!.unifyUndo = v; renderAll(); }),
            'Edit journal owns undo; disable native cell undo when available',
          ),
        );
        scroll.appendChild(global.root);

        const sources = band('02', 'Record Sources');
        for (const src of RECORD_SOURCE_ROWS) {
          sources.body.append(
            row(
              src.label,
              switchToggle(draft.recordSources[src.key], (v) => {
                draft!.recordSources[src.key] = v;
                renderAll();
              }),
              src.hint,
            ),
          );
        }
        scroll.appendChild(sources.root);
        root.appendChild(scroll);

        const monitorWrap = el('div', 'ckp-flat-foot ckp-monitor-wrap');
        const monitor = band('03', 'Monitor');
        renderMonitor(monitor.body);
        monitorWrap.appendChild(monitor.root);
        root.appendChild(monitorWrap);

        unsubJournal?.();
        unsubJournal = handle.journal.subscribe(() => {
          const body = root.querySelector('.ckp-monitor-wrap .ckp-band-body') as HTMLElement | null;
          if (body) renderMonitor(body);
          const stackChip = root.querySelector('.ckp-pane-head .ckp-chip-value');
          if (stackChip) stackChip.textContent = String(handle.journal.entries().length);
        });
      };

      load();
      renderAll();

      return {
        destroy() {
          unsubJournal?.();
          unsubJournal = null;
          root.replaceChildren();
          root.remove();
        },
        refresh() {
          load();
          renderAll();
        },
      };
    },
  };
}
