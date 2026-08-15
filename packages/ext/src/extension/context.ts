import type { VelocityGrid, StateModule, GridState } from '@wellsfargo-starui/velocity-grid';
import type {
  VelocityGridExtContext, ExtEventBus, ExtEvent, ProfileController, ExtModalHost, Unsub,
} from './types';
import { DrawerSession } from '../profiles/drawerSession';

export function createExtEventBus(): ExtEventBus {
  const map = new Map<string, Set<(e: ExtEvent) => void>>();
  return {
    on(type, fn): Unsub {
      const set = map.get(type) ?? new Set();
      set.add(fn); map.set(type, set);
      return () => set.delete(fn);
    },
    // Each listener is isolated — one throwing listener must not abort
    // delivery to the rest (mirrors ExtensionRegistry.disposeAll/initAll).
    emit(e): void {
      for (const fn of map.get(e.type) ?? []) {
        try {
          fn(e);
        } catch (err) {
          console.warn(`[velocity-grid-ext] event listener for "${e.type}" threw`, err);
        }
      }
    },
  };
}

/** Every member of `ProfileController` — kept in one place so
 *  `delegateProfiles` can build a complete wrapper without missing a
 *  future addition to the interface silently. */
const PROFILE_CONTROLLER_KEYS = [
  'activeId', 'isDirty', 'markDirty', 'onDirtyChange', 'onListChange',
  'save', 'saveAs', 'discard', 'rename', 'remove', 'switchTo', 'bootstrap', 'list',
] as const satisfies readonly (keyof ProfileController)[];

/**
 * Build a `ProfileController` delegate over `target`: every member not
 * present in `overrides` is `target`'s own method *bound to `target`*, and
 * every member in `overrides` is used as-is.
 *
 * `Object.create(target, { ...overrides })` looks like it does the same
 * thing but is NOT safe here: JS binds `this` to the *receiver* the method
 * was called through, not to the object the method was found on. Any
 * non-overridden method reached through such a wrapper (e.g. `isDirty()`
 * calling `return this.dirty`) would run with `this` pointing at the
 * *wrapper*, silently reading/writing shadow state on it instead of the
 * real controller (`ProfilesController` mutates plain `this.<field>`
 * internally). Explicitly binding every delegated member to `target`
 * avoids that trap regardless of how many wrapper layers exist (shell.ts
 * wraps this wrapper again for `markDirty`) — a bound function's `this` is
 * fixed and immune to further rebinding.
 */
export function delegateProfiles(
  target: ProfileController,
  overrides: Partial<ProfileController>,
): ProfileController {
  const out = {} as Record<string, unknown>;
  for (const key of PROFILE_CONTROLLER_KEYS) {
    if (key in overrides) {
      out[key] = overrides[key];
      continue;
    }
    const member = target[key];
    out[key] = typeof member === 'function' ? member.bind(target) : member;
  }
  return out as unknown as ProfileController;
}

/** Build the context every extension receives. The kernel is reached
 *  through its public api only. `grid.getModal()` returns the kernel
 *  ModalHost, which structurally satisfies `ExtModalHost`. */
export function createExtContext(grid: VelocityGrid, profiles: ProfileController): VelocityGridExtContext {
  const events = createExtEventBus();
  const session = new DrawerSession();
  // Delegating wrapper — do NOT assign onto the shared `profiles` instance
  // (own-property monkey-patching shadowed the prototype's `save`/`discard`
  // permanently, and double-wrapped if this function ever ran twice for the
  // same controller). `save`/`discard` also clear the drawer's staged-edit
  // session once they resolve; every other member delegates to `profiles`
  // unchanged.
  const wrappedProfiles: ProfileController = delegateProfiles(profiles, {
    save: async () => {
      await profiles.save();
      session.clear();
    },
    discard: async () => {
      await profiles.discard();
      session.clear();
    },
  });
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
    profiles: wrappedProfiles,
    session,
  };
}
