import type { ConnectionFieldsApi, ConnectionFieldsHandle } from '../registry/plugins';
import {
  createCard,
  createField,
  createNumberInput,
  createSelect,
  createTextInput,
  createTextarea,
} from './ui';

export type FieldDescriptor =
  | {
      kind: 'text';
      key: string;
      label: string;
      placeholder?: string;
      help?: string;
      required?: boolean;
      mono?: boolean;
    }
  | {
      kind: 'number';
      key: string;
      label: string;
      help?: string;
      required?: boolean;
    }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: string[];
      help?: string;
      required?: boolean;
    };

export type FieldGroup = {
  title: string;
  fields: FieldDescriptor[];
};

/** Mount a simple label/control grid driven by field descriptors. */
export function mountFieldDescriptors(
  host: HTMLElement,
  fields: FieldDescriptor[],
  api: ConnectionFieldsApi,
): ConnectionFieldsHandle {
  const wrap = document.createElement('div');
  wrap.className = 'vg-dp-editor__grid';
  for (const f of fields) {
    appendField(wrap, f, api);
  }
  host.appendChild(wrap);
  return { destroy() { wrap.remove(); } };
}

/**
 * Markets-style connection cards — titled sections with stacked fields
 * and helper copy under each control.
 */
export function mountFieldGroups(
  host: HTMLElement,
  groups: FieldGroup[],
  api: ConnectionFieldsApi,
): ConnectionFieldsHandle {
  const root = document.createElement('div');
  root.className = 'vg-dp-fields';
  for (const g of groups) {
    root.appendChild(createCard(g.title, (card) => {
      for (const f of g.fields) {
        card.appendChild(createField({
          label: f.label,
          required: f.required,
          control: createControl(f, api),
          help: f.help,
        }));
      }
    }));
  }
  host.appendChild(root);
  return { destroy() { root.remove(); } };
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
  const skip = new Set([
    'keyColumn', 'throttleEnabled', 'throttleMs', 'conflateEnabled', 'conflateByKey',
    'thinDeltas', 'projectFields', 'wireFormat', 'snapshotChunkSize', 'reconnect',
    'inferredFields', 'columnDefinitions',
  ]);
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(api.value)) {
    if (!skip.has(k)) custom[k] = v;
  }
  const ta = createTextarea({
    rows: 8,
    value: JSON.stringify(custom, null, 2),
    onChange: (value) => {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        api.onChange(parsed);
      } catch { /* ignore invalid JSON until blur-valid */ }
    },
  });
  wrap.append(lab, ta);
  host.appendChild(wrap);
  return { destroy() { wrap.remove(); } };
}

function appendField(
  wrap: HTMLElement,
  f: FieldDescriptor,
  api: ConnectionFieldsApi,
): void {
  const lab = document.createElement('label');
  lab.textContent = f.required ? `${f.label} *` : f.label;
  wrap.append(lab, createControl(f, api));
}

/** Read flat or dotted keys (`heartbeat.outgoing`). */
function readFieldValue(value: Record<string, unknown>, key: string): unknown {
  const dot = key.indexOf('.');
  if (dot < 0) return value[key];
  const root = key.slice(0, dot);
  const child = key.slice(dot + 1);
  const nested = value[root];
  if (nested && typeof nested === 'object') {
    return (nested as Record<string, unknown>)[child];
  }
  return undefined;
}

function patchFieldValue(
  api: ConnectionFieldsApi,
  key: string,
  next: unknown,
): void {
  const dot = key.indexOf('.');
  if (dot < 0) {
    api.onChange({ [key]: next });
    return;
  }
  const root = key.slice(0, dot);
  const child = key.slice(dot + 1);
  const prev = (api.value[root] && typeof api.value[root] === 'object')
    ? { ...(api.value[root] as Record<string, unknown>) }
    : {};
  prev[child] = next;
  api.onChange({ [root]: prev });
}

function createControl(f: FieldDescriptor, api: ConnectionFieldsApi): HTMLElement {
  if (f.kind === 'select') {
    return createSelect({
      value: String(readFieldValue(api.value, f.key) ?? ''),
      options: f.options,
      onChange: (value) => patchFieldValue(api, f.key, value),
    });
  }
  if (f.kind === 'number') {
    return createNumberInput({
      value: Number(readFieldValue(api.value, f.key) ?? 0) || 0,
      onChange: (value) => patchFieldValue(api, f.key, value),
    });
  }
  // Live updates on input (Markets-style) — don't wait for blur.
  return createTextInput({
    value: readFieldValue(api.value, f.key) == null
      ? ''
      : String(readFieldValue(api.value, f.key)),
    placeholder: f.placeholder,
    mono: f.mono,
    onInput: (value) => patchFieldValue(api, f.key, value),
  });
}
