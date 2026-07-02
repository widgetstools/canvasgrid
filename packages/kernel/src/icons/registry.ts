// Icon registry — Path2D-backed, lazy-instantiated from SVG path strings.
// Populated by @cgrid/format's wireIntoKernel (Task 17); kernel does NOT
// auto-register any icon set.

type IconPathValue = string | Path2D;
type IconSet = Map<string, IconPathValue>;

const sets = new Map<string, IconSet>();
const insertionOrder: string[] = [];

export function registerIconSet(name: string, paths: Record<string, IconPathValue>): void {
  const set = new Map<string, IconPathValue>();
  for (const [iconName, path] of Object.entries(paths)) {
    set.set(iconName, path);
  }
  sets.set(name, set);
  if (!insertionOrder.includes(name)) insertionOrder.push(name);
}

export function resolveIcon(name: string, setHint?: string): Path2D | null {
  const order = setHint ? [setHint, ...insertionOrder.filter((s) => s !== setHint)] : insertionOrder;
  for (const setName of order) {
    const set = sets.get(setName);
    if (!set) continue;
    const val = set.get(name);
    if (val === undefined) continue;
    if (typeof val === 'string') {
      // Lazy Path2D construction; cache in the same slot.
      if (typeof Path2D === 'undefined') return null; // SSR / Node fallback
      const p = new Path2D(val);
      set.set(name, p);
      return p;
    }
    return val;
  }
  return null;
}

export function listIconSets(): string[] {
  return insertionOrder.slice();
}

/** Test-only helper. */
export function _resetIconRegistry_forTests(): void {
  sets.clear();
  insertionOrder.length = 0;
}
