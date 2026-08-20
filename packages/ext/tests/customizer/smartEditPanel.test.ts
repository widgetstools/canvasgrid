/**
 * Cycle 21i Phase 2 / T6 — Smart Edit panel unit tests.
 *
 * The panel is a pure view over `EditBridgeHandle.getSettings().smartEdit`
 * with immediate-apply writes through `updateSettings`. A fake handle
 * (real `mergeEditSettings` semantics) stands in for the engine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeEditSettings, type EditBridgeHandle, type EditSettings } from '../../src/edit/index';
import { smartEditToolPanel } from '../../src/customizer/panels/smartEdit';

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
        smartEdit: { ...settings.smartEdit, ...partial?.smartEdit },
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
  const Ctor = smartEditToolPanel(() => handle);
  const instance = new Ctor();
  instance.init({ api: {} } as never);
  document.body.appendChild(instance.getGui());
  await flushLit();
  const el = instance.getGui().firstElementChild as HTMLElement & { shadowRoot: ShadowRoot };
  await flushLit();
  return { instance, el };
}

describe('SmartEditPanel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders the three doc bands with current engine settings', async () => {
    const { handle } = makeHandle();
    const { el } = await mountPanel(handle);
    const bands = Array.from(el.shadowRoot.querySelectorAll('cgc-band')).map((b) => b.getAttribute('band-title'));
    expect(bands).toEqual(['Global', 'Operations', 'Safety']);
    const fields = Array.from(el.shadowRoot.querySelectorAll('cgc-field')).map((f) => f.getAttribute('label'));
    expect(fields).toEqual([
      'Enabled', 'Increment step', 'K/M/B shortcuts',
      'Toolbar ops',
      'Confirm above', 'Single column', 'Preview before apply', 'Record history',
    ]);
    // All five ops enabled by default.
    const pressed = Array.from(el.shadowRoot.querySelectorAll('.ops button')).map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'true', 'true', 'true', 'true']);
  });

  it('switch flip writes an immediate-apply patch and re-renders modified state', async () => {
    const { handle, patches } = makeHandle();
    const { el } = await mountPanel(handle);
    const enabledField = el.shadowRoot.querySelector('cgc-field[label="Enabled"]')!;
    const sw = enabledField.querySelector('cgc-switch') as HTMLElement & { shadowRoot: ShadowRoot };
    await flushLit();
    (sw.shadowRoot.querySelector('input.vg-checkbox') as HTMLInputElement).click();
    await flushLit();
    expect(patches).toEqual([{ smartEdit: { enabled: false } }]);
    expect(handle.getSettings().smartEdit.enabled).toBe(false);
    expect(enabledField.hasAttribute('modified')).toBe(true);
  });

  it('op toggles flip membership but never empty the set', async () => {
    const { handle } = makeHandle();
    const { el } = await mountPanel(handle);
    const buttons = () => Array.from(el.shadowRoot.querySelectorAll('.ops button')) as HTMLButtonElement[];
    // Turn off all but 'set' (last).
    for (let i = 0; i < 4; i++) {
      buttons()[i]!.click();
      await flushLit();
    }
    expect(handle.getSettings().smartEdit.enabledOps).toEqual(['set']);
    // The last op refuses to turn off.
    buttons()[4]!.click();
    await flushLit();
    expect(handle.getSettings().smartEdit.enabledOps).toEqual(['set']);
    expect(buttons()[4]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the not-wired notice when the handle getter returns undefined', async () => {
    const { el } = await mountPanel(undefined);
    expect(el.shadowRoot.querySelector('.empty')!.textContent).toContain('wireEditIntoKernel');
  });
});
