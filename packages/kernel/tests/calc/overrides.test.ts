import { describe, expect, it } from 'vitest';
import { overrideToKernelPatch } from '../../src/calc/overrides';

describe('overrideToKernelPatch — kernel key mapping', () => {
  it('maps every override field to the verified kernel CColDef key', () => {
    const patch = overrideToKernelPatch({
      colId: 'px',
      headerName: 'Px',
      format: '0.00',
      cellStyle: { color: 'red' },
      cellRenderer: 'sparkline',
      editable: true,
      hide: true,
      width: 120,
    }, { isCalcColumn: false });
    // Exact key set — quoted from packages/kernel/src/types/column.ts:
    // headerName(:97) width(:98) valueFormatter(:128) cellRenderer(:151)
    // editable(:272) cellStyle(:348) hide(:421).
    expect(patch).toEqual({
      headerName: 'Px',
      valueFormatter: '0.00',     // format string → kernel valueFormatter (string form)
      cellStyle: { color: 'red' },
      cellRenderer: 'sparkline',
      editable: true,
      hide: true,
      width: 120,
    });
  });

  it('drops editable for calc columns (pinned non-editable)', () => {
    const patch = overrideToKernelPatch(
      { colId: 'total', headerName: 'T', editable: true },
      { isCalcColumn: true },
    );
    expect(patch).toEqual({ headerName: 'T' });
    expect('editable' in patch).toBe(false);
  });

  it('keeps a DEFINED editable: false for data columns', () => {
    const patch = overrideToKernelPatch({ colId: 'px', editable: false }, { isCalcColumn: false });
    expect(patch).toEqual({ editable: false });
  });

  it('returns {} for an override with nothing to map', () => {
    expect(overrideToKernelPatch({ colId: 'px' }, { isCalcColumn: false })).toEqual({});
    expect(overrideToKernelPatch({ colId: 'px', templateIds: ['t1'] }, { isCalcColumn: false })).toEqual({});
  });

  it('copies cellStyle — mutating the patch never touches the input', () => {
    const merged = { colId: 'px', cellStyle: { color: 'red' } };
    const patch = overrideToKernelPatch(merged, { isCalcColumn: false });
    (patch.cellStyle as Record<string, unknown>).color = 'HACKED';
    expect(merged.cellStyle.color).toBe('red');
  });

  it('never emits initial* or unexpected keys', () => {
    const patch = overrideToKernelPatch(
      { colId: 'px', hide: true, width: 90 },
      { isCalcColumn: false },
    );
    expect(Object.keys(patch).sort()).toEqual(['hide', 'width']);   // live keys, not initialHide/initialWidth
  });
});
