/**
 * Grid Options — settings-sheet module wrapping the kernel's native
 * `GridOptionsToolPanel` (same UI as the former side-bar Options tab).
 */
import { GridOptionsToolPanel } from '@wellsfargo-starui/velocity-grid';
import type { SettingsModule } from '../extension/types';
import { mountToolPanel } from './toolPanelHost';

export function gridOptionsModule(): SettingsModule {
  return {
    id: 'grid-options',
    kind: 'settings-module',
    title: 'Options',
    icon: 'sliders-horizontal',
    category: 'layout',

    init(): void { /* panel owns its own chrome */ },

    mount(host, ctx) {
      return mountToolPanel(GridOptionsToolPanel, host, ctx);
    },
  };
}
