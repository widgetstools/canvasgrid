export { FIELD_FORMAT_CATALOG } from './catalog';
export {
  matchFieldToCatalog,
  buildAutoFormatPlan,
  normalizeToken,
  soundex,
} from './match';
export { runAutoFormat, type AutoFormatGrid, type AutoFormatHost } from './apply';
export type {
  AutoFormatAlignment,
  AutoFormatAssignment,
  AutoFormatColumn,
  FieldFormatEntry,
} from './types';
