/**
 * Shared vanilla DOM UI kit for the data-provider editor.
 *
 * Prefer these factories over ad-hoc `document.createElement` for tabs,
 * buttons, search, switches, modals, cards, and fields so chrome stays
 * consistent and reusable across the shell + form tabs.
 */

export { el, setTestId } from './dom';
export type { Attrs } from './dom';

export { createButton } from './button';
export type { ButtonOpts, ButtonVariant } from './button';

export {
  createTextInput,
  createSearchInput,
  createNumberInput,
  createTextarea,
  createSelect,
  createCheckbox,
} from './input';
export type {
  TextInputOpts,
  SearchInputOpts,
  NumberInputOpts,
  TextareaOpts,
  SelectOpts,
  CheckboxOpts,
} from './input';

export { createSwitch, createSwitchField } from './switch';
export { createTabs } from './tabs';
export type { TabItem, TabsOpts } from './tabs';

export { createField, createNumberField } from './field';
export { createCard, createBadge } from './card';
export { createModal } from './modal';
export type { ModalOpts, ModalAction } from './modal';
export { createEmptyState } from './emptyState';
export type { EmptyStateOpts } from './emptyState';

export { mountMultiSelect } from '../MultiSelect';
export type {
  MultiSelectOption,
  MultiSelectOptions,
  MultiSelectHandle,
} from '../MultiSelect';
