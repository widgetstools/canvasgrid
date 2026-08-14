import { describe, expect, it } from 'vitest';
import { band, emptyState } from '../src/ui/cockpit';

describe('emptyState', () => {
  it('renders a shared title + body + optional action', () => {
    const action = document.createElement('button');
    action.textContent = 'Add rule';
    const node = emptyState({
      title: 'No rule selected',
      description: 'Select a rule, or add one with +.',
      action,
    });
    expect(node.className).toBe('ckp-empty');
    expect(node.querySelector('.ckp-empty-title')?.textContent).toBe('No rule selected');
    expect(node.querySelector('.ckp-empty-body')?.textContent).toBe('Select a rule, or add one with +.');
    expect(node.querySelector('button')?.textContent).toBe('Add rule');
    expect(node.querySelector('.ckp-empty-icon')).toBeTruthy();
  });
});

describe('band', () => {
  it('toggles collapse from the section head (chevron affordance)', () => {
    const { root, body } = band('Header');
    body.textContent = 'rows';
    const head = root.querySelector('.ckp-band-head') as HTMLButtonElement;
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(root.classList.contains('is-collapsed')).toBe(false);

    head.click();
    expect(root.classList.contains('is-collapsed')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');

    head.click();
    expect(root.classList.contains('is-collapsed')).toBe(false);
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });
});
