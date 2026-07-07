import type { CgExtension, ToolbarItem, CgExtContext } from './extension/types';
import { gridOptionsModule } from './modules/gridOptions';

/** A tiny helper for building an icon button toolbar item. */
function button(id: string, label: string, onClick: (ctx: CgExtContext) => void): ToolbarItem {
  return {
    id, kind: 'toolbar-item', slot: 'primary-right', init() {},
    render(host, ctx) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgext-btn';
      b.textContent = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => onClick(ctx));
      host.appendChild(b);
      return { destroy() { host.replaceChildren(); } };
    },
  };
}

/** Save button whose enabled/label state follows the profiles dirty flag. */
function saveButton(): ToolbarItem {
  return {
    id: 'save', kind: 'toolbar-item', slot: 'primary-right', init() {},
    render(host, ctx) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cgext-btn cgext-save';
      const sync = (dirty: boolean) => {
        b.textContent = dirty ? 'Save*' : 'Save';
        b.disabled = !dirty;
      };
      sync(ctx.profiles.isDirty());
      const off = ctx.profiles.onDirtyChange(sync);
      b.addEventListener('click', () => { void ctx.profiles.save(); });
      host.appendChild(b);
      return { destroy() { off(); host.replaceChildren(); } };
    },
  };
}

/** The built-in extension set CGridExt registers before consumer specs.
 *  The settings launcher needs a way to open the sheet; it emits an ext
 *  event the shell subscribes to via CGridExt (see registerDefaults). */
export function buildDefaultBundle(): CgExtension[] {
  const launcher = button('settings-launcher', 'Settings', (ctx) =>
    ctx.events.emit({ type: 'open-settings', id: 'grid-options' }));
  return [launcher, saveButton(), gridOptionsModule()];
}
