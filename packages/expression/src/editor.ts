/**
 * CodeMirror 6 expression editor for the cgrid expression DSL and
 * Perspective ExprTK (SSRM).
 *
 * The shared editor embedded by the conditional-styling and
 * calculated-columns settings modules (feature parity with starui's
 * customizer editor, on CM6 instead of Monaco): dialect syntax highlighting,
 * context-aware completions (columns / functions), debounced lint
 * diagnostics from a caller-supplied validator, `--vg-*` token theming,
 * single- or multi-line chrome.
 *
 * Vanilla TS, no Lit/shadow DOM — mounts into any host element.
 */
import {
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  tooltips,
} from '@codemirror/view';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  LanguageSupport,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  completionKeymap,
  closeBracketsKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';

// ─── language ──────────────────────────────────────────────────────────────

const KEYWORDS = new Set(['true', 'false', 'null']);

/** Stream tokenizer for the `[col] OP fn(...)` DSL — the CM6 analogue of
 *  starui's Monarch grammar. */
const cgridExpressionStream = StreamLanguage.define<{ inString: false | '"' | "'" }>({
  name: 'cgExpression',
  startState: () => ({ inString: false }),
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === state.inString) { state.inString = false; return 'string'; }
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    // Column reference `[colId]` / `[col.old]`
    if (stream.match(/\[[A-Za-z_][\w.]*\]/)) return 'variableName.special';
    // Strings
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      state.inString = quote as '"' | "'";
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === quote) { state.inString = false; break; }
      }
      return 'string';
    }
    // Numbers
    if (stream.match(/\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    // Identifiers — function call when followed by '(' else keyword/atom
    if (stream.match(/[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word.toLowerCase())) return 'atom';
      if (stream.peek() === '(') return 'function(variableName)';
      return 'name';
    }
    if (stream.match(/&&|\|\||[=!<>]=|[+\-*/%<>!?:]/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: {
    closeBrackets: { brackets: ['(', '[', '"', "'"] },
  },
});

/**
 * Perspective ExprTK — column refs are `"colId"` (double quotes); string
 * literals use single quotes. Optional `// Alias` first-line name.
 */
const perspectiveExpressionStream = StreamLanguage.define<{ inString: false | '"' | "'" }>({
  name: 'pspExprTK',
  startState: () => ({ inString: false }),
  token(stream, state) {
    if (state.inString) {
      const q = state.inString;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === q) { state.inString = false; break; }
      }
      return q === '"' ? 'variableName.special' : 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/\/\/.*/)) return 'comment';
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      const q = quote as '"' | "'";
      state.inString = q;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') { stream.next(); continue; }
        if (ch === q) { state.inString = false; break; }
      }
      // Double-quoted → column ref; single-quoted → string literal.
      return q === '"' ? 'variableName.special' : 'string';
    }
    if (stream.match(/\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word.toLowerCase())) return 'atom';
      if (stream.peek() === '(') return 'function(variableName)';
      return 'name';
    }
    if (stream.match(/[=!<>]=|[+\-*/%<>^]/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: {
    closeBrackets: { brackets: ['(', '"', "'"] },
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.special(tags.variableName), color: 'var(--cgx-expr-col, #7dd3fc)' },
  { tag: tags.function(tags.variableName), color: 'var(--cgx-expr-fn, #c084fc)' },
  { tag: tags.atom, color: 'var(--cgx-expr-kw, #f0b90b)' },
  { tag: tags.string, color: 'var(--cgx-expr-str, #86efac)' },
  { tag: tags.number, color: 'var(--cgx-expr-num, #fda4af)' },
  { tag: tags.operator, color: 'var(--cgx-expr-op, #94a3b8)' },
  { tag: tags.comment, color: 'var(--cgx-expr-comment, #6b7684)', fontStyle: 'italic' },
]);

// ─── completion catalog ────────────────────────────────────────────────────

export interface ExpressionColumn {
  colId: string;
  headerName?: string;
  dataType?: string;
}

export interface ExpressionFunction {
  name: string;
  signature: string;
  description: string;
  category: string;
  /** Snippet inserted on pick; default `NAME(${})`. */
  apply?: string;
}

/** Dialect: cgrid `[col]` DSL (CSRM) vs Perspective ExprTK `"col"` (SSRM). */
export type ExpressionDialect = 'cgrid' | 'perspective';

/** @wellsfargo-starui/velocity-grid-expression builtins (its BUILTINS table is not exported — this
 *  catalog mirrors packages/expression/src/builtins.ts). */
