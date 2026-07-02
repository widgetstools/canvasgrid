// @cgrid/renderers — action category tests (Cycle 21f / Task 12).

import { describe, it, expect, beforeEach } from 'vitest';
import type { CellPaintConfig } from '@cgrid/kernel';
import { makeFakeGc } from './helpers/fakeGc';
import type { FakeGc } from './helpers/fakeGc';
import {
  iconActionCluster, rowMenuCell, HitRegionRegistry, resolveHitRegion,
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

  it('paints icons only when hovered (nominal)', () => {
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

  it('no paint when not hovered (edge)', () => {
    iconActionCluster.paint(gc, baseConfig({
      isHovered: false,
      params: { actions: [{ icon: 'x', label: 'Cancel', onAction: () => {} }] },
    }));
    expect(gc.calls.filter((c) => c.op === 'fillText').length).toBe(0);
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
});
