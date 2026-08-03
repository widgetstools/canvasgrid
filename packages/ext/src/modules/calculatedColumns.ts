/**
 * Calculated Columns — settings-sheet editor in the starui customizer
 * cockpit layout: columns rail, summary-chip strip (column id / refs /
 * formatter / width), column-id row, numbered bands (expression → value
 * formatter → placement), CodeMirror 6 editor with live compile
 * validation and the shared Format picker.
 *
 * Mutations ride the idempotent @cgrid/calc engine handle; its bridge
 * persists the set in the grid config (layout-tier 'calc' state module)
 * and refolds columnDefs.
 */
import {
  wireIntoKernel as wireCalc,
  compileCalc,
  listAggregates,
  type CalculatedColumnDef,
  type CellDataType,
} from '@cgrid/calc';
import type { SettingsModule, CgExtContext, ModuleInstance } from '../extension/types';
import { ExpressionEditor, EXPRESSION_BUILTINS, type ExpressionFunction } from '../ui/expressionEditor';
import { editorColumns, schemaFromGrid } from '../ui/gridSchema';
import {
  band, caps, chip, el, injectCockpitStyles, lucideSvg, numberInput,
  pillGroup, row, select, textInput,
} from '../ui/cockpit';
import { formatPickerMenu, previewFormat } from '../toolbar/formatPicker';
import type { FormatDataType } from '../toolbar/formatPresets';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function newColumn(position: number): CalculatedColumnDef {
  return {
    colId: `vcol_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    headerName: 'New Column',
    expression: '',
    cellDataType: 'number',
    position,
  };
}

function calcFunctions(): ExpressionFunction[] {
  let aggregates: string[] = [];
  try { aggregates = listAggregates(); } catch { /* engine unavailable */ }
  return [
    ...EXPRESSION_BUILTINS,
    ...aggregates.map((name): ExpressionFunction => ({
      name,
      signature: `${name}([col], scope?)`,
      description: "Aggregate — scope 'all' | 'visible' | 'group' | 'parent'",
      category: 'Aggregate',
    })),
    { name: 'PREV', signature: 'PREV([col])', description: 'Value before the last update', category: 'Aggregate' },
  ];
}

/** Distinct `[col]` references in an expression (REFS chip). */
function countRefs(expression: string): number {
  const seen = new Set<string>();
  for (const m of expression.matchAll(/\[([\w.]+)\]/g)) seen.add(m[1]!);
  return seen.size;
}

const toFormatDataType = (t: CellDataType | undefined): FormatDataType =>
  t === 'date' || t === 'datetime' ? 'date' : t === 'boolean' ? 'boolean' : t === 'string' ? 'text' : 'number';

export function calculatedColumnsModule(): SettingsModule {
  return {
    id: 'calculated-columns',
    kind: 'settings-module',
    title: 'Calculated Columns',
    icon: 'sigma',
    category: 'data',

    init(): void {
      injectCockpitStyles();
    },

    mount(host: HTMLElement, ctx: CgExtContext): ModuleInstance {
      const { calc } = wireCalc(ctx.grid);

      let columns: CalculatedColumnDef[] = [];
      let selectedId: string | null = null;
      let draft: CalculatedColumnDef | null = null;
      let draftIsNew = false;
      let editor: ExpressionEditor | null = null;
      let fmtMenu: { toggle(): void; destroy(): void } | null = null;

      const root = el('div', 'ckp');
      const rail = el('div', 'ckp-rail');
      const pane = el('div', 'ckp-pane');
      root.append(rail, pane);
      host.appendChild(root);

      const load = (): void => {
        try { columns = calc.listCalculatedColumns(); } catch { columns = []; }
        columns.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      };

      const isDirty = (): boolean => {
        if (!draft) return false;
        if (draftIsNew) return true;
        return JSON.stringify(columns.find((c) => c.colId === selectedId)) !== JSON.stringify(draft);
      };

      const selectColumn = (colId: string | null, asNew = false, seed?: CalculatedColumnDef): void => {
        editor?.destroy(); editor = null;
        fmtMenu?.destroy(); fmtMenu = null;
        selectedId = colId;
        draftIsNew = asNew;
        draft = seed
          ? clone(seed)
          : colId
            ? clone(columns.find((c) => c.colId === colId) ?? newColumn(columns.length))
            : null;
        renderAll();
      };

      const errBox = el('div', 'ckp-error');

      const save = (): void => {
        if (!draft) return;
        const compiled = compileCalc(draft.expression, schemaFromGrid(ctx.grid));
        if (!compiled.ok) {
          errBox.style.display = '';
          errBox.textContent = compiled.error.message;
          return;
        }
        const backup = !draftIsNew ? columns.find((c) => c.colId === selectedId) : undefined;
        if (backup) calc.removeCalculatedColumn(backup.colId);
        const result = calc.registerCalculatedColumn(clone(draft));
        if (!result.ok) {
          if (backup) calc.registerCalculatedColumn(backup);
          errBox.style.display = '';
          errBox.textContent = result.errors.map((e) => e.message).join('\n');
          return;
        }
        errBox.style.display = 'none';
        ctx.profiles.markDirty();
        load();
        draftIsNew = false;
        selectColumn(draft.colId);
      };

      const renderRail = (): void => {
        rail.replaceChildren();
        const head = el('div', 'ckp-rail-head');
        const add = el('button', 'ckp-addbtn', '+');
        add.type = 'button';
        add.title = 'Add calculated column';
        add.addEventListener('click', () => {
          const def = newColumn(columns.length);
          selectColumn(def.colId, true, def);
        });
        head.append(caps('Columns'), el('span', 'ckp-caps ckp-count', String(columns.length).padStart(2, '0')), add);
        rail.appendChild(head);

        for (const def of columns) {
          const rowEl = el('div', `ckp-rail-row${def.colId === selectedId ? ' active' : ''}`);
          const name = el('span', 'ckp-rail-name', def.headerName || def.colId);
          const del = el('button', 'ckp-mini');
          del.type = 'button';
          del.title = 'Delete';
          del.innerHTML = lucideSvg('trash-2', 12) || '🗑';
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            calc.removeCalculatedColumn(def.colId);
            ctx.profiles.markDirty();
            load();
            if (selectedId === def.colId) selectColumn(columns[0]?.colId ?? null);
            else renderAll();
          });
          rowEl.append(name, del);
          rowEl.addEventListener('click', () => selectColumn(def.colId));
          rail.appendChild(rowEl);
        }
      };

      const renderPane = (): void => {
        // Destroy the previous CM view + body-mounted format menu before
        // replacing the DOM — leaked instances pollute document.body.
        editor?.destroy();
        editor = null;
        fmtMenu?.destroy();
        fmtMenu = null;
        pane.replaceChildren();
        errBox.style.display = 'none';
        if (!draft) {
          pane.appendChild(el('div', 'ckp-empty', 'Select a calculated column, or add one with +'));
          return;
        }
        const d = draft;

        // Title row.
        const head = el('div', 'ckp-pane-head');
        const nameIn = textInput(d.headerName, (v) => { d.headerName = v; syncDirty(); }, { className: 'ckp-title', placeholder: 'Header name' });
        const resetBtn = el('button', 'ckp-actbtn');
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.addEventListener('click', () => selectColumn(draftIsNew ? (columns[0]?.colId ?? null) : selectedId));
        const saveBtn = el('button', 'ckp-actbtn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.addEventListener('click', save);
        head.append(nameIn, resetBtn, saveBtn);
        pane.appendChild(head);

        // Summary chips: COLUMN ID / REFS / FORMATTER / WIDTH.
        const chipsStrip = el('div', 'ckp-chips-strip');
        const idChip = chip('Column id', d.colId, 'warning');
        const refsChip = chip('Refs', `${countRefs(d.expression)} COLS`, 'info');
        const fmtChip = chip('Formatter', d.format ? 'SET' : '—');
        const widthChip = chip('Width', d.initialWidth ? `${d.initialWidth}PX` : 'AUTO');
        chipsStrip.append(idChip.root, refsChip.root, fmtChip.root, widthChip.root);
        pane.appendChild(chipsStrip);

        const syncDirty = (): void => {
          saveBtn.disabled = !isDirty();
          refsChip.set(`${countRefs(d.expression)} COLS`, 'info');
          fmtChip.set(d.format ? 'SET' : '—');
          widthChip.set(d.initialWidth ? `${d.initialWidth}PX` : 'AUTO');
        };
        syncDirty();

        // COLUMN ID row.
        const idIn = textInput(d.colId, (v) => { d.colId = v.trim(); idChip.set(d.colId, 'warning'); syncDirty(); }, { mono: true });
        pane.appendChild(row('Column id', idIn, 'Unique — must not collide with data fields'));

        // 01 EXPRESSION.
        const expr = band('01', 'Expression');
        const editorHost = el('div', 'ckp-editor');
        editor = new ExpressionEditor(editorHost, {
          value: d.expression,
          multiline: true,
          lines: 3,
          placeholder: '[price] * [quantity]',
          columnsProvider: () => editorColumns(ctx.grid),
          functionsProvider: calcFunctions,
          validate: (text) => {
            if (!text.trim()) return [];
            const compiled = compileCalc(text, schemaFromGrid(ctx.grid));
            if (compiled.ok) return [];
            const loc = (compiled.error as { loc?: { start: number; end: number } | null }).loc;
            return [{ message: compiled.error.message, from: loc?.start ?? 0, to: loc?.end ?? text.length }];
          },
          onChange: (v) => { d.expression = v; syncDirty(); },
        });
        expr.body.append(editorHost, el('div', 'ckp-hint', "Type [ for columns · aggregates take a scope: SUM([price], 'group') · PREV([col]) for prior tick"));
        pane.appendChild(expr.root);

        // 02 VALUE FORMATTER.
        const fmt = band('02', 'Value formatter');
        const fmtBtn = el('button', 'ckp-fmtbtn');
        fmtBtn.type = 'button';
        const syncFmtBtn = (): void => {
          fmtBtn.innerHTML = `${lucideSvg('hash', 12)}<span>${d.format ? previewFormat(d.format, 1234.5) : 'Format'}</span><span>⌄</span>`;
          fmtBtn.title = d.format ?? 'No format';
        };
        syncFmtBtn();
        fmtMenu = formatPickerMenu(fmtBtn, {
          targetCols: () => [d.colId],
          currentFormat: () => d.format,
          applyFormat: (format) => { d.format = format; syncFmtBtn(); syncDirty(); },
          clearFormat: () => { d.format = undefined; syncFmtBtn(); syncDirty(); },
          dataType: () => toFormatDataType(d.cellDataType),
        });
        fmtBtn.addEventListener('click', () => fmtMenu?.toggle());
        fmt.body.appendChild(fmtBtn);
        pane.appendChild(fmt.root);

        // 03 PLACEMENT.
        const place = band('03', 'Placement');
        place.body.appendChild(row('Data type', select(
          (['number', 'currency', 'percent', 'date', 'datetime', 'string', 'boolean'] as CellDataType[])
            .map((t): [string, string] => [t, t.toUpperCase()]),
          d.cellDataType ?? 'number',
          (v) => { d.cellDataType = v as CellDataType; syncDirty(); },
        )));
        place.body.appendChild(row('Width', numberInput(d.initialWidth, (v) => { d.initialWidth = v; syncDirty(); }, { placeholder: 'auto', suffix: 'PX' })));
        place.body.appendChild(row('Pinned', pillGroup(
          [['', 'None'], ['left', 'Left'], ['right', 'Right']],
          d.initialPinned ?? '',
          (v) => { d.initialPinned = (v || undefined) as CalculatedColumnDef['initialPinned']; syncDirty(); },
        )));
        place.body.appendChild(row('Position', numberInput(d.position, (v) => { d.position = v; syncDirty(); }), 'Insertion order among calculated columns'));
        pane.appendChild(place.root);

        pane.appendChild(errBox);
      };

      const renderAll = (): void => {
        renderRail();
        renderPane();
      };

      load();
      selectColumn(columns[0]?.colId ?? null);

      return {
        destroy() {
          editor?.destroy();
          fmtMenu?.destroy();
          host.replaceChildren();
        },
        refresh() {
          load();
          renderAll();
        },
      };
    },
  };
}
