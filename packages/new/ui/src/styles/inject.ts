import { allCss } from './cssText';

const STYLE_ID = 'vg-new-ui-styles';

/** Inject the design-system stylesheet once into `root` (document or shadow). */
export function injectVgNewStyles(root: Document | ShadowRoot = document): void {
  const doc = root instanceof Document ? root : root.ownerDocument ?? document;
  const host = root instanceof Document ? root.head : root;
  if (host.querySelector(`#${STYLE_ID}`)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = allCss;
  host.appendChild(style);
}
