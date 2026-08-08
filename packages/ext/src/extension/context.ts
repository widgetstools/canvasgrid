import type { VelocityGrid, StateModule, GridState } from '@wellsfargo-starui/velocity-grid';
import type {
  VelocityGridExtContext, ExtEventBus, ExtEvent, ProfileController, ExtModalHost, Unsub,
} from './types';

export function createExtEventBus(): ExtEventBus {
  const map = new Map<string, Set<(e: ExtEvent) => void>>();
  return {
    on(type, fn): Unsub {
      const set = map.get(type) ?? new Set();
      set.add(fn); map.set(type, set);
      return () => set.delete(fn);
    },
    emit(e): void { for (const fn of map.get(e.type) ?? []) fn(e); },
  };
}

/** Build the context every extension receives. The kernel is reached
 *  through its public api only. `grid.getModal()` returns the kernel
 *  ModalHost, which structurally satisfies `ExtModalHost`. */
export function createExtContext(grid: VelocityGrid, profiles: ProfileController): VelocityGridExtContext {
  const events = createExtEventBus();
  return {
    grid,
    getState: () => grid.getState(),
    // Kernel `setState` is typed to take a full `GridState`, but at runtime
    // every field is optional — each step is a no-op when the snapshot
    // omits the corresponding slice (see velocityGrid.ts `setState` docblock).
    // The narrower `Partial<GridState>` on `VelocityGridExtContext` is the accurate
    // contract for callers; cast to satisfy the kernel's stricter TS type.
    setState: (s) => grid.setState(s as GridState),
    registerStateModule: (m: StateModule) => grid.registerStateModule(m),
    modal: grid.getModal() as unknown as ExtModalHost,
    events,
    profiles,
  };
}
