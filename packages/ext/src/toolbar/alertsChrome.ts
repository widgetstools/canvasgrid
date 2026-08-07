/**
 * Alerts chrome — title-bar badge + lightweight DOM toasts.
 * Subscribes to `grid.onAlert` from the `@cgrid/rules` bridge.
 */
import type { AlertEvent, AlertSeverity } from '@cgrid/rules';
import type { ToolbarItem, ToolbarItemInstance } from '../extension/types';
import { iconButton } from './ui';

const BELL = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0';

interface AlertsHost {
  getAlertHistory?(): AlertEvent[];
  getAlertUnreadCount?(): number;
  markAlertRead?(): void;
  clearAlertHistory?(): void;
  onAlert?(fn: (alert: AlertEvent) => void): () => void;
}

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  info: '#4f9cf9',
  success: '#3ecf8e',
  warning: '#f5a524',
  critical: '#f31260',
};

function ensureToastHost(): HTMLElement {
  const ID = 'cgext-alert-toasts';
  let host = document.getElementById(ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ID;
    host.setAttribute('aria-live', 'polite');
    host.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:10000;display:flex;flex-direction:column;' +
      'gap:8px;max-width:360px;pointer-events:none;';
    document.body.appendChild(host);
  }
  return host;
}

function ensureBadgeStyles(): void {
  const ID = 'cgext-alerts-badge-styles';
  if (document.getElementById(ID)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = `
.cgext-alert-badge { position: relative; }
.cgext-alert-badge .cgext-alert-count {
  position: absolute; top: -2px; right: -2px; min-width: 14px; height: 14px;
  padding: 0 3px; border-radius: 7px; background: #f31260; color: #fff;
  font-size: 9px; font-weight: 700; line-height: 14px; text-align: center;
  pointer-events: none;
}
.cgext-alert-badge .cgext-alert-count[hidden] { display: none; }
.cgext-alert-pop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
  width: 320px; max-height: 360px; overflow: auto;
  background: color-mix(in srgb, var(--cg-bg-color, #1a1f2b) 96%, transparent);
  border: 1px solid var(--cg-border-color, #2a3140);
  border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
  padding: 8px; color: var(--cg-fg-color, #e5e9f0); font-size: 12px;
}
.cgext-alert-pop[hidden] { display: none; }
.cgext-alert-pop-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  padding-bottom: 6px; border-bottom: 1px solid var(--cg-border-color, #2a3140);
}
.cgext-alert-pop-head strong { flex: 1; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.cgext-alert-pop-head button {
  background: transparent; border: none; color: var(--cg-muted-fg-color, #8a93a6);
  font: inherit; font-size: 11px; cursor: pointer; padding: 2px 4px;
}
.cgext-alert-pop-head button:hover { color: var(--cg-fg-color, #e5e9f0); }
.cgext-alert-item {
  display: grid; grid-template-columns: 4px 1fr; gap: 8px;
  padding: 6px 4px; border-radius: 4px;
}
.cgext-alert-item:hover { background: color-mix(in srgb, var(--cg-fg-color, #fff) 5%, transparent); }
.cgext-alert-item .bar { border-radius: 2px; }
.cgext-alert-item .meta { opacity: .55; font-size: 10px; margin-top: 2px; }
.cgext-alert-toast {
  pointer-events: auto; padding: 10px 12px; border-radius: 6px;
  background: color-mix(in srgb, var(--cg-bg-color, #1a1f2b) 94%, transparent);
  border: 1px solid var(--cg-border-color, #2a3140);
  border-left-width: 3px; color: var(--cg-fg-color, #e5e9f0);
  font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.3);
  animation: cgext-toast-in 160ms ease-out;
}
@keyframes cgext-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;
  document.head.appendChild(style);
}

function showToast(alert: AlertEvent): void {
  if (!alert.channels.includes('toast')) return;
  ensureBadgeStyles();
  const host = ensureToastHost();
  const toast = document.createElement('div');
  toast.className = 'cgext-alert-toast';
  toast.style.borderLeftColor = SEVERITY_TONE[alert.severity];
  toast.innerHTML = `<strong style="display:block;margin-bottom:2px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.7">${alert.severity}</strong>${escapeHtml(alert.message)}`;
  host.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms';
    window.setTimeout(() => toast.remove(), 220);
  }, 4200);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Title-bar notifications control with unread badge + history popover. */
export function alertsBadgeItem(): ToolbarItem {
  return {
    id: 'notifications',
    kind: 'toolbar-item',
    slot: 'primary-right',
    init() { ensureBadgeStyles(); },
    render(host, ctx): ToolbarItemInstance {
      const wrap = document.createElement('div');
      wrap.className = 'cgext-alert-badge';
      wrap.style.position = 'relative';
      const btn = iconButton(BELL, 'Alerts');
      btn.setAttribute('data-testid', 'cgext-alerts-badge');
      const count = document.createElement('span');
      count.className = 'cgext-alert-count';
      count.hidden = true;
      const pop = document.createElement('div');
      pop.className = 'cgext-alert-pop';
      pop.hidden = true;
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Alert history');

      const grid = ctx.grid as AlertsHost;

      const syncCount = (): void => {
        const n = grid.getAlertUnreadCount?.() ?? 0;
        count.textContent = n > 99 ? '99+' : String(n);
        count.hidden = n <= 0;
      };

      const renderPop = (): void => {
        const history = grid.getAlertHistory?.() ?? [];
        pop.replaceChildren();
        const head = document.createElement('div');
        head.className = 'cgext-alert-pop-head';
        const title = document.createElement('strong');
        title.textContent = 'Alerts';
        head.appendChild(title);
        const mark = document.createElement('button');
        mark.type = 'button';
        mark.textContent = 'Mark read';
        mark.addEventListener('click', () => {
          grid.markAlertRead?.();
          syncCount();
        });
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => {
          grid.clearAlertHistory?.();
          syncCount();
          renderPop();
        });
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Settings';
        open.addEventListener('click', () => {
          pop.hidden = true;
          ctx.events.emit({ type: 'open-settings', id: 'alerts' });
        });
        head.append(mark, clear, open);
        pop.appendChild(head);
        if (history.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'opacity:.55;padding:12px 4px;text-align:center;';
          empty.textContent = 'No alerts this session.';
          pop.appendChild(empty);
          return;
        }
        for (const a of history.slice(0, 40)) {
          const item = document.createElement('div');
          item.className = 'cgext-alert-item';
          const bar = document.createElement('div');
          bar.className = 'bar';
          bar.style.background = SEVERITY_TONE[a.severity];
          const body = document.createElement('div');
          body.innerHTML = `${escapeHtml(a.message)}<div class="meta">${escapeHtml(a.ruleName)} · ${a.rowId}</div>`;
          item.append(bar, body);
          pop.appendChild(item);
        }
      };

      const unsub = grid.onAlert?.((alert) => {
        showToast(alert);
        syncCount();
        if (!pop.hidden) renderPop();
      });

      btn.addEventListener('click', () => {
        const opening = pop.hidden;
        pop.hidden = !opening;
        if (opening) {
          renderPop();
          grid.markAlertRead?.();
          syncCount();
        }
      });

      const onDoc = (e: MouseEvent): void => {
        if (pop.hidden) return;
        if (wrap.contains(e.target as Node)) return;
        pop.hidden = true;
      };
      document.addEventListener('mousedown', onDoc);

      wrap.append(btn, count, pop);
      host.appendChild(wrap);
      syncCount();

      return {
        destroy() {
          unsub?.();
          document.removeEventListener('mousedown', onDoc);
          host.replaceChildren();
        },
        refresh() { syncCount(); },
      };
    },
  };
}
