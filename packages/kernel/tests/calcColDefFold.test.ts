import { describe, it, expect, afterEach } from 'vitest';
import { resolveColDefs } from '../src/core/propertyChain';
import {
  registerCalcProvider,
  _resetCalcProvider_forTests,
  foldCalcColumnDefs,
  type CalcProviderShape,
} from '../src/core/calcSlot';
import {
  registerFormatCompiler,
  _resetFormatCompiler_forTests,
  type FormatCompiler,
} from '../src/core/formatCompilerSlot';

function makeProvider(overrides: Partial<CalcProviderShape> = {}): CalcProviderShape {
  return {
    synthesizedColDefs: () => [],
    resolvedPatchFor: () => null,
    workerProgram: () => null,
    onColumnsChanged: () => () => {},
    ...overrides,
  };
}

describe('foldCalcColumnDefs', () => {
  afterEach(() => {
    _resetCalcProvider_forTests();
    _resetFormatCompiler_forTests();
  });

  it('no provider → returns the SAME array reference (zero-diff)', () => {
    const defs = [{ colId: 'px', headerName: 'Price' }];
    const folded = foldCalcColumnDefs(defs);
    expect(folded).toBe(defs);
  });

  it('no provider → resolveColDefs output deep-equals a pre-registration snapshot', () => {
    const defs = [{ colId: 'px', headerName: 'Price', width: 90 }];
    const before = resolveColDefs(foldCalcColumnDefs(defs) as any);
    // Register then unregister — should not affect the pass-through path
    // when nothing is registered at fold time.
    const after = resolveColDefs(foldCalcColumnDefs(defs) as any);
    expect(after).toEqual(before);
  });

  it('synthesized def appears in resolved output with editable: false carried through, valueFormatter compiled to a function', () => {
    const fakeCompiler: FormatCompiler = (source) => {
      if (source === '$#,##0.00') {
        return {
          ok: true,
          program: {
            formatText: (ctx) => `$${Number(ctx.value).toFixed(2)}`,
            resolveStyle: () => null,
            resolveIcon: () => null,
            resolveFragments: () => null,
            source,
            tiers: { tier0: true, tier1: false, tier2: false },
          },
        };
      }
      return { ok: false, error: { message: 'unknown', loc: { start: 0, end: 0 } } };
    };
    registerFormatCompiler(fakeCompiler);
    registerCalcProvider(makeProvider({
      synthesizedColDefs: () => [
        { colId: 'spread', headerName: 'Spread', editable: false, cellDataType: 'number', valueFormatter: '$#,##0.00' },
      ],
    }));
    const defs = [{ colId: 'px', headerName: 'Price' }];
    const folded = foldCalcColumnDefs(defs);
    const resolved = resolveColDefs(folded as any);
    const spread = resolved.find((d) => d.colId === 'spread');
    expect(spread).toBeDefined();
    expect(spread!.editable).toBe(false);
    expect(typeof spread!.valueFormatter).toBe('function');
    expect((spread!.valueFormatter as any)({ value: 4.5, data: {}, colId: 'spread' })).toBe('$4.50');
  });

  it('patch fold precedence: patch wins, unpatched fields intact', () => {
    registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'px' ? { headerName: 'Px (o/r)', hide: true } : null,
    }));
    const defs = [{ colId: 'px', headerName: 'Price', width: 90 }];
    const folded = foldCalcColumnDefs(defs);
    const resolved = resolveColDefs(folded as any);
    const px = resolved.find((d) => d.colId === 'px')!;
    expect(px.headerName).toBe('Px (o/r)');
    expect(px.hide).toBe(true);
    expect(px.width).toBe(90);
  });

  it('position hint ordering: undefined position sorts last', () => {
    registerCalcProvider(makeProvider({
      synthesizedColDefs: () => [
        { colId: 'c2', position: 5 },
        { colId: 'c1', position: 1 },
        { colId: 'c3' },
      ],
    }));
    const defs = [{ colId: 'px', headerName: 'Price' }];
    const folded = foldCalcColumnDefs(defs);
    const synthesizedIds = folded.slice(1).map((d: any) => d.colId);
    expect(synthesizedIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('resolvedPatchFor receives the def cellDataType', () => {
    const calls: Array<[string, string]> = [];
    registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId, cellDataType) => {
        calls.push([colId, cellDataType]);
        return null;
      },
    }));
    const defs = [
      { colId: 'px', headerName: 'Price', cellDataType: 'number' },
      { colId: 'name', headerName: 'Name' },
    ];
    foldCalcColumnDefs(defs);
    expect(calls).toEqual([
      ['px', 'number'],
      ['name', 'text'],
    ]);
  });

  it('recurses into column groups: a patch reaches a nested leaf (grouped-column styling regression)', () => {
    registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'dv01' ? { cellStyle: { bg: '#12333a' }, headerName: 'DV01*' } : null,
    }));
    const defs = [
      { colId: 'px', headerName: 'Price' },
      {
        groupId: 'risk',
        headerName: 'Risk',
        children: [
          { colId: 'dv01', headerName: 'DV01', cellDataType: 'number' },
          {
            groupId: 'nested',
            headerName: 'Nested',
            children: [{ colId: 'pv01', headerName: 'PV01', cellDataType: 'number' }],
          },
        ],
      },
    ];
    const folded = foldCalcColumnDefs(defs) as any[];
    const risk = folded[1];
    const dv01 = risk.children[0];
    expect(dv01.headerName).toBe('DV01*');
    expect(dv01.cellStyle).toEqual({ bg: '#12333a' });
    // untouched deeply-nested leaf keeps its reference (zero-work path)
    expect(risk.children[1]).toBe(defs[1].children[1]);
  });

  it('group nodes with NO patched descendants keep their reference; patched groups are re-created', () => {
    registerCalcProvider(makeProvider({
      resolvedPatchFor: (colId) => colId === 'inA' ? { hide: true } : null,
    }));
    const defs = [
      { groupId: 'a', children: [{ colId: 'inA' }] },
      { groupId: 'b', children: [{ colId: 'inB' }] },
    ];
    const folded = foldCalcColumnDefs(defs) as any[];
    expect(folded[0]).not.toBe(defs[0]);        // descendant patched -> new group object
    expect(folded[0].children[0].hide).toBe(true);
    expect(folded[1]).toBe(defs[1]);            // untouched group passes through by reference
  });
});

