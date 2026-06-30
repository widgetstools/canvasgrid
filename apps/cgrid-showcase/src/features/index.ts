import type { CGrid } from 'cgrid';
import type { ShowcaseRow } from '../seedData';
import { hideOpenParents } from './hideOpenParents';
import { groupTotalRow } from './groupTotalRow';
import { grandTotalRow } from './grandTotalRow';
import { groupSelects } from './groupSelects';
import { suppressCount } from './suppressCount';
import { stickyGroupRows } from './stickyGroupRows';
import { groupSort } from './groupSort';
import { stateRoundtrip } from './stateRoundtrip';
import { filteringWithGroups } from './filteringWithGroups';
import { pivotToolPanel } from './pivotToolPanel';
import { pivot } from './pivot';
import { pivotAgComparison } from './pivotAgComparison';
import { exportFeature } from './exportFeature';
import { sparkline } from './sparkline';
import { theming } from './theming';
import { cellStyleExpansion } from './cellStyleExpansion';
import { eventsState } from './eventsState';
import { a11y } from './a11y';
import { selectionModes } from './selectionModes';
import { realtimeStomp } from './realtimeStomp';

export interface Feature {
  id: string;
  label: string;
  description: string;
  // Most features mount a `CGrid<ShowcaseRow>`; a few (e.g.
  // realtime feeds with a foreign schema) widen to `CGrid<any>` so
  // the showcase shell can still destroy them uniformly.
  mount(gridHost: HTMLElement, controls: HTMLElement, theme: string): CGrid<ShowcaseRow> | CGrid<any>;
}

export const FEATURES: Feature[] = [
  hideOpenParents,
  groupTotalRow,
  grandTotalRow,
  groupSelects,
  suppressCount,
  stickyGroupRows,
  groupSort,
  stateRoundtrip,
  filteringWithGroups,
  pivotToolPanel,
  pivot,
  pivotAgComparison,
  exportFeature,
  sparkline,
  theming,
  cellStyleExpansion,
  eventsState,
  a11y,
  selectionModes,
  realtimeStomp,
];

export const FEATURE_MAP = new Map(FEATURES.map((f) => [f.id, f]));
