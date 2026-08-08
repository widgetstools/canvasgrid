/**
 * Shortcuts — Customize module (starui customizer-ui #07).
 * Module settings + shortcut list / editor (master-detail).
 */
import type { ShortcutDefinition, ShortcutsSettings } from '@wellsfargo-starui/velocity-grid-edit';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import { leafColumns } from '../ui/gridSchema';
import {
  band, caps, el, injectCockpitStyles, lucideSvg, numberInput, pillGroup, row, switchToggle, textInput,
} from '../ui/cockpit';
import { clone, editHandle } from './editHandle';

type ShortcutOp = ShortcutDefinition['operation'];

const OP_PILLS: Array<[ShortcutOp, string]> = [
  ['multiply', '×'],
  ['divide', '÷'],
  ['add', '+'],
  ['subtract', '−'],
];

function newShortcut(): ShortcutDefinition {
  return {
    id: `sc_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: 'New shortcut',
    enabled: true,
    shortcutKey: 'q',
    operation: 'add',
    shortcutValue: 1,
    scope: { columnIds: [] },
  };
}

function parseCols(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function opGlyph(op: ShortcutOp): string {
  return OP_PILLS.find(([o]) => o === op)?.[1] ?? op;
}

export function shortcutsModule(): SettingsModule {
  return {
    id: 'shortcuts',
    kind: 'settings-module',
    title: 'Shortcuts',
    icon: 'keyboard',
    category: 'editing',

    init(): void { injectCockpitStyles(); },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      let settingsCommitted: ShortcutsSettings | null = null;
      let settingsDraft: ShortcutsSettings | null = null;
      let defs: ShortcutDefinition[] = [];
      let selectedId: string | null = null;
      let draft: ShortcutDefinition | null = null;
      let draftIsNew = false;

      const root = el('div', 'ckp');
      const rail = el('div', 'ckp-rail');
      const pane = el('div', 'ckp-pane');
      root.append(rail, pane);
      host.appendChild(root);

      const loadDefs = (): void => {
        const h = editHandle(ctx.grid);
        if (!h) {
          settingsCommitted = null;
          settingsDraft = null;
          defs = [];
          return;
        }
        if (!settingsDraft || !settingsCommitted
          || JSON.stringify(settingsDraft) === JSON.stringify(settingsCommitted)) {
          settingsCommitted = clone(h.getSettings().shortcuts);
          settingsDraft = clone(settingsCommitted);
        } else if (!settingsCommitted) {
          settingsCommitted = clone(h.getSettings().shortcuts);
        }
        defs = h.getShortcuts();
      };

      const settingsDirty = (): boolean =>
        !!settingsDraft && !!settingsCommitted
        && JSON.stringify(settingsDraft) !== JSON.stringify(settingsCommitted);

      const itemDirty = (): boolean => {
        if (!draft) return false;
        if (draftIsNew) return true;
        return JSON.stringify(defs.find((s) => s.id === draft!.id)) !== JSON.stringify(draft);
      };

      const isDirty = (): boolean => settingsDirty() || itemDirty();

      const selectItem = (id: string | null, asNew = false, seed?: ShortcutDefinition, force = false): void => {
        if (!force && draft && itemDirty() && !(asNew && seed) && id !== selectedId) {
          if (!window.confirm('Discard unsaved shortcut changes?')) return;
        }
        selectedId = id;
        draftIsNew = asNew;
        draft = seed ? clone(seed) : id ? clone(defs.find((s) => s.id === id) ?? newShortcut()) : null;
        renderAll();
      };

      const save = (): void => {
        const h = editHandle(ctx.grid);
        if (!h || !settingsDraft) return;
        if (settingsDirty()) {
          h.updateSettings({ shortcuts: clone(settingsDraft) });
          h.updateSettings({ history: { recordSources: { shortcuts: settingsDraft.recordHistory } } });
          settingsCommitted = clone(settingsDraft);
        }
        if (draft && itemDirty()) {
          const next = clone(draft);
          next.shortcutKey = next.shortcutKey.toLowerCase().slice(0, 1);
          let list = h.getShortcuts();
          if (draftIsNew) list = [...list, next];
          else list = list.map((s) => (s.id === next.id ? next : s));
          h.setShortcuts(list);
          defs = list;
          draftIsNew = false;
          selectedId = next.id;
          draft = clone(next);
        }
        ctx.profiles.markDirty();
        renderAll();
      };

      const reset = (): void => {
        if (settingsCommitted) settingsDraft = clone(settingsCommitted);
        if (draftIsNew) {
          selectItem(defs[0]?.id ?? null, false, undefined, true);
          return;
        }
        if (draft && selectedId) {
          const src = defs.find((s) => s.id === selectedId);
          draft = src ? clone(src) : null;
        }
        renderAll();
      };

      const renderRail = (): void => {
        rail.replaceChildren();
        const head = el('div', 'ckp-rail-head');
        const add = el('button', 'ckp-addbtn', '+') as HTMLButtonElement;
        add.type = 'button';
        add.title = 'Add shortcut';
        add.addEventListener('click', () => {
          const s = newShortcut();
          selectItem(s.id, true, s);
        });
        head.append(caps('Shortcuts'), el('span', 'ckp-caps ckp-count', String(defs.length).padStart(2, '0')), add);
        rail.appendChild(head);

        for (const s of defs) {
          const rowEl = el('div', `ckp-rail-row${s.id === selectedId ? ' active' : ''}${s.enabled ? '' : ' muted'}`);
          const name = el('span', 'ckp-rail-name', s.name);
          const meta = el('div', 'ckp-hint lc',
            `${s.enabled ? 'on' : 'off'} · ${s.shortcutKey.toUpperCase()} → ${opGlyph(s.operation)}${s.shortcutValue}`
            + ` · ${s.scope.columnIds.length ? s.scope.columnIds.join(',') : 'all'}`);
          meta.style.fontSize = '10px';
          const wrap = el('div');
          wrap.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';
          wrap.append(name, meta);
          const del = el('button', 'ckp-mini') as HTMLButtonElement;
          del.type = 'button';
          del.title = 'Delete';
          del.innerHTML = lucideSvg('trash-2', 12) || '×';
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const h = editHandle(ctx.grid);
            if (!h) return;
            const list = h.getShortcuts().filter((x) => x.id !== s.id);
            h.setShortcuts(list);
            ctx.profiles.markDirty();
            defs = list;
            if (selectedId === s.id) selectItem(list[0]?.id ?? null, false, undefined, true);
            else renderAll();
          });
          rowEl.append(wrap, del);
          rowEl.addEventListener('click', () => selectItem(s.id));
          rail.appendChild(rowEl);
        }
        if (draftIsNew && draft) {
          const rowEl = el('div', 'ckp-rail-row active');
          rowEl.appendChild(el('span', 'ckp-rail-name', draft.name || 'New shortcut'));
          rail.appendChild(rowEl);
        }
      };

      const renderPane = (): void => {
        pane.replaceChildren();
        if (!settingsDraft) {
          pane.appendChild(el('div', 'ckp-empty', 'Shortcuts requires wireEditIntoKernel(grid).'));
          return;
        }

        const head = el('div', 'ckp-pane-head');
        const title = el('div', 'ckp-title', draft ? draft.name : 'Shortcuts');
        const resetBtn = el('button', 'ckp-actbtn') as HTMLButtonElement;
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        const saveBtn = el('button', 'ckp-actbtn') as HTMLButtonElement;
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        head.append(title, resetBtn, saveBtn);
        pane.appendChild(head);

        const glob = band('00', 'Global');
        glob.body.append(
          row('Enabled', switchToggle(settingsDraft.enabled, (v) => {
            settingsDraft!.enabled = v;
            renderAll();
          }), 'Focus a numeric cell and press a letter key'),
          row('Record history', switchToggle(settingsDraft.recordHistory, (v) => {
            settingsDraft!.recordHistory = v;
            renderAll();
          })),
        );
        pane.appendChild(glob.root);

        if (!draft) {
          pane.appendChild(el('div', 'ckp-empty', 'Select a shortcut, or add one with +'));
          return;
        }
        const d = draft;
        const band1 = band('01', 'Shortcut');
        const keyIn = textInput(d.shortcutKey, () => { /* validated below */ }, {
          placeholder: 'a-z',
        });
        keyIn.maxLength = 1;
        keyIn.addEventListener('beforeinput', (ev) => {
          const e = ev as InputEvent;
          if (!e.data) return;
          if (!/^[a-zA-Z]$/.test(e.data)) ev.preventDefault();
        });
        keyIn.addEventListener('input', () => {
          const v = keyIn.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 1);
          keyIn.value = v;
          d.shortcutKey = v || d.shortcutKey;
          saveBtn.disabled = !isDirty();
          resetBtn.disabled = !isDirty();
        });

        band1.body.append(
          row('Name', textInput(d.name, (v) => { d.name = v; renderAll(); })),
          row('Enabled', switchToggle(d.enabled, (v) => { d.enabled = v; renderAll(); })),
          row('Key', keyIn),
          row('Operation', pillGroup(
            OP_PILLS.map(([op, label]) => [op, label] as [string, string]),
            d.operation,
            (v) => { d.operation = v as ShortcutOp; renderAll(); },
          )),
          row('Value', numberInput(d.shortcutValue, (v) => {
            if (v === undefined) return;
            d.shortcutValue = v;
            renderAll();
          })),
          row('Columns', textInput(d.scope.columnIds.join(', '), (v) => {
            d.scope.columnIds = parseCols(v);
            saveBtn.disabled = !isDirty();
            resetBtn.disabled = !isDirty();
          }, { placeholder: 'colIds, comma-separated (empty = all)' })),
        );
        pane.appendChild(band1.root);

        const cols = leafColumns(ctx.grid)
          .map((c) => c.colId ?? c.field)
          .filter((id): id is string => !!id)
          .slice(0, 8);
        const more = leafColumns(ctx.grid).length > 8 ? '…' : '';
        pane.appendChild(el('div', 'ckp-hint',
          `Letter shortcuts apply to focused numeric cells. Columns: ${cols.join(', ') || '—'} ${more}`));
      };

      const renderAll = (): void => {
        loadDefs();
        renderRail();
        renderPane();
      };

      loadDefs();
      if (defs[0]) selectItem(defs[0].id, false, undefined, true);
      else {
        renderRail();
        renderPane();
      }

      return {
        destroy() { root.replaceChildren(); root.remove(); },
        refresh() {
          loadDefs();
          if (selectedId && !draftIsNew && !defs.some((s) => s.id === selectedId)) {
            selectItem(defs[0]?.id ?? null, false, undefined, true);
          } else {
            renderRail();
            renderPane();
          }
        },
      };
    },
  };
}
