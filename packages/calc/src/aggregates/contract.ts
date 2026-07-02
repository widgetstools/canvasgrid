// Aggregate contract — type-only re-export of the public Aggregate interface plus
// the factory options shape shared by percentile-family aggregates (Task 5-6).
export type { Aggregate } from '../types';

export interface AggregateFactoryOpts {
  /** Accepted + ignored this cycle (t-digest reserve, spec §1.2). */
  percentileThreshold?: number;
  /** Replace an existing registration instead of throwing. */
  force?: boolean;
}
