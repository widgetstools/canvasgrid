/**
 * Conditional Styling — settings-sheet rules editor in the starui
 * customizer cockpit layout: rules rail, summary-chip meta strip with
 * status switch, numbered bands (expression → target columns → type →
 * colour → border → flash/style-window → indicator icon grid → value
 * formatter), CodeMirror 6 expression editor with live validation.
 *
 * Mutations ride the kernel rule API (`addRule` / `updateRule` /
 * `deleteRule` / `setRuleEnabled`); the @wellsfargo-starui/velocity-grid-rules bridge persists the
 * set in the grid config (layout-tier 'rules' state module) and repaints.
 */
import {
  validateRule,
  wireIntoKernel as wireRules,
  type RuleEngine,
  type ConditionalStyleRule,
  type RuleBorderSpec,
  type RuleIndicatorPlacement,
  type StyleSlice,
} from '@wellsfargo-starui/velocity-grid-rules';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import { mountFormatterStyleChrome } from '../toolbar/styleChrome';
import { ExpressionEditor } from '../ui/expressionEditor';
import { editorColumns, leafColumns, schemaFromGrid } from '../ui/gridSchema';
import {
  appendPaneChrome, band, caps, chip, colorField, el, iconTile, injectCockpitStyles, lucideSvg,
  numberInput, pillGroup, restorePaneScroll, row, select, checkbox, takePaneScroll, textInput,
  emptyState,
} from '../ui/cockpit';
import { formatPickerMenu, formatPickerFitContainer, previewFormat } from '../toolbar/formatPicker';
import type { FormatDataType } from '../toolbar/formatPresets';
import { lucideBundle } from '@wellsfargo-starui/velocity-grid/icons/lucide.generated';

