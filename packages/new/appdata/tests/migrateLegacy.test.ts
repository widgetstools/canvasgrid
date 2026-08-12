import { describe, expect, it } from 'vitest';
import { migrateLegacyPersistence } from '../src/migrateLegacy';

describe('migrateLegacyPersistence', () => {
  it('copies legacy keys when new keys are absent', () => {
    localStorage.clear();
    localStorage.setItem('vg-appdata', JSON.stringify({ env: { x: 1 } }));
    localStorage.setItem('vg-appdata:ns', JSON.stringify({ a: { b: 2 } }));
    localStorage.setItem('vg-data:provider-catalog', JSON.stringify([{ id: 'p1' }]));
    localStorage.setItem('velocity-grid:instance:g1', JSON.stringify({ version: 1 }));
    localStorage.setItem('cgrid-ssrm:feed-stop:positions', '42');

    const r1 = migrateLegacyPersistence();
    expect(r1.copied).toEqual(expect.arrayContaining([
      'vg-appdata → vg-new:appdata',
      'vg-appdata:ns → vg-new:appdata:ns',
      'vg-data:provider-catalog → vg-new:provider-catalog',
      'velocity-grid:instance:g1 → vg-new:instance:g1',
      'cgrid-ssrm:feed-stop:positions → vg-new:feed-stop:positions',
    ]));
    expect(localStorage.getItem('vg-new:appdata')).toContain('"x":1');
    expect(localStorage.getItem('vg-new:feed-stop:positions')).toBe('42');

    const r2 = migrateLegacyPersistence();
    expect(r2.copied).toHaveLength(0);
    expect(r2.skipped.some((s) => s.includes('dest exists'))).toBe(true);
  });

  it('does not overwrite existing new keys', () => {
    localStorage.clear();
    localStorage.setItem('vg-appdata', JSON.stringify({ legacy: true }));
    localStorage.setItem('vg-new:appdata', JSON.stringify({ neu: true }));
    migrateLegacyPersistence();
    expect(JSON.parse(localStorage.getItem('vg-new:appdata')!)).toEqual({ neu: true });
  });
});
