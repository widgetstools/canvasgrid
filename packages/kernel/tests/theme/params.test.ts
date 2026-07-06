import { describe, it, expect } from 'vitest';
import { compileParams, resolveTokenName, PARAM_DERIVATIONS, type CgThemeParams } from '../../src/theming/theme/params';

describe('resolveTokenName', () => {
  it('resolves a foundational param to its primary token', () => {
    expect(resolveTokenName('accentColor')).toBe('--cg-chrome-accent');
    expect(resolveTokenName('backgroundColor')).toBe('--cg-bg-color');
    expect(resolveTokenName('foregroundColor')).toBe('--cg-fg-color');
  });

  it('resolves a fan-out param to its primary (first-listed) token', () => {
    expect(resolveTokenName('borderRadius')).toBe('--cg-radius');
    expect(resolveTokenName('popupBackgroundColor')).toBe('--cg-popup-bg');
    expect(resolveTokenName('flashColor')).toBe('--cg-flash-from-color');
  });

  it('returns empty string for a name outside the vocabulary (defers to values.ts fallback)', () => {
    expect(resolveTokenName('notARealParam')).toBe('');
  });
});

describe('compileParams — foundational', () => {
  it('compiles a plain color param to its token', () => {
    expect(compileParams({ accentColor: '#2f7bc4' })).toMatchObject({
      '--cg-chrome-accent': '#2f7bc4',
    });
  });

  it('compiles a length param (number -> px)', () => {
    expect(compileParams({ rowHeight: 24 })).toMatchObject({
      '--cg-row-height': '24px',
    });
  });
});

describe('compileParams — auto-derivation', () => {
  it('emits the border-color color-mix default when borderColor is unset', () => {
    const out = compileParams({ backgroundColor: '#111', foregroundColor: '#eee' });
    expect(out['--cg-border-color']).toBe(
      'color-mix(in srgb, var(--cg-fg-color) 15%, var(--cg-bg-color))'
    );
  });

  it('suppresses the auto-derivation when the param is explicitly set', () => {
    const out = compileParams({ borderColor: '#333' });
    expect(out['--cg-border-color']).toBe('#333');
  });

  it('emits all seven auto-derived tokens when nothing overrides them', () => {
    const out = compileParams({});
    expect(out['--cg-border-color']).toBe(
      'color-mix(in srgb, var(--cg-fg-color) 15%, var(--cg-bg-color))'
    );
    expect(out['--cg-grid-line-color']).toBe(
      'color-mix(in srgb, var(--cg-fg-color) 9%, var(--cg-bg-color))'
    );
    expect(out['--cg-row-hover-bg']).toBe(
      'color-mix(in srgb, var(--cg-chrome-accent) 7%, var(--cg-bg-color))'
    );
    expect(out['--cg-row-selected-bg']).toBe(
      'color-mix(in srgb, var(--cg-chrome-accent) 12%, var(--cg-bg-color))'
    );
    expect(out['--cg-header-bg']).toBe(
      'color-mix(in srgb, var(--cg-fg-color) 4%, var(--cg-bg-color))'
    );
    expect(out['--cg-range-border-color']).toBe('var(--cg-chrome-accent)');
    expect(out['--cg-range-fill-color']).toBe(
      'color-mix(in srgb, var(--cg-range-border-color) 22%, transparent)'
    );
  });
});

describe('compileParams — fan-outs', () => {
  it('fans borderRadius out to radius/modal-radius/chip-radius', () => {
    expect(compileParams({ borderRadius: 4 })).toMatchObject({
      '--cg-radius': '4px',
      '--cg-modal-radius': '4px',
      '--cg-chip-radius': '4px',
    });
  });

  it('fans flashColor out to a from-color and a transparent to-color', () => {
    expect(compileParams({ flashColor: '#fef3c7' })).toMatchObject({
      '--cg-flash-from-color': '#fef3c7',
      '--cg-flash-to-color': 'color-mix(in srgb, #fef3c7 0%, transparent)',
    });
  });

  it('fans popupBackgroundColor out to popup + modal tokens', () => {
    expect(compileParams({ popupBackgroundColor: '#202020' })).toMatchObject({
      '--cg-popup-bg': '#202020',
      '--cg-modal-bg': '#202020',
    });
  });

  it('lets a later-processed chipRadius win over an earlier borderRadius for the shared token', () => {
    const out = compileParams({ borderRadius: 4, chipRadius: 8 });
    expect(out['--cg-chip-radius']).toBe('8px');
    expect(out['--cg-radius']).toBe('4px');
  });
});

describe('compileParams — records', () => {
  it('emits one token per statusColors sub-key', () => {
    expect(compileParams({ statusColors: { filled: { bg: '#0a0' } } })).toMatchObject({
      '--cg-status-filled-bg': '#0a0',
    });
  });

  it('emits bg/fg/border for a full statusColors entry', () => {
    expect(
      compileParams({ statusColors: { rejected: { bg: '#fff', fg: '#e63946', border: '#e63946' } } })
    ).toMatchObject({
      '--cg-status-rejected-bg': '#fff',
      '--cg-status-rejected-fg': '#e63946',
      '--cg-status-rejected-border': '#e63946',
    });
  });

  it('emits one token per ratingColors entry', () => {
    expect(compileParams({ ratingColors: { aaa: '#0aa063' } })).toMatchObject({
      '--cg-rating-aaa-color': '#0aa063',
    });
  });

  it('emits one token per venueColors entry, lowercasing the key', () => {
    expect(compileParams({ venueColors: { XNAS: '#3b82f6' } })).toMatchObject({
      '--cg-venue-xnas-color': '#3b82f6',
    });
  });
});

describe('compileParams — rich value forms', () => {
  it('compiles a { ref, mix, onto } param through to the exact color-mix string', () => {
    const out = compileParams({
      rowHoverColor: { ref: 'accentColor', mix: 0.07, onto: 'backgroundColor' },
    });
    expect(out['--cg-row-hover-bg']).toBe(
      'color-mix(in srgb, var(--cg-chrome-accent) 7%, var(--cg-bg-color))'
    );
  });
});

describe('compileParams — vars escape hatch', () => {
  it('applies vars last, overriding any named param for the same token', () => {
    const out = compileParams({
      accentColor: '#2f7bc4',
      vars: { '--cg-chrome-accent': '#ff0000' },
    });
    expect(out['--cg-chrome-accent']).toBe('#ff0000');
  });

  it('passes through a var not covered by any named param', () => {
    const out = compileParams({ vars: { '--cg-my-custom-token': 'red' } });
    expect(out['--cg-my-custom-token']).toBe('red');
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
      vars: { '--cg-my-token': 'blue' },
    };
    expect(compileParams(params)['--cg-chrome-accent']).toBe('#2f7bc4');
  });
});
