import { afterEach, describe, expect, it } from 'vitest';
import {
  applyThemeToPopout,
  findThemeSource,
  resolveThemeMode,
} from '../src/editor/themeSync';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-vg-theme-mode');
  document.documentElement.className = '';
});

describe('resolveThemeMode', () => {
  it('reads data-vg-theme-mode', () => {
    const el = document.createElement('div');
    el.setAttribute('data-vg-theme-mode', 'dark');
    document.body.appendChild(el);
    expect(resolveThemeMode(el)).toBe('dark');
  });

  it('detects -dark theme class', () => {
    const el = document.createElement('div');
    el.className = 'vgext-root vg-theme-quartz-dark';
    document.body.appendChild(el);
    expect(resolveThemeMode(el)).toBe('dark');
  });

  it('detects light theme class', () => {
    const el = document.createElement('div');
    el.className = 'vg-theme-quartz';
    document.body.appendChild(el);
    expect(resolveThemeMode(el)).toBe('light');
  });
});

describe('applyThemeToPopout', () => {
  it('stamps mode, color-scheme, theme class, and copied tokens', () => {
    const source = document.createElement('div');
    source.className = 'vgext-root vg-theme-quartz-dark';
    source.style.setProperty('--vg-fg-color', '#E6E8EC');
    source.style.setProperty('--vg-bg-color', '#1A232E');
    source.style.setProperty('--vg-popup-bg', '#242E3A');
    document.body.appendChild(source);

    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const win = iframe.contentWindow!;
    const doc = win.document;
    doc.open();
    doc.write('<!doctype html><html><body></body></html>');
    doc.close();

    const mode = applyThemeToPopout(win, source);
    expect(mode).toBe('dark');
    expect(doc.documentElement.getAttribute('data-vg-theme-mode')).toBe('dark');
    expect(doc.documentElement.style.colorScheme).toBe('dark');
    expect(doc.documentElement.classList.contains('vg-theme-quartz-dark')).toBe(true);
    expect(doc.documentElement.style.getPropertyValue('--vg-fg-color').trim()).toBe('#E6E8EC');
    expect(doc.documentElement.style.getPropertyValue('--vg-popup-bg').trim()).toBe('#242E3A');
  });
});

describe('findThemeSource', () => {
  it('prefers an explicit connected source', () => {
    const el = document.createElement('div');
    el.className = 'vg-theme-starui-dark';
    document.body.appendChild(el);
    expect(findThemeSource(el)).toBe(el);
  });

  it('falls back to .vgext-root with theme class', () => {
    const el = document.createElement('div');
    el.className = 'vgext-root vg-theme-quartz';
    document.body.appendChild(el);
    expect(findThemeSource(null)).toBe(el);
  });
});
