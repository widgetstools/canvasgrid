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

export interface Feature {
  id: string;
  label: string;
  description: string;
  mount(gridHost: HTMLElement, controls: HTMLElement, theme: string): CGrid<ShowcaseRow>;
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
];

export const FEATURE_MAP = new Map(FEATURES.map((f) => [f.id, f]));
