/**
 * Column Groups — settings-sheet module wrapping the kernel's native
 * `ColumnGroupsToolPanel` (same UI as the former side-bar Column Groups tab).
 *
 * Passes the shared Formatting ribbon Font / Alignment / Borders chrome into
 * the panel so group header style editing matches the toolbar.
 */
import { ColumnGroupsToolPanel } from '@cgrid/kernel';
import type { SettingsModule } from '../extension/types';
import { mountToolPanel } from './toolPanelHost';
import { mountFormatterStyleChrome } from '../toolbar/styleChrome';

export function columnGroupsModule(): SettingsModule {
  return {
    id: 'column-groups',
    kind: 'settings-module',
    title: 'Column Groups',
    icon: 'columns',
    category: 'layout',

    init(): void { /* panel owns its own chrome + Apply persistence */ },

    mount(host, ctx) {
      return mountToolPanel(ColumnGroupsToolPanel, host, ctx, {
        mountStyleChrome: mountFormatterStyleChrome,
      });
    },
  };
}