export const EXPRESSION_BUILTINS: ExpressionFunction[] = [
  { name: 'IF', signature: 'IF(cond, then, else)', description: 'Conditional value', category: 'Logical' },
  { name: 'COALESCE', signature: 'COALESCE(a, b, …)', description: 'First non-null argument', category: 'Logical' },
  { name: 'NOT', signature: 'NOT(x)', description: 'Logical not', category: 'Logical' },
  { name: 'AND', signature: 'AND(a, b, …)', description: 'Logical and', category: 'Logical' },
  { name: 'OR', signature: 'OR(a, b, …)', description: 'Logical or', category: 'Logical' },
  { name: 'ABS', signature: 'ABS(x)', description: 'Absolute value', category: 'Math' },
  { name: 'ROUND', signature: 'ROUND(x, digits?)', description: 'Round to digits', category: 'Math' },
  { name: 'MIN', signature: 'MIN(a, b, …)', description: 'Smallest argument', category: 'Math' },
  { name: 'MAX', signature: 'MAX(a, b, …)', description: 'Largest argument', category: 'Math' },
  { name: 'FLOOR', signature: 'FLOOR(x)', description: 'Round down', category: 'Math' },
  { name: 'CEIL', signature: 'CEIL(x)', description: 'Round up', category: 'Math' },
  { name: 'LOWER', signature: 'LOWER(s)', description: 'Lower-case', category: 'String' },
  { name: 'UPPER', signature: 'UPPER(s)', description: 'Upper-case', category: 'String' },
  { name: 'LEN', signature: 'LEN(s)', description: 'String length', category: 'String' },
  { name: 'TRIM', signature: 'TRIM(s)', description: 'Trim whitespace', category: 'String' },
  { name: 'TITLE', signature: 'TITLE(s)', description: 'Title Case', category: 'String' },
  { name: 'CAMEL', signature: 'CAMEL(s)', description: 'camelCase', category: 'String' },
  { name: 'CAP', signature: 'CAP(s)', description: 'Capitalize first letter', category: 'String' },
  { name: 'FIXED', signature: 'FIXED(x, digits)', description: 'Fixed-point string', category: 'String' },
];

/** Common Perspective ExprTK builtins used in calculated columns. */
export const PERSPECTIVE_EXPRTK_BUILTINS: ExpressionFunction[] = [
  { name: 'abs', signature: 'abs(x)', description: 'Absolute value', category: 'Math' },
  { name: 'sqrt', signature: 'sqrt(x)', description: 'Square root', category: 'Math' },
  { name: 'pow', signature: 'pow(x, y)', description: 'x raised to y', category: 'Math' },
  { name: 'min', signature: 'min(a, b)', description: 'Smaller of two', category: 'Math' },
  { name: 'max', signature: 'max(a, b)', description: 'Larger of two', category: 'Math' },
  { name: 'floor', signature: 'floor(x)', description: 'Round down', category: 'Math' },
  { name: 'ceil', signature: 'ceil(x)', description: 'Round up', category: 'Math' },
  { name: 'round', signature: 'round(x)', description: 'Round to nearest', category: 'Math' },
  { name: 'if', signature: 'if(cond) expr1; else expr2', description: 'Conditional', category: 'Logical', apply: 'if(${}) ${}; else ${}' },
  { name: 'concat', signature: "concat('a', \"col\")", description: 'Concatenate strings', category: 'String' },
  { name: 'upper', signature: 'upper(s)', description: 'Upper-case', category: 'String' },
  { name: 'lower', signature: 'lower(s)', description: 'Lower-case', category: 'String' },
  { name: 'length', signature: 'length(s)', description: 'String length', category: 'String' },
  { name: 'order', signature: 'order(x)', description: 'Sort key helper', category: 'Misc' },
];

export interface ExpressionEditorOptions {
  value?: string;
  placeholder?: string;
  /** Single-line by default; multi-line reserves `lines` rows. */
  multiline?: boolean;
  lines?: number;
  /** `'cgrid'` (default) or `'perspective'` ExprTK for SSRM. */
  dialect?: ExpressionDialect;
  columnsProvider?: () => ExpressionColumn[];
  functionsProvider?: () => ExpressionFunction[];
  /** Return diagnostics for the current text (char offsets). Debounced. */
  validate?: (text: string) => Array<{ message: string; from: number; to: number; severity?: 'error' | 'warning' | 'info' }>;
  onChange?: (value: string) => void;
  /** Fires on blur and Ctrl/Cmd+Enter. */
  onCommit?: (value: string) => void;
  /**
   * Document or shadow root the editor lives in. Required when the host is
   * in another window (DataProvider popout) — CodeMirror otherwise mounts
   * autocomplete on the opener `document.body`.
   */
  root?: Document | ShadowRoot;
  /** Autocomplete / lint tooltip mount. Defaults to `root`'s body. */
  tooltipParent?: HTMLElement;
}

