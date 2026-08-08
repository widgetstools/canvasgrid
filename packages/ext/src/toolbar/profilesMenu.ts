/**
 * Profile switcher for the VelocityGridExt title bar — list / switch / rename /
 * save-as / delete, plus a dirty-aware profile Save disk.
 *
 * Profiles are full grid+ext snapshots (distinct from kernel *layouts*,
 * which are named view lenses). Both live in the title bar: layouts for
 * "how the grid looks", profiles for "trader workspace".
 */
import type { ToolbarItem, VelocityGridExtContext, ProfileMeta } from '../extension/types';
import { menu, svg, iconButton } from './ui';

const I = {
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M20 6L9 17l-5-5',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Dirty-aware "save active profile" disk. */
export function profileSaveItem(): ToolbarItem {
  return {
    id: 'profile-save',
    kind: 'toolbar-item',
    slot: 'primary-right',
    init() {},
    render(host, ctx) {
      const btn = iconButton(I.save, 'Profile up to date');
      btn.classList.add('vgext-save');
      const sync = (dirty: boolean) => {
        btn.classList.toggle('is-dirty', dirty);
        btn.disabled = !dirty;
        const id = ctx.profiles.activeId();
        btn.title = dirty
          ? `Save profile '${id}' (unsaved changes)`
          : 'Profile up to date';
      };
      sync(ctx.profiles.isDirty());
      const off = ctx.profiles.onDirtyChange(sync);
      btn.addEventListener('click', () => { void ctx.profiles.save(); });
      host.appendChild(btn);
      return { destroy() { off(); host.replaceChildren(); } };
    },
  };
}

/** Dropdown listing saved profiles with switch / rename / save-as / delete. */
export function profilesItem(): ToolbarItem {
  return {
    id: 'profiles',
    kind: 'toolbar-item',
    slot: 'primary-right',
    init() {},
    render(host, ctx) {
      injectProfileStyles();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vgext-pill vgext-profile vgext-profiles-trigger';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML =
        `<span class="vgext-profile-avatar">${svg(I.user, 13)}</span>` +
        `<span class="vgext-pill-name vgext-profile-name"></span>` +
        `<span class="vgext-pill-caret">${svg(I.chevronDown, 13)}</span>`;
      const nameEl = btn.querySelector('.vgext-profile-name')!;

      const paint = async () => {
        const id = ctx.profiles.activeId();
        const list = await ctx.profiles.list();
        const meta = list.find((m) => m.id === id);
        const name = meta?.name ?? id;
        nameEl.textContent = name;
        btn.title = `Profile: ${name}`;
      };
      void paint();

      let refreshOpenPanel: (() => void) | null = null;
      const m = menu(
        btn,
        (close) => {
          const { el, refresh } = buildPanel(ctx, close);
          refreshOpenPanel = refresh;
          return el;
        },
        (open) => {
          btn.setAttribute('aria-expanded', String(open));
          if (!open) refreshOpenPanel = null;
        },
      );
      btn.addEventListener('click', () => m.toggle());

      const offDirty = ctx.profiles.onDirtyChange(() => { void paint(); });
      const offList = ctx.profiles.onListChange(() => {
        void paint();
        refreshOpenPanel?.();
      });

      host.appendChild(btn);
      return {
        destroy() {
          offDirty();
          offList();
          m.destroy();
          host.replaceChildren();
        },
      };
    },
  };
}

function buildPanel(ctx: VelocityGridExtContext, close: () => void): { el: HTMLElement; refresh: () => void } {
  const el = document.createElement('div');
  el.className = 'vgext-profiles-menu';
  const err = document.createElement('div');
  err.className = 'vgext-profiles-err';
  err.hidden = true;
  el.appendChild(err);

  const setErr = (msg: string | null) => {
    if (!msg) { err.hidden = true; err.textContent = ''; return; }
    err.hidden = false;
    err.textContent = msg;
  };

  const refresh = () => {
    el.querySelectorAll('.vgext-profiles-row, .vgext-profiles-actions').forEach((n) => n.remove());
    setErr(null);
    void ctx.profiles.list().then((list) => {
      const active = ctx.profiles.activeId();
      list.sort((a, b) => a.name.localeCompare(b.name));
      for (const meta of list) {
        el.appendChild(rowEl(meta, active, ctx, setErr, () => { refresh(); close(); }));
      }
      el.appendChild(actionsEl(ctx, setErr, () => { refresh(); close(); }));
    });
  };
  refresh();
  return { el, refresh };
}

function rowEl(
  m: ProfileMeta,
  activeId: string,
  ctx: VelocityGridExtContext,
  setErr: (msg: string | null) => void,
  done: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vgext-profiles-row';
  if (m.id === activeId) row.classList.add('is-active');

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'vgext-profiles-main';
  if (m.id === activeId) main.insertAdjacentHTML('afterbegin', svg(I.check, 14));
  else {
    const spacer = document.createElement('span');
    spacer.className = 'vgext-profiles-check-spacer';
    main.append(spacer);
  }
  const name = document.createElement('span');
  name.textContent = m.name;
  main.append(name);
  main.addEventListener('click', () => {
    void ctx.profiles.switchTo(m.id).then(done).catch((e) => setErr(errText(e)));
  });

  const renameBtn = iconButton(I.pencil, 'Rename');
  renameBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const next = window.prompt('Rename profile', m.name);
    if (next == null) return;
    void ctx.profiles.rename(m.id, next).then(done).catch((e) => setErr(errText(e)));
  });

  const delBtn = iconButton(I.trash, 'Delete');
  delBtn.disabled = m.id === activeId;
  delBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!window.confirm(`Delete profile '${m.name}'?`)) return;
    void ctx.profiles.remove(m.id).then(done).catch((e) => setErr(errText(e)));
  });

  row.append(main, renameBtn, delBtn);
  return row;
}

