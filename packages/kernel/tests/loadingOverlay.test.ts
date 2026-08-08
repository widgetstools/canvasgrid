import { describe, it, expect, afterEach } from 'vitest';
import { LoadingOverlay } from '../src/interaction/loadingOverlay';

describe('LoadingOverlay', () => {
  let host: HTMLElement;

  afterEach(() => {
    host?.remove();
  });

  it('mounts hidden and toggles with setLoading', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const overlay = new LoadingOverlay(host);
    const el = host.querySelector('.cg-loading-overlay') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.hidden).toBe(true);
    expect(el.textContent).toContain('Loading');

    overlay.setLoading(true);
    expect(el.hidden).toBe(false);
    expect(el.getAttribute('aria-busy')).toBe('true');

    overlay.setLoading(false);
    expect(el.hidden).toBe(true);
    expect(el.getAttribute('aria-busy')).toBe('false');

    overlay.destroy();
    expect(host.querySelector('.cg-loading-overlay')).toBeNull();
  });

  it('updates message and progress detail', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const overlay = new LoadingOverlay(host);
    const label = host.querySelector('.cg-loading-overlay-label') as HTMLElement;
    const detail = host.querySelector('.cg-loading-overlay-detail') as HTMLElement;

    overlay.setMessage('Loading snapshot…');
    expect(label.textContent).toBe('Loading snapshot…');

    overlay.setProgress(12450, 20000);
    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toMatch(/12[,.]?450/);
    expect(detail.textContent).toMatch(/20[,.]?000/);
    expect(detail.textContent).toContain('rows');

    overlay.setProgress(42);
    expect(detail.textContent).toMatch(/42/);
    expect(detail.textContent).toContain('rows loaded');

    overlay.setLoading(false);
    expect(detail.hidden).toBe(true);
    expect(detail.textContent).toBe('');
  });
});
