/**
 * Alerts — Customize sheet module (starui customizer-ui #05).
 * Master-detail: rules rail + editor (trigger tabs, severity, message,
 * channels, debounce) with a collapsible global-settings band.
 *
 * Mutations ride the public alerts API attached by `@wellsfargo-starui/velocity-grid-rules`
 * `wireIntoKernel` (`getAlertRules` / `addAlertRule` / …). Persistence is
 * the dedicated `alerts` state module (rules+settings; never history).
 */
import type {
  AlertChannel,
  AlertRule,
  AlertSeverity,
  AlertTrigger,
  AlertsSettings,
} from '@wellsfargo-starui/velocity-grid-rules';
import { wireIntoKernel as wireRules, DEFAULT_ALERTS_SETTINGS } from '@wellsfargo-starui/velocity-grid-rules';
import type { SettingsModule, VelocityGridExtContext, ModuleInstance } from '../extension/types';
import { ExpressionEditor } from '../ui/expressionEditor';
import { editorColumns, leafColumns } from '../ui/gridSchema';
import {
  band,
  caps,
  chip,
  el,
  injectCockpitStyles,
  lucideSvg,
  numberInput,
  pillGroup,
  row,
  select,
  switchToggle,
  switchToggleEnhanced,
  textInput,
  appendPaneChrome,
  takePaneScroll,
  restorePaneScroll,
  emptyState,
  engineMissingNotice,
  actionButtonEnhanced,
  resetButtonEnhanced,
} from '../ui/cockpit';

