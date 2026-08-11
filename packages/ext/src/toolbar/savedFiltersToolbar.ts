/**
 * Saved filter pills — title-bar strip that captures / toggles / persists
 * named filter models per layout (Markets Grid "quick filter buttons").
 */
import type { VelocityGridExtContext, ToolbarItem, ToolbarItemInstance } from '../extension/types';
import {
  doesRowMatchFilterModel,
  filterModelsEqual,
  generateLabel,
  isNewFilter,
  makeId,
  mergeFilterModels,
  normalizeFilterModelForCompare,
  subtractFilterModel,
  type SavedFilterShape,
} from './savedFiltersLogic';

export interface SavedFilter {
  id: string;
  label: string;
  filterModel: Record<string, unknown>;
  active: boolean;
}

const I = {
  /** Lucide filter-plus — same funnel body as filterX for matched optical size. */
  filterPlus: 'M13.013 3H2l8 9.46V19l4 2v-8.54l.9-1.055 M16 6h6 M19 3v6',
  /** Lucide filter-x */
  filterX: 'M13.013 3H2l8 9.46V19l4 2v-8.54l.9-1.055 M22 3l-5 5 M17 3l5 5',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  more: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1 M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1',
  chevronL: 'M15 18l-6-6 6-6',
  chevronR: 'M9 18l6-6-6-6',
  x: 'M18 6L6 18M6 6l12 12',
};

const MODULE_ID = 'saved-filters';
const MODULE_VERSION = 1;

type FilterHost = {
  getFilterModel(): Record<string, unknown>;
  setFilterModel(f: Record<string, unknown>): void;
  forEachRow?(fn: (rowId: string, row: unknown) => void): void;
  getDisplayedRowCount?(): number;
  getSsrmExpressionHost?(): {
    countMatchingFilterModel?(filterModel: Record<string, unknown>): Promise<number>;
  } | null;
  addEventListener?(type: string, fn: (e: unknown) => void): () => void;
  registerStateModule?(m: {
    id: string;
    version: number;
    get(): unknown;
    set(data: unknown, version: number): void;
  }): () => void;
  notifyModuleStateChanged?(id: string): void;
};

function validateFilters(raw: unknown): SavedFilter[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedFilter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    if (!r.filterModel || typeof r.filterModel !== 'object') continue;
    out.push({
      id: r.id,
      label: r.label,
      filterModel: r.filterModel as Record<string, unknown>,
      active: !!r.active,
    });
  }
  return out;
}

function iconBtn(
  path: string,
  title: string,
  cls = 'vgext-sf-iconbtn',
  size = 14,
  strokeWidth = 1.8,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  // Inline stroke-width so CSS can't leave mismatched weights on sibling icons.
  b.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${path}"/></svg>`;
  return b;
}

function ensureStyles(): void {
  const ID = 'vgext-saved-filters-styles';
  let style = document.getElementById(ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = ID;
    document.head.appendChild(style);
  }
  style.textContent = SAVED_FILTERS_CSS;
}

