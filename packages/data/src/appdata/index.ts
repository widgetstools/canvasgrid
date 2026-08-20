/**
 * AppData slice of @wellsfargo-starui/velocity-grid-data — Markets-compatible
 * AppData store + `{{name.key}}` resolver.
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
  PersistedAppDataStore,
  LocalStorageAppDataStore,
  appDataStorageKey,
  APPDATA_STORAGE_PREFIX,
  type PersistedAppDataStoreOptions,
} from './localStorageStore';
