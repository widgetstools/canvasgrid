// Statistical aggregates: STDEV, VARIANCE, MEDIAN, PERCENTILE(p). Ships in Task 6.
import type { Aggregate } from '../types';
import type { AggregateFactoryOpts } from './contract';

export function createStdevAggregate(): Aggregate {
  throw new Error('not-yet-implemented: createStdevAggregate ships in Task 6');
}

export function createVarianceAggregate(): Aggregate {
  throw new Error('not-yet-implemented: createVarianceAggregate ships in Task 6');
}

export function createMedianAggregate(_opts?: AggregateFactoryOpts): Aggregate {
  throw new Error('not-yet-implemented: createMedianAggregate ships in Task 6');
}

export function createPercentileAggregate(_p: number, _opts?: AggregateFactoryOpts): Aggregate {
  throw new Error('not-yet-implemented: createPercentileAggregate ships in Task 6');
}
