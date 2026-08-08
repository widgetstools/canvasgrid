import type { VelocityGridExtension, ToolbarItem, VelocityGridExtContext } from './extension/types';
import { gridOptionsModule } from './modules/gridOptions';
import { columnGroupsModule } from './modules/columnGroups';
import { columnSettingsModule } from './modules/columnSettings';
import { conditionalStylingModule } from './modules/conditionalStyling';
import { calculatedColumnsModule } from './modules/calculatedColumns';
import { dataChangeHistoryModule } from './modules/dataChangeHistory';
import { alertsModule } from './modules/alerts';
import { smartEditModule } from './modules/smartEdit';
import { bulkUpdateModule } from './modules/bulkUpdate';
import { plusMinusModule } from './modules/plusMinus';
import { shortcutsModule } from './modules/shortcuts';

/** A tiny helper for building an icon button toolbar item. */
function button(id: string, label: string, onClick: (ctx: VelocityGridExtContext) => void): ToolbarItem {
  return {
    id, kind: 'toolbar-item', slot: 'primary-right', init() {},
    render(host, ctx) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vgext-btn';
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
      b.className = 'vgext-btn vgext-save';
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

/** The built-in extension set VelocityGridExt registers before consumer specs. */
export function buildDefaultBundle(): VelocityGridExtension[] {
  const launcher = button('settings-launcher', 'Settings', (ctx) =>
    ctx.events.emit({ type: 'open-settings', id: 'grid-options' }));
  return [
    launcher,
    saveButton(),
    gridOptionsModule(),
    columnGroupsModule(),
    columnSettingsModule(),
    conditionalStylingModule(),
    alertsModule(),
    calculatedColumnsModule(),
    smartEditModule(),
    bulkUpdateModule(),
    plusMinusModule(),
    shortcutsModule(),
    dataChangeHistoryModule(),
  ];
}
