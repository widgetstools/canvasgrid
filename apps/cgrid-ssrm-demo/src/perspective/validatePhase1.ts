/**
 * Phase 1 validation — sparse SSRM must window, not hydrate the full book.
 */
import type { PerspectiveBook } from './book';
import type { BlotterMount } from '../ui/blotterHost';

export interface Phase1ValidationResult {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

export async function validatePhase1(opts: {
  book: PerspectiveBook;
  blotters: Map<string, BlotterMount>;
}): Promise<Phase1ValidationResult> {
  const checks: Phase1ValidationResult['checks'] = [];
  const t = opts.book.getTelemetry();

  checks.push({
    name: 'engine',
    pass: t.engine === 'perspective',
    detail: `engine=${t.engine}`,
  });

  checks.push({
    name: 'phase-live-or-snapshot',
    pass: t.phase === 'live' || t.phase === 'snapshot',
    detail: `phase=${t.phase}`,
  });

  checks.push({
    name: 'book-has-rows',
    pass: t.bookSize > 0 || t.snapshotRowsLoaded > 0,
    detail: `bookSize=${t.bookSize} snapshot=${t.snapshotRowsLoaded}`,
  });

  checks.push({
    name: 'views-registered',
    pass: t.viewCount >= 1 && opts.blotters.size >= 1,
    detail: `views=${t.viewCount} blotters=${opts.blotters.size}`,
  });

  checks.push({
    name: 'getRows-fired',
    pass: t.getRowsTotal > 0,
    detail: `getRowsTotal=${t.getRowsTotal} rowsServed=${t.rowsServedTotal}`,
  });

  const book = Math.max(t.bookSize, t.snapshotRowsLoaded, 1);
  const sparseOk =
    t.getRowsTotal >= 1
    && t.rowsServedTotal > 0
    && t.rowsServedTotal < book * 0.5;
  checks.push({
    name: 'sparse-ssrm-windows',
    pass: sparseOk,
    detail: `served=${t.rowsServedTotal} book=${book} (expect block windows ≪ book)`,
  });

  const ok = checks.every((c) => c.pass);
  return { ok, checks };
}
