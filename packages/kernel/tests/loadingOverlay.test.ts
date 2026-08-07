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
});
