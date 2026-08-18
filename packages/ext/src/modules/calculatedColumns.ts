/**
 * Calculated Columns — settings-sheet editor in the starui customizer
 * cockpit layout: columns rail, summary-chip strip (column id / refs /
 * formatter / width), column-id row, numbered bands (expression → value
 * formatter → placement), CodeMirror 6 editor with live compile
 * validation and the shared Format picker.
 *
 * CSRM mutations ride the idempotent @wellsfargo-starui/velocity-grid-calc
 * engine. SSRM + StompPerspectiveProvider uses Perspective ExprTK via
 * `grid.getSsrmExpressionHost()` (ViewConfig.expressions) instead of Stage A.
 */
import {
  wireIntoKernel as wireCalc,
  compileCalc,
  listAggregates,
  type CalculatedColumnDef,
  type CellDataType,
} from '@wellsfargo-starui/velocity-grid-calc';
import type { SsrmExpressionHost, CColDef } from '@wellsfargo-starui/velocity-grid';
import { PerspectiveDataProviderController } from '@wellsfargo-starui/velocity-grid-perspective';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import {
  ExpressionEditor,
  EXPRESSION_BUILTINS,
  PERSPECTIVE_EXPRTK_BUILTINS,
  countPerspectiveColumnRefs,
  type ExpressionFunction,
} from '../ui/expressionEditor';
import { editorColumns, schemaFromGrid } from '../ui/gridSchema';
import {
  band,
  caps,
  chip,
  el,
  injectCockpitStyles,
  lucideSvg,
  numberInput,
  pillGroup,
  row,
  select,
  textInput,
  appendPaneChrome,
  takePaneScroll,
  restorePaneScroll,
  emptyState,
  workflowLink,
  workflowStrip,
} from '../ui/cockpit';
import { formatPickerMenu, formatPickerFitContainer, previewFormat } from '../toolbar/formatPicker';
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

/**
 * Ensure a Perspective ExprTK alias is a real grid column.
 * `editColumn` only patches existing defs — expression outputs are new
 * fields, so we merge into `columnDefs` like the SSRM demo's addPerspectiveCalc.
 */
function ensureExprColumnDef(
  grid: VelocityGridExtContext['grid'],
  def: CalculatedColumnDef,
): void {
  const alias = def.colId;
  // D-F7 — was: cast the grid, read the PRIVATE `columnDefsMap`, shallow-copy
  // its values, filter by colId/field, append, `updateGridOptions`. That is
  // exactly `upsertColumnDefs`' contract (identity `colId ?? field`, matches
  // dropped, incoming appended), so the whole hand-rolled path collapses into
  // the kernel's public API with identical resulting def order.
  grid.upsertColumnDefs([{
    colId: alias,
    field: alias,
    headerName: def.headerName || alias,
    // Calc's `CellDataType` union ('currency' | 'percent' | 'date' |
    // 'datetime' | 'string' | 'boolean' | 'number') is WIDER than the
    // kernel's declared `CColDef['cellDataType']` ('text' | 'number'). The
    // kernel only ever COMPARES this field (`resolveColDef`:
    // `cellDataType === 'number'` → right-align, otherwise it rides through
    // untouched), so calc's wider vocabulary has always been shipped on this
    // def — the old `unknown[]` cast just hid it. Narrowing it here would
    // change the stored def, so keep the author's exact value and record the
    // widening in this one spot.
    cellDataType: (def.cellDataType ?? 'number') as CColDef['cellDataType'],
    ...(def.initialWidth != null ? { width: def.initialWidth } : { width: 120 }),
    ...(def.format ? { format: def.format } : {}),
    ...(def.cellDataType === 'number' || def.cellDataType == null
      ? { aggFunc: 'sum', enableValue: true }
      : {}),
  }]);
}