/** Same placement slots as the Formatting toolbar icon picker (Prefix/Suffix + corners/middles). */
const INDICATOR_PLACE_GROUPS: Array<[string, Array<[RuleIndicatorPlacement, string]>]> = [
  ['Inline', [['before', 'Prefix'], ['after', 'Suffix']]],
  ['Positional', [
    ['tl', 'Top-left'], ['tr', 'Top-right'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'],
    ['ml', 'Middle-left'], ['mr', 'Middle-right'],
  ]],
];
interface RulesGrid {
  getRules(): ConditionalStyleRule[];
  addRule(rule: ConditionalStyleRule): void;
  updateRule(id: string, patch: Partial<ConditionalStyleRule>): void;
  deleteRule(id: string): void;
  setRuleEnabled(id: string, enabled: boolean): void;
  forEachNode?(cb: (node: { id: string; data: unknown }) => void): void;
}
const asRulesGrid = (grid: unknown): RulesGrid => grid as RulesGrid;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function newRule(priority: number): ConditionalStyleRule {
  return {
    id: `rule_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: 'new_rule',
    kind: 'style',
    enabled: true,
    priority,
    scope: { kind: 'row' },
    condition: 'true',
    style: { base: {} },
  };
}

/** Indicator icon catalog — curated Lucide groups (screenshot parity);
 *  names missing from the kernel bundle are dropped at runtime. */
const ICON_GROUPS: Array<[label: string, icons: string[]]> = [
  ['Direction', ['arrow-up', 'arrow-down', 'trending-up', 'trending-down', 'chevrons-up', 'chevrons-down', 'triangle', 'move-up', 'move-down', 'arrow-up-right', 'arrow-down-right', 'corner-right-down']],
  ['Alert', ['triangle-alert', 'circle-alert', 'octagon-alert', 'zap', 'flame', 'bell', 'bell-ring', 'siren', 'cloud-lightning', 'radiation', 'skull', 'bug']],
  ['Status', ['circle-dot', 'circle', 'flag', 'flag-off', 'pin', 'pin-off', 'bookmark', 'bookmark-check']],
  ['Lifecycle', ['circle-check', 'circle-x', 'clock', 'lock']],
  ['Favorite', ['star', 'star-off', 'eye', 'heart', 'target', 'circle-dashed', 'sparkles', 'plus']],
  ['Classification', ['tag', 'badge-check']],
];

export function conditionalStylingModule(): SettingsModule {
  return {
    id: 'conditional-styling',
    kind: 'settings-module',
    title: 'Styling Rules',
    icon: 'palette',
    category: 'format',

    init(): void {
      injectCockpitStyles();
    },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      const grid = asRulesGrid(ctx.grid);
      const schema = () => schemaFromGrid(ctx.grid);

      let rules: ConditionalStyleRule[] = [];
      let selectedId: string | null = null;
      let draft: ConditionalStyleRule | null = null;
      let draftIsNew = false;
      let editor: ExpressionEditor | null = null;
      let fmtMenu: { toggle(): void; destroy(): void } | null = null;
      let styleChromeDispose: (() => void) | null = null;

      const root = el('div', 'ckp');
      const rail = el('div', 'ckp-rail');
      const pane = el('div', 'ckp-pane');
      root.append(rail, pane);
      host.appendChild(root);

      const loadRules = (): void => {
        try {
          rules = (grid.getRules() ?? []).filter(
            (r): r is ConditionalStyleRule => (r as { kind?: string }).kind === 'style',
          );
        } catch { rules = []; }
      };

      const isDirty = (): boolean => {
        if (!draft) return false;
        if (draftIsNew) return true;
        return JSON.stringify(rules.find((r) => r.id === draft!.id)) !== JSON.stringify(draft);
      };

      /**
       * D-F8 — lazy wirer for `rules`: wires on demand (the bridge is
       * idempotent) and RECORDS both engines in the context slots so no other
       * module has to re-derive them from a grid expando. `null` when the
       * bridge is unavailable; callers must surface that, not hide it.
       */
      const rulesEngine = (): RuleEngine | null => {
        const already = ctx.engines.get('rules');
        if (already) return already;
        try {
          const wired = wireRules(ctx.grid);
          ctx.engines.register('rules', wired.rules);
          ctx.engines.register('alerts', wired.alerts);
          return wired.rules;
        } catch (err) {
          console.warn('[velocity-grid-ext] Styling Rules: wiring @wellsfargo-starui/velocity-grid-rules failed', err);
          return null;
        }
      };

      /** APPLIED n ROWS — evaluate the committed rule over the row cache
       *  via the wired engine; '—' when unavailable. */
      const appliedCount = (rule: ConditionalStyleRule): string => {
        try {
          const engine = rulesEngine();
          if (!engine) return '—';
          if (!grid.forEachNode) return '—';
          const colId = rule.scope.kind === 'cell' ? rule.scope.columnIds[0] ?? '' : '';
          let n = 0;
          let seen = 0;
          grid.forEachNode((node) => {
            if (seen++ > 5000) return;
            try {
              const res = (engine as unknown as {
                evaluateCell(args: { row: unknown; rowId: string; colId: string; theme: 'light' | 'dark' }): { matched?: unknown } | null;
              }).evaluateCell({ row: node.data, rowId: node.id, colId, theme: 'dark' });
              const matched = res?.matched;
              if (Array.isArray(matched) ? matched.includes(rule.id) : matched === true) n++;
            } catch { /* row skipped */ }
          });
          return `${n} ROWS`;
        } catch { return '—'; }
      };

      const selectRule = (
        id: string | null,
        asNew = false,
        seed?: ConditionalStyleRule,
        force = false,
      ): void => {
        if (!force && draft && isDirty() && !(asNew && seed) && id !== selectedId) {
          const ok = window.confirm('Discard unsaved rule changes?');
          if (!ok) return;
        }
        editor?.destroy(); editor = null;
        fmtMenu?.destroy(); fmtMenu = null;
        selectedId = id;
        draftIsNew = asNew;
        draft = seed ? clone(seed) : id ? clone(rules.find((r) => r.id === id) ?? newRule(rules.length)) : null;
        renderAll();
      };

      const save = (): void => {
        if (!draft) return;
        if (draftIsNew) grid.addRule(clone(draft));
        else grid.updateRule(draft.id, clone(draft));
        ctx.profiles.markDirty();
        loadRules();
        draftIsNew = false;
        selectRule(draft.id);
      };

      const renderRail = (): void => {
        rail.replaceChildren();
        const head = el('div', 'ckp-rail-head');
        const title = caps('Rules');
        const count = el('span', 'ckp-caps ckp-count', String(rules.length).padStart(2, '0'));
        const add = el('button', 'ckp-addbtn', '+');
        add.type = 'button';
        add.title = 'Add rule';
        add.addEventListener('click', () => {
          const rule = newRule(rules.length);
          selectRule(rule.id, true, rule);
        });
        head.append(title, count, add);
        rail.appendChild(head);

        for (const rule of rules) {
          const rowEl = el('div', `ckp-rail-row${rule.id === selectedId ? ' active' : ''}${rule.enabled ? '' : ' muted'}`);
          const name = el('span', 'ckp-rail-name', rule.name);
          const cloneBtn = el('button', 'ckp-mini');
          cloneBtn.type = 'button';
          cloneBtn.title = 'Clone';
          cloneBtn.innerHTML = lucideSvg('copy', 12) || '⧉';
          cloneBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const copy = clone(rule);
            copy.id = newRule(0).id;
            copy.name = `${rule.name}_copy`;
            copy.enabled = false;
            copy.priority = rule.priority + 1;
            selectRule(copy.id, true, copy);
          });
          const del = el('button', 'ckp-mini');
          del.type = 'button';
          del.title = 'Delete';
          del.innerHTML = lucideSvg('trash-2', 12) || '🗑';
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            grid.deleteRule(rule.id);
            ctx.profiles.markDirty();
            loadRules();
            if (selectedId === rule.id) selectRule(rules[0]?.id ?? null);
            else renderAll();
          });
          rowEl.append(name, cloneBtn, del);
          rowEl.addEventListener('click', () => selectRule(rule.id));
          rail.appendChild(rowEl);
        }
      };

      const renderPane = (): void => {
        const scrollTop = takePaneScroll(pane);
        // Re-renders replace the pane DOM — the previous CM view and the
        // body-mounted format menu must go with it or their tooltip/menu
        // containers leak onto document.body (page-level scrollbars).
        editor?.destroy();
        editor = null;
        fmtMenu?.destroy();
        fmtMenu = null;
        styleChromeDispose?.();
        styleChromeDispose = null;
        pane.replaceChildren();
        if (!draft) {
          pane.appendChild(emptyState({
            title: 'No rule selected',
            description: 'Select a rule, or add one with +.',
            icon: 'palette',
          }));
          return;
        }
        const d = draft;

        // Sticky title row: name + status/scope/priority + RESET/SAVE.
        const head = el('div', 'ckp-pane-head');
        const nameIn = textInput(d.name, (v) => { d.name = v; syncDirty(); }, { className: 'ckp-title' });
        const appliedChip = chip('Applied', draftIsNew ? '—' : appliedCount(d), 'neutral');
        const statusBox = checkbox(d.enabled, (v) => {
          d.enabled = v;
          syncDirty();
        });
        statusBox.title = 'Status';
        const scopeSel = select([['cell', 'Cell'], ['row', 'Row']], d.scope.kind, (v) => {
          d.scope = v === 'cell' ? { kind: 'cell', columnIds: [] } : { kind: 'row' };
          renderPane();
        });
        scopeSel.title = 'Scope';
        const prioIn = numberInput(d.priority, (v) => {
          d.priority = v ?? 0;
          syncDirty();
        });
        prioIn.title = 'Priority';
        const saveBtn = el('button', 'ckp-actbtn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `${lucideSvg('save', 12)}<span>Save</span>`;
        saveBtn.addEventListener('click', save);
        const resetBtn = el('button', 'ckp-actbtn ckp-btn-secondary');
        resetBtn.type = 'button';
        resetBtn.innerHTML = `${lucideSvg('rotate-ccw', 12)}<span>Reset</span>`;
        resetBtn.addEventListener('click', () => {
          selectRule(draftIsNew ? (rules[0]?.id ?? null) : d.id, false, undefined, true);
        });
        head.append(nameIn, statusBox, scopeSel, prioIn, saveBtn, resetBtn);
        const body = appendPaneChrome(pane, head);

        // Applied is display-only (no twin control). Status / Scope / Priority
        // live once in the header — chips must not duplicate those controls.
        const chipsStrip = el('div', 'ckp-chips-strip');
        chipsStrip.append(appliedChip.root);
        body.appendChild(chipsStrip);

        const syncDirty = (): void => {
          const dirty = isDirty();
          saveBtn.disabled = !dirty && !draftIsNew;
          resetBtn.disabled = !dirty && !draftIsNew;
        };
        syncDirty();

        // 01 EXPRESSION.
        const expr = band('Expression');
        const editorHost = el('div', 'ckp-editor');
        const errBox = el('div', 'ckp-error');
        errBox.style.display = 'none';
        const runValidate = (text: string) => {
          const probe = { ...clone(d), condition: text };
          let errors: Array<{ message: string; loc: { start: number; end: number } | null }> = [];
          try { errors = validateRule(probe, schema()); } catch { errors = []; }
          errBox.style.display = errors.length ? '' : 'none';
          errBox.textContent = errors[0]?.message ?? '';
          return errors.map((e) => ({
            message: e.message,
            from: e.loc?.start ?? 0,
            to: e.loc?.end ?? text.length,
          }));
        };
        editor = new ExpressionEditor(editorHost, {
          value: d.condition,
          multiline: true,
          lines: 3,
          placeholder: '[price] > 110',
          columnsProvider: () => editorColumns(ctx.grid),
          validate: runValidate,
          onChange: (v) => { d.condition = v; syncDirty(); },
          onCommit: () => { if (isDirty()) save(); },
        });
        expr.body.append(editorHost, errBox, el('div', 'ckp-hint', 'Type [ for columns · ⌘↵ to save · [col.old] / [col.new] compare against the previous tick'));
        body.appendChild(expr.root);

        // 02 TARGET COLUMNS (cell scope).
        if (d.scope.kind === 'cell') {
          const scope = d.scope;
          const tgt = band('Target columns');
          const chips = el('div', 'ckp-colchips');
          const renderChips = (): void => {
            chips.replaceChildren();
            for (const colId of scope.columnIds) {
              const c = el('span', 'ckp-colchip', colId);
              const x = el('button', 'ckp-mini', '×');
              x.type = 'button';
              x.addEventListener('click', () => {
                scope.columnIds = scope.columnIds.filter((id) => id !== colId);
                renderChips();
                syncDirty();
              });
              c.appendChild(x);
              chips.appendChild(c);
            }
            if (scope.columnIds.length === 0) chips.appendChild(el('span', 'ckp-warn', 'No columns · rule won’t apply'));
          };
          renderChips();
          const remaining = () => leafColumns(ctx.grid)
            .map((c) => (c.colId ?? c.field)!)
            .filter((id) => !scope.columnIds.includes(id));
          const picker = select([['', 'ADD COLUMN…']], '', () => {});
          const refreshPicker = (): void => {
            picker.replaceChildren();
            const opts: Array<[string, string]> = [
              ['', 'ADD COLUMN…'],
              ...remaining().map((id): [string, string] => [id, id]),
            ];
            for (const [v, label] of opts) {
              const o = document.createElement('option');
              o.value = v;
              o.textContent = label;
              picker.appendChild(o);
            }
            picker.value = '';
          };
          refreshPicker();
          picker.style.width = '100%';
          picker.addEventListener('change', () => {
            if (!picker.value) return;
            scope.columnIds.push(picker.value);
            renderChips();
            refreshPicker();
            syncDirty();
          });
          tgt.body.append(chips, picker);
          body.appendChild(tgt.root);
        }

        // 03 STYLE — the formatter toolbar's Font/Borders chrome (same
        // component as the ribbon), adapted onto the rule's StyleSlice.
        // Controls the rules model cannot express (font size, alignment,
        // per-side borders, border width) are hidden via scoped CSS
        // rather than left as dead buttons.
        const slice = (d.style.base ??= {});
        const styleBand = band('Style');
        const chromeHost = el('div', 'ckp-stylechrome');
        styleChromeDispose = mountFormatterStyleChrome(chromeHost, {
          getStyle: () => ({
            fontWeight: slice.fontWeight,
            fontStyle: slice.fontStyle,
            textDecoration: slice.textDecoration,
            fg: slice.color,
            bg: slice.backgroundColor,
            // Per-side spec is authoritative; legacy borderColor/borderStyle
            // pairs (older stored rules) surface as an `all` edge.
            border: slice.border
              ?? (slice.borderStyle || slice.borderColor
                ? { all: { width: 1, style: slice.borderStyle === 'none' ? 'solid' : (slice.borderStyle ?? 'solid'), color: slice.borderColor ?? '#2dd4bf' } }
                : {}),
          }),
          applyStyle: (patch) => {
            if ('fontWeight' in patch) slice.fontWeight = patch.fontWeight as StyleSlice['fontWeight'];
            if ('fontStyle' in patch) slice.fontStyle = patch.fontStyle as StyleSlice['fontStyle'];
            if ('textDecoration' in patch) slice.textDecoration = patch.textDecoration as StyleSlice['textDecoration'];
            if ('fg' in patch) slice.color = patch.fg as string | undefined;
            if ('bg' in patch) slice.backgroundColor = patch.bg as string | undefined;
            if ('border' in patch) {
              // Chrome speaks the kernel BorderSpec vocabulary — store the
              // per-side spec verbatim; the legacy pair is superseded.
              const spec = patch.border as RuleBorderSpec | undefined;
              slice.border = spec && Object.keys(spec).length > 0 ? spec : undefined;
              slice.borderStyle = undefined;
              slice.borderColor = undefined;
            }
            syncDirty();
          },
        });
        styleBand.body.appendChild(chromeHost);
        styleBand.body.appendChild(el('div', 'ckp-hint', 'Bold / italic / underline / strike · text + fill colour · per-side borders (pick a side, then width / style / colour · eraser clears the side)'));
        body.appendChild(styleBand.root);

        // 07 FLASH ON MATCH + STYLE WINDOW.
        const flash = band('Flash on match');
        const f = d.flash ?? { enabled: false, target: 'cell' as const, mode: 'fade' as const, color: '#f0b90b', durationMs: 700 };
        flash.body.appendChild(row('Flash', checkbox(f.enabled, (v) => {
          d.flash = { ...f, enabled: v };
          renderPane();
          syncDirty();
        })));
        if (f.enabled) {
          flash.body.appendChild(row('Target', pillGroup([['cell', 'Cell'], ['row', 'Row']], f.target, (v) => { d.flash = { ...f, target: v as 'cell' | 'row' }; syncDirty(); })));
          flash.body.appendChild(row('Mode', pillGroup([['fade', 'Fade'], ['pulse', 'Pulse'], ['glow', 'Glow']], f.mode, (v) => { d.flash = { ...f, mode: v as 'fade' | 'pulse' | 'glow' }; syncDirty(); })));
          flash.body.appendChild(row('Colour', colorField(f.color, (v) => { d.flash = { ...f, color: v ?? '#f0b90b' }; syncDirty(); })));
          flash.body.appendChild(row('Duration', numberInput(f.durationMs, (v) => { d.flash = { ...f, durationMs: v ?? 700 }; syncDirty(); }, { suffix: 'MS' })));
        }
        flash.body.appendChild(row(
          'Style window',
          numberInput(d.activeDurationMs, (v) => { d.activeDurationMs = v; syncDirty(); }, { placeholder: 'persistent', suffix: 'MS' }),
          'Optional — match styling auto-reverts after this interval. Leave blank for persistent.',
        ));
        body.appendChild(flash.root);

        // 08 INDICATOR.
        const ind = band('Indicator');
        const current = el('div', 'ckp-typebar');
        const renderCurrent = (): void => {
          current.replaceChildren();
          const i = d.indicator;
          if (i) {
            const tile = el('span', 'ckp-tile on');
            tile.innerHTML = lucideSvg(i.iconName) || '?';
            // Preview uses the rule's indicator colour; grid selection chrome stays neutral.
            tile.style.color = i.color;
            current.append(
              tile,
              caps(i.iconName.replace(/-/g, ' ')),
              colorField(i.color, (v) => {
                i.color = v ?? '#ef4444';
                tile.style.color = i.color;
                syncDirty();
              }),
            );
            const clear = el('button', 'ckp-actbtn ckp-btn-quiet', 'Clear');
            clear.type = 'button';
            clear.addEventListener('click', () => { d.indicator = undefined; renderPane(); syncDirty(); });
            current.appendChild(clear);
          } else {
            current.appendChild(el('span', 'ckp-hint lc', 'Pick an icon below to add a match badge.'));
          }
        };
        renderCurrent();
        ind.body.appendChild(current);
        if (d.indicator) {
          const i = d.indicator;
          ind.body.appendChild(row('Target', pillGroup(
            [['cell', 'Cells'], ['row-start', 'Row start'], ['row-end', 'Row end']],
            i.target,
            (v) => { i.target = v as typeof i.target; syncDirty(); },
          )));
          const placeOpts = INDICATOR_PLACE_GROUPS.flatMap(([, entries]) => entries);
          ind.body.appendChild(row(
            'Position',
            select(placeOpts, i.position, (v) => {
              i.position = v as RuleIndicatorPlacement;
              syncDirty();
            }),
            'Inline flows with the value; positional slots overlay the cell corners',
          ));
        }
        for (const [label, icons] of ICON_GROUPS) {
          const present = icons.filter((n) => n in lucideBundle);
          if (!present.length) continue;
          ind.body.appendChild(caps(label));
          const gridEl = el('div', 'ckp-tilegrid');
          for (const name of present) {
            gridEl.appendChild(iconTile(name, d.indicator?.iconName === name, () => {
              const hadIndicator = !!d.indicator;
              d.indicator = {
                iconName: name,
                color: d.indicator?.color ?? '#ef4444',
                target: d.indicator?.target ?? 'cell',
                position: d.indicator?.position ?? 'after',
              };
              // First pick needs Target/Position rows; later picks only
              // refresh preview + tile selection (preserves scroll).
              if (!hadIndicator) {
                renderPane();
                syncDirty();
                return;
              }
              renderCurrent();
              ind.body.querySelectorAll('.ckp-tilegrid .ckp-tile').forEach((node) => {
                const btn = node as HTMLElement;
                btn.classList.toggle('on', btn.title === name);
              });
              syncDirty();
            }));
          }
          ind.body.appendChild(gridEl);
        }
        ind.body.appendChild(el('div', 'ckp-hint', 'Inline Prefix/Suffix flow with the value; positional slots overlay the cell corners and middles.'));
        body.appendChild(ind.root);

        // 09 VALUE FORMATTER.
        const fmt = band('Value formatter');
        const fmtBtn = el('button', 'ckp-fmtbtn');
        fmtBtn.type = 'button';
        const syncFmtBtn = (): void => {
          const cur = d.valueFormatter;
          fmtBtn.innerHTML = `${lucideSvg('hash', 12)}<span>${cur ? previewFormat(cur, 1234.5) : 'Format'}</span><span>⌄</span>`;
          fmtBtn.title = cur ?? 'No formatter';
        };
        syncFmtBtn();
        const firstTargetType = (): FormatDataType => {
          const first = d.scope.kind === 'cell' ? d.scope.columnIds[0] : undefined;
          const def = leafColumns(ctx.grid).find((c) => (c.colId ?? c.field) === first);
          const t = def?.cellDataType;
          return t === 'date' ? 'date' : t === 'boolean' ? 'boolean' : t === 'text' || t === 'string' ? 'text' : 'number';
        };
        fmtMenu = formatPickerMenu(fmtBtn, {
          // Sentinel keeps the picker usable before target columns are chosen
          // (row scope / empty cell scope still need a format string editor).
          targetCols: () => (
            d.scope.kind === 'cell' && d.scope.columnIds.length > 0
              ? d.scope.columnIds
              : ['__rule__']
          ),
          currentFormat: () => d.valueFormatter,
          applyFormat: (format) => { d.valueFormatter = format; syncFmtBtn(); syncDirty(); },
          clearFormat: () => { d.valueFormatter = undefined; syncFmtBtn(); syncDirty(); },
          dataType: firstTargetType,
        }, {
          fitTo: () => formatPickerFitContainer(fmtBtn),
        });
        fmtBtn.addEventListener('click', () => fmtMenu?.toggle());
        fmt.body.append(fmtBtn, el('div', 'ckp-hint', "Applied to cells where this rule matches — overrides the column's own formatter."));
        body.appendChild(fmt.root);

        restorePaneScroll(pane, scrollTop);
      };

      const renderAll = (): void => {
        renderRail();
        renderPane();
      };

      loadRules();
      selectRule(rules[0]?.id ?? null);

      const offRules = ctx.grid.addEventListener('rulesChanged' as never, (() => {
        loadRules();
        renderRail();
      }) as never);

      return {
        destroy() {
          (offRules as unknown as () => void)?.();
          editor?.destroy();
          fmtMenu?.destroy();
          styleChromeDispose?.();
          host.replaceChildren();
        },
        commit() { if (isDirty()) save(); },
        refresh() {
          loadRules();
          renderAll();
        },
      };
    },
  };
}
