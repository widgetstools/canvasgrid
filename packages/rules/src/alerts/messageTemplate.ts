// {rule}/{rowId}/{column}/{value}/{prev} template rendering. Ships in Task 6.
export interface MessageContext {
  rule: string; rowId: string; column: string | null; value: unknown; prev: unknown;
}
export function renderMessage(_template: string, _ctx: MessageContext): string {
  throw new Error('not-yet-implemented: renderMessage ships in Task 6');
}
