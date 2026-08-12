/**
 * Small allowlist HTML sanitizers for DOM sinks that historically used
 * unsanitized `innerHTML` (tooltip `{ html }`, context-menu icons).
 *
 * Not a full HTML purifier — strips disallowed tags/attrs and event
 * handlers. Prefer `{ plain }` / textContent for untrusted app data.
 */

const TOOLTIP_ALLOWED = new Set([
  'B', 'I', 'EM', 'STRONG', 'BR', 'SPAN', 'CODE', 'U', 'SMALL',
]);

const SVG_ALLOWED = new Set([
  'SVG', 'G', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON',
  'ELLIPSE', 'DEFS', 'USE', 'TITLE', 'DESC', 'TEXT', 'TSPAN',
]);

const SVG_ALLOWED_ATTR = new Set([
  'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'rx', 'ry',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'opacity',
  'fill-opacity', 'stroke-opacity', 'xmlns', 'class', 'aria-hidden',
  'role', 'focusable',
]);

function stripDisallowed(root: ParentNode, allowedTags: Set<string>, allowedAttrs: Set<string> | null): void {
  const nodes = Array.from(root.childNodes);
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType === Node.COMMENT_NODE) {
      root.removeChild(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      root.removeChild(node);
      continue;
    }
    const el = node as Element;
    // HTML elements report uppercase tagName; SVG-in-HTML (jsdom) may
    // report lowercase — normalize before the allowlist check.
    const tag = el.tagName.toUpperCase();
    if (!allowedTags.has(tag)) {
      const text = document.createTextNode(el.textContent ?? '');
      root.replaceChild(text, el);
      continue;
    }
    // Drop event handlers / javascript: URLs. When an allowlist is
    // provided, also drop unknown attrs; when null (tooltip), strip
    // every attribute so markup is structure-only.
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      const lower = name.toLowerCase();
      if (
        lower.startsWith('on')
        || lower === 'style'
        || lower === 'href'
        || lower === 'src'
        || allowedAttrs === null
        || (!allowedAttrs.has(name) && !allowedAttrs.has(lower))
      ) {
        el.removeAttribute(name);
      }
    }
    stripDisallowed(el, allowedTags, allowedAttrs);
  }
}

/** Allowlist sanitize for tooltip `{ html }` payloads. */
export function sanitizeTooltipHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  stripDisallowed(template.content, TOOLTIP_ALLOWED, null);
  return template.innerHTML;
}

/**
 * Allowlist sanitize for context-menu icon markup (typically inline SVG).
 * Non-SVG roots are escaped as text.
 */
export function sanitizeIconHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }
  const trimmed = html.trim();
  if (!trimmed.toLowerCase().startsWith('<svg')) {
    const span = document.createElement('span');
    span.textContent = html;
    return span.innerHTML;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  stripDisallowed(template.content, SVG_ALLOWED, SVG_ALLOWED_ATTR);
  return template.innerHTML;
}