function removeExprColumnDef(
  grid: VelocityGridExtContext['grid'],
  colId: string,
): void {
  // D-F7 — same story as `ensureExprColumnDef`, minus an append. There is no
  // `removeColumnDefs`; the public snapshot + `updateGridOptions` pair (the
  // only entry point that rebuilds the column tree) covers it directly.
  const next = grid.getColumnDefsSnapshot()
    .filter((d) => d.colId !== colId && d.field !== colId);
  grid.updateGridOptions({ columnDefs: next });
}

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

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      // D-F8 — this module is the LAZY WIRER for calc: it wires on mount (the
      // bridge is idempotent and returns the same `{ calc }` for an already
      // wired grid) and records the engine into the context slots, so every
      // other module — Column Settings' caption path especially — sees the
      // same engine instead of re-deriving it from the grid expando.
      const calc = ctx.engines.get('calc') ?? (() => {
        const engine = wireCalc(ctx.grid).calc;
        ctx.engines.register('calc', engine);
        return engine;
      })();
      const exprHost = (): SsrmExpressionHost | null => {
        const g = ctx.grid as unknown as {
          getSsrmExpressionHost?: () => SsrmExpressionHost | null;
        };
        return g.getSsrmExpressionHost?.() ?? null;
      };
      const isPerspectiveSsrm = (): boolean => exprHost() != null;

      /** Local metadata for Perspective expression columns (header / format). */
      let pspMeta: Record<string, Omit<CalculatedColumnDef, 'expression'>> = {};

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

      const hydrateMetaFromController = (): void => {
        const ctrl = PerspectiveDataProviderController.forGrid(ctx.grid);
        if (!ctrl) return;
        for (const [colId, m] of Object.entries(ctrl.getExpressionMeta())) {
          if (pspMeta[colId]) continue;
          pspMeta[colId] = {
            colId,
            headerName: m.headerName ?? colId,
            cellDataType: (m.cellDataType as CellDataType | undefined) ?? 'number',
            initialWidth: m.width,
            format: m.format,
          };
        }
      };

      const rememberWithController = (exprs: Record<string, string>): void => {
        const ctrl = PerspectiveDataProviderController.forGrid(ctx.grid);
        if (!ctrl) return;
        const meta: Record<string, {
          headerName?: string;
          cellDataType?: 'text' | 'number' | 'boolean' | 'date';
          width?: number;
          format?: string;
        }> = {};
        for (const [colId, m] of Object.entries(pspMeta)) {
          const dt = m.cellDataType;
          meta[colId] = {
            headerName: m.headerName,
            cellDataType:
              dt === 'boolean' || dt === 'date'
                ? dt
                : dt === 'string'
                  ? 'text'
                  : 'number',
            width: m.initialWidth,
            format: m.format,
          };
        }
        ctrl.rememberExpressions(exprs, meta);
      };

      const load = (): void => {
        const hostApi = exprHost();
        if (hostApi) {
          hydrateMetaFromController();
          const exprs = hostApi.getExpressions();
          columns = Object.entries(exprs).map(([colId, expression], i) => {
            const meta = pspMeta[colId];
            return {
              colId,
              expression,
              headerName: meta?.headerName ?? colId,
              cellDataType: meta?.cellDataType ?? 'number',
              position: meta?.position ?? i,
              initialWidth: meta?.initialWidth,
              initialPinned: meta?.initialPinned,
              format: meta?.format,
            } satisfies CalculatedColumnDef;
          });
          columns.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
          // Keep paint/rules columns in sync (e.g. after profile restore).
          for (const def of columns) ensureExprColumnDef(ctx.grid, def);
          return;
        }
        try { columns = calc.listCalculatedColumns(); } catch { columns = []; }
        columns.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      };

      const isDirty = (): boolean => {
        if (!draft) return false;
        if (draftIsNew) return true;
        return JSON.stringify(columns.find((c) => c.colId === selectedId)) !== JSON.stringify(draft);
      };

      const selectColumn = (
        colId: string | null,
        asNew = false,
        seed?: CalculatedColumnDef,
        force = false,
      ): void => {
        if (!force && draft && isDirty() && !(asNew && seed) && colId !== selectedId) {
          const ok = window.confirm('Discard unsaved column changes?');
          if (!ok) return;
        }
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
        const hostApi = exprHost();
        if (hostApi) {
          void (async () => {
            const next: Record<string, string> = { ...hostApi.getExpressions() };
            if (selectedId && selectedId !== draft!.colId) delete next[selectedId];
            const alias = draft!.colId.trim();
            if (!alias) {
              errBox.style.display = '';
              errBox.textContent = 'Column id is required';
              return;
            }
            const raw = draft!.expression.trim();
            if (!raw) {
              errBox.style.display = '';
              errBox.textContent = 'Expression is required';
              return;
            }
            const source = raw.includes('//') ? raw : `// ${alias}\n${raw}`;
            next[alias] = source;
            try {
              const validated = await hostApi.validateExpressions({ [alias]: source });
              const err = validated.errors?.[alias];
              if (err) {
                errBox.style.display = '';
                errBox.textContent = String(err);
                return;
              }
            } catch (e) {
              errBox.style.display = '';
              errBox.textContent = e instanceof Error ? e.message : String(e);
              return;
            }
            await hostApi.setExpressions(next);
            if (selectedId && selectedId !== alias) delete pspMeta[selectedId];
            pspMeta[alias] = {
              colId: alias,
              headerName: draft!.headerName,
              cellDataType: draft!.cellDataType,
              position: draft!.position,
              initialWidth: draft!.initialWidth,
              initialPinned: draft!.initialPinned,
              format: draft!.format,
            };
            ensureExprColumnDef(ctx.grid, { ...draft!, expression: source });
            rememberWithController(next);
            errBox.style.display = 'none';
            ctx.profiles.markDirty();
            load();
            draftIsNew = false;
            selectColumn(alias);
          })();
          return;
        }

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
            const hostApi = exprHost();
            if (hostApi) {
              const next = { ...hostApi.getExpressions() };
              delete next[def.colId];
              delete pspMeta[def.colId];
              void hostApi.setExpressions(next).then(() => {
                removeExprColumnDef(ctx.grid, def.colId);
                rememberWithController(next);
                ctx.profiles.markDirty();
                load();
                if (selectedId === def.colId) selectColumn(columns[0]?.colId ?? null);
                else renderAll();
              });
              return;
            }
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
        const scrollTop = takePaneScroll(pane);
        editor?.destroy();
        editor = null;
        fmtMenu?.destroy();
        fmtMenu = null;
        pane.replaceChildren();
        errBox.style.display = 'none';
        if (!draft) {
          pane.appendChild(emptyState({
            title: 'No column selected',
            description: 'Select a calculated column, or add one with +.',
            icon: 'square-sigma',
          }));
          return;
        }
        const d = draft;
        const psp = isPerspectiveSsrm();

        const head = el('div', 'ckp-pane-head');
        const nameIn = textInput(d.headerName, (v) => { d.headerName = v; syncDirty(); }, { className: 'ckp-title', placeholder: 'Header name' });
        const saveBtn = el('button', 'ckp-actbtn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.addEventListener('click', save);
        const resetBtn = el('button', 'ckp-actbtn ckp-btn-secondary');
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.addEventListener('click', () => {
          selectColumn(draftIsNew ? (columns[0]?.colId ?? null) : selectedId, false, undefined, true);
        });
        head.append(nameIn, saveBtn, resetBtn);
        const body = appendPaneChrome(pane, head);

        body.appendChild(workflowStrip([
          workflowLink({
            label: 'Column format settings',
            hint: 'Width, filter, and display options',
            icon: 'columns-3',
            moduleId: 'column-settings',
            events: ctx.events,
            lucideSvg,
          }),
        ]));

        const chipsStrip = el('div', 'ckp-chips-strip');
        const idChip = chip('Column id', d.colId, 'warning');
        const refCount = psp ? countPerspectiveColumnRefs(d.expression) : countRefs(d.expression);
        const refsChip = chip('Refs', `${refCount} COLS`, 'info');
        const fmtChip = chip('Formatter', d.format ? 'SET' : '—');
        const widthChip = chip('Width', d.initialWidth ? `${d.initialWidth}PX` : 'AUTO');
        chipsStrip.append(idChip.root, refsChip.root, fmtChip.root, widthChip.root);
        body.appendChild(chipsStrip);

        const syncDirty = (): void => {
          const dirty = isDirty();
          saveBtn.disabled = !dirty && !draftIsNew;
          resetBtn.disabled = !dirty && !draftIsNew;
          const n = psp ? countPerspectiveColumnRefs(d.expression) : countRefs(d.expression);
          refsChip.set(`${n} COLS`, 'info');
          fmtChip.set(d.format ? 'SET' : '—');
          widthChip.set(d.initialWidth ? `${d.initialWidth}PX` : 'AUTO');
        };
        syncDirty();

        const idIn = textInput(d.colId, (v) => { d.colId = v.trim(); idChip.set(d.colId, 'warning'); syncDirty(); }, { mono: true });
        body.appendChild(row('Column id', idIn, psp
          ? 'Perspective expression alias — must not collide with table fields'
          : 'Unique — must not collide with data fields'));

        const expr = band('Expression');
        const editorHost = el('div', 'ckp-editor');
        editor = new ExpressionEditor(editorHost, {
          value: d.expression,
          multiline: true,
          lines: 3,
          dialect: psp ? 'perspective' : 'cgrid',
          placeholder: psp ? '// MyCalc\n"pnl" + "dailyPnl"' : '[price] * [quantity]',
          columnsProvider: () => editorColumns(ctx.grid),
          functionsProvider: psp ? () => PERSPECTIVE_EXPRTK_BUILTINS : calcFunctions,
          validate: (text) => {
            if (!text.trim() || psp) return [];
            const compiled = compileCalc(text, schemaFromGrid(ctx.grid));
            if (compiled.ok) return [];
            const loc = (compiled.error as { loc?: { start: number; end: number } | null }).loc;
            return [{ message: compiled.error.message, from: loc?.start ?? 0, to: loc?.end ?? text.length }];
          },
          onChange: (v) => { d.expression = v; syncDirty(); },
          onCommit: () => { if (isDirty()) save(); },
        });
        expr.body.append(
          editorHost,
          el(
            'div',
            'ckp-hint',
            psp
              ? 'Perspective ExprTK — type " for columns · // Alias on first line · ⌘↵ to save'
              : "Type [ for columns · ⌘↵ to save · aggregates take a scope: SUM([price], 'group') · PREV([col]) for prior tick",
          ),
        );
        body.appendChild(expr.root);

        const fmt = band('Value formatter');
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
        }, {
          fitTo: () => formatPickerFitContainer(fmtBtn),
        });
        fmtBtn.addEventListener('click', () => fmtMenu?.toggle());
        fmt.body.appendChild(fmtBtn);
        body.appendChild(fmt.root);

        const place = band('Placement');
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
        body.appendChild(place.root);

        body.appendChild(errBox);

        restorePaneScroll(pane, scrollTop);
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
        commit() { if (isDirty()) save(); },
        refresh() {
          load();
          renderAll();
        },
      };
    },
  };
}
