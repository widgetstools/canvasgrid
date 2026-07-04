/**
 * Cycle 21i Phase 2 / T1 — ToolbarHost unit tests.
 *
 * ToolbarHost owns the intrinsic DOM strip at the very top of the grid
 * (above the top status bar / pivot panel / row group panel). It is
 * plain DOM chrome — not a canvas element — and reports its reserved
 * height back through `ToolbarGridContext.setReservedSpace('top', h)`
 * exactly like the status-bar / row-group-panel hosts, so the grid's
 * inset chain shifts every sibling strip + the canvas body down in
 * lock-step.
 *
 * jsdom has no layout, so `getBoundingClientRect().height` is 0 and the
 * host falls back to the explicit `toolbarHeight` option or the 40px
 * default — the tests pin that contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolbarHost, type ToolbarGridContext } from '../src/interaction/toolbar/host';
import type { CGridEvent } from '../src/types/event';

function makeContext() {
  const reserveCalls: Array<{ side: 'top'; height: number }> = [];
  const events: CGridEvent[] = [];
  const ctx: ToolbarGridContext = {
    setReservedSpace(side, height) {
      reserveCalls.push({ side, height });
    },
    emit(event) {
      events.push(event);
    },
  };
  return { ctx, reserveCalls, events };
}

function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

describe('ToolbarHost', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  it('mounts the strip with start/end zones and the intrinsic controls', () => {
    const { ctx } = makeContext();
    new ToolbarHost(root, ctx);
    const bar = root.querySelector('.cg-toolbar');
    expect(bar).not.toBeNull();
    expect(bar!.querySelector('.cg-toolbar-start')).not.toBeNull();
    const end = bar!.querySelector('.cg-toolbar-end')!;
    const date = end.querySelector('.cg-toolbar-date') as HTMLInputElement;
    const save = end.querySelector('.cg-toolbar-save') as HTMLButtonElement;
    expect(date).not.toBeNull();
    expect(date.type).toBe('date');
    expect(date.value).toBe(todayIso());
    expect(save).not.toBeNull();
    expect(save.getAttribute('aria-label')).toBe('Save');
    // Icon is an inline SVG stroked in currentColor (Lucide source set).
    expect(save.querySelector('svg.cg-toolbar-ic path')).not.toBeNull();
  });

  it('reserves the default 40px on mount (jsdom measure fallback)', () => {
    const { ctx, reserveCalls } = makeContext();
    new ToolbarHost(root, ctx);
    expect(reserveCalls).toEqual([{ side: 'top', height: 40 }]);
  });

  it('honors an explicit height option in the reservation', () => {
    const { ctx, reserveCalls } = makeContext();
    const host = new ToolbarHost(root, ctx, { height: 56 });
    expect(reserveCalls.at(-1)).toEqual({ side: 'top', height: 56 });
    expect(host.getElement().style.height).toBe('56px');
  });

  it('updateHeight re-reports; undefined reverts to the token default', () => {
    const { ctx, reserveCalls } = makeContext();
    const host = new ToolbarHost(root, ctx, { height: 56 });
    host.updateHeight(32);
    expect(reserveCalls.at(-1)).toEqual({ side: 'top', height: 32 });
    expect(host.getElement().style.height).toBe('32px');
    host.updateHeight(undefined);
    expect(reserveCalls.at(-1)).toEqual({ side: 'top', height: 40 });
    expect(host.getElement().style.height).toBe('');
  });

  it('setVisible(false) releases the inset; setVisible(true) restores it', () => {
    const { ctx, reserveCalls } = makeContext();
    const host = new ToolbarHost(root, ctx);
    host.setVisible(false);
    expect(host.isVisible()).toBe(false);
    expect(host.getElement().style.display).toBe('none');
    expect(reserveCalls.at(-1)).toEqual({ side: 'top', height: 0 });
    host.setVisible(true);
    expect(host.isVisible()).toBe(true);
    expect(reserveCalls.at(-1)).toEqual({ side: 'top', height: 40 });
    // Same-value set is a no-op (no duplicate reservation).
    const count = reserveCalls.length;
    host.setVisible(true);
    expect(reserveCalls.length).toBe(count);
  });

  it('save click runs handlers and emits toolbarSave with the picker date', () => {
    const { ctx, reserveCalls: _r, events } = makeContext();
    const host = new ToolbarHost(root, ctx);
    const seen: string[] = [];
    host.onSave(() => seen.push('a'));
    host.onSave(() => seen.push('b'));
    host.setDate('2026-06-30');
    (root.querySelector('.cg-toolbar-save') as HTMLButtonElement).click();
    expect(seen).toEqual(['a', 'b']);
    expect(events).toEqual([{ type: 'toolbarSave', date: '2026-06-30' }]);
  });

  it('date change runs handlers + emits; programmatic setDate stays silent', () => {
    const { ctx, events } = makeContext();
    const host = new ToolbarHost(root, ctx);
    const seen: string[] = [];
    host.onDateChange((iso) => seen.push(iso));
    host.setDate('2026-01-15');
    expect(seen).toEqual([]);
    expect(events).toEqual([]);
    const input = root.querySelector('.cg-toolbar-date') as HTMLInputElement;
    input.value = '2026-02-01';
    input.dispatchEvent(new Event('change'));
    expect(seen).toEqual(['2026-02-01']);
    expect(events).toEqual([{ type: 'toolbarDateChanged', date: '2026-02-01' }]);
    expect(host.getDate()).toBe('2026-02-01');
  });

  it('start-zone builders append in order; clear() keeps intrinsic controls', () => {
    const { ctx } = makeContext();
    const host = new ToolbarHost(root, ctx);
    const clicks: string[] = [];
    host.addButton('Refresh', () => clicks.push('refresh'));
    host.addDivider();
    host.addIconButton('save-all', () => clicks.push('icon'), { title: 'Save all' });
    host.addSpacer();
    host.addContent('<em>custom</em>');
    const start = root.querySelector('.cg-toolbar-start')!;
    expect(Array.from(start.children).map((c) => c.className)).toEqual([
      'cg-toolbar-button',
      'cg-toolbar-divider',
      'cg-toolbar-icon-button',
      'cg-toolbar-spacer',
      'cg-toolbar-content',
    ]);
    (start.children[0] as HTMLButtonElement).click();
    (start.children[2] as HTMLButtonElement).click();
    expect(clicks).toEqual(['refresh', 'icon']);
    expect((start.children[2] as HTMLButtonElement).getAttribute('aria-label')).toBe('Save all');
    host.clear();
    expect(start.children.length).toBe(0);
    // Intrinsic end-zone controls survive a clear.
    expect(root.querySelector('.cg-toolbar-date')).not.toBeNull();
    expect(root.querySelector('.cg-toolbar-save')).not.toBeNull();
  });

  it('destroy releases the inset, removes the DOM, and is idempotent', () => {
    const { ctx, reserveCalls } = makeContext();
    const host = new ToolbarHost(root, ctx);
    host.destroy();
    expect(reserveCalls.at(-1)).toEqual({ side: 'top', height: 0 });
    expect(root.querySelector('.cg-toolbar')).toBeNull();
    expect(host.isVisible()).toBe(false);
    expect(host.getReservedHeight()).toBe(0);
    const count = reserveCalls.length;
    host.destroy();
    expect(reserveCalls.length).toBe(count);
  });
});
