import { describe, it, expect } from 'vitest';
import { compileParams, resolveTokenName, PARAM_DERIVATIONS, type CgThemeParams } from '../../src/theming/theme/params';

describe('resolveTokenName', () => {
  it('resolves a foundational param to its primary token', () => {
    expect(resolveTokenName('accentColor')).toBe('--vg-chrome-accent');
    expect(resolveTokenName('backgroundColor')).toBe('--vg-bg-color');
    expect(resolveTokenName('foregroundColor')).toBe('--vg-fg-color');
  });

  it('resolves a fan-out param to its primary (first-listed) token', () => {
    expect(resolveTokenName('borderRadius')).toBe('--vg-radius');
    expect(resolveTokenName('popupBackgroundColor')).toBe('--vg-popup-bg');
    expect(resolveTokenName('flashColor')).toBe('--vg-flash-from-color');
  });

  it('returns empty string for a name outside the vocabulary (defers to values.ts fallback)', () => {
    expect(resolveTokenName('notARealParam')).toBe('');
  });
});

describe('compileParams — foundational', () => {
  it('compiles a plain color param to its token', () => {
    expect(compileParams({ accentColor: '#2f7bc4' })).toMatchObject({
      '--vg-chrome-accent': '#2f7bc4',
    });
  });

  it('compiles a length param (number -> px)', () => {
    expect(compileParams({ rowHeight: 24 })).toMatchObject({
      '--vg-row-height': '24px',
    });
  });
});

describe('compileParams — auto-derivation (dependency-gated)', () => {
  it('emits the border-color color-mix default when borderColor is unset AND a dependency (bg/fg) is present', () => {
    const out = compileParams({ backgroundColor: '#111', foregroundColor: '#eee' });
    expect(out['--vg-border-color']).toBe(
      'color-mix(in srgb, var(--vg-fg-color) 15%, var(--vg-bg-color))'
    );
  });

  it('suppresses the auto-derivation when the param is explicitly set', () => {
    const out = compileParams({ borderColor: '#333' });
    expect(out['--vg-border-color']).toBe('#333');
  });

  it('compiles to {} for an empty params object — no derivations without a dependency present', () => {
    expect(compileParams({})).toEqual({});
  });

  it('emits only the accent-dependent derivations when accentColor is set, not the bg/fg-only ones', () => {
    const out = compileParams({ accentColor: '#f00' });

    expect(out['--vg-row-hover-bg']).toBe(
      'color-mix(in srgb, var(--vg-chrome-accent) 7%, var(--vg-bg-color))'
    );
    expect(out['--vg-row-selected-bg']).toBe(
      'color-mix(in srgb, var(--vg-chrome-accent) 12%, var(--vg-bg-color))'
    );
    expect(out['--vg-range-border-color']).toBe('var(--vg-chrome-accent)');
    expect(out['--vg-range-fill-color']).toBe(
      'color-mix(in srgb, var(--vg-range-border-color) 22%, transparent)'
    );

    expect(out['--vg-border-color']).toBeUndefined();
    expect(out['--vg-grid-line-color']).toBeUndefined();
    expect(out['--vg-header-bg']).toBeUndefined();
  });

  it('emits only the explicit token for a non-color param with no color dependencies present', () => {
    const out = compileParams({ rowHeight: 24 });
    expect(out).toEqual({ '--vg-row-height': '24px' });
  });
});

describe('compileParams — fan-outs', () => {
  it('fans borderRadius out to radius/modal-radius/chip-radius', () => {
    expect(compileParams({ borderRadius: 4 })).toMatchObject({
      '--vg-radius': '4px',
      '--vg-modal-radius': '4px',
      '--vg-chip-radius': '4px',
    });
  });

  it('fans flashColor out to a from-color and a transparent to-color', () => {
    expect(compileParams({ flashColor: '#fef3c7' })).toMatchObject({
      '--vg-flash-from-color': '#fef3c7',
      '--vg-flash-to-color': 'color-mix(in srgb, #fef3c7 0%, transparent)',
    });
  });

  it('fans popupBackgroundColor out to popup + modal tokens', () => {
    expect(compileParams({ popupBackgroundColor: '#202020' })).toMatchObject({
      '--vg-popup-bg': '#202020',
      '--vg-modal-bg': '#202020',
    });
  });

  it('lets a later-processed chipRadius win over an earlier borderRadius for the shared token', () => {
    const out = compileParams({ borderRadius: 4, chipRadius: 8 });
    expect(out['--vg-chip-radius']).toBe('8px');
    expect(out['--vg-radius']).toBe('4px');
  });
});

describe('compileParams — records', () => {
  it('emits one token per statusColors sub-key', () => {
    expect(compileParams({ statusColors: { filled: { bg: '#0a0' } } })).toMatchObject({
      '--vg-status-filled-bg': '#0a0',
    });
  });

  it('emits bg/fg/border for a full statusColors entry', () => {
    expect(
      compileParams({ statusColors: { rejected: { bg: '#fff', fg: '#e63946', border: '#e63946' } } })
    ).toMatchObject({
      '--vg-status-rejected-bg': '#fff',
      '--vg-status-rejected-fg': '#e63946',
      '--vg-status-rejected-border': '#e63946',
    });
  });

  it('emits one token per ratingColors entry', () => {
    expect(compileParams({ ratingColors: { aaa: '#0aa063' } })).toMatchObject({
      '--vg-rating-aaa-color': '#0aa063',
    });
  });

  it('emits one token per venueColors entry, lowercasing the key', () => {
    expect(compileParams({ venueColors: { XNAS: '#3b82f6' } })).toMatchObject({
      '--vg-venue-xnas-color': '#3b82f6',
    });
  });
});

describe('compileParams — rich value forms', () => {
  it('compiles a { ref, mix, onto } param through to the exact color-mix string', () => {
    const out = compileParams({
      rowHoverColor: { ref: 'accentColor', mix: 0.07, onto: 'backgroundColor' },
    });
    expect(out['--vg-row-hover-bg']).toBe(
      'color-mix(in srgb, var(--vg-chrome-accent) 7%, var(--vg-bg-color))'
    );
  });
});

describe('compileParams — vars escape hatch', () => {
  it('applies vars last, overriding any named param for the same token', () => {
    const out = compileParams({
      accentColor: '#2f7bc4',
      vars: { '--vg-chrome-accent': '#ff0000' },
    });
    expect(out['--vg-chrome-accent']).toBe('#ff0000');
  });

  it('passes through a var not covered by any named param', () => {
    const out = compileParams({ vars: { '--vg-my-custom-token': 'red' } });
    expect(out['--vg-my-custom-token']).toBe('red');
  });
});

describe('CgThemeParams type', () => {
  it('type-checks a wide param object (compile-time only, smoke-tested at runtime)', () => {
    const params: CgThemeParams = {
      accentColor: '#2f7bc4',
      backgroundColor: '#16181d',
      rowHeight: 32,
      fontFamily: ['Inter', 'system-ui'],
      totalsFontWeight: 600,
      statusColors: { filled: { bg: '#0a0', fg: '#fff' } },
      vars: { '--vg-my-token': 'blue' },
    };
    expect(compileParams(params)['--vg-chrome-accent']).toBe('#2f7bc4');
  });
});
