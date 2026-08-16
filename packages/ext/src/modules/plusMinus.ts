/**
 * Plus / Minus — Customize module (starui customizer-ui #06).
 * Module settings + nudge list / editor (master-detail).
 */
import type { PlusMinusNudge, PlusMinusSettings } from '@wellsfargo-starui/velocity-grid-edit';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import { ExpressionEditor } from '../ui/expressionEditor';
import { editorColumns } from '../ui/gridSchema';
import {
  band,
  caps,
  el,
  injectCockpitStyles,
  lucideSvg,
  numberInput,
  row,
  switchToggle,
  textInput,
  appendPaneChrome,
  takePaneScroll,
  restorePaneScroll,
  emptyState,
  engineMissingNotice,
} from '../ui/cockpit';
import { clone, editHandle } from './editHandle';

function newNudge(): PlusMinusNudge {
  return {
    id: `nudge_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: 'New nudge',
    enabled: true,
    scope: { columnIds: [] },
    incrementStep: 1,
  };
}

function parseCols(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function formatCols(ids: string[]): string {
  return ids.join(', ');
}

export function plusMinusModule(): SettingsModule {
  return {
    id: 'plus-minus',
    kind: 'settings-module',
    title: 'Plus / Minus',
    icon: 'plus',
    category: 'editing',

    init(): void { injectCockpitStyles(); },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      let settingsCommitted: PlusMinusSettings | null = null;
      let settingsDraft: PlusMinusSettings | null = null;
      let nudges: PlusMinusNudge[] = [];
      let selectedId: string | null = null;
      let draft: PlusMinusNudge | null = null;
      let draftIsNew = false;
      let editor: ExpressionEditor | null = null;

      const root = el('div', 'ckp');
      const rail = el('div', 'ckp-rail');
      const pane = el('div', 'ckp-pane');
      root.append(rail, pane);
      host.appendChild(root);

      const load = (): void => {
        const h = editHandle(ctx);
        if (!h) {
          settingsCommitted = null;
          settingsDraft = null;
          nudges = [];
          return;
        }
        if (!settingsDraft || !settingsCommitted
          || JSON.stringify(settingsDraft) === JSON.stringify(settingsCommitted)) {
          settingsCommitted = clone(h.getSettings().plusMinus);
          settingsDraft = clone(settingsCommitted);
        } else if (!settingsCommitted) {
          settingsCommitted = clone(h.getSettings().plusMinus);
        }
        nudges = h.getNudges();
      };

      const settingsDirty = (): boolean =>
        !!settingsDraft && !!settingsCommitted
        && JSON.stringify(settingsDraft) !== JSON.stringify(settingsCommitted);

      const nudgeDirty = (): boolean => {
        if (!draft) return false;
        if (draftIsNew) return true;
        return JSON.stringify(nudges.find((n) => n.id === draft!.id)) !== JSON.stringify(draft);
      };

      const isDirty = (): boolean => settingsDirty() || nudgeDirty();

      const selectNudge = (id: string | null, asNew = false, seed?: PlusMinusNudge, force = false): void => {
        if (!force && draft && nudgeDirty() && !(asNew && seed) && id !== selectedId) {
          if (!window.confirm('Discard unsaved nudge changes?')) return;
        }
        editor?.destroy();
        editor = null;
        selectedId = id;
        draftIsNew = asNew;
        draft = seed ? clone(seed) : id ? clone(nudges.find((n) => n.id === id) ?? newNudge()) : null;
        renderAll();
      };

      const save = (): void => {
        const h = editHandle(ctx);
        if (!h || !settingsDraft) return;
        if (settingsDirty()) {
          h.updateSettings({ plusMinus: clone(settingsDraft) });
          h.updateSettings({ history: { recordSources: { plusMinus: settingsDraft.recordHistory } } });
          settingsCommitted = clone(settingsDraft);
        }
        if (draft && nudgeDirty()) {
          const next = clone(draft);
          let list = h.getNudges();
          if (draftIsNew) list = [...list, next];
          else list = list.map((n) => (n.id === next.id ? next : n));
          h.setNudges(list);
          nudges = list;
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
          selectNudge(nudges[0]?.id ?? null, false, undefined, true);
          return;
        }
        if (draft && selectedId) {
          const src = nudges.find((n) => n.id === selectedId);
          draft = src ? clone(src) : null;
        }
        renderAll();
      };

      const renderRail = (): void => {
        rail.replaceChildren();
        const head = el('div', 'ckp-rail-head');
        const add = el('button', 'ckp-addbtn', '+') as HTMLButtonElement;
        add.type = 'button';
        add.title = 'Add nudge';
        add.addEventListener('click', () => {
          const n = newNudge();
          selectNudge(n.id, true, n);
        });
        head.append(caps('Nudges'), el('span', 'ckp-caps ckp-count', String(nudges.length).padStart(2, '0')), add);
        rail.appendChild(head);

        for (const n of nudges) {
          const rowEl = el('div', `ckp-rail-row${n.id === selectedId ? ' active' : ''}${n.enabled ? '' : ' muted'}`);
          const name = el('span', 'ckp-rail-name', n.name);
          const meta = el('div', 'ckp-hint lc',
            `${n.enabled ? 'on' : 'off'} · ±${n.incrementStep}`
            + (n.decrementStep !== undefined && n.decrementStep !== n.incrementStep ? `/-${n.decrementStep}` : '')
            + ` · ${n.scope.columnIds.length ? n.scope.columnIds.join(',') : 'all'}`);
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
            const h = editHandle(ctx);
            if (!h) return;
            const list = h.getNudges().filter((x) => x.id !== n.id);
            h.setNudges(list);
            ctx.profiles.markDirty();
            nudges = list;
            if (selectedId === n.id) selectNudge(list[0]?.id ?? null, false, undefined, true);
            else renderAll();
          });
          rowEl.append(wrap, del);
          rowEl.addEventListener('click', () => selectNudge(n.id));
          rail.appendChild(rowEl);
        }
        if (draftIsNew && draft) {
          const rowEl = el('div', 'ckp-rail-row active');
          rowEl.appendChild(el('span', 'ckp-rail-name', draft.name || 'New nudge'));
          rail.appendChild(rowEl);
        }
      };

      const renderPane = (): void => {
        const scrollTop = takePaneScroll(pane);
        editor?.destroy();
        editor = null;
        pane.replaceChildren();
        if (!settingsDraft) {
          pane.appendChild(engineMissingNotice('edit', {
            feature: 'Plus / Minus', icon: 'plus',
          }));
          return;
        }

        const head = el('div', 'ckp-pane-head');
        const title = el('div', 'ckp-title', draft ? draft.name : 'Plus / Minus');
        const saveBtn = el('button', 'ckp-actbtn') as HTMLButtonElement;
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const resetBtn = el('button', 'ckp-actbtn ckp-btn-secondary') as HTMLButtonElement;
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        head.append(title, saveBtn, resetBtn);
        const body = appendPaneChrome(pane, head);

        const glob = band('Global');
        glob.body.append(
          row('Enabled', switchToggle(settingsDraft.enabled, (v) => {
            settingsDraft!.enabled = v;
            renderAll();
          }), 'When enabled, +/- keys use these nudges'),
          row('Record history', switchToggle(settingsDraft.recordHistory, (v) => {
            settingsDraft!.recordHistory = v;
            renderAll();
          })),
        );
        body.appendChild(glob.root);

        if (!draft) {
          body.appendChild(emptyState({
            title: 'No nudge selected',
            description: 'Select a nudge, or add one with +.',
            icon: 'plus',
          }));
          return;
        }
        const d = draft;
        const nb = band('Nudge');
        nb.body.append(
          row('Name', textInput(d.name, (v) => { d.name = v; renderAll(); })),
          row('Enabled', switchToggle(d.enabled, (v) => { d.enabled = v; renderAll(); })),
          row('Columns', textInput(formatCols(d.scope.columnIds), (v) => {
            d.scope.columnIds = parseCols(v);
          }, { placeholder: 'colIds, comma-separated (empty = all numeric)' })),
          row('Increment', numberInput(d.incrementStep, (v) => {
            if (v === undefined) return;
            d.incrementStep = v;
            renderAll();
          })),
          row('Decrement', numberInput(d.decrementStep, (v) => {
            d.decrementStep = v;
            renderAll();
          }), 'Optional — defaults to increment'),
        );
        body.appendChild(nb.root);

        const expr = band('Expression gate');
        const mount = el('div');
        expr.body.appendChild(mount);
        editor = new ExpressionEditor(mount, {
          value: d.expression ?? '',
          multiline: true,
          lines: 2,
          placeholder: 'optional row gate — empty = always',
          columnsProvider: () => editorColumns(ctx.grid),
          onChange: (v) => {
            d.expression = v.trim() ? v : undefined;
            resetBtn.disabled = !isDirty();
          },
        });
        expr.body.appendChild(el('div', 'ckp-hint', 'Falsy / throw skips the nudge for that row'));
        body.appendChild(expr.root);

        restorePaneScroll(pane, scrollTop);
      };

      const renderAll = (): void => {
        load();
        renderRail();
        renderPane();
      };

      load();
      if (nudges[0]) selectNudge(nudges[0].id, false, undefined, true);
      else {
        renderRail();
        renderPane();
      }

      return {
        destroy() {
          editor?.destroy();
          editor = null;
          root.replaceChildren();
          root.remove();
        },
        commit() { if (isDirty()) save(); },
        refresh() {
          load();
          if (selectedId && !draftIsNew && !nudges.some((n) => n.id === selectedId)) {
            selectNudge(nudges[0]?.id ?? null, false, undefined, true);
          } else {
            renderRail();
            renderPane();
          }
        },
      };
    },
  };
}
