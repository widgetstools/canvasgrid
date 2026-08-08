import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
import type { SettingsModule } from '../src/extension/types';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

const opts = () => ({
  getRowId: (r: any) => r.a,
  columnDefs: [{ colId: 'a', field: 'a' }],
  rowData: [{ a: 1 }],
} as any);

describe('VelocityGridExt', () => {
  it('constructs a grid inside the shell and exposes .grid', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, opts());
    // ShellLayout marks its own container with `vgext-root` (see shell.ts);
    // since VelocityGridExt hands ShellLayout the `host` container directly, the
    // class lands on `host` itself, not a descendant — querySelector can't
    // match the element it's called on, so assert via classList instead.
    expect(host.classList.contains('vgext-root')).toBe(true);
    expect(host.querySelector('.vgext-grid')).toBeTruthy();
    expect(ext.grid).toBeTruthy();
    expect(typeof ext.getState).toBe('function');
    ext.destroy();
  });

  it('mounts a consumer-provided settings module and opens it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = vi.fn();
    const mod: SettingsModule = {
      id: 'demo', kind: 'settings-module', title: 'Demo', icon: 'i', category: 'layout',
      init: vi.fn(),
      mount: (el) => { mounted(); el.textContent = 'demo-panel'; return { destroy() {} }; },
    };
    const ext = new VelocityGridExt(host, { ...opts(), ext: { extensions: [mod] } });
    ext.openSettings('demo');
    expect(mounted).toHaveBeenCalled();
    expect(host.querySelector('.vgext-sheet')!.textContent).toContain('demo-panel');
    ext.destroy();
  });
});
