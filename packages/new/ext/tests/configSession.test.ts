import { describe, expect, it } from 'vitest';
import { ConfigSession } from '../src/profiles/configSession';

describe('ConfigSession draft → validate → apply', () => {
  it('rejects invalid draft and commits valid apply', async () => {
    localStorage.clear();
    const s = new ConfigSession('cfg-test');
    const draft = s.beginDraft<{ expr: string }>('calc', { expr: '' });
    draft.expr = '';
    s.setDraft('calc', draft);

    const bad = await s.apply('calc', {
      validate: (d) => {
        const e = (d as { expr: string }).expr;
        return e.trim() ? { ok: true } : { ok: false, errors: ['empty'] };
      },
      apply: () => { throw new Error('should not run'); },
      persist: false,
    });
    expect(bad.ok).toBe(false);

    draft.expr = 'pnl + 1';
    s.setDraft('calc', draft);
    let applied = '';
    const ok = await s.apply('calc', {
      validate: (d) => ((d as { expr: string }).expr.trim()
        ? { ok: true }
        : { ok: false, errors: ['empty'] }),
      apply: (d) => { applied = (d as { expr: string }).expr; },
    });
    expect(ok.ok).toBe(true);
    expect(applied).toBe('pnl + 1');
    expect(s.getModuleSlice<{ expr: string }>('calc')?.expr).toBe('pnl + 1');
    expect(s.getDraft('calc')).toBeUndefined();
  });

  it('persists saved filters', async () => {
    localStorage.clear();
    const s = new ConfigSession('cfg-filters');
    s.upsertSavedFilter({
      id: 'f1',
      label: 'Losses',
      filterModel: { pnl: { filterType: 'number', type: 'lessThan', filter: 0 } },
    });
    await s.save();
    const s2 = new ConfigSession('cfg-filters');
    expect(s2.getSavedFilters()).toHaveLength(1);
    expect(s2.getSavedFilters()[0]?.label).toBe('Losses');
  });
});
