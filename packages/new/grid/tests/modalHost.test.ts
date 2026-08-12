/**
 * Cycle 21i Phase 2 / T4 — ModalHost unit tests.
 *
 * The kernel's generic modal primitive: backdrop + centered dialog on
 * the grid root with focus trap, ESC/backdrop dismiss, focus restore,
 * and one-modal-at-a-time semantics. Consumed by the Column Selector
 * dialog (#18) + Settings Sheet chrome in later phases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ModalHost, type ModalCloseReason } from '../src/interaction/modalHost';

function makeContent(): HTMLDivElement {
  const content = document.createElement('div');
  const input = document.createElement('input');
  input.className = 'first-input';
  const button = document.createElement('button');
  button.className = 'last-button';
  button.textContent = 'OK';
  content.appendChild(input);
  content.appendChild(button);
  return content;
}

function pressKey(key: string, shiftKey = false): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
}

describe('ModalHost', () => {
  let root: HTMLDivElement;
  let host: ModalHost;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    host = new ModalHost(root);
  });

  it('opens a titled dialog with backdrop, aria wiring, and body content', () => {
    host.open(makeContent(), { title: 'Column Selector', width: 560 });
    const backdrop = root.querySelector('.vg-modal-backdrop')!;
    const dialog = backdrop.querySelector('.vg-modal') as HTMLElement;
    expect(host.isOpen()).toBe(true);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Column Selector');
    expect(dialog.style.width).toBe('560px');
    expect(dialog.querySelector('.vg-modal-title')!.textContent).toBe('Column Selector');
    expect(dialog.querySelector('.vg-modal-body .first-input')).not.toBeNull();
  });

  it('focuses the first focusable on open and restores prior focus on close', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    host.open(makeContent(), { title: 'T' });
    expect((document.activeElement as HTMLElement).className).toBe('first-input');
    host.close();
    expect(document.activeElement).toBe(outside);
  });

  it('traps Tab: forward wraps last→first, Shift+Tab wraps first→last', () => {
    host.open(makeContent());
    const first = root.querySelector('.first-input') as HTMLElement;
    const last = root.querySelector('.last-button') as HTMLElement;
    last.focus();
    pressKey('Tab');
    expect(document.activeElement).toBe(first);
    first.focus();
    pressKey('Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('ESC closes with reason "escape"; closeOnEscape: false keeps it open', () => {
    const reasons: ModalCloseReason[] = [];
    host.open(makeContent(), { onClose: (r) => reasons.push(r) });
    pressKey('Escape');
    expect(host.isOpen()).toBe(false);
    expect(reasons).toEqual(['escape']);

    host.open(makeContent(), { closeOnEscape: false, onClose: (r) => reasons.push(r) });
    pressKey('Escape');
    expect(host.isOpen()).toBe(true);
    host.close();
    expect(reasons).toEqual(['escape', 'api']);
  });

  it('backdrop mousedown closes with reason "backdrop"; clicks INSIDE the dialog do not', () => {
    const reasons: ModalCloseReason[] = [];
    host.open(makeContent(), { onClose: (r) => reasons.push(r) });
    const dialog = host.getDialogElement()!;
    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.isOpen()).toBe(true);
    const backdrop = root.querySelector('.vg-modal-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.isOpen()).toBe(false);
    expect(reasons).toEqual(['backdrop']);
  });

  it('the title-row close button closes with reason "closeButton"', () => {
    const reasons: ModalCloseReason[] = [];
    host.open(makeContent(), { title: 'T', onClose: (r) => reasons.push(r) });
    (root.querySelector('.vg-modal-close') as HTMLButtonElement).click();
    expect(reasons).toEqual(['closeButton']);
  });

  it('one modal at a time — reopening closes the prior dialog with reason "api"', () => {
    const reasons: ModalCloseReason[] = [];
    host.open(makeContent(), { title: 'First', onClose: (r) => reasons.push(r) });
    host.open(makeContent(), { title: 'Second' });
    expect(reasons).toEqual(['api']);
    expect(root.querySelectorAll('.vg-modal-backdrop').length).toBe(1);
    expect(host.getDialogElement()!.getAttribute('aria-label')).toBe('Second');
  });

  it('destroy closes with reason "destroy" and refuses further opens', () => {
    const reasons: ModalCloseReason[] = [];
    host.open(makeContent(), { onClose: (r) => reasons.push(r) });
    host.destroy();
    expect(reasons).toEqual(['destroy']);
    host.open(makeContent());
    expect(host.isOpen()).toBe(false);
    expect(root.querySelector('.vg-modal-backdrop')).toBeNull();
  });
});