function actionsEl(
  ctx: VelocityGridExtContext,
  setErr: (msg: string | null) => void,
  done: () => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'vgext-profiles-actions';
  const saveAs = document.createElement('button');
  saveAs.type = 'button';
  saveAs.className = 'vgext-btn';
  saveAs.innerHTML = `${svg(I.plus, 14)} Save as…`;
  saveAs.addEventListener('click', () => {
    const name = window.prompt('New profile name');
    if (name == null) return;
    void ctx.profiles.saveAs(name).then(done).catch((e) => setErr(errText(e)));
  });
  wrap.append(saveAs);
  return wrap;
}

function injectProfileStyles(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById('vgext-profiles-styles') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'vgext-profiles-styles';
    document.head.appendChild(style);
  }
  style.textContent = `
.vgext-profiles-menu { min-width: 240px; max-width: 320px; padding: 6px; }
.vgext-profiles-err {
  color: var(--vg-danger-color, #f87171); font-size: 11px;
  padding: 4px 6px; margin-bottom: 4px;
}
.vgext-profiles-row {
  display: flex; align-items: center; gap: 2px;
  border-radius: var(--vg-radius, 6px);
}
.vgext-profiles-row.is-active { background: var(--vg-row-alt-bg, rgba(255,255,255,0.06)); }
.vgext-profiles-main {
  flex: 1; display: inline-flex; align-items: center; gap: 6px;
  border: 0; background: transparent; color: inherit; cursor: pointer;
  padding: 6px 8px; text-align: left; font: inherit; min-width: 0;
}
.vgext-profiles-main span {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vgext-profiles-check-spacer { width: 14px; height: 14px; flex: 0 0 auto; }
.vgext-profiles-actions {
  display: flex; gap: 6px; padding: 8px 4px 4px;
  border-top: 1px solid var(--vg-border-color, rgba(255,255,255,0.08));
  margin-top: 4px;
}
.vgext-profiles-actions .vgext-btn {
  display: inline-flex; align-items: center; gap: 6px;
}
`;
}