/** True inside an unclosed `[` (string-aware) — column-only completions. */
function inColumnRef(text: string): boolean {
  let inStr: false | string = false;
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === '[') open = true;
    else if (ch === ']') open = false;
  }
  return open;
}

/** True inside an unclosed `"` column ref (Perspective); ignores `'…'` strings. */
function inPerspectiveColumnRef(text: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inSingle) {
      if (ch === '\\') i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
  }
  return inDouble;
}

export class ExpressionEditor {
  private view: EditorView;
  private readonly opts: ExpressionEditorOptions;
  private readonly lintCompartment = new Compartment();

  constructor(host: HTMLElement, opts: ExpressionEditorOptions = {}) {
    this.opts = opts;
    const multiline = opts.multiline === true;
    const lines = Math.max(1, opts.lines ?? 3);
    const dialect: ExpressionDialect = opts.dialect ?? 'cgrid';
    const language = dialect === 'perspective' ? perspectiveExpressionStream : cgridExpressionStream;
    const defaultFns = dialect === 'perspective' ? PERSPECTIVE_EXPRTK_BUILTINS : EXPRESSION_BUILTINS;
    const defaultPlaceholder = dialect === 'perspective'
      ? '// MyCalc\n"pnl" + "dailyPnl"'
      : '[price] * [quantity]';

    const completionSource = (context: CompletionContext): CompletionResult | null => {
      const before = context.state.sliceDoc(0, context.pos);
      if (dialect === 'perspective') {
        if (inPerspectiveColumnRef(before)) {
          const word = context.matchBefore(/[\w.]*/);
          const columns = this.opts.columnsProvider?.() ?? [];
          return {
            from: word ? word.from : context.pos,
            options: columns.map((c): Completion => ({
              label: c.colId,
              detail: [c.headerName, c.dataType].filter(Boolean).join(' · '),
              type: 'variable',
              boost: 2,
            })),
            validFor: /^[\w.]*$/,
          };
        }
        const word = context.matchBefore(/[\w"]*$/);
        if (!word && !context.explicit) return null;
        const columns = this.opts.columnsProvider?.() ?? [];
        const functions = this.opts.functionsProvider?.() ?? defaultFns;
        const options: Completion[] = [
          ...columns.map((c): Completion => ({
            label: `"${c.colId}"`,
            detail: c.headerName ?? '',
            type: 'variable',
            boost: 3,
          })),
          ...functions.map((f) =>
            snippetCompletion(f.apply ?? `${f.name}(\${})`, {
              label: f.name,
              detail: f.signature,
              info: `${f.category} — ${f.description}`,
              type: 'function',
              boost: 1,
            }),
          ),
        ];
        return { from: word ? word.from : context.pos, options, validFor: /^[\w"]*$/ };
      }

      if (inColumnRef(before)) {
        const word = context.matchBefore(/[\w.]*/);
        const columns = this.opts.columnsProvider?.() ?? [];
        return {
          from: word ? word.from : context.pos,
          options: columns.map((c): Completion => ({
            label: c.colId,
            detail: [c.headerName, c.dataType].filter(Boolean).join(' · '),
            type: 'variable',
            boost: 2,
          })),
          validFor: /^[\w.]*$/,
        };
      }
      const word = context.matchBefore(/[\w[]*$/);
      if (!word && !context.explicit) return null;
      const columns = this.opts.columnsProvider?.() ?? [];
      const functions = this.opts.functionsProvider?.() ?? defaultFns;
      const options: Completion[] = [
        ...columns.map((c): Completion => ({
          label: `[${c.colId}]`,
          detail: c.headerName ?? '',
          type: 'variable',
          boost: 3,
        })),
        ...functions.map((f) =>
          snippetCompletion(f.apply ?? `${f.name}(\${})`, {
            label: f.name,
            detail: f.signature,
            info: `${f.category} — ${f.description}`,
            type: 'function',
            boost: 1,
          }),
        ),
        { label: 'true', type: 'keyword' },
        { label: 'false', type: 'keyword' },
        { label: 'null', type: 'keyword' },
      ];
      return { from: word ? word.from : context.pos, options, validFor: /^[\w[\]]*$/ };
    };

    const lintSource = () => {
      const validate = this.opts.validate;
      if (!validate) return [];
      const text = this.view ? this.view.state.doc.toString() : opts.value ?? '';
      const max = text.length;
      return validate(text).map((d): Diagnostic => ({
        from: Math.max(0, Math.min(d.from, max)),
        to: Math.max(0, Math.min(Math.max(d.to, d.from + 1), max)),
        severity: d.severity ?? 'error',
        message: d.message,
      }));
    };

    const commitKeys = Prec.highest(keymap.of([
      {
        key: 'Mod-Enter',
        run: () => { this.opts.onCommit?.(this.getValue()); return true; },
      },
      // Single-line: Enter commits instead of inserting a newline.
      ...(!multiline
        ? [{ key: 'Enter', run: (): boolean => { this.opts.onCommit?.(this.getValue()); return true; } }]
        : []),
    ]));

    const root = opts.root
      ?? (host.getRootNode() as Document | ShadowRoot | undefined)
      ?? host.ownerDocument
      ?? document;
    const crossDocument = root instanceof Document && root !== document;
    const tooltipParent = opts.tooltipParent
      ?? (crossDocument ? root.body : undefined);

    this.view = new EditorView({
      parent: host,
      root,
      state: EditorState.create({
        doc: opts.value ?? '',
        extensions: [
          new LanguageSupport(language),
          syntaxHighlighting(highlightStyle),
          history(),
          closeBrackets(),
          autocompletion({ override: [completionSource], icons: false }),
          // Only override tooltip parent for popout / explicit hosts.
          // A body-parented container in the opener is IN FLOW and grows
          // the page (stray scrollbars). Drawer panes keep CM's default.
          ...(tooltipParent ? [tooltips({ parent: tooltipParent })] : []),
          this.lintCompartment.of(opts.validate ? [linter(lintSource, { delay: 150 }), lintGutter()] : []),
          ...(multiline ? [lineNumbers()] : []),
          cmPlaceholder(opts.placeholder ?? defaultPlaceholder),
          commitKeys,
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.opts.onChange?.(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) {
              this.opts.onCommit?.(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            '&': {
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
              backgroundColor: 'var(--cgx-expr-bg, rgba(0,0,0,0.25))',
              border: '1px solid var(--vg-border-color, #2c3540)',
              borderRadius: '4px',
              minHeight: multiline ? `${lines * 20 + 12}px` : '26px',
              maxHeight: multiline ? '220px' : '26px',
            },
            '&.cm-focused': { outline: 'none', borderColor: 'var(--vg-chrome-accent)' },
            '.cm-content': { padding: '4px 6px', caretColor: 'var(--vg-fg, #dfe6ee)' },
            '.cm-line': { padding: '0' },
            '.cm-scroller': { overflow: 'auto', lineHeight: '20px' },
            '.cm-gutters': {
              ...(opts.validate || multiline ? {} : { display: 'none' }),
              background: 'transparent',
              border: 'none',
              color: 'var(--vg-fg-muted, #5f6a78)',
            },
            '.cm-lineNumbers .cm-gutterElement': { minWidth: '22px', paddingRight: '6px' },
            '.cm-placeholder': { color: 'var(--vg-fg-muted, #6b7684)', fontStyle: 'italic' },
            '.cm-tooltip': {
              background: 'var(--vg-bg, #171c23)',
              color: 'var(--vg-fg, #dfe6ee)',
              border: '1px solid var(--vg-border-color, #2c3540)',
              fontSize: '11px',
              zIndex: '10300',
            },
            '.cm-tooltip-autocomplete ul li[aria-selected]': {
              background: 'var(--vg-chrome-accent)',
              color: '#fff',
            },
          }),
          ...(multiline ? [EditorView.lineWrapping] : []),
        ],
      }),
    });
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(value: string): void {
    if (value === this.getValue()) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: value },
    });
  }

  focus(): void {
    this.view.focus();
  }

  /** Force an immediate re-lint (e.g. after schema changes). */
  relint(): void {
    if (!this.opts.validate) return;
    this.view.dispatch({ effects: this.lintCompartment.reconfigure([]) });
    this.view.dispatch({
      effects: this.lintCompartment.reconfigure([
        linter(() => {
          const validate = this.opts.validate!;
          const text = this.view.state.doc.toString();
          const max = text.length;
          return validate(text).map((d): Diagnostic => ({
            from: Math.max(0, Math.min(d.from, max)),
            to: Math.max(0, Math.min(Math.max(d.to, d.from + 1), max)),
            severity: d.severity ?? 'error',
            message: d.message,
          }));
        }, { delay: 150 }),
        lintGutter(),
      ]),
    });
  }

  destroy(): void {
    this.view.destroy();
  }
}

/** Count distinct `"col"` refs in a Perspective ExprTK expression. */
export function countPerspectiveColumnRefs(expression: string): number {
  const seen = new Set<string>();
  for (const m of expression.matchAll(/"([^"\\]+)"/g)) seen.add(m[1]!);
  return seen.size;
}