interface AlertsGrid {
  getAlertRules?(): AlertRule[];
  addAlertRule?(rule: AlertRule): void;
  updateAlertRule?(id: string, patch: Partial<AlertRule>): void;
  deleteAlertRule?(id: string): void;
  getAlertsSettings?(): AlertsSettings;
  setAlertsSettings?(patch: Partial<AlertsSettings>): void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const SEVERITIES: AlertSeverity[] = ['info', 'success', 'warning', 'critical'];
const CHANNELS: AlertChannel[] = ['toast', 'badge', 'openfin'];

function newRule(priority: number): AlertRule {
  return {
    id: `alert_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: 'New alert',
    enabled: true,
    priority,
    severity: 'warning',
    trigger: { kind: 'dataChange', expression: '' },
    message: '{rule} fired on {rowId}',
    channels: ['toast', 'badge'],
  };
}

function triggerKind(t: AlertTrigger): 'dataChange' | 'relativeChange' | 'rowChange' {
  return t.kind;
}

function defaultTrigger(kind: AlertTrigger['kind']): AlertTrigger {
  switch (kind) {
    case 'dataChange':
      return { kind: 'dataChange', expression: '' };
    case 'relativeChange':
      return {
        kind: 'relativeChange',
        colId: '',
        mode: 'PERCENT_CHANGE',
        threshold: 5,
        direction: 'both',
      };
    case 'rowChange':
      return { kind: 'rowChange', mode: 'ROW_ADDED' };
  }
}

function openFinAvailable(): boolean {
  return typeof (window as unknown as { fin?: unknown }).fin !== 'undefined';
}

export function alertsModule(): SettingsModule {
  return {
    id: 'alerts',
    kind: 'settings-module',
    title: 'Alerts',
    icon: 'bell',
    category: 'format',

    init(): void {
      injectCockpitStyles();
    },

    mount(host: HTMLElement, ctx: VelocityGridExtContext): ModuleInstance {
      const grid = ctx.grid as AlertsGrid;
      /**
       * D-F8 — was `try { wireRules(ctx.grid); } catch { }`: a failed wire was
       * swallowed, and the pane then rendered a fully functional-looking
       * editor on top of `grid.getAlertRules?.()` → `undefined` → `[]`. Every
       * Save silently did nothing.
       *
       * Now: wire lazily (the bridge is idempotent), RECORD both engines into
       * the context slots so the rest of ext shares them, log the failure, and
       * let `renderAll` surface the shared missing-engine state.
       */
      const ensureRulesWired = (): boolean => {
        if (ctx.engines.get('alerts')) return true;
        try {
          const wired = wireRules(ctx.grid);
          ctx.engines.register('rules', wired.rules);
          ctx.engines.register('alerts', wired.alerts);
          return true;
        } catch (err) {
          console.warn('[velocity-grid-ext] Alerts: wiring @wellsfargo-starui/velocity-grid-rules failed', err);
          return false;
        }
      };
      ensureRulesWired();

      let rules: AlertRule[] = [];
      let selectedId: string | null = null;
      let draft: AlertRule | null = null;
      let draftIsNew = false;
      let globalOpen = false;
      let editor: ExpressionEditor | null = null;

      const root = el('div', 'ckp');
      const rail = el('div', 'ckp-rail');
      const pane = el('div', 'ckp-pane');
      root.append(rail, pane);
      host.appendChild(root);

      const loadRules = (): void => {
        try { rules = grid.getAlertRules?.() ?? []; } catch { rules = []; }
      };

      const isDirty = (): boolean => {
        if (!draft) return false;
        if (draftIsNew) return true;
        return JSON.stringify(rules.find((r) => r.id === draft!.id)) !== JSON.stringify(draft);
      };

      const selectRule = (
        id: string | null,
        asNew = false,
        seed?: AlertRule,
        force = false,
      ): void => {
        if (!force && draft && isDirty() && !(asNew && seed) && id !== selectedId) {
          if (!window.confirm('Discard unsaved alert changes?')) return;
        }
        editor?.destroy();
        editor = null;
        selectedId = id;
        draftIsNew = asNew;
        draft = seed ? clone(seed) : id ? clone(rules.find((r) => r.id === id) ?? newRule(rules.length)) : null;
        renderAll();
      };

      const save = (): void => {
        if (!draft) return;
        const next = clone(draft);
        if (draftIsNew) grid.addAlertRule?.(next);
        else grid.updateAlertRule?.(next.id, next);
        ctx.profiles.markDirty();
        loadRules();
        draftIsNew = false;
        selectRule(next.id, false, undefined, true);
      };

      const reset = (): void => {
        if (!draft || draftIsNew) {
          if (draftIsNew) selectRule(rules[0]?.id ?? null, false, undefined, true);
          return;
        }
        draft = clone(rules.find((r) => r.id === draft!.id)!);
        renderAll();
      };

      const liveSettings = (): AlertsSettings =>
        grid.getAlertsSettings?.() ?? { ...DEFAULT_ALERTS_SETTINGS, enabledChannels: { ...DEFAULT_ALERTS_SETTINGS.enabledChannels } };

      const patchSettings = (patch: Partial<AlertsSettings>): void => {
        grid.setAlertsSettings?.(patch);
        ctx.profiles.markDirty();
        renderAll();
      };

      const renderGlobal = (parent: HTMLElement): void => {
        const wrap = el('div', 'ckp-global');
        wrap.style.cssText = 'margin-bottom:14px;border:1px solid var(--ckp-border);border-radius:4px;';
        const head = el('button', 'ckp-global-head') as HTMLButtonElement;
        head.type = 'button';
        head.style.cssText =
          'display:flex;width:100%;align-items:center;gap:8px;padding:8px 10px;background:transparent;' +
          'border:none;color:inherit;font:inherit;cursor:pointer;text-align:left;';
        head.innerHTML = `${lucideSvg(globalOpen ? 'chevron-down' : 'chevron-right', 14)}<span class="ckp-caps">Global settings</span>`;
        head.addEventListener('click', () => { globalOpen = !globalOpen; renderAll(); });
        wrap.appendChild(head);
        if (globalOpen) {
          const body = el('div', 'ckp-global-body');
          body.style.cssText = 'padding:4px 12px 12px;display:flex;flex-direction:column;gap:2px;';
          const s = liveSettings();
          body.append(
            row('Alerts enabled', switchToggleEnhanced(s.enabled, (v) => patchSettings({ enabled: v }))),
            row(
              'Frequency',
              pillGroup(
                [['realtime', 'Realtime'], ['throttled', 'Throttled'], ['paused', 'Paused']],
                s.evaluationMode,
                (v) => patchSettings({ evaluationMode: v as AlertsSettings['evaluationMode'] }),
              ),
            ),
            row('Default debounce', numberInput(s.defaultDebounceMs, (v) => {
              if (v === undefined) return;
              patchSettings({ defaultDebounceMs: Math.max(0, Math.floor(v)) });
            }, { suffix: 'ms' })),
            row('Max / second', numberInput(s.maxNotificationsPerSecond, (v) => {
              if (v === undefined) return;
              patchSettings({ maxNotificationsPerSecond: Math.max(1, Math.floor(v)) });
            })),
            row('History limit', numberInput(s.historyLimit, (v) => {
              if (v === undefined) return;
              patchSettings({ historyLimit: Math.max(1, Math.floor(v)) });
            })),
          );
          const ch = el('div', 'ckp-band-body');
          ch.appendChild(caps('Channels'));
          for (const c of CHANNELS) {
            const disabled = c === 'openfin' && !openFinAvailable();
            const sw = switchToggleEnhanced(s.enabledChannels[c], (v) => {
              patchSettings({ enabledChannels: { ...s.enabledChannels, [c]: v } });
            });
            if (disabled) {
              sw.setAttribute('disabled', 'true');
              (sw as HTMLButtonElement).disabled = true;
              sw.title = 'OpenFin not available in this host';
            }
            ch.appendChild(row(c, sw, disabled ? 'OpenFin not available' : undefined));
          }
          body.appendChild(ch);
          wrap.appendChild(body);
        }
        parent.appendChild(wrap);
      };

      const renderRail = (): void => {
        rail.replaceChildren();
        const head = el('div', 'ckp-rail-head');
        const add = el('button', 'ckp-addbtn', '+') as HTMLButtonElement;
        add.type = 'button';
        add.title = 'Add alert';
        add.addEventListener('click', () => {
          const rule = newRule(rules.length);
          selectRule(rule.id, true, rule);
        });
        head.append(caps('Alert rules'), el('span', 'ckp-caps ckp-count', String(rules.length).padStart(2, '0')), add);
        rail.appendChild(head);

        if (rules.length === 0 && !draftIsNew) {
          rail.appendChild(emptyState({
            title: 'No alerts yet',
            description: 'Add one with + to start watching the grid.',
            icon: 'bell',
          }));
          return;
        }
        for (const rule of rules) {
          const rowEl = el('div', `ckp-rail-row${rule.id === selectedId ? ' active' : ''}${rule.enabled ? '' : ' muted'}`);
          const name = el('span', 'ckp-rail-name', rule.name);
          const kind = el('span', 'ckp-caps', rule.trigger.kind === 'dataChange' ? 'EXPR' : rule.trigger.kind === 'relativeChange' ? 'Δ' : 'ROW');
          kind.style.opacity = '0.55';
          kind.style.fontSize = '9px';
          const del = el('button', 'ckp-mini') as HTMLButtonElement;
          del.type = 'button';
          del.title = 'Delete';
          del.innerHTML = lucideSvg('trash-2', 12) || '×';
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            grid.deleteAlertRule?.(rule.id);
            ctx.profiles.markDirty();
            loadRules();
            if (selectedId === rule.id) selectRule(rules[0]?.id ?? null, false, undefined, true);
            else renderAll();
          });
          rowEl.append(name, kind, del);
          rowEl.addEventListener('click', () => selectRule(rule.id));
          rail.appendChild(rowEl);
        }
        if (draftIsNew && draft) {
          const rowEl = el('div', 'ckp-rail-row active');
          rowEl.appendChild(el('span', 'ckp-rail-name', draft.name || 'New alert'));
          rail.appendChild(rowEl);
        }
      };

      const renderPane = (): void => {
        const scrollTop = takePaneScroll(pane);
        editor?.destroy();
        editor = null;
        pane.replaceChildren();
        if (!draft) {
          const emptyBody = el('div', 'ckp-pane-body');
          pane.appendChild(emptyBody);
          renderGlobal(emptyBody);
          emptyBody.appendChild(emptyState({
            title: 'No alert selected',
            description: 'Select an alert, or add one with +.',
            icon: 'bell',
          }));
          return;
        }
        const d = draft;

        const head = el('div', 'ckp-pane-head');
        const nameIn = textInput(d.name, (v) => { d.name = v; }, { className: 'ckp-title', placeholder: 'Alert name' });
        const saveBtn = actionButtonEnhanced('Save', 'save');
        saveBtn.disabled = !isDirty();
        saveBtn.addEventListener('click', save);
        const resetBtn = resetButtonEnhanced('Reset', 'rotate-ccw');
        resetBtn.disabled = !isDirty();
        resetBtn.addEventListener('click', reset);
        nameIn.addEventListener('input', () => {
          saveBtn.disabled = !isDirty();
          resetBtn.disabled = !isDirty();
        });
        head.append(nameIn, saveBtn, resetBtn);
        const body = appendPaneChrome(pane, head);
        renderGlobal(body);

        const chips = el('div', 'ckp-chips-strip');
        chips.append(
          chip('Severity', d.severity.toUpperCase(), d.severity === 'critical' ? 'warning' : 'info').root,
          chip('Trigger', d.trigger.kind, 'neutral').root,
          chip('Enabled', d.enabled ? 'YES' : 'NO', d.enabled ? 'positive' : 'neutral').root,
        );
        body.appendChild(chips);

        const ruleBand = band('Rule');
        ruleBand.body.append(
          row('Enabled', switchToggleEnhanced(d.enabled, (v) => { d.enabled = v; renderAll(); })),
        );
        body.appendChild(ruleBand.root);

        const sev = band('Severity');
        sev.body.append(
          pillGroup(
            SEVERITIES.map((s) => [s, s] as [string, string]),
            d.severity,
            (v) => { d.severity = v as AlertSeverity; renderAll(); },
          ),
        );
        body.appendChild(sev.root);

        const trig = band('Trigger');
        trig.body.append(
          pillGroup(
            [['dataChange', 'Expression'], ['relativeChange', 'Δ Delta'], ['rowChange', 'Row']],
            triggerKind(d.trigger),
            (v) => {
              d.trigger = defaultTrigger(v as AlertTrigger['kind']);
              renderAll();
            },
          ),
        );

        const cols = leafColumns(ctx.grid).map((c) => {
          const id = c.colId ?? c.field ?? '';
          return [id, c.headerName || id] as [string, string];
        }).filter(([id]) => id);
        if (d.trigger.kind === 'dataChange') {
          const mount = el('div');
          trig.body.appendChild(mount);
          editor = new ExpressionEditor(mount, {
            value: d.trigger.expression,
            multiline: true,
            lines: 3,
            placeholder: '[pnl] > 0',
            columnsProvider: () => editorColumns(ctx.grid),
            onChange: (v) => {
              if (d.trigger.kind !== 'dataChange') return;
              d.trigger.expression = v;
              resetBtn.disabled = !isDirty();
            },
            onCommit: () => { if (isDirty()) save(); },
          });
          const colOpts: Array<[string, string]> = [['', '(any column)'], ...cols];
          const current = d.trigger.columnIds?.[0] ?? '';
          trig.body.append(
            row('Column', select(colOpts, current, (v) => {
              if (d.trigger.kind !== 'dataChange') return;
              d.trigger.columnIds = v ? [v] : undefined;
              renderAll();
            })),
          );
        } else if (d.trigger.kind === 'relativeChange') {
          const t = d.trigger;
          trig.body.append(
            row('Column', select(cols.length ? cols : [['', '—']], t.colId, (v) => {
              t.colId = v;
              renderAll();
            })),
            row('Mode', pillGroup(
              [['PERCENT_CHANGE', '%'], ['ABSOLUTE_CHANGE', 'Abs'], ['ANY_CHANGE', 'Any']],
              t.mode,
              (v) => { t.mode = v as typeof t.mode; renderAll(); },
            )),
          );
          if (t.mode !== 'ANY_CHANGE') {
            trig.body.append(
              row('Threshold', numberInput(t.threshold, (v) => {
                if (v === undefined) return;
                t.threshold = v;
                renderAll();
              }, { suffix: t.mode === 'PERCENT_CHANGE' ? '%' : undefined })),
            );
          }
          trig.body.append(
            row('Direction', pillGroup(
              [['both', 'Both'], ['up', 'Up'], ['down', 'Down']],
              t.direction,
              (v) => { t.direction = v as typeof t.direction; renderAll(); },
            )),
          );
        } else {
          const t = d.trigger;
          trig.body.append(
            row('Event', pillGroup(
              [['ROW_ADDED', 'Row added'], ['ROW_REMOVED', 'Row removed']],
              t.mode,
              (v) => { t.mode = v as typeof t.mode; renderAll(); },
            )),
          );
        }
        body.appendChild(trig.root);

        const msg = band('Message');
        msg.body.append(
          row('Template', textInput(d.message, (v) => { d.message = v; renderAll(); }, { placeholder: '{rule} fired on {rowId}' })),
          el('div', 'ckp-hint lc', 'Placeholders: {rule} {rowId} {column} {value} {prev}'),
        );
        body.appendChild(msg.root);

        const chBand = band('Channels');
        for (const c of CHANNELS) {
          const on = d.channels.includes(c);
          const disabled = c === 'openfin' && !openFinAvailable();
          const sw = switchToggleEnhanced(on, (v) => {
            d.channels = v ? [...new Set([...d.channels, c])] : d.channels.filter((x) => x !== c);
            renderAll();
          });
          if (disabled) {
            (sw as HTMLButtonElement).disabled = true;
            sw.title = 'OpenFin not available in this host';
          }
          chBand.body.append(row(c, sw));
        }
        body.appendChild(chBand.root);

        const deb = band('Debounce');
        deb.body.append(
          row(
            'Debounce ms',
            numberInput(d.debounceMs ?? 0, (v) => {
              d.debounceMs = v === undefined || v <= 0 ? undefined : Math.floor(v);
              renderAll();
            }, { suffix: 'ms' }),
            '0 = use global default',
          ),
        );
        body.appendChild(deb.root);

        restorePaneScroll(pane, scrollTop);
      };

      const renderAll = (): void => {
        // D-F8 — no alerts engine means every mutation below is a no-op; say
        // so instead of rendering a live-looking editor.
        if (!ensureRulesWired()) {
          editor?.destroy();
          editor = null;
          root.replaceChildren();
          root.appendChild(engineMissingNotice('alerts', { feature: 'Alerts', icon: 'bell' }));
          return;
        }
        if (!root.contains(rail)) root.append(rail, pane);
        loadRules();
        renderRail();
        renderPane();
      };

      loadRules();
      if (rules[0]) selectRule(rules[0].id, false, undefined, true);
      else renderAll();

      return {
        destroy() {
          editor?.destroy();
          editor = null;
          root.replaceChildren();
          root.remove();
        },
        commit() { if (isDirty()) save(); },
        refresh() {
          loadRules();
          if (selectedId && !draftIsNew && !rules.some((r) => r.id === selectedId)) {
            selectRule(rules[0]?.id ?? null, false, undefined, true);
          } else {
            renderAll();
          }
        },
      };
    },
  };
}
