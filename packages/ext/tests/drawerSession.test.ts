import { describe, expect, it } from 'vitest';
import { DrawerSession } from '../src/profiles/drawerSession';

describe('DrawerSession', () => {
  it('stages per module and reports a live pending count', () => {
    const s = new DrawerSession();
    const seen: number[] = [];
    s.onChange(() => seen.push(s.pendingCount()));

    expect(s.isDirty()).toBe(false);
    s.stage('column-settings');
    s.stage('styling-rules', { id: 'r1' });
    expect(s.isDirty()).toBe(true);
    expect(s.pendingCount()).toBe(2);
    expect(seen).toEqual([1, 2]);

    s.unstage('column-settings');
    expect(s.pendingCount()).toBe(1);
    s.clear();
    expect(s.isDirty()).toBe(false);
    expect(s.pendingCount()).toBe(0);
  });
});
