import { describe, it, expect, vi } from 'vitest';
import { createIconPicker } from '../src/toolbar/iconPicker';

describe('createIconPicker', () => {
  it('renders category sections with 8-column tile grids and fires onSelect', () => {
    const onSelect = vi.fn();
    const p = createIconPicker({ onSelect });
    document.body.append(p.button, p.panel);
    p.button.click(); // open
    expect(p.panel.hidden).toBe(false);
    const grids = p.panel.querySelectorAll('.vgext-ip-grid');
    expect(grids.length).toBeGreaterThan(8); // lucide cats + 8 emoji cats
    const tile = p.panel.querySelector('.vgext-ip-tile[data-icon="flame"]') as HTMLButtonElement;
    expect(tile.querySelector('svg')).toBeTruthy();
    tile.click();
    expect(onSelect).toHaveBeenCalledWith({ name: 'flame' });
    expect(p.panel.hidden).toBe(true); // selecting closes
    p.destroy();
  });

  it('search filters tiles across both sources; emoji tiles fire {emoji}', () => {
    const onSelect = vi.fn();
    const p = createIconPicker({ onSelect });
    document.body.append(p.button, p.panel);
    p.button.click();
    const search = p.panel.querySelector('[data-ip="search"]') as HTMLInputElement;
    search.value = 'flame';
    search.dispatchEvent(new Event('input'));
    expect(p.panel.querySelector('.vgext-ip-tile[data-icon="flame"]')).toBeTruthy();
    expect(p.panel.querySelector('.vgext-ip-tile[data-icon="anchor"]')).toBeFalsy();
    search.value = ''; search.dispatchEvent(new Event('input'));
    (p.panel.querySelector('.vgext-ip-tile[data-emoji="🔥"]') as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenLastCalledWith({ emoji: '🔥' });
    p.destroy();
  });

  it('emoji tiles are searchable by their English name', () => {
    const onSelect = vi.fn();
    const p = createIconPicker({ onSelect });
    document.body.append(p.button, p.panel);
    p.button.click();
    const search = p.panel.querySelector('[data-ip="search"]') as HTMLInputElement;
    // Typing a word — not the glyph — must reveal the 🔥 tile.
    search.value = 'fire';
    search.dispatchEvent(new Event('input'));
    const flame = p.panel.querySelector('.vgext-ip-tile[data-emoji="🔥"]') as HTMLButtonElement;
    expect(flame).toBeTruthy();
    // and the tile still selects with the glyph payload the caller expects.
    flame.click();
    expect(onSelect).toHaveBeenLastCalledWith({ emoji: '🔥' });
    p.destroy();
  });

  it('setPreview reflects the current slot into the button', () => {
    const p = createIconPicker({ onSelect: () => {} });
    p.setPreview({ emoji: '🚀' });
    expect(p.button.textContent).toContain('🚀');
    p.setPreview({ name: 'flame' });
    expect(p.button.querySelector('svg')).toBeTruthy();
    p.setPreview(null);
    expect(p.button.querySelector('svg') ?? p.button.textContent?.trim()).toBeTruthy(); // placeholder glyph
    p.destroy();
  });
});
