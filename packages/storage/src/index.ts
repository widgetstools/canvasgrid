export type { IStorage, StorageOpts } from './types';
export { LocalStore } from './localStore';
export { MemoryStore } from './memoryStore';
export { RestStore, type RestStoreOptions } from './restStore';
export {
  storageGet,
  storageSet,
  storageRemove,
  storageGetSync,
  storageSetSync,
  storageRemoveSync,
  getJson,
  setJson,
  getJsonSync,
  setJsonSync,
} from './helpers';
