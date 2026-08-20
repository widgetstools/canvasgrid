import { describe, expect, it } from 'vitest';
import { renderMessage, type MessageContext } from '../../../src/rules/alerts/messageTemplate';

const ctx = (over?: Partial<MessageContext>): MessageContext => ({
  rule: 'Big move', rowId: 'AAPL', column: 'price', value: 105, prev: 100, ...over,
});

describe('renderMessage', () => {
  it('substitutes all five placeholders', () => {
    expect(renderMessage('{rule}: {column} {prev} -> {value} on {rowId}', ctx()))
      .toBe('Big move: price 100 -> 105 on AAPL');
  });

  it('null column renders as empty string', () => {
    expect(renderMessage('col=<{column}>', ctx({ column: null }))).toBe('col=<>');
  });

  it('null and undefined value/prev render as empty string', () => {
    expect(renderMessage('{value}|{prev}', ctx({ value: null, prev: undefined }))).toBe('|');
  });

  it('non-string values render via String(...)', () => {
    expect(renderMessage('{value} {prev}', ctx({ value: true, prev: 0 }))).toBe('true 0');
  });

  it('single pass: a value containing "{prev}" is NOT re-substituted', () => {
    expect(renderMessage('{value} / {prev}', ctx({ value: '{prev}', prev: 'OLD' })))
      .toBe('{prev} / OLD');
  });

  it('unknown placeholders pass through verbatim', () => {
    expect(renderMessage('{foo} {value} {}', ctx({ value: 5 }))).toBe('{foo} 5 {}');
  });

  it('repeated placeholders substitute every occurrence', () => {
    expect(renderMessage('{rowId}-{rowId}', ctx())).toBe('AAPL-AAPL');
  });

  it('template without placeholders returns unchanged', () => {
    expect(renderMessage('static text', ctx())).toBe('static text');
  });
});
