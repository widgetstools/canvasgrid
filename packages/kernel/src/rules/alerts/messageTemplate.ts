// {rule}/{rowId}/{column}/{value}/{prev} template rendering (spec §4.4).
// Single-pass String.replace with a callback: replacement text is never
// re-scanned, so values that themselves contain placeholder syntax are not
// re-substituted, and there is no regex/`$`-pattern injection surface (the
// pattern is a fixed literal; callback returns are inserted verbatim).

export interface MessageContext {
  rule: string;
  rowId: string;
  column: string | null;
  value: unknown;
  prev: unknown;
}

const PLACEHOLDER = /\{(rule|rowId|column|value|prev)\}/g;

function toText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function renderMessage(template: string, ctx: MessageContext): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    switch (key) {
      case 'rule': return toText(ctx.rule);
      case 'rowId': return toText(ctx.rowId);
      case 'column': return toText(ctx.column);
      case 'value': return toText(ctx.value);
      case 'prev': return toText(ctx.prev);
      /* v8 ignore next 2 -- the pattern only matches the five keys above */
      default: return match;
    }
  });
}
