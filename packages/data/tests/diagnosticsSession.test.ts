import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryConfigBackend } from '../src/catalog/ConfigBackend';
import { createDiagnosticsSession } from '../src/editor/diagnosticsSession';
import { mountProviderEditor } from '../src/editor/ProviderEditor';
import { _resetHubConnectionForTests } from '../src/client/hubConnection';
import { _resetTransportRegistryForTests } from '../src/registry/transports';
import { _resetDefaultTransportsFlagForTests } from '../src/transports/registerDefaults';
import {
  registerDataProviderFeedControl,
  _resetDataProviderFeedControlsForTests,
} from '../src/feedControlRegistry';
import type { DataProviderConfig } from '../src/types';

function reset(): void {
  _resetHubConnectionForTests();
  _resetTransportRegistryForTests();
  _resetDefaultTransportsFlagForTests();
  _resetDataProviderFeedControlsForTests();
}

afterEach(reset);

function mockCfg(id: string): DataProviderConfig {
  return {
    providerId: id,
    name: id,
    providerType: 'mock',
    rowModel: 'clientSide',
    config: {
      keyColumn: 'positionId',
      rowCount: 15,
      tickMs: 0,
      shape: 'positions',
      throttleEnabled: false,
    },
  };
}

describe('diagnosticsSession', () => {
  it('ensure + stop update stats/status', async () => {
    reset();
    const session = createDiagnosticsSession({ inProcess: true });
    const updates: string[] = [];
    session.subscribe((s) => updates.push(s.status));

    await session.ensure(mockCfg('diag-1'));
    await new Promise((r) => setTimeout(r, 40));
    const live = session.getState();
    expect(live.stats.rowCount).toBe(15);
    expect(live.status).toBe('ready');

    await session.stop();
    expect(session.getState().status).toBe('idle');
    expect(session.getState().stats.rowCount).toBe(0);

    session.destroy();
  });

  it('stop also invokes registered non-hub feed controls (Perspective bridge)', async () => {
    reset();
    const stop = vi.fn();
    const restart = vi.fn();
    registerDataProviderFeedControl('diag-psp-1', { stop, restart });

    const session = createDiagnosticsSession({ inProcess: true });
    await session.ensure(mockCfg('diag-psp-1'));
    await session.stop();
    expect(stop).toHaveBeenCalledTimes(1);

    await session.restart(mockCfg('diag-psp-1'));
    expect(restart).toHaveBeenCalledTimes(1);

    session.destroy();
  });
});

describe('ProviderEditor Diagnostics tab', () => {
  it('wires Restart/Stop and paints live stats', async () => {
    reset();
    const backend = new MemoryConfigBackend();
    const cfg = mockCfg('diag-editor-1');
    await backend.save(cfg);

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const editor = mountProviderEditor({
      mount,
      backend,
      initial: cfg,
      hubOpts: { inProcess: true },
    });

    const diagTab = Array.from(mount.querySelectorAll('button')).find(
      (b) => b.textContent === 'Diagnostics',
    );
    expect(diagTab).toBeTruthy();
    diagTab!.click();

    await new Promise((r) => setTimeout(r, 80));
    const rowsEl = mount.querySelector('[data-diag-stat="rowCount"]');
    expect(rowsEl?.textContent).not.toBe('—');
    expect(Number(rowsEl?.textContent?.replace(/,/g, ''))).toBeGreaterThan(0);

    const stop = Array.from(mount.querySelectorAll('button')).find((b) => b.textContent === 'Stop');
    expect(stop).toBeTruthy();
    stop!.click();
    await new Promise((r) => setTimeout(r, 40));
    expect(mount.querySelector('[data-diag="badge"]')?.textContent?.toLowerCase()).toContain('idle');

    editor.destroy();
    mount.remove();
  });
});
