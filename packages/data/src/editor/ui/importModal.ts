import { el, setTestId } from './dom';
import { createModal } from './modal';

export type JsonImportModalOpts = {
  /** Modal + field title (e.g. "Import provider"). */
  title: string;
  /** Sub-line under the title. */
  description?: string;
  /** Placeholder inside the paste area. */
  placeholder?: string;
  /** Small helper line under the paste area. */
  hint?: string;
  /** Primary button label. Defaults to "Import". */
  submitLabel?: string;
  /** data-testid stem for the dialog (buttons/inputs derive from it). */
  testId?: string;
  /**
   * Parse + apply the pasted / dropped text. Throw (or reject) to surface the
   * message inline and keep the modal open; resolve to close it.
   */
  onSubmit: (text: string) => void | Promise<void>;
  onClose: () => void;
};

/**
 * Import-from-JSON modal — paste into a textarea or drop a `.json` file. Uses
 * no native OS file dialog, so it behaves identically in a `window.open`
 * popout, OpenFin/Electron, or inline hosts (unlike a hidden `<input type=file>`,
 * whose picker is unreliable from a popup window). Reuses the editor's modal +
 * field chrome so it matches the rest of the surface.
 */
export function createJsonImportModal(opts: JsonImportModalOpts): HTMLElement {
  const submitLabel = opts.submitLabel ?? 'Import';
  const testId = opts.testId;

  const field = el('div', 'vg-dp-field');

  const drop = el('div', 'vg-dp-import-drop');
  const textarea = el('textarea', {
    className: 'vg-dp-import-textarea vg-dp-mono',
    placeholder: opts.placeholder ?? 'Paste JSON here, or drop a .json file…',
    'aria-label': opts.title,
  });
  textarea.spellcheck = false;
  setTestId(textarea, testId ? `${testId}-textarea` : undefined);
  drop.appendChild(textarea);
  field.appendChild(drop);

  if (opts.hint) field.appendChild(el('p', 'vg-dp-field__help', opts.hint));

  const error = el('p', 'vg-dp-editor__error vg-dp-import-error');
  error.hidden = true;
  field.appendChild(error);

  const showError = (msg: string): void => { error.textContent = msg; error.hidden = false; };
  const clearError = (): void => { error.hidden = true; error.textContent = ''; };
  textarea.addEventListener('input', clearError);

  const readFile = (file: File): void => {
    void Promise.resolve(file.text())
      .then((t) => { textarea.value = t; clearError(); textarea.focus(); })
      .catch(() => showError('Could not read the dropped file.'));
  };

  let submitBtn: HTMLButtonElement | null = null;

  const overlay = createModal({
    title: opts.title,
    description: opts.description,
    body: field,
    testId,
    onBackdropClose: opts.onClose,
    actions: [
      { label: 'Cancel', variant: 'secondary', onClick: opts.onClose },
      {
        label: submitLabel,
        variant: 'primary',
        testId: testId ? `${testId}-submit` : undefined,
        onClick: () => {
          const text = textarea.value.trim();
          if (!text) { showError('Paste JSON or drop a .json file first.'); textarea.focus(); return; }
          clearError();
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Importing…'; }
          void (async () => {
            try {
              await opts.onSubmit(text);
              opts.onClose();
            } catch (err) {
              showError(err instanceof Error ? err.message : String(err));
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
            }
          })();
        },
      },
    ],
  });

  submitBtn = overlay.querySelector<HTMLButtonElement>(
    testId ? `[data-testid="${testId}-submit"]` : '.vg-dp-modal__footer .vg-dp-btn--primary',
  );

  // Drag & drop a .json file → read its text into the paste area. Handlers live
  // on the WHOLE overlay (which fills the popout window), not just the textarea,
  // so a file dropped anywhere on the modal is captured and the browser never
  // navigates away to open the dropped file — the classic file-drop bug that
  // makes a hidden-file-input-free drop appear to "do nothing". Every dragover
  // is prevented so the drop is always accepted.
  overlay.addEventListener('dragenter', (e) => { e.preventDefault(); });
  overlay.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    drop.classList.add('is-dragover');
  });
  overlay.addEventListener('dragleave', (e) => {
    // Only clear when the pointer actually leaves the overlay.
    if (!overlay.contains(e.relatedTarget as Node | null)) drop.classList.remove('is-dragover');
  });
  overlay.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) readFile(file);
  });

  // Focus the paste area once mounted.
  queueMicrotask(() => textarea.focus());

  return overlay;
}
