/**
 * Cycle 21i — CgcExpressionEditor unit tests (critical-review gap fill).
 * Mirrors smartEditPanel.test.ts / bulkUpdatePanel.test.ts: mount into
 * happy-dom, flush Lit's update cycle, assert against shadowRoot.
 *
 * Assertions read the textarea's ATTRIBUTE bindings (class / aria-invalid)
 * and the component's own `valid`/`errors` state rather than querying for
 * the conditionally-rendered `.errors`/`.ok` child elements: this
 * environment's happy-dom + lit-html combination does not correctly patch
 * a ChildPart whose value alternates between `nothing` and a nested
 * `html` TemplateResult (verified in isolation with a minimal LitElement
 * probe — unrelated to this component's logic). The attribute bindings
 * and `valid`/`errors` fields they're driven by are the real thing under
 * test (resolvedSchema()'s parse path, live-validate-on-input) and render
 * correctly in this environment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CgcExpressionEditor, defineExpressionEditor } from '../../src/customizer/expressionEditor';

async function flushLit(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function mountEditor(): Promise<CgcExpressionEditor & { shadowRoot: ShadowRoot }> {
  defineExpressionEditor();
  const el = document.createElement('cgc-expression-editor') as CgcExpressionEditor & { shadowRoot: ShadowRoot };
  document.body.appendChild(el);
  await flushLit();
  return el;
}

function textareaOf(el: CgcExpressionEditor & { shadowRoot: ShadowRoot }): HTMLTextAreaElement {
  return el.shadowRoot.querySelector('textarea') as HTMLTextAreaElement;
}

describe('CgcExpressionEditor', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  describe('resolvedSchema()', () => {
    it('validates against a valid schemaJson attribute value', async () => {
      const el = await mountEditor();
      el.schemaJson = JSON.stringify({ fields: { qty: 'number' } });
      el.value = '[qty] > 0';
      await flushLit();
      expect((el as unknown as { valid: boolean }).valid).toBe(true);
      expect((el as unknown as { errors: unknown[] }).errors).toEqual([]);
      const textarea = textareaOf(el);
      expect(textarea.classList.contains('is-invalid')).toBe(false);
      expect(textarea.getAttribute('aria-invalid')).toBe('false');
    });

    it('falls back to the schema property when schemaJson is malformed JSON (try/catch path)', async () => {
      const el = await mountEditor();
      el.schema = { fields: { qty: 'number' } };
      el.schemaJson = '{ this is not json';
      el.value = '[qty] > 0';
      await flushLit();
      // JSON.parse throws inside resolvedSchema()'s try/catch, which falls
      // through to `this.schema` — a condition valid under THAT schema
      // still validates clean, proving the catch path was taken rather
      // than crashing or leaving validation stuck.
      expect((el as unknown as { valid: boolean }).valid).toBe(true);
      expect((el as unknown as { errors: unknown[] }).errors).toEqual([]);
      expect(textareaOf(el).classList.contains('is-invalid')).toBe(false);
    });

    it('surfaces an unknown-field error when schemaJson parses but omits the referenced field', async () => {
      const el = await mountEditor();
      el.schemaJson = JSON.stringify({ fields: { price: 'number' } });
      el.value = '[qty] > 0';
      await flushLit();
      const errors = (el as unknown as { errors: Array<{ message: string }> }).errors;
      expect((el as unknown as { valid: boolean }).valid).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('qty');
      expect(textareaOf(el).classList.contains('is-invalid')).toBe(true);
    });
  });

  describe('live validate-on-input', () => {
    it('marks the textarea invalid as the user types an unknown field', async () => {
      const el = await mountEditor();
      el.schema = { fields: { qty: 'number' } };
      await flushLit();
      const textarea = textareaOf(el);
      textarea.value = '[bogus] > 0';
      textarea.dispatchEvent(new Event('input'));
      await flushLit();
      expect(textarea.classList.contains('is-invalid')).toBe(true);
      expect(textarea.getAttribute('aria-invalid')).toBe('true');
      const errors = (el as unknown as { errors: Array<{ message: string }> }).errors;
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.message).toContain('bogus');
    });

    it('clears the invalid state once the input becomes well-formed', async () => {
      const el = await mountEditor();
      el.schema = { fields: { qty: 'number' } };
      await flushLit();
      const textarea = textareaOf(el);

      textarea.value = '[bogus] > 0';
      textarea.dispatchEvent(new Event('input'));
      await flushLit();
      expect(textarea.classList.contains('is-invalid')).toBe(true);

      textarea.value = '[qty] > 0';
      textarea.dispatchEvent(new Event('input'));
      await flushLit();
      expect(textarea.classList.contains('is-invalid')).toBe(false);
      expect((el as unknown as { valid: boolean }).valid).toBe(true);
      expect((el as unknown as { errors: unknown[] }).errors).toEqual([]);
    });

    it('treats blank input as valid without producing errors', async () => {
      const el = await mountEditor();
      el.schema = { fields: { qty: 'number' } };
      await flushLit();
      const textarea = textareaOf(el);
      textarea.value = '   ';
      textarea.dispatchEvent(new Event('input'));
      await flushLit();
      expect(textarea.classList.contains('is-invalid')).toBe(false);
      expect((el as unknown as { valid: boolean }).valid).toBe(true);
      expect((el as unknown as { errors: unknown[] }).errors).toEqual([]);
    });

    it('emits cgc-change with the current textarea value on every input', async () => {
      const el = await mountEditor();
      el.schema = { fields: { qty: 'number' } };
      await flushLit();
      const seen: string[] = [];
      el.addEventListener('cgc-change', (e) => seen.push((e as CustomEvent<{ value: string }>).detail.value));
      const textarea = textareaOf(el);
      textarea.value = '[qty] > 5';
      textarea.dispatchEvent(new Event('input'));
      await flushLit();
      expect(seen).toEqual(['[qty] > 5']);
      expect(el.value).toBe('[qty] > 5');
    });
  });
});
