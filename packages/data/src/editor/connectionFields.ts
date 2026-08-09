import type { ConnectionFieldsApi, ConnectionFieldsHandle } from '../registry/plugins';

export type FieldDescriptor =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'number'; key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: string[] };

/** Mount a simple label/control grid driven by field descriptors. */
export function mountFieldDescriptors(
  host: HTMLElement,
  fields: FieldDescriptor[],
  api: ConnectionFieldsApi,
): ConnectionFieldsHandle {
  const grid = document.createElement('div');
  grid.className = 'vg-dp-editor__grid';
  grid.style.display = 'contents';

  const wrap = document.createElement('div');
  wrap.className = 'vg-dp-editor__grid';

  for (const f of fields) {
    const lab = document.createElement('label');
    lab.textContent = f.label;
    let control: HTMLElement;
    if (f.kind === 'select') {
      const sel = document.createElement('select');
      for (const o of f.options) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        if (String(api.value[f.key] ?? '') === o) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => api.onChange({ [f.key]: sel.value }));
      control = sel;
    } else {
      const input = document.createElement('input');
      input.type = f.kind === 'number' ? 'number' : 'text';
      if (f.kind === 'text' && f.placeholder) input.placeholder = f.placeholder;
      const raw = api.value[f.key];
      input.value = raw == null ? '' : String(raw);
      input.addEventListener('change', () => {
        api.onChange({
          [f.key]: f.kind === 'number' ? (Number(input.value) || 0) : input.value,
        });
      });
      control = input;
    }
    wrap.append(lab, control);
  }

  host.appendChild(wrap);
  return { destroy() { wrap.remove(); } };
}

/** Fallback when a plugin has no mountConnectionFields — editable JSON blob. */
export function mountGenericConfigFields(
  host: HTMLElement,
  api: ConnectionFieldsApi,
): ConnectionFieldsHandle {
  const wrap = document.createElement('div');
  wrap.className = 'vg-dp-editor__grid';
  const lab = document.createElement('label');
  lab.textContent = 'config (JSON)';
  const ta = document.createElement('textarea');
  ta.rows = 8;
  const skip = new Set([
    'keyColumn', 'throttleEnabled', 'throttleMs', 'conflateEnabled', 'conflateByKey',
    'thinDeltas', 'projectFields', 'wireFormat', 'snapshotChunkSize', 'reconnect',
    'inferredFields', 'columnDefinitions',
  ]);
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(api.value)) {
    if (!skip.has(k)) custom[k] = v;
  }
  ta.value = JSON.stringify(custom, null, 2);
  ta.addEventListener('change', () => {
    try {
      const parsed = JSON.parse(ta.value) as Record<string, unknown>;
      api.onChange(parsed);
    } catch { /* ignore invalid JSON until blur-valid */ }
  });
  wrap.append(lab, ta);
  host.appendChild(wrap);
  return { destroy() { wrap.remove(); } };
}
