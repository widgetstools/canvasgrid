import type { Disposable } from '@wellsfargo-starui/vg-new-ui';
import type { VelocityGridApi } from '@wellsfargo-starui/vg-new-grid';
import type { AppDataLookup } from '@wellsfargo-starui/vg-new-appdata';
import type { ConfigBackend } from '@wellsfargo-starui/vg-new-data';
import type { ConfigSession, ValidateResult } from '../profiles/configSession';
import type { DataProviderController } from '@wellsfargo-starui/vg-new-data';

export type CustomizeCategory = 'layout' | 'data' | 'format' | 'editing' | 'workspace';

export type ExtContext = {
  gridApi: VelocityGridApi;
  session: ConfigSession;
  markDirty: () => void;
  /** Optional — injected by shell when host wires data plane. */
  dataProvider?: DataProviderController | null;
  catalog?: ConfigBackend | null;
  appData?: AppDataLookup | null;
  /** Convenience: validate + apply + toast errors. */
  validateAndApply: (
    moduleId: string,
    opts: {
      validate: (draft: unknown) => ValidateResult;
      apply: (draft: unknown) => void | Promise<void>;
      persist?: boolean;
    },
  ) => Promise<ValidateResult>;
};

export type SettingsModule = {
  id: string;
  kind: 'settings';
  category: CustomizeCategory;
  label: string;
  mount(host: HTMLElement, ctx: ExtContext): Disposable;
};
