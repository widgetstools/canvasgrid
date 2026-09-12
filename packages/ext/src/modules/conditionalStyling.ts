/**
 * Conditional Styling — settings-sheet rules editor in the starui
 * customizer cockpit layout: rules rail, a labelled identity head
 * (name / status / scope / priority / applied), a live three-cell preview,
 * then bands — expression → target columns → style (apply-to target, font,
 * colour, borders) → number format, with flash and indicator under
 * Advanced. CodeMirror 6 expression editor with live validation.
 *
 * Mutations ride the kernel rule API (`addRule` / `updateRule` /
 * `deleteRule` / `setRuleEnabled`); the @wellsfargo-starui/velocity-grid/rules bridge persists the
 * set in the grid config (layout-tier 'rules' state module) and repaints.
 */
import {
  validateRule,
  wireIntoKernel as wireRules,
  type RuleEngine,
  type ConditionalStyleRule,
  type RuleBorderSpec,
  type RuleIndicatorPlacement,
  type RuleStyleTarget,
  type StyleSlice,
} from '@wellsfargo-starui/velocity-grid/rules';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import { mountFormatterStyleChrome } from '../toolbar/styleChrome';
import { ExpressionEditor } from '../ui/expressionEditor';
import { editorColumns, leafColumns, schemaFromGrid } from '../ui/gridSchema';
import {
  appendPaneChrome, band, caps, colorField, el, iconTile, injectCockpitStyles, lucideSvg,
  numberInput, pillGroup, restorePaneScroll, row, select, switchToggle, takePaneScroll, textInput,
  emptyState, createSettingsAdvancedTabs, markBandComplexity,
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
      let activeTab: string | undefined;

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
          console.warn('[velocity-grid-ext] Styling Rules: wiring @wellsfargo-starui/velocity-grid/rules failed', err);
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
        const count = el('span', 'ckp-caps ckp-count', String(rules.length));
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

        // Sticky identity head. Same six controls as before — name, status,
        // scope, priority, Save, Reset — but each one now says what it is.
        // Unlabelled, a select reading "Row" and a number reading "0" are
        // indistinguishable from each other; the only way to tell scope from
        // priority was to hover for a tooltip.
        const head = el('div', 'ckp-pane-head ckp-rule-head');
        const ident = el('div', 'ckp-rule-ident');
        const nameIn = textInput(d.name, (v) => { d.name = v; runValidate(d.condition); syncDirty(); }, { className: 'ckp-title' });
        nameIn.setAttribute('aria-label', 'Rule name');
        const statusBox = switchToggle(d.enabled, (v) => {
          d.enabled = v;
          syncDirty();
        });
        statusBox.title = 'Status';
        const scopeSel = select([['cell', 'Cell'], ['row', 'Row']], d.scope.kind, (v) => {
          d.scope = v === 'cell' ? { kind: 'cell', columnIds: [] } : { kind: 'row' };
          // `target` rides through: scope decides WHICH columns, target
          // decides which part of them. Changing one must not silently
          // reset the other.
          renderPane();
        });
        scopeSel.title = 'Scope';
        const prioIn = numberInput(d.priority, (v) => {
          d.priority = v ?? 0;
          syncDirty();
        }, { placeholder: '0' });
        prioIn.title = 'Priority';
        const metaField = (label: string, control: HTMLElement): HTMLElement => {
          const wrap = el('span', 'ckp-metafield');
          wrap.append(caps(label), control);
          return wrap;
        };
        const metaLine = el('div', 'ckp-metaline');
        // Applied is a computed count, not a control — it reads as a value.
        // A header-only rule has no rows to count: it paints the caption
        // unconditionally, so a row count there would always read 0 and mean
        // nothing. Say what it does instead.
        const appliedVal = el('span', 'ckp-metaval');
        const syncApplied = (): void => {
          appliedVal.textContent = draftIsNew ? '—'
            : d.target === 'header' ? 'Header only'
              : appliedCount(d);
        };
        syncApplied();
        metaLine.append(
          metaField('Status', statusBox),
          metaField('Scope', scopeSel),
          metaField('Priority', prioIn),
          metaField('Applied', appliedVal),
        );
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
        const actions = el('div', 'ckp-head-actions');
        actions.append(saveBtn, resetBtn);
        // Name and actions share the top line; the meta fields run the full
        // width beneath them, so four labelled fields fit on one row instead
        // of wrapping into a column beside the buttons.
        const topLine = el('div', 'ckp-rule-topline');
        topLine.append(nameIn, actions);
        ident.append(topLine, metaLine);
        head.append(ident);
        const body = appendPaneChrome(pane, head);

        const syncDirty = (): void => {
          const dirty = isDirty();
          saveBtn.disabled = !dirty && !draftIsNew;
          resetBtn.disabled = !dirty && !draftIsNew;
        };
        syncDirty();

        // ── Preview ──────────────────────────────────────────────────────
        // Three cells in the grid's own tokens: the column header, a row the
        // rule matches, a row it doesn't. Every control below reports here —
        // the style chrome, the format string, and the header/cells target,
        // which is otherwise invisible until the rule is saved and the grid
        // repaints. Reads the draft on every sync, so it never drifts from
        // the controls that feed it.
        const pvHeader = el('div', 'ckp-pv-cell is-header');
        const pvMatch = el('div', 'ckp-pv-cell');
        const pvOff = el('div', 'ckp-pv-cell');
        const pvRow = (tag: string, cell: HTMLElement, off = false): HTMLElement => {
          const rowEl = el('div', `ckp-pv-row${off ? ' is-off' : ''}`);
          rowEl.append(el('span', 'ckp-pv-tag', tag), cell);
          return rowEl;
        };
        const previewSection = el('section', 'ckp-preview');
        const pvFrame = el('div', 'ckp-pv-frame');
        pvFrame.append(
          pvRow('Header', pvHeader),
          pvRow('Match', pvMatch),
          pvRow('No match', pvOff, true),
        );
        previewSection.append(caps('Preview'), pvFrame);

        /** One border side → the CSS shorthand, or '' when it paints nothing. */
        const sideCss = (side?: { width?: number; color?: string; style?: string }): string => {
          if (!side) return '';
          const w = side.width ?? 1;
          if (w <= 0 || side.style === 'none') return '';
          return `${w}px ${side.style ?? 'solid'} ${side.color ?? 'currentColor'}`;
        };
        const paintPreviewCell = (node: HTMLElement, styled: boolean): void => {
          // Wipe first: a cleared control must clear the preview too.
          node.removeAttribute('style');
          if (!styled) return;
          const sl = d.style.base ?? {};
          if (sl.color) node.style.color = sl.color;
          if (sl.backgroundColor) node.style.background = sl.backgroundColor;
          if (sl.fontWeight !== undefined) node.style.fontWeight = String(sl.fontWeight);
          if (sl.fontStyle) node.style.fontStyle = sl.fontStyle;
          if (sl.textDecoration) node.style.textDecoration = sl.textDecoration;
          // The preview cells are flex rows, so alignment is justification —
          // and the header cell starts left while the data cells start right,
          // which is the grid's own default for a number.
          if (sl.halign) {
            node.style.justifyContent =
              sl.halign === 'center' ? 'center' : sl.halign === 'right' ? 'flex-end' : 'flex-start';
          }
          // Per-side spec wins over the legacy pair, exactly as the paint
          // path folds it (see `ruleStyleToPatch` in the kernel).
          const spec: RuleBorderSpec | undefined = sl.border
            ?? (sl.borderColor && sl.borderStyle !== 'none'
              ? { all: { width: 1, style: (sl.borderStyle ?? 'solid') as never, color: sl.borderColor } }
              : undefined);
          if (!spec) return;
          const all = sideCss(spec.all);
          if (all) node.style.border = all;
          const edges: Array<[string, typeof spec.top]> = [
            ['top', spec.top], ['right', spec.right], ['bottom', spec.bottom], ['left', spec.left],
          ];
          for (const [edge, side] of edges) {
            const css = sideCss(side);
            if (css) node.style.setProperty(`border-${edge}`, css);
          }
        };
        const syncPreview = (): void => {
          const target = d.target ?? 'cells';
          const firstCol = d.scope.kind === 'cell' ? d.scope.columnIds[0] : undefined;
          const def = firstCol
            ? leafColumns(ctx.grid).find((c) => (c.colId ?? c.field) === firstCol)
            : undefined;
          pvHeader.textContent = def?.headerName ?? firstCol ?? 'Column';
          const text = d.valueFormatter ? previewFormat(d.valueFormatter, 1234.5) : '1,234.57';
          pvMatch.textContent = text;
          pvOff.textContent = '1,234.57';
          paintPreviewCell(pvHeader, target === 'header' || target === 'both');
          paintPreviewCell(pvMatch, target === 'cells' || target === 'both');
          paintPreviewCell(pvOff, false);
        };
        syncPreview();
        body.appendChild(previewSection);

        // Rule-level problems (name, target columns) — see `runValidate`.
        const shapeBox = el('div', 'ckp-notice ckp-notice-shape');
        shapeBox.setAttribute('role', 'status');
        shapeBox.style.display = 'none';
        body.appendChild(shapeBox);

        const settingsPane = el('div');
        const advancedPane = el('div');

        // 01 EXPRESSION.
        const expr = band('Expression');
        markBandComplexity(expr, 'basic');
        const editorHost = el('div', 'ckp-editor');
        const errBox = el('div', 'ckp-error');
        errBox.style.display = 'none';
        // `validateRule` answers for the whole rule, not just the expression:
        // an empty name or an unpicked target column comes back as
        // `bad-shape` with no `loc`, which used to underline the entire
        // expression and print "rule.scope must be…" beneath it. The
        // expression box takes only the errors that are about the
        // expression; everything else goes to the rule-level strip, where
        // the control it names actually lives.
        const EXPR_CODES = new Set(['parse', 'unknown-fn', 'arity', 'not-yet-implemented']);
        /** Shape errors state the type contract ("rule.scope must be { kind:
         *  'row' } or …"). That is the right message for a caller passing
         *  rules through the API and the wrong one for someone editing a
         *  rule. `null` drops the entry: an empty target-column list is
         *  already called out inside the Target columns band, right under
         *  the control that fixes it, and saying it twice on one screen
         *  makes both copies easier to ignore. */
        const humanise = (message: string): string | null => {
          if (message.startsWith('rule.scope')) return null;
          if (message.startsWith('rule.name')) return 'Give the rule a name.';
          return message;
        };
        const runValidate = (text: string) => {
          const probe = { ...clone(d), condition: text };
          let errors: Array<{ code: string; message: string; loc: { start: number; end: number } | null }> = [];
          try { errors = validateRule(probe, schema()); } catch { errors = []; }
          const exprErrors = errors.filter((e) => EXPR_CODES.has(e.code));
          const otherErrors = errors
            .filter((e) => !EXPR_CODES.has(e.code))
            .map((e) => humanise(e.message))
            .filter((m): m is string => m !== null);
          errBox.style.display = exprErrors.length ? '' : 'none';
          errBox.textContent = exprErrors[0]?.message ?? '';
          shapeBox.style.display = otherErrors.length ? '' : 'none';
          shapeBox.replaceChildren(
            ...otherErrors.map((m) => el('div', 'ckp-notice-body', m)),
          );
          return exprErrors.map((e) => ({
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
        settingsPane.appendChild(expr.root);

        // 02 TARGET COLUMNS (cell scope).
        if (d.scope.kind === 'cell') {
          const scope = d.scope;
          const tgt = band('Target columns');
          markBandComplexity(tgt, 'basic');
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
                syncPreview();
                runValidate(d.condition);
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
          const picker = select([['', 'Add column…']], '', () => {});
          const refreshPicker = (): void => {
            picker.replaceChildren();
            const opts: Array<[string, string]> = [
              ['', 'Add column…'],
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
            syncPreview();
            runValidate(d.condition);
            syncDirty();
          });
          tgt.body.append(chips, picker);
          settingsPane.appendChild(tgt.root);
        }

        // 03 STYLE — the formatter toolbar's Font/Borders chrome (same
        // component as the ribbon), adapted onto the rule's StyleSlice.
        // Controls the rules model cannot express (font size, alignment,
        // per-side borders, border width) are hidden via scoped CSS
        // rather than left as dead buttons.
        const slice = (d.style.base ??= {});
        const styleBand = band('Style');
        markBandComplexity(styleBand, 'basic');
        // Where the style lands — the first thing to decide about a style,
        // so it leads the band. Cells is the default and what every rule
        // authored before this switch existed means, so an untouched rule
        // paints exactly as it did.
        //
        // Always offered, whatever the scope: a new rule starts row-scoped,
        // and hiding the control there made the feature invisible to anyone
        // who had not already switched to Cell. Which headers it reaches
        // follows the scope, exactly as it does for cells — named columns
        // under Cell scope, every column under Row.
        styleBand.body.appendChild(row(
          'Apply to',
          pillGroup(
            [['cells', 'Cells'], ['header', 'Header'], ['both', 'Both']],
            d.target ?? 'cells',
            (v) => { d.target = v as RuleStyleTarget; syncPreview(); syncApplied(); syncDirty(); },
          ),
          d.scope.kind === 'cell'
            ? 'Headers are styled whenever the rule is on — a header has no row for the expression to test.'
            : 'Row scope means every column, so Header reaches every column’s header.',
        ));
        const chromeHost = el('div', 'ckp-stylechrome');
        styleChromeDispose = mountFormatterStyleChrome(chromeHost, {
          getStyle: () => ({
            fontWeight: slice.fontWeight,
            fontStyle: slice.fontStyle,
            textDecoration: slice.textDecoration,
            halign: slice.halign,
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
            if ('halign' in patch) {
              // Clicking the alignment already set clears it. A rule with no
              // alignment leaves the column's own (right for a number, left
              // for the rest) alone, and without a toggle there would be no
              // way back to that once a button had been pressed.
              const next = patch.halign as StyleSlice['halign'];
              slice.halign = slice.halign === next ? undefined : next;
            }
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
            syncPreview();
            syncDirty();
          },
        });
        // The chrome ships alignment as its own ribbon group, which in a
        // settings pane would stack a third labelled block under Font and
        // Borders for three buttons. Alignment is part of how the text is
        // set, so it joins the font row: move the cluster into the Font deck
        // and retire the group it came from. Doing it here rather than in
        // `mountFormatterStyleChrome` keeps the ribbon's own layout — where
        // the groups sit side by side and the separate block is right —
        // untouched.
        const alignCluster = chromeHost.querySelector<HTMLElement>('[data-vg-field="halign"]');
        const fontGroup = chromeHost.querySelector<HTMLElement>('[data-vg-field="fg"]')
          ?.closest('.vgext-rb-grp');
        const fontDeck = fontGroup?.querySelector<HTMLElement>('.vgext-rb-deck');
        if (alignCluster && fontDeck) {
          const emptied = alignCluster.closest('.vgext-rb-grp');
          fontDeck.appendChild(alignCluster);
          emptied?.setAttribute('hidden', '');
        }
        // The ribbon always shows an alignment, because a column always has
        // one. A RULE may have none, and "no override" must not look like
        // "left" — the chrome's own refresh falls back to it. Runs on the
        // bubble, so it lands after the chrome has re-rendered the cluster.
        // `Array.from`, not a spread: the demo apps typecheck against a lib
        // where NodeListOf has no Symbol.iterator.
        const alignButtons = (): HTMLElement[] =>
          Array.from(chromeHost.querySelectorAll<HTMLElement>('[data-vg-field="halign"] button'));
        const syncAlignUnset = (): void => {
          if (slice.halign === undefined) {
            for (const b of alignButtons()) b.classList.remove('is-on');
          }
        };
        chromeHost.addEventListener('click', syncAlignUnset);
        syncAlignUnset();
        styleBand.body.appendChild(chromeHost);
        // The font and colour controls carry their own tooltips; the only
        // part that is not self-evident is that borders are edited one side
        // at a time.
        styleBand.body.appendChild(el('div', 'ckp-hint', 'Alignment and the font controls follow the Apply to target. Borders are set one side at a time — pick a side, then its width, style and colour; the eraser clears that side.'));
        settingsPane.appendChild(styleBand.root);

        // 07 FLASH ON MATCH + STYLE WINDOW.
        const flash = band('Flash on match');
        markBandComplexity(flash, 'advanced');
        const f = d.flash ?? { enabled: false, target: 'cell' as const, mode: 'fade' as const, color: '#f0b90b', durationMs: 700 };
        flash.body.appendChild(row('Flash', switchToggle(f.enabled, (v) => {
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
        advancedPane.appendChild(flash.root);

        // 08 INDICATOR.
        const ind = band('Indicator');
        markBandComplexity(ind, 'advanced');
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
        advancedPane.appendChild(ind.root);

        // 09 VALUE FORMATTER — a Settings band, not Advanced.
        //
        // This is the formatter toolbar's own picker (`formatPickerMenu`),
        // and choosing how a matched cell READS is the same order of
        // decision as choosing its colour — it belongs beside the style
        // controls, not behind a tab. Parked under Advanced it was
        // effectively undiscoverable: the rule editor opens on Settings.
        const fmt = band('Number format');
        const fmtBtn = el('button', 'ckp-fmtbtn');
        fmtBtn.type = 'button';
        const syncFmtBtn = (): void => {
          const cur = d.valueFormatter;
          // D-XSS1 — the preview text runs a user-authored format string
          // through compileFormat/formatText, which passes quoted-literal
          // sections through verbatim; it must never reach innerHTML.
          fmtBtn.innerHTML = lucideSvg('hash', 12);
          const label = document.createElement('span');
          label.textContent = cur ? previewFormat(cur, 1234.5) : 'Format';
          const chevron = document.createElement('span');
          chevron.textContent = '⌄';
          fmtBtn.append(label, chevron);
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
          applyFormat: (format) => { d.valueFormatter = format; syncFmtBtn(); syncPreview(); syncDirty(); },
          clearFormat: () => { d.valueFormatter = undefined; syncFmtBtn(); syncPreview(); syncDirty(); },
          dataType: firstTargetType,
        }, {
          fitTo: () => formatPickerFitContainer(fmtBtn),
        });
        fmtBtn.addEventListener('click', () => fmtMenu?.toggle());
        fmt.body.append(fmtBtn, el('div', 'ckp-hint', "Applied to cells where this rule matches — overrides the column's own formatter."));
        settingsPane.appendChild(fmt.root);

        // State the rule-level problems now rather than when CodeMirror's
        // linter next fires — "pick a target column" is true the moment the
        // pane renders, and waiting a lint delay to say so reads as the
        // editor not noticing.
        runValidate(d.condition);

        body.appendChild(createSettingsAdvancedTabs({
          settings: settingsPane,
          advanced: advancedPane,
          defaultTab: activeTab,
          lucideSvg,
          onTabChange: (id) => { activeTab = id; },
        }).root);

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
