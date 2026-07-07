import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { CGridExt } from '../src/cgridExt';
import type { SettingsModule } from '../src/extension/types';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

const opts = () => ({
  getRowId: (r: any) => r.a,
  columnDefs: [{ colId: 'a', field: 'a' }],
  rowData: [{ a: 1 }],
} as any);

describe('CGridExt', () => {
  it('constructs a grid inside the shell and exposes .grid', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new CGridExt(host, opts());
    // ShellLayout marks its own container with `cgext-root` (see shell.ts);
    // since CGridExt hands ShellLayout the `host` container directly, the
    // class lands on `host` itself, not a descendant — querySelector can't
    // match the element it's called on, so assert via classList instead.
    expect(host.classList.contains('cgext-root')).toBe(true);
    expect(host.querySelector('.cgext-grid')).toBeTruthy();
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
    const ext = new CGridExt(host, { ...opts(), ext: { extensions: [mod] } });
    ext.openSettings('demo');
    expect(mounted).toHaveBeenCalled();
    expect(host.querySelector('.cgext-sheet')!.textContent).toContain('demo-panel');
    ext.destroy();
  });
});
