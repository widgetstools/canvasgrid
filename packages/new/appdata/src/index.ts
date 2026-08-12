/**
 * @wellsfargo-starui/vg-new-appdata — AppData bags + {{name.key}} resolver.
 * Persistence prefix: `vg-new:appdata`.
 */
export {
  resolveTemplate,
  resolveCfg,
  collectTemplateRefs,
  findUnresolvedAppDataTokens,
  assertAppDataResolved,
  type AppDataLookup,
} from './resolver';

export {
  AppDataStore,
  isAppDataStore,
  toAppDataLookup,
  type AppDataChange,
  type AppDataUnsubscribe,
} from './store';

export {
  LocalStorageAppDataStore,
  appDataStorageKey,
  APPDATA_STORAGE_PREFIX,
} from './localStorageStore';
