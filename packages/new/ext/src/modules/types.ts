import type { Disposable } from '@wellsfargo-starui/vg-new-ui';
import type { VelocityGridApi } from '@wellsfargo-starui/vg-new-grid';
import type { ConfigSession } from '../profiles/configSession';

export type CustomizeCategory = 'layout' | 'data' | 'format' | 'editing' | 'workspace';

export type ExtContext = {
  gridApi: VelocityGridApi;
  session: ConfigSession;
  markDirty: () => void;
};

export type SettingsModule = {
  id: string;
  kind: 'settings';
  category: CustomizeCategory;
  label: string;
  mount(host: HTMLElement, ctx: ExtContext): Disposable;
};
