// Aggregate contract — type-only re-export of the public Aggregate interface plus
// the factory options shape shared by percentile-family aggregates (Task 5-6).
export type { Aggregate } from '../types';

export interface AggregateFactoryOpts {
  percentileThreshold?: number;
}
