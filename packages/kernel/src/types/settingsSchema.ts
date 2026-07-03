/**
 * Cycle 21i / Phase 1 (T3) — declarative settings schema.
 *
 * One schema vocabulary drives every native settings surface (the Grid
 * Options tool panel first; host-app Custom Settings sections later per
 * decision D-G). A schema is data — sections → bands → fields — with live
 * `get`/`set` closures per field, rendered by the vanilla
 * `interaction/settingsForm` renderer. Field types are deliberately
 * limited to the D-G vocabulary: switch | checkbox | text | number |
 * select.
 */

export type SettingsFieldType = 'switch' | 'checkbox' | 'text' | 'number' | 'select';

export interface SettingsSelectOption {
  value: string;
  label: string;
}

export interface SettingsField {
  /** Stable key — unique within the section; used for search + tests. */
  key: string;
  label: string;
  type: SettingsFieldType;
  /** Optional single-line hint rendered under the label. */
  hint?: string;
  /** Select choices (type: 'select' only). */
  options?: SettingsSelectOption[];
  /** Numeric constraints (type: 'number' only). */
  min?: number;
  max?: number;
  step?: number;
  /** The value this field is considered UNMODIFIED at. Drives the
   *  modified diff-rail + per-band counts + "modified only" filter.
   *  `undefined` means "kernel default in effect". A FUNCTION form is
   *  re-evaluated on every check — for defaults that track live state
   *  (e.g. row height following the density bundle). */
  defaultValue?: unknown | (() => unknown);
  /** Read the live value. `undefined` renders as the default. */
  get(): unknown;
  /** Write a new value. Called on every control commit. */
  set(value: unknown): void;
}

export interface SettingsBand {
  id: string;
  title: string;
  fields: SettingsField[];
  /** Collapsed on first render. Default false. */
  collapsed?: boolean;
}

export interface SettingsSection {
  id: string;
  title: string;
  bands: SettingsBand[];
}

/** Resolve a field's default, evaluating the dynamic (function) form. */
export function resolveFieldDefault(field: SettingsField): unknown {
  return typeof field.defaultValue === 'function'
    ? (field.defaultValue as () => unknown)()
    : field.defaultValue;
}

/** True when the field's live value differs from its declared default.
 *  Loose-equality on JSON-primitive settings values; `undefined`/`null`
 *  both read as "default in effect". */
export function isFieldModified(field: SettingsField): boolean {
  const value = field.get();
  const def = resolveFieldDefault(field);
  const norm = (v: unknown) => (v === undefined || v === null ? undefined : v);
  return norm(value) !== norm(def);
}
