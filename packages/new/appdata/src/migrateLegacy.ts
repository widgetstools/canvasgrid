/**
 * One-shot localStorage migrators: legacy VelocityGrid keys → `vg-new:*`.
 * Copies only when the destination key is absent (never overwrites).
 */

export type MigrateReport = {
  copied: string[];
  skipped: string[];
};

const LEGACY_APPDATA = 'vg-appdata';
const NEW_APPDATA = 'vg-new:appdata';
const LEGACY_CATALOG = 'vg-data:provider-catalog';
const NEW_CATALOG = 'vg-new:provider-catalog';
const LEGACY_INSTANCE = 'velocity-grid:instance:';
const NEW_INSTANCE = 'vg-new:instance:';
const LEGACY_FEED_STOP = 'cgrid-ssrm:feed-stop:';
const NEW_FEED_STOP = 'vg-new:feed-stop:';

function copyIfAbsent(
  storage: Storage,
  from: string,
  to: string,
  report: MigrateReport,
): void {
  if (storage.getItem(to) != null) {
    report.skipped.push(`${from} → ${to} (dest exists)`);
    return;
  }
  const raw = storage.getItem(from);
  if (raw == null) {
    report.skipped.push(`${from} → ${to} (src missing)`);
    return;
  }
  try {
    storage.setItem(to, raw);
    report.copied.push(`${from} → ${to}`);
  } catch {
    report.skipped.push(`${from} → ${to} (write failed)`);
  }
}

function keys(storage: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) out.push(k);
  }
  return out;
}

/**
 * Migrate AppData, provider catalog, instance bundles, and feed-stop epochs.
 * Safe to call on every boot — idempotent.
 */
export function migrateLegacyPersistence(
  storage: Storage = typeof localStorage !== 'undefined' ? localStorage : (undefined as unknown as Storage),
): MigrateReport {
  const report: MigrateReport = { copied: [], skipped: [] };
  if (!storage) return report;

  copyIfAbsent(storage, LEGACY_APPDATA, NEW_APPDATA, report);

  for (const key of keys(storage)) {
    if (key.startsWith(`${LEGACY_APPDATA}:`)) {
      const suffix = key.slice(LEGACY_APPDATA.length + 1);
      copyIfAbsent(storage, key, `${NEW_APPDATA}:${suffix}`, report);
    }
    if (key.startsWith(LEGACY_INSTANCE)) {
      const id = key.slice(LEGACY_INSTANCE.length);
      copyIfAbsent(storage, key, `${NEW_INSTANCE}${id}`, report);
    }
    if (key.startsWith(LEGACY_FEED_STOP)) {
      const schema = key.slice(LEGACY_FEED_STOP.length);
      copyIfAbsent(storage, key, `${NEW_FEED_STOP}${schema}`, report);
    }
  }

  copyIfAbsent(storage, LEGACY_CATALOG, NEW_CATALOG, report);
  return report;
}
