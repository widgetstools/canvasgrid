// Cycle 21i / Phase 1 (T3) — settings-form renderer tests (jsdom).
//
// Covers the renderer contract: control rendering + commit round-trip,
// the modified diff-rail + per-band chips + reset affordance, the text
// filter (force-expands bands, hides non-matches), and "modified only".
// Runs in the suite's default happy-dom environment.

import { describe, it, expect, vi } from 'vitest';
import { SettingsForm } from '../src/interaction/settingsForm/form';
import type { SettingsSection } from '../src/types/settingsSchema';

function makeSection(): { section: SettingsSection; store: Record<string, unknown> } {
  const store: Record<string, unknown> = { alpha: false, beta: 10, gamma: 'y' };
  const field = (key: string, type: 'switch' | 'number' | 'select', def: unknown, extra: object = {}) => ({
    key,
    label: key.toUpperCase(),
    type,
    defaultValue: def,
    get: () => store[key],
    set: (v: unknown) => { store[key] = v; },
    ...extra,
  });
  return {
    store,
    section: {
      id: 's',
      title: 'S',
      bands: [
        {
          id: 'b1',
          title: 'First band',
          fields: [
            field('alpha', 'switch', false),
            field('beta', 'number', 10, { min: 0, max: 100 }),
          ],
        },
        {
          id: 'b2',
          title: 'Second band',
          fields: [
            field('gamma', 'select', 'y', {
              options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }],
            }),
          ],
        },
      ],
    },
  };
}

const q = <T extends Element>(root: Element, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

describe('SettingsForm', () => {
  it('renders bands + rows and commits control changes', () => {
    const { section, store } = makeSection();
    const onChange = vi.fn();
    const form = new SettingsForm(section, onChange);

    expect(form.root.querySelectorAll('.cg-settings-band')).toHaveLength(2);
    expect(form.root.querySelectorAll('.cg-settings-row')).toHaveLength(3);

    const toggle = q<HTMLButtonElement>(form.root, '[data-field-key="alpha"] .cg-settings-toggle');
    toggle.click();
    expect(store.alpha).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('marks modified rows with the diff rail + band chip, reset reverts', () => {
    const { section, store } = makeSection();
    const form = new SettingsForm(section);

    const row = q<HTMLElement>(form.root, '[data-field-key="alpha"]');
    expect(row.hasAttribute('data-modified')).toBe(false);

    q<HTMLButtonElement>(row, '.cg-settings-toggle').click();
    expect(row.hasAttribute('data-modified')).toBe(true);
    expect(form.modifiedCount()).toBe(1);

    const chip = q<HTMLElement>(form.root, '[data-band-id="b1"] .cg-settings-band-chip');
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('1');

    const reset = q<HTMLButtonElement>(row, '.cg-settings-row-reset');
    expect(reset.getAttribute('data-visible')).toBe('true');
    reset.click();
    expect(store.alpha).toBe(false);
    expect(row.hasAttribute('data-modified')).toBe(false);
    expect(chip.hidden).toBe(true);
  });

  it('text filter hides non-matching rows and empty bands', () => {
    const { section } = makeSection();
    const form = new SettingsForm(section);

    form.setFilter('gamma');
    expect(q<HTMLElement>(form.root, '[data-field-key="alpha"]').hidden).toBe(true);
    expect(q<HTMLElement>(form.root, '[data-field-key="gamma"]').hidden).toBe(false);
    expect(q<HTMLElement>(form.root, '[data-band-id="b1"]').hidden).toBe(true);
    expect(q<HTMLElement>(form.root, '[data-band-id="b2"]').hidden).toBe(false);

    form.setFilter('');
    expect(q<HTMLElement>(form.root, '[data-band-id="b1"]').hidden).toBe(false);
  });

  it('band-title match keeps the whole band visible', () => {
    const { section } = makeSection();
    const form = new SettingsForm(section);
    form.setFilter('first');
    expect(q<HTMLElement>(form.root, '[data-field-key="alpha"]').hidden).toBe(false);
    expect(q<HTMLElement>(form.root, '[data-field-key="beta"]').hidden).toBe(false);
    expect(q<HTMLElement>(form.root, '[data-band-id="b2"]').hidden).toBe(true);
  });

  it('modified-only shows only changed fields', () => {
    const { section } = makeSection();
    const form = new SettingsForm(section);

    q<HTMLButtonElement>(form.root, '[data-field-key="alpha"] .cg-settings-toggle').click();
    form.setModifiedOnly(true);
    expect(q<HTMLElement>(form.root, '[data-field-key="alpha"]').hidden).toBe(false);
    expect(q<HTMLElement>(form.root, '[data-field-key="beta"]').hidden).toBe(true);
    expect(q<HTMLElement>(form.root, '[data-band-id="b2"]').hidden).toBe(true);
  });

  it('band header collapses / expands its body', () => {
    const { section } = makeSection();
    const form = new SettingsForm(section);
    const header = q<HTMLButtonElement>(form.root, '[data-band-id="b1"] .cg-settings-band-header');
    const body = q<HTMLElement>(form.root, '[data-band-id="b1"] .cg-settings-band-body');

    expect(body.hidden).toBe(false);
    header.click();
    expect(body.hidden).toBe(true);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    expect(body.hidden).toBe(false);
  });

  it('refresh() pulls externally-changed values into the controls', () => {
    const { section, store } = makeSection();
    const form = new SettingsForm(section);
    store.beta = 55;
    form.refresh();
    const input = q<HTMLInputElement>(form.root, '[data-field-key="beta"] input');
    expect(input.value).toBe('55');
    expect(form.modifiedCount()).toBe(1);
  });
});
