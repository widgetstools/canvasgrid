export type MessageContext = {
  rule: string;
  rowId: string;
  column: string | null;
  value: unknown;
  prev: unknown;
};

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
      default: return match;
    }
  });
}
