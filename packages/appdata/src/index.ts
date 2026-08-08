/**
 * @wellsfargo-starui/velocity-grid-appdata — Markets-compatible AppData store + `{{name.key}}` resolver.
 *
 * Future package name under VelocityGrid:
 *   `@wellsfargo-starui/velocity-grid-data` (AppData slice)
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
