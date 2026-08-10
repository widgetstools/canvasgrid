import { describe, expect, it } from 'vitest';
import { MemoryConfigBackend, mountDataProviderEditor, registerDefaultTransports } from '../src/index';
import { createJsonImportModal } from '../src/editor/ui';

function fireDropOn(el: Element, file: File): void {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
  el.dispatchEvent(ev);
}

describe('Import via paste modal (no native file dialog)', () => {
  it('dropping a .json file ANYWHERE on the modal populates the paste area + imports', async () => {
    let submitted: string | null = null;
    const overlay = createJsonImportModal({
      title: 'Import provider',
      testId: 'imp',
      onSubmit: (text) => { submitted = text; },
      onClose: () => overlay.remove(),
    });
    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('[data-testid="imp-textarea"]') as HTMLTextAreaElement;
    const json = '{"name":"Dropped","providerType":"mock","config":{}}';

    // Drop on the overlay itself (e.g. the modal padding), not the textarea —
    // this is the case that previously navigated the window instead of importing.
    fireDropOn(overlay, new File([json], 'p.json', { type: 'application/json' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(textarea.value, 'drop on overlay populates the paste area').toBe(json);

    (overlay.querySelector('[data-testid="imp-submit"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(submitted, 'Import submits the dropped content').toBe(json);
  });


  it('sidebar Import opens a paste modal; pasting valid JSON imports the provider', async () => {
    registerDefaultTransports();
    const backend = new MemoryConfigBackend();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const shell = mountDataProviderEditor({ mount, backend, initialProviderId: null });
    await new Promise((r) => setTimeout(r, 20));

    // No hidden file input anywhere in the sidebar anymore.
    const actions = mount.querySelector('.vg-dp-shell__sidebar-actions')!;
    expect(actions.querySelector('input[type="file"]')).toBeNull();

    const importBtn = Array.from(actions.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Import') as HTMLButtonElement;
    importBtn.click();

    // Modal appears with a paste area.
    const dialog = mount.querySelector('[data-testid="provider-import-dialog"]');
    expect(dialog, 'import dialog present').toBeTruthy();
    const textarea = mount.querySelector('[data-testid="provider-import-dialog-textarea"]') as HTMLTextAreaElement;
    expect(textarea, 'paste textarea present').toBeTruthy();

    // Paste a valid provider export and submit.
    textarea.value = JSON.stringify({ name: 'Pasted provider', providerType: 'mock', config: {} });
    textarea.dispatchEvent(new Event('input'));
    const submit = mount.querySelector('[data-testid="provider-import-dialog-submit"]') as HTMLButtonElement;
    submit.click();
    await new Promise((r) => setTimeout(r, 30));

    const all = await backend.list();
    expect(all.some((p) => p.name === 'Pasted provider')).toBe(true);

    shell.destroy();
    mount.remove();
  });

  it('invalid JSON shows an inline error and keeps the modal open', async () => {
    registerDefaultTransports();
    const backend = new MemoryConfigBackend();
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const shell = mountDataProviderEditor({ mount, backend, initialProviderId: null });
    await new Promise((r) => setTimeout(r, 20));

    const actions = mount.querySelector('.vg-dp-shell__sidebar-actions')!;
    (Array.from(actions.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Import') as HTMLButtonElement).click();
    const textarea = mount.querySelector('[data-testid="provider-import-dialog-textarea"]') as HTMLTextAreaElement;
    textarea.value = 'not json{';
    textarea.dispatchEvent(new Event('input'));
    (mount.querySelector('[data-testid="provider-import-dialog-submit"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));

    expect(mount.querySelector('[data-testid="provider-import-dialog"]'), 'modal stays open').toBeTruthy();
    const err = mount.querySelector('.vg-dp-import-error') as HTMLElement;
    expect(err && !err.hidden, 'inline error shown').toBe(true);

    shell.destroy();
    mount.remove();
  });
});
