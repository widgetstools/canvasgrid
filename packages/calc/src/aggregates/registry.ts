// Aggregate registry: register/get/list + serialization for the worker bundle.
// Ships in Task 5.
import type { Aggregate } from '../types';
import type { AggregateFactoryOpts } from './contract';

export function registerAggregate(
  _name: string,
  _impl: Aggregate,
  _opts?: AggregateFactoryOpts,
): void {
  throw new Error('not-yet-implemented: registerAggregate ships in Task 5');
}

export function getAggregate(_name: string): Aggregate | undefined {
  throw new Error('not-yet-implemented: getAggregate ships in Task 5');
}

export function listAggregates(): string[] {
  throw new Error('not-yet-implemented: listAggregates ships in Task 5');
}

/** Serialize registered aggregate implementations (name + source) for the worker bundle. */
export function serializeAggregates(): Array<{ name: string; source: string }> {
  throw new Error('not-yet-implemented: serializeAggregates ships in Task 5');
}
