/** Tiny DOM helpers shared by editor UI components. */

export type Attrs = Record<string, string | number | boolean | undefined | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | string | null,
  children?: Array<Node | string | null | undefined> | string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (typeof attrs === 'string') {
    node.className = attrs;
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'className' || k === 'class') node.className = String(v);
      else if (k === 'textContent') node.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'string') node.setAttribute(k, v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  if (typeof children === 'string') node.textContent = children;
  else if (children) {
    for (const c of children) {
      if (c == null) continue;
      node.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

export function setTestId(node: HTMLElement, id?: string): void {
  if (id) node.setAttribute('data-testid', id);
}
