// @cgrid/renderers — action category tests (Cycle 21f / Task 12).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import {
  iconActionCluster, rowMenuCell, HitRegionRegistry, resolveHitRegion,
  defaultHitRegionRegistry, clearRegionsForRow, setActionIconResolver,
} from '../src/actions';

function baseConfig(overrides: Partial<CellPaintConfig> = {}): CellPaintConfig {
  return {
    value: null,
    valueFormatted: '',
    bounds: { x: 0, y: 0, w: 140, h: 28 },
    font: '13px Inter, sans-serif',
    fg: '#111111',
    bg: '#ffffff',
    borderColor: '#ccc',
    halign: 'right',
    prefillColor: '#ffffff',
    isFocused: false,
    isSelected: false,
    isHovered: false,
    isHeader: false,
    rowId: 'r1',
    colId: 'actions',
    ...overrides,
  };
}

describe('iconActionCluster', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints icons by default even when NOT hovered — kernel never threads isHovered:true (F1 nominal)', () => {
    iconActionCluster.paint(gc, baseConfig({
      isHovered: false,
      params: {
        actions: [
          { icon: 'x', label: 'Cancel', onAction: () => {} },
          { icon: 'route', label: 'Route', onAction: () => {} },
        ],
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(2);
  });

  it('also paints when hovered (nominal)', () => {
    iconActionCluster.paint(gc, baseConfig({
      isHovered: true,
      params: {
        actions: [
          { icon: 'x', label: 'Cancel', onAction: () => {} },
          { icon: 'route', label: 'Route', onAction: () => {} },
        ],
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(2);
  });

  it('revealOnHover:true + isHovered:false paints nothing (F1 opt-in gate, edge)', () => {
    iconActionCluster.paint(gc, baseConfig({
      isHovered: false,
      params: {
        revealOnHover: true,
        actions: [{ icon: 'x', label: 'Cancel', onAction: () => {} }],
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBe(0);
    expect(gc.calls.filter((c) => c.op === 'arc').length).toBe(0);
  });

  it('revealOnHover:true + isHovered:true paints (variant)', () => {
    iconActionCluster.paint(gc, baseConfig({
      isHovered: true,
      params: {
        revealOnHover: true,
        actions: [{ icon: 'x', label: 'Cancel', onAction: () => {} }],
      },
    }));
    expect(gc.calls.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(1);
  });

  it('registers 24×24 hit regions (variant)', () => {
    iconActionCluster.paint(gc, baseConfig({
      isHovered: true,
      rowId: 'r9',
      colId: 'act',
      params: { actions: [{ icon: 'x', label: 'Cancel', onAction: () => {} }] },
    }));
    const region = resolveHitRegion('r9', 'act', 130, 14);
    expect(region?.bounds.w).toBe(24);
    expect(region?.bounds.h).toBe(24);
  });

  // B2 — falls back to the letter-in-circle badge (no resolver wired, e.g.
  // this describe block never calls setActionIconResolver).
  it('falls back to the letter badge when no icon resolver is wired (B2 fallback)', () => {
    iconActionCluster.paint(gc, baseConfig({
      params: { actions: [{ icon: 'x', label: 'Cancel', onAction: () => {} }] },
    }));
    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'C')).toBe(true);
    // The hit-circle outline still strokes; only a resolved icon Path2D
    // (never present here, since no resolver is wired) would stroke.
    expect(gc.calls.some((c) => c.op === 'stroke' && c.args.length > 0)).toBe(false);
  });

  describe('with a wired icon resolver', () => {
    const fakePath = {} as Path2D;

    afterEach(() => { setActionIconResolver(null); });

    it('strokes the resolved Lucide Path2D instead of the letter badge (B2)', () => {
      setActionIconResolver((name) => (name === 'x' ? fakePath : null));
      iconActionCluster.paint(gc, baseConfig({
        params: { actions: [{ icon: 'x', label: 'Cancel', onAction: () => {} }] },
      }));
      expect(gc.calls.some((c) => c.op === 'stroke' && c.args[0] === fakePath)).toBe(true);
      expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'C')).toBe(false);
    });

    it('falls back to the letter badge when the icon name does not resolve (B2 unknown name)', () => {
      setActionIconResolver(() => null);
      iconActionCluster.paint(gc, baseConfig({
        params: { actions: [{ icon: 'not-a-real-icon', label: 'Cancel', onAction: () => {} }] },
      }));
      expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'C')).toBe(true);
    });
  });
});

describe('rowMenuCell', () => {
  let gc: FakeGc;
  beforeEach(() => { gc = makeFakeGc(); });

  it('paints kebab dots (nominal)', () => {
    rowMenuCell.paint(gc, baseConfig({ params: { onOpen: () => {} } }));
    expect(gc.calls.filter((c) => c.op === 'arc').length).toBe(3);
  });

  it('registers 20×20 hit region (edge)', () => {
    rowMenuCell.paint(gc, baseConfig({ rowId: 'r2', colId: 'menu', params: { onOpen: () => {} } }));
    const hit = resolveHitRegion('r2', 'menu', 130, 14);
    expect(hit?.bounds.w).toBe(20);
    expect(hit?.bounds.h).toBe(20);
  });

  it('resolveHitRegion returns undefined outside bounds (variant)', () => {
    const registry = new HitRegionRegistry();
    registry.register({
      rowId: 'r1', colId: 'c1', actionIndex: 0,
      bounds: { x: 10, y: 10, w: 24, h: 24 },
    });
    expect(resolveHitRegion('r1', 'c1', 5, 5, registry)).toBeUndefined();
    expect(resolveHitRegion('r1', 'c1', 15, 15, registry)?.actionIndex).toBe(0);
  });
});

describe('HitRegionRegistry', () => {
  it('clear removes cell regions', () => {
    const registry = new HitRegionRegistry();
    registry.register({
      rowId: 'a', colId: 'b', actionIndex: 0,
      bounds: { x: 0, y: 0, w: 10, h: 10 },
    });
    registry.clear('a', 'b');
    expect(registry.resolve('a', 'b', 5, 5)).toBeUndefined();
  });

  it('clearForRow evicts every colId registered for that rowId, leaves other rows alone (F3)', () => {
    const registry = new HitRegionRegistry();
    registry.register({ rowId: 'r1', colId: 'actions', actionIndex: 0, bounds: { x: 0, y: 0, w: 10, h: 10 } });
    registry.register({ rowId: 'r1', colId: 'menu', actionIndex: 0, bounds: { x: 0, y: 0, w: 10, h: 10 } });
    registry.register({ rowId: 'r2', colId: 'menu', actionIndex: 0, bounds: { x: 0, y: 0, w: 10, h: 10 } });
    registry.clearForRow('r1');
    expect(registry.resolve('r1', 'actions', 5, 5)).toBeUndefined();
    expect(registry.resolve('r1', 'menu', 5, 5)).toBeUndefined();
    expect(registry.resolve('r2', 'menu', 5, 5)?.rowId).toBe('r2');
  });

  it('does not confuse rowIds that are string-prefixes of one another (F3 edge)', () => {
    const registry = new HitRegionRegistry();
    registry.register({ rowId: 'r1', colId: 'menu', actionIndex: 0, bounds: { x: 0, y: 0, w: 10, h: 10 } });
    registry.register({ rowId: 'r10', colId: 'menu', actionIndex: 0, bounds: { x: 0, y: 0, w: 10, h: 10 } });
    registry.clearForRow('r1');
    expect(registry.resolve('r1', 'menu', 5, 5)).toBeUndefined();
    expect(registry.resolve('r10', 'menu', 5, 5)?.rowId).toBe('r10');
  });

  it('clearRegionsForRow evicts on the shared default registry (F3)', () => {
    defaultHitRegionRegistry.register({
      rowId: 'shared-1', colId: 'menu', actionIndex: 0, bounds: { x: 0, y: 0, w: 10, h: 10 },
    });
    clearRegionsForRow('shared-1');
    expect(resolveHitRegion('shared-1', 'menu', 5, 5)).toBeUndefined();
  });
});
