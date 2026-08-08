/**
 * Cycle 21i Phase 2 / T7 — Bulk Update panel unit tests.
 * Mirrors smartEditPanel.test.ts: pure view over
 * `EditBridgeHandle.getSettings().bulkUpdate`, immediate-apply writes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeEditSettings, type EditBridgeHandle, type EditSettings } from '@wellsfargo-starui/velocity-grid-edit';
import { bulkUpdateToolPanel } from '../src/panels/bulkUpdate';

function makeHandle() {
  let settings: EditSettings = mergeEditSettings();
  const patches: unknown[] = [];
  const handle = {
    getSettings: () => settings,
    updateSettings: (partial: any) => {
      patches.push(partial);
      settings = mergeEditSettings({
        ...settings,
        ...partial,
        bulkUpdate: { ...settings.bulkUpdate, ...partial?.bulkUpdate },
      } as any);
    },
  } as unknown as EditBridgeHandle;
  return { handle, patches };
}

async function flushLit(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function mountPanel(handle: EditBridgeHandle | undefined) {
  const Ctor = bulkUpdateToolPanel(() => handle);
  const instance = new Ctor();
  instance.init({ api: {} } as never);
  document.body.appendChild(instance.getGui());
  await flushLit();
  const el = instance.getGui().firstElementChild as HTMLElement & { shadowRoot: ShadowRoot };
  await flushLit();
  return { instance, el };
}

describe('BulkUpdatePanel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders the two doc bands with the engine defaults', async () => {
    const { handle } = makeHandle();
    const { el } = await mountPanel(handle);
    const bands = Array.from(el.shadowRoot.querySelectorAll('cgc-band')).map((b) => b.getAttribute('band-title'));
    expect(bands).toEqual(['Global', 'Dropdown']);
    const fields = Array.from(el.shadowRoot.querySelectorAll('cgc-field')).map((f) => f.getAttribute('label'));
    expect(fields).toEqual([
      'Enabled', 'Confirm above', 'Single column', 'Record history',
      'Distinct values', 'Max dropdown',
    ]);
  });

  it('number change writes an immediate-apply patch and marks the row modified', async () => {
    const { handle, patches } = makeHandle();
    const { el } = await mountPanel(handle);
    const maxField = el.shadowRoot.querySelector('cgc-field[label="Max dropdown"]')!;
    const num = maxField.querySelector('cgc-number') as HTMLElement & { shadowRoot: ShadowRoot };
    await flushLit();
    const input = num.shadowRoot.querySelector('input') as HTMLInputElement;
    input.value = '50';
    input.dispatchEvent(new Event('change'));
    await flushLit();
    expect(patches).toEqual([{ bulkUpdate: { maxDropdownValues: 50 } }]);
    expect(handle.getSettings().bulkUpdate.maxDropdownValues).toBe(50);
    expect(maxField.hasAttribute('modified')).toBe(true);
  });

  it('renders the not-wired notice without a handle', async () => {
    const { el } = await mountPanel(undefined);
    expect(el.shadowRoot.querySelector('.empty')!.textContent).toContain('wireEditIntoKernel');
  });
});