/** Title-bar saved-filter pills (slot: primary-left, after brand). */
export function savedFiltersItem(): ToolbarItem {
  return {
    id: 'saved-filters',
    kind: 'toolbar-item',
    slot: 'primary-left',
    init() { ensureStyles(); },
    render(host, ctx): ToolbarItemInstance {
      ensureStyles();
      const grid = ctx.grid as FilterHost;
      let filters: SavedFilter[] = [];
      let pushing = false;
      let counts: Record<string, number> = {};

      const root = document.createElement('div');
      root.className = 'vgext-sf';
      root.setAttribute('data-testid', 'vgext-saved-filters');

      const scroller = document.createElement('div');
      scroller.className = 'vgext-sf-scroll';
      const pillsEl = document.createElement('div');
      pillsEl.className = 'vgext-sf-pills';
      scroller.appendChild(pillsEl);

      const prevBtn = iconBtn(I.chevronL, 'Scroll filters left', 'vgext-sf-nav');
      const nextBtn = iconBtn(I.chevronR, 'Scroll filters right', 'vgext-sf-nav');
      prevBtn.hidden = true;
      nextBtn.hidden = true;

      // Matched funnel icons (filter-x / filter-plus), same box + stroke weight.
      const clearBtn = iconBtn(I.filterX, 'Deactivate all filter pills', 'vgext-sf-iconbtn vgext-sf-clear', 18, 2.35);
      const addBtn = iconBtn(I.filterPlus, 'Save current filters as a pill', 'vgext-sf-iconbtn vgext-sf-add', 18, 2.35);
      addBtn.disabled = true;

      root.append(prevBtn, scroller, nextBtn, clearBtn, addBtn);
      host.appendChild(root);

      const notify = (): void => {
        try { grid.notifyModuleStateChanged?.(MODULE_ID); } catch { /* ignore */ }
      };

      const activeMerged = (): Record<string, unknown> => {
        const actives = filters.filter((f) => f.active).map((f) => f.filterModel);
        if (actives.length === 0) return {};
        if (actives.length === 1) return actives[0]!;
        return mergeFilterModels(actives);
      };

      const pushActive = (): void => {
        pushing = true;
        try {
          const merged = activeMerged();
          grid.setFilterModel(Object.keys(merged).length ? merged : {});
        } finally {
          // Allow filterChanged from our own push to settle before re-enabling.
          queueMicrotask(() => { pushing = false; syncAddEnabled(); });
        }
      };

      let countGen = 0;
      const recomputeCounts = (): void => {
        const gen = ++countGen;
        void (async () => {
          const tally: Record<string, number> = {};
          for (const f of filters) tally[f.id] = 0;
          if (!filters.length) {
            if (gen === countGen) { counts = tally; paintCounts(); }
            return;
          }

          let live: Record<string, unknown> = {};
          try { live = grid.getFilterModel() ?? {}; } catch { live = {}; }
          const liveNorm = normalizeFilterModelForCompare(live);
          const displayed = typeof grid.getDisplayedRowCount === 'function'
            ? grid.getDisplayedRowCount()
            : 0;
          const ssrmHost = typeof grid.getSsrmExpressionHost === 'function'
            ? grid.getSsrmExpressionHost()
            : null;
          const countOnServer = typeof ssrmHost?.countMatchingFilterModel === 'function'
            ? ssrmHost.countMatchingFilterModel.bind(ssrmHost)
            : null;

          if (countOnServer) {
            // Sparse SSRM — hydrate mirror under-counts; ask Perspective.
            await Promise.all(filters.map(async (f) => {
              // Active pill that equals the live filter → footer row count
              // (already authoritative for the applied View).
              if (
                f.active
                && liveNorm != null
                && Object.keys(liveNorm).length > 0
                && filterModelsEqual(liveNorm, normalizeFilterModelForCompare(f.filterModel))
              ) {
                tally[f.id] = displayed;
                return;
              }
              try {
                tally[f.id] = await countOnServer(f.filterModel);
              } catch {
                tally[f.id] = f.active ? displayed : 0;
              }
            }));
          } else if (typeof grid.forEachRow === 'function') {
            try {
              grid.forEachRow((_id, row) => {
                const data = (row && typeof row === 'object') ? row as Record<string, unknown> : {};
                for (const f of filters) {
                  if (doesRowMatchFilterModel(data, f.filterModel)) {
                    tally[f.id] = (tally[f.id] ?? 0) + 1;
                  }
                }
              });
            } catch { /* empty */ }
          }

          if (gen !== countGen) return;
          counts = tally;
          paintCounts();
        })();
      };

      const paintCounts = (): void => {
        for (const pill of Array.from(pillsEl.querySelectorAll<HTMLElement>('.vgext-sf-pill'))) {
          const id = pill.dataset.id!;
          const badge = pill.querySelector('.vgext-sf-count');
          if (badge) badge.textContent = counts[id] != null ? String(counts[id]) : '–';
        }
      };

      const syncAddEnabled = (): void => {
        if (pushing) return;
        let live: Record<string, unknown> = {};
        try { live = grid.getFilterModel() ?? {}; } catch { live = {}; }
        const shapes: SavedFilterShape[] = filters.map((f) => ({
          filterModel: f.filterModel,
          active: f.active,
        }));
        addBtn.disabled = !isNewFilter(live, shapes);
        addBtn.title = addBtn.disabled
          ? 'Apply a new column filter first, then save it as a pill'
          : 'Save current filters as a pill';
        clearBtn.disabled = !filters.some((f) => f.active);
      };

      const syncOverflow = (): void => {
        const overflow = scroller.scrollWidth > scroller.clientWidth + 2;
        prevBtn.hidden = !overflow;
        nextBtn.hidden = !overflow;
        if (!overflow) return;
        prevBtn.disabled = scroller.scrollLeft <= 2;
        nextBtn.disabled = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
      };

      const closeEditors = (): void => {
        document.querySelectorAll('.vgext-sf-pop').forEach((el) => el.remove());
      };

      const placePop = (pop: HTMLElement, anchor: HTMLElement, preferH = 160): void => {
        const r = anchor.getBoundingClientRect();
        pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - preferH)}px`;
        pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
      };

      const bindPopDismiss = (pop: HTMLElement, anchor: HTMLElement): void => {
        const onDoc = (e: PointerEvent): void => {
          if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
            pop.remove();
            document.removeEventListener('pointerdown', onDoc, true);
          }
        };
        document.addEventListener('pointerdown', onDoc, true);
      };

      const openRenameEditor = (pill: SavedFilter, anchor: HTMLElement): void => {
        closeEditors();
        const pop = document.createElement('div');
        pop.className = 'vgext-sf-pop vgext-sf-rename';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Rename filter');
        const title = document.createElement('div');
        title.className = 'vgext-sf-pop-title';
        title.textContent = 'Rename filter';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'vgext-sf-rename-input';
        input.value = pill.label;
        input.setAttribute('aria-label', 'Filter name');
        input.maxLength = 80;
        const foot = document.createElement('div');
        foot.className = 'vgext-sf-pop-foot';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.className = 'vgext-sf-pop-cancel';
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Save';
        save.className = 'vgext-sf-pop-save';
        const syncSave = (): void => {
          const t = input.value.trim();
          save.disabled = !t || t === pill.label;
        };
        syncSave();
        foot.append(cancel, save);
        pop.append(title, input, foot);
        document.body.appendChild(pop);
        placePop(pop, anchor, 140);
        bindPopDismiss(pop, anchor);

        const commit = (): void => {
          const trimmed = input.value.trim();
          if (!trimmed || trimmed === pill.label) { pop.remove(); return; }
          const idx = filters.findIndex((x) => x.id === pill.id);
          if (idx < 0) return;
          filters[idx] = { ...filters[idx]!, label: trimmed };
          notify();
          paint();
          pop.remove();
        };
        input.addEventListener('input', syncSave);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); pop.remove(); }
        });
        cancel.addEventListener('click', () => pop.remove());
        save.addEventListener('click', commit);
        input.focus();
        input.select();
      };

      const openJsonEditor = (pill: SavedFilter, anchor: HTMLElement): void => {
        closeEditors();
        const pop = document.createElement('div');
        pop.className = 'vgext-sf-pop vgext-sf-json';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Edit filter JSON');
        const title = document.createElement('div');
        title.className = 'vgext-sf-pop-title';
        title.textContent = pill.label;
        const ta = document.createElement('textarea');
        ta.value = JSON.stringify(pill.filterModel, null, 2);
        ta.spellcheck = false;
        const foot = document.createElement('div');
        foot.className = 'vgext-sf-pop-foot';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.className = 'vgext-sf-pop-cancel';
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Save';
        save.className = 'vgext-sf-pop-save';
        save.disabled = true;
        foot.append(cancel, save);
        pop.append(title, ta, foot);
        document.body.appendChild(pop);
        placePop(pop, anchor, 280);
        bindPopDismiss(pop, anchor);

        const validate = (): void => {
          try {
            const parsed = JSON.parse(ta.value);
            save.disabled = !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
              || JSON.stringify(parsed) === JSON.stringify(pill.filterModel);
          } catch {
            save.disabled = true;
          }
        };
        ta.addEventListener('input', validate);
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); pop.remove(); }
        });
        cancel.addEventListener('click', () => pop.remove());
        save.addEventListener('click', () => {
          try {
            const parsed = JSON.parse(ta.value) as Record<string, unknown>;
            const idx = filters.findIndex((f) => f.id === pill.id);
            if (idx < 0) return;
            filters[idx] = { ...filters[idx]!, filterModel: parsed };
            notify();
            if (filters[idx]!.active) pushActive();
            paint();
            recomputeCounts();
            pop.remove();
          } catch { /* ignore */ }
        });
        ta.focus();
      };

      const paint = (): void => {
        pillsEl.replaceChildren();
        for (const f of filters) {
          const pill = document.createElement('div');
          pill.className = 'vgext-sf-pill' + (f.active ? ' is-active' : '');
          pill.dataset.id = f.id;
          pill.setAttribute('role', 'button');
          pill.tabIndex = 0;
          pill.title = f.active ? `Deactivate “${f.label}”` : `Apply “${f.label}”`;

          const label = document.createElement('span');
          label.className = 'vgext-sf-label';
          label.textContent = f.label;

          const count = document.createElement('span');
          count.className = 'vgext-sf-count';
          count.textContent = counts[f.id] != null ? String(counts[f.id]) : '–';

          const actions = document.createElement('span');
          actions.className = 'vgext-sf-actions';
          const renameBtn = iconBtn(I.pencil, 'Rename', 'vgext-sf-act', 12);
          const delBtn = iconBtn(I.trash, 'Delete', 'vgext-sf-act', 12);
          const moreBtn = iconBtn(I.more, 'Edit filter JSON', 'vgext-sf-act', 12);
          moreBtn.setAttribute('data-testid', 'vgext-sf-edit-json');
          actions.append(renameBtn, delBtn, moreBtn);

          pill.append(label, count, actions);
          pillsEl.appendChild(pill);

          const toggle = (): void => {
            const idx = filters.findIndex((x) => x.id === f.id);
            if (idx < 0) return;
            filters[idx] = { ...filters[idx]!, active: !filters[idx]!.active };
            notify();
            pushActive();
            paint();
            syncAddEnabled();
          };
          pill.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.vgext-sf-actions')) return;
            toggle();
          });
          pill.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          });

          renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameEditor(f, renameBtn);
          });
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasActive = f.active;
            filters = filters.filter((x) => x.id !== f.id);
            notify();
            if (wasActive) pushActive();
            paint();
            recomputeCounts();
            syncAddEnabled();
            syncOverflow();
          });
          moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openJsonEditor(f, moreBtn);
          });
        }
        syncAddEnabled();
        syncOverflow();
      };

      addBtn.addEventListener('click', () => {
        let live: Record<string, unknown> = {};
        try { live = grid.getFilterModel() ?? {}; } catch { return; }
        if (!isNewFilter(live, filters)) return;
        const delta = subtractFilterModel(live, activeMerged());
        if (!Object.keys(delta).length) return;
        const pill: SavedFilter = {
          id: makeId(),
          label: generateLabel(delta, filters.length),
          filterModel: delta,
          active: true,
        };
        filters = [...filters, pill];
        notify();
        pushActive();
        paint();
        recomputeCounts();
      });

      clearBtn.addEventListener('click', () => {
        if (!filters.some((f) => f.active)) return;
        filters = filters.map((f) => (f.active ? { ...f, active: false } : f));
        notify();
        pushActive();
        paint();
        syncAddEnabled();
      });

      prevBtn.addEventListener('click', () => {
        scroller.scrollBy({ left: -150, behavior: 'smooth' });
      });
      nextBtn.addEventListener('click', () => {
        scroller.scrollBy({ left: 150, behavior: 'smooth' });
      });
      scroller.addEventListener('scroll', syncOverflow, { passive: true });

      let ro: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => syncOverflow());
        ro.observe(scroller);
      }

      const unreg = grid.registerStateModule?.({
        id: MODULE_ID,
        version: MODULE_VERSION,
        get: () => (filters.length ? filters : undefined),
        set: (data) => {
          filters = validateFilters(data);
          paint();
          pushActive();
          recomputeCounts();
        },
      });

      const offs: Array<() => void> = [];
      let countTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleCounts = (): void => {
        if (countTimer != null) clearTimeout(countTimer);
        countTimer = setTimeout(() => {
          countTimer = null;
          recomputeCounts();
        }, 120);
      };
      const on = (type: string, fn: () => void): void => {
        try {
          const off = grid.addEventListener?.(type, () => { if (!pushing) fn(); });
          if (typeof off === 'function') offs.push(off);
        } catch { /* ignore */ }
      };
      on('filterChanged', () => { syncAddEnabled(); scheduleCounts(); });
      on('modelUpdated', () => scheduleCounts());
      on('rowDataUpdated', () => scheduleCounts());

      paint();
      syncAddEnabled();
      recomputeCounts();
      requestAnimationFrame(syncOverflow);

      return {
        destroy() {
          if (countTimer != null) clearTimeout(countTimer);
          closeEditors();
          ro?.disconnect();
          unreg?.();
          for (const off of offs) off();
          host.replaceChildren();
        },
      };
    },
  };
}

const SAVED_FILTERS_CSS = `
.vgext-sf {
  display: inline-flex; align-items: center; gap: 4px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  margin-left: 4px;
}
.vgext-sf[hidden] { display: none !important; }
.vgext-sf-scroll {
  flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden;
  /* Hide the rail on the pill strip — nav arrows handle scroll. */
  scrollbar-width: none;
}
.vgext-sf-pills { display: inline-flex; align-items: center; gap: 6px; padding: 0 2px; }
.vgext-sf-nav {
  appearance: none; flex: 0 0 auto;
  width: 22px; height: 22px; padding: 0; border: none; border-radius: var(--vg-radius, 2px);
  background: transparent; color: var(--vg-muted-fg-color, #9aa4b6); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.vgext-sf-nav:hover:not(:disabled) { color: var(--vg-fg-color, #e5e9f0); background: var(--vg-control-bg, rgba(255,255,255,.06)); }
.vgext-sf-nav:disabled { opacity: 0.3; cursor: default; }
.vgext-sf-pill {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 6px 0 8px;
  border: 1px solid var(--vg-accent-color, #4f9cf9);
  border-radius: 999px;
  background: transparent;
  color: var(--vg-fg-color, #e5e9f0);
  font: inherit; font-size: 11.5px; font-weight: 550;
  cursor: pointer; flex: 0 0 auto; white-space: nowrap;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.vgext-sf-pill:hover { background: color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 12%, transparent); }
.vgext-sf-pill.is-active {
  background: var(--vg-accent-color, #4f9cf9);
  border-color: var(--vg-accent-color, #4f9cf9);
  color: var(--vg-accent-fg, var(--vg-checkbox-checked-fg, #191c22));
}
.vgext-sf-label { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
.vgext-sf-count {
  min-width: 16px; height: 14px; padding: 0 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vg-fg-color, #e5e9f0) 14%, transparent);
  font-size: 9.5px; font-weight: 650; line-height: 14px; text-align: center;
  font-variant-numeric: tabular-nums;
}
.vgext-sf-pill.is-active .vgext-sf-count {
  background: color-mix(in srgb, var(--vg-accent-fg, #191c22) 18%, transparent);
}
.vgext-sf-actions {
  display: none; align-items: center; gap: 0; margin-left: 1px;
}
.vgext-sf-pill:hover .vgext-sf-actions,
.vgext-sf-pill:focus-within .vgext-sf-actions { display: inline-flex; }
.vgext-sf-act {
  appearance: none; width: 16px; height: 16px; padding: 0; border: none; border-radius: 2px;
  background: transparent; color: inherit; opacity: 0.75; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.vgext-sf-act:hover { opacity: 1; background: color-mix(in srgb, var(--vg-fg-color, #fff) 12%, transparent); }
.vgext-sf-iconbtn {
  appearance: none; width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--vg-radius, 2px);
  background: transparent; color: var(--vg-muted-fg-color, #9aa4b6); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.vgext-sf-iconbtn:hover:not(:disabled) { color: var(--vg-fg-color, #e5e9f0); background: var(--vg-control-bg, rgba(255,255,255,.06)); }
.vgext-sf-iconbtn:disabled { opacity: 0.35; cursor: default; }
.vgext-sf-clear,
.vgext-sf-add {
  width: 32px;
  height: 32px;
}
.vgext-sf-clear svg,
.vgext-sf-add svg {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}
.vgext-sf-clear { color: color-mix(in srgb, var(--vg-neg-color, #e5646e) 85%, var(--vg-muted-fg-color, #9aa4b6)); }
.vgext-sf-clear:hover:not(:disabled) { color: var(--vg-neg-color, #e5646e); }
.vgext-sf-add:not(:disabled) { color: var(--vg-accent-color, #4f9cf9); }
.vgext-sf-pop {
  position: fixed; z-index: 80; width: 280px;
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--vg-popup-bg, var(--vg-bg-color, #1a1f2b));
  border: 1px solid var(--vg-border-color, #2a3140);
  border-radius: var(--vg-radius, 2px);
  box-shadow: 0 12px 32px rgba(0,0,0,.45);
  color: var(--vg-fg-color, #e5e9f0);
}
.vgext-sf-pop.vgext-sf-json { width: 320px; }
.vgext-sf-pop-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-sf-rename-input {
  width: 100%; height: 32px; box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--vg-border-color, #2a3140);
  border-radius: var(--vg-radius, 2px);
  background: var(--vg-input-bg, rgba(0,0,0,.25));
  color: inherit; font: inherit; font-size: 13px; font-weight: 550;
}
.vgext-sf-rename-input:focus {
  outline: none;
  border-color: var(--vg-accent-color, #4f9cf9);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 18%, transparent);
}
.vgext-sf-json textarea {
  width: 100%; height: 160px; box-sizing: border-box; resize: vertical;
  padding: 8px; border: 1px solid var(--vg-border-color, #2a3140); border-radius: var(--vg-radius, 2px);
  background: var(--vg-input-bg, rgba(0,0,0,.25)); color: inherit;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.vgext-sf-json textarea:focus {
  outline: none;
  border-color: var(--vg-accent-color, #4f9cf9);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vg-accent-color, #4f9cf9) 18%, transparent);
}
.vgext-sf-pop-foot { display: flex; justify-content: flex-end; gap: 8px; }
.vgext-sf-pop-cancel, .vgext-sf-pop-save {
  appearance: none; height: 26px; padding: 0 12px; border-radius: var(--vg-radius, 2px);
  font: inherit; font-size: 11px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase;
  cursor: pointer;
}
.vgext-sf-pop-cancel {
  border: none; background: transparent; color: var(--vg-muted-fg-color, #9aa4b6);
}
.vgext-sf-pop-cancel:hover { color: var(--vg-fg-color, #e5e9f0); }
.vgext-sf-pop-save {
  border: 1px solid var(--vg-accent-color, #4f9cf9);
  background: var(--vg-accent-color, #4f9cf9);
  color: var(--vg-accent-fg, var(--vg-checkbox-checked-fg, #fff));
}
.vgext-sf-pop-save:disabled { opacity: 0.4; cursor: default; }
`;
