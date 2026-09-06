import type { CColDef, CColGroupDef } from '@wellsfargo-starui/velocity-grid';
import type { VelocityGridExtOptions } from '@wellsfargo-starui/velocity-grid-ext';
import type { BlotterRow } from '../data/domain';

/** What the Inspector drawer shows for a tab. Kept beside the grid options it
 *  describes so the two cannot drift — the commonest rot in a feature lab. */
export interface LabGuide {
  /** One paragraph: what this feature is and why it exists. */
  what: string;
  /** Concrete things to do in the grid, in order. */
  try: string[];
  /** The options that make this tab what it is, as pasteable code. */
  config: string;
}

export interface LabTab {
  id: string;
  group: string;
  label: string;
  /** Sidebar one-liner. */
  hint: string;
  title: string;
  subtitle: string;
  /** Columns this tab shows, already ordered. */
  columns: () => (CColDef<BlotterRow> | CColGroupDef<BlotterRow>)[];
  /** Grid options layered over the lab defaults. */
  options?: Partial<Omit<VelocityGridExtOptions<BlotterRow>, 'columnDefs' | 'getRowId'>>;
  /** Book size / cadence for this tab. Smaller books where the point is a
   *  visual detail; the full book where the point is throughput. */
  stream?: { rowCount?: number; tickMs?: number };
  guide: LabGuide;
}
