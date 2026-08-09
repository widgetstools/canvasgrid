import type { ProfileStore, ProfileSnapshot, ProfileMeta } from '../extension/types';

/** Legacy flat `ProfileStore` — one localStorage key per namespace holding a
 *  `{ [id]: ProfileSnapshot }` map.
 *
 *  Prefer `LocalStorageConfigSession` (default in VelocityGridExt) so
 *  profiles + layouts share one Markets-aligned instance bundle per gridId.
 *  Host Config Managers should implement `ConfigSession` / `ProfileStore`.
 */
export class LocalStorageProfileStore implements ProfileStore {
  constructor(private namespace = 'velocity-grid-ext') {}
  private get key(): string { return `${this.namespace}:profiles`; }

  private read(): Record<string, ProfileSnapshot> {
    try { return JSON.parse(localStorage.getItem(this.key) ?? '{}'); }
    catch { return {}; }
  }
  private write(map: Record<string, ProfileSnapshot>): void {
    localStorage.setItem(this.key, JSON.stringify(map));
  }

  async list(): Promise<ProfileMeta[]> {
    return Object.values(this.read()).map(s => s.meta);
  }
  async load(id: string): Promise<ProfileSnapshot | null> {
    return this.read()[id] ?? null;
  }
  async save(id: string, snap: ProfileSnapshot): Promise<void> {
    const map = this.read(); map[id] = snap; this.write(map);
  }
  async remove(id: string): Promise<void> {
    const map = this.read(); delete map[id]; this.write(map);
  }
}
