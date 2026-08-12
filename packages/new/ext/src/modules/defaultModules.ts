import {
  el,
  mountBanner,
  mountButton,
  mountEmptyState,
  mountField,
  mountSelect,
  showToast,
  type Disposable,
} from '@wellsfargo-starui/vg-new-ui';
import type { ExtContext, SettingsModule } from './types';
import type { ValidateResult } from '../profiles/configSession';

function panel(title: string, body: (host: HTMLElement, ctx: ExtContext) => Disposable[]): SettingsModule['mount'] {
  return (host, ctx) => {
    const root = el('div');
    const h = el('h3', undefined, title);
    h.style.cssText = 'margin:0 0 12px;font-size:14px;';
    root.appendChild(h);
    const dispos = body(root, ctx);
    host.appendChild(root);
    return {
      destroy() {
        for (const d of dispos) d.destroy();
        root.remove();
      },
    };
  };
}

function footerApply(
  root: HTMLElement,
  ctx: ExtContext,
  moduleId: string,
  opts: {
    validate: (draft: unknown) => ValidateResult;
    apply: (draft: unknown) => void | Promise<void>;
    onReset: () => void;
  },
): Disposable[] {
  const footer = el('div');
  footer.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;';
  root.appendChild(footer);
  return [
    mountButton(footer, {
      label: 'Reset',
      variant: 'ghost',
      onClick: () => {
        ctx.session.discardDraft(moduleId);
        opts.onReset();
        ctx.markDirty();
      },
    }),
    mountButton(footer, {
      label: 'Validate',
      onClick: () => {
        const r = ctx.session.validate(moduleId, opts.validate);
        if (r.ok) showToast('Valid', { tone: 'ok' });
        else showToast(r.errors.join('; '), { tone: 'err' });
      },
    }),
    mountButton(footer, {
      label: 'Apply',
      variant: 'primary',
      onClick: () => {
        void ctx.validateAndApply(moduleId, {
          validate: opts.validate,
          apply: opts.apply,
        }).then((r) => {
          if (r.ok) showToast('Applied', { tone: 'ok' });
          else showToast(r.errors.join('; '), { tone: 'err' });
        });
      },
    }),
  ];
}

type CalcDraft = { columns: Array<{ alias: string; expression: string; headerName?: string }> };
type RulesDraft = {
  rules: Array<{
    id: string;
    expression: string;
    style: { backgroundColor?: string; color?: string };
    enabled?: boolean;
  }>;
};
type AlertsDraft = {
  rules: Array<{
    id: string;
    expression: string;
    channels: Array<'toast' | 'badge' | 'openfin'>;
    messageTemplate?: string;
  }>;
};
type ColSettingsDraft = { captions: Record<string, string>; widths: Record<string, number> };
type GridOptsDraft = { rowGroupCols: string[]; quickFilter: string };
type EditDraft = {
  colId: string;
  op: 'multiply' | 'add' | 'set' | 'nudge';
  operand: string;
};

function nonEmptyExpr(expr: string): ValidateResult {
  if (!expr.trim()) return { ok: false, errors: ['Expression required'] };
  return { ok: true };
}

export function buildDefaultModules(): SettingsModule[] {
  return [
    {
      id: 'grid-options',
      kind: 'settings',
      category: 'layout',
      label: 'Grid options',
      mount: panel('Grid options', (host, ctx) => {
        const draft = ctx.session.beginDraft<GridOptsDraft>('grid-options', {
          rowGroupCols: ctx.gridApi.getRowGroupColumns(),
          quickFilter: ctx.gridApi.getQuickFilterText(),
        });
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Row grouping + quick filter. Draft → Validate → Apply.' }),
          mountField(host, {
            label: 'Quick filter',
            value: draft.quickFilter,
            onChange: (v) => {
              draft.quickFilter = v;
              ctx.session.setDraft('grid-options', draft);
            },
          }),
          mountField(host, {
            label: 'Row group columns (comma-separated)',
            value: draft.rowGroupCols.join(','),
            placeholder: 'desk,region',
            onChange: (v) => {
              draft.rowGroupCols = v.split(',').map((s) => s.trim()).filter(Boolean);
              ctx.session.setDraft('grid-options', draft);
            },
          }),
        ];
        dispos.push(...footerApply(host, ctx, 'grid-options', {
          validate: () => ({ ok: true }),
          apply: (d) => {
            const g = d as GridOptsDraft;
            ctx.gridApi.setQuickFilterText(g.quickFilter);
            ctx.gridApi.setRowGroupColumns(g.rowGroupCols);
          },
          onReset: () => {
            Object.assign(draft, {
              rowGroupCols: ctx.gridApi.getRowGroupColumns(),
              quickFilter: ctx.gridApi.getQuickFilterText(),
            });
          },
        }));
        return dispos;
      }),
    },
    {
      id: 'column-groups',
      kind: 'settings',
      category: 'layout',
      label: 'Column groups',
      mount: panel('Column groups', (host) => [
        mountEmptyState(host, {
          title: 'Column groups',
          detail: 'Nested header groups land with layout editor (E-MOD-02).',
        }),
      ]),
    },
    {
      id: 'column-settings',
      kind: 'settings',
      category: 'layout',
      label: 'Column settings',
      mount: panel('Column settings', (host, ctx) => {
        const cols = ctx.gridApi.getColumnState();
        const draft = ctx.session.beginDraft<ColSettingsDraft>('column-settings', {
          captions: Object.fromEntries(cols.map((c) => [c.colId, c.headerName ?? c.colId])),
          widths: Object.fromEntries(cols.map((c) => [c.colId, c.width ?? 120])),
        });
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Caption + width per column. Apply writes column state.' }),
        ];
        for (const c of cols.slice(0, 8)) {
          dispos.push(mountField(host, {
            label: `${c.colId} caption`,
            value: draft.captions[c.colId] ?? c.colId,
            onChange: (v) => {
              draft.captions[c.colId] = v;
              ctx.session.setDraft('column-settings', draft);
            },
          }));
          dispos.push(mountField(host, {
            label: `${c.colId} width`,
            value: String(draft.widths[c.colId] ?? 120),
            onChange: (v) => {
              const n = Number(v);
              if (Number.isFinite(n)) draft.widths[c.colId] = n;
              ctx.session.setDraft('column-settings', draft);
            },
          }));
        }
        dispos.push(...footerApply(host, ctx, 'column-settings', {
          validate: (d) => {
            const w = (d as ColSettingsDraft).widths;
            for (const [k, v] of Object.entries(w)) {
              if (!(v >= 40 && v <= 800)) {
                return { ok: false, errors: [`Width for ${k} must be 40–800`] };
              }
            }
            return { ok: true };
          },
          apply: (d) => {
            const s = d as ColSettingsDraft;
            ctx.gridApi.applyColumnState(
              Object.keys(s.widths).map((colId) => ({
                colId,
                width: s.widths[colId],
                headerName: s.captions[colId],
              })),
            );
          },
          onReset: () => ctx.session.discardDraft('column-settings'),
        }));
        return dispos;
      }),
    },
    {
      id: 'data-provider',
      kind: 'settings',
      category: 'data',
      label: 'Data provider',
      mount: panel('Data provider', (host, ctx) => {
        const dispos: Disposable[] = [
          mountBanner(host, {
            text: 'Apply selects a catalog provider and binds it to the grid. Edit opens the catalog popout.',
            tone: 'warn',
          }),
        ];
        let options = [
          { value: '', label: '(none)' },
          { value: 'positions-mock', label: 'positions-mock' },
          { value: 'positions-stomp', label: 'positions-stomp' },
          { value: 'positions-perspective', label: 'positions-perspective' },
        ];
        const select = mountSelect(host, {
          label: 'Provider',
          options,
          value: ctx.session.getDoc().gridLevelData?.activeProviderId ?? '',
          onChange: (v) => ctx.session.setActiveProviderId(v || undefined),
        });
        dispos.push(select);

        void ctx.catalog?.list().then((list) => {
          if (!list.length) return;
          options = [
            { value: '', label: '(none)' },
            ...list.map((c) => ({ value: c.id, label: `${c.name} (${c.id})` })),
          ];
          select.setOptions(options);
        });

        const actions = el('div');
        actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';
        host.appendChild(actions);
        dispos.push(mountButton(actions, {
          label: 'Apply',
          variant: 'primary',
          onClick: () => {
            const id = select.getValue() || null;
            ctx.session.setActiveProviderId(id || undefined);
            void (async () => {
              try {
                if (ctx.dataProvider) {
                  await ctx.dataProvider.setActiveProvider(id);
                }
                await ctx.session.save();
                showToast(id ? `Bound ${id}` : 'Provider cleared', { tone: 'ok' });
              } catch (e) {
                showToast(e instanceof Error ? e.message : String(e), { tone: 'err' });
              }
            })();
          },
        }));
        dispos.push(mountButton(actions, {
          label: 'Edit…',
          onClick: () => {
            window.dispatchEvent(new CustomEvent('vg-new:open-provider-editor'));
          },
        }));
        dispos.push(mountButton(actions, {
          label: 'Stop feed',
          variant: 'ghost',
          onClick: () => {
            const id = ctx.dataProvider?.getActiveProviderId();
            if (id) {
              import('@wellsfargo-starui/vg-new-data').then(({ stopRegisteredProviderFeeds }) => {
                stopRegisteredProviderFeeds(id);
                showToast('Feed stopped');
              });
            }
          },
        }));
        dispos.push(mountButton(actions, {
          label: 'Restart feed',
          variant: 'ghost',
          onClick: () => {
            const id = ctx.dataProvider?.getActiveProviderId();
            if (id) {
              import('@wellsfargo-starui/vg-new-data').then(({ restartRegisteredProviderFeeds }) => {
                restartRegisteredProviderFeeds(id);
                showToast('Feed restarted');
              });
            }
          },
        }));
        return dispos;
      }),
    },
    {
      id: 'calculated-columns',
      kind: 'settings',
      category: 'data',
      label: 'Calculated columns',
      mount: panel('Calculated columns', (host, ctx) => {
        const draft = ctx.session.beginDraft<CalcDraft>('calculated-columns', {
          columns: [{ alias: 'net', expression: '[pnl] + [dailyPnl]', headerName: 'Net' }],
        });
        const col = draft.columns[0]!;
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Expression DSL → setCalcColumns on Apply. Use [field] refs.' }),
          mountField(host, {
            label: 'Alias',
            value: col.alias,
            onChange: (v) => {
              col.alias = v;
              ctx.session.setDraft('calculated-columns', draft);
            },
          }),
          mountField(host, {
            label: 'Expression',
            value: col.expression,
            placeholder: '[pnl] + [dailyPnl]',
            onChange: (v) => {
              col.expression = v;
              ctx.session.setDraft('calculated-columns', draft);
            },
          }),
        ];
        dispos.push(...footerApply(host, ctx, 'calculated-columns', {
          validate: (d) => {
            const c = (d as CalcDraft).columns[0];
            if (!c?.alias.trim()) return { ok: false, errors: ['Alias required'] };
            return nonEmptyExpr(c.expression);
          },
          apply: (d) => {
            ctx.gridApi.setCalcColumns((d as CalcDraft).columns);
          },
          onReset: () => {
            draft.columns = [{ alias: 'net', expression: '[pnl] + [dailyPnl]', headerName: 'Net' }];
          },
        }));
        return dispos;
      }),
    },
    {
      id: 'conditional-styling',
      kind: 'settings',
      category: 'format',
      label: 'Conditional styling',
      mount: panel('Conditional styling', (host, ctx) => {
        const draft = ctx.session.beginDraft<RulesDraft>('conditional-styling', {
          rules: [{
            id: 'neg-pnl',
            expression: '[pnl] < 0',
            style: { color: '#b42318', backgroundColor: '#fef3f2' },
            enabled: true,
          }],
        });
        const rule = draft.rules[0]!;
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Rule expression → setStyleRules on Apply. Use [field] refs.' }),
          mountField(host, {
            label: 'Expression',
            value: rule.expression,
            placeholder: '[pnl] < 0',
            onChange: (v) => {
              rule.expression = v;
              ctx.session.setDraft('conditional-styling', draft);
            },
          }),
          mountField(host, {
            label: 'Text color',
            value: rule.style.color ?? '',
            onChange: (v) => {
              rule.style.color = v;
              ctx.session.setDraft('conditional-styling', draft);
            },
          }),
        ];
        dispos.push(...footerApply(host, ctx, 'conditional-styling', {
          validate: (d) => nonEmptyExpr((d as RulesDraft).rules[0]?.expression ?? ''),
          apply: (d) => {
            ctx.gridApi.setStyleRules((d as RulesDraft).rules);
          },
          onReset: () => {
            draft.rules = [{
              id: 'neg-pnl',
              expression: '[pnl] < 0',
              style: { color: '#b42318', backgroundColor: '#fef3f2' },
              enabled: true,
            }];
          },
        }));
        return dispos;
      }),
    },
    {
      id: 'alerts',
      kind: 'settings',
      category: 'format',
      label: 'Alerts',
      mount: panel('Alerts', (host, ctx) => {
        const draft = ctx.session.beginDraft<AlertsDraft>('alerts', {
          rules: [{
            id: 'big-loss',
            expression: '[pnl] < -1000',
            channels: ['toast', 'badge'],
            messageTemplate: 'Large loss on {{ticker}}',
          }],
        });
        const rule = draft.rules[0]!;
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Alert rules → setAlertRules. Badge uses unread count.' }),
          mountField(host, {
            label: 'Expression',
            value: rule.expression,
            onChange: (v) => {
              rule.expression = v;
              ctx.session.setDraft('alerts', draft);
            },
          }),
          mountField(host, {
            label: 'Message template',
            value: rule.messageTemplate ?? '',
            onChange: (v) => {
              rule.messageTemplate = v;
              ctx.session.setDraft('alerts', draft);
            },
          }),
        ];
        dispos.push(...footerApply(host, ctx, 'alerts', {
          validate: (d) => nonEmptyExpr((d as AlertsDraft).rules[0]?.expression ?? ''),
          apply: (d) => {
            ctx.gridApi.setAlertRules((d as AlertsDraft).rules);
          },
          onReset: () => {
            draft.rules = [{
              id: 'big-loss',
              expression: '[pnl] < -1000',
              channels: ['toast', 'badge'],
              messageTemplate: 'Large loss on {{ticker}}',
            }];
          },
        }));
        return dispos;
      }),
    },
    {
      id: 'smart-edit',
      kind: 'settings',
      category: 'editing',
      label: 'Smart edit',
      mount: panel('Smart edit', (host, ctx) => {
        const draft = ctx.session.beginDraft<EditDraft>('smart-edit', {
          colId: 'pnl',
          op: 'multiply',
          operand: '2',
        });
        const dispos: Disposable[] = [
          mountSelect(host, {
            label: 'Operation',
            options: [
              { value: 'multiply', label: 'Multiply' },
              { value: 'add', label: 'Add' },
              { value: 'set', label: 'Set' },
              { value: 'nudge', label: 'Nudge' },
            ],
            value: draft.op,
            onChange: (v) => {
              draft.op = v as EditDraft['op'];
              ctx.session.setDraft('smart-edit', draft);
            },
          }),
          mountField(host, {
            label: 'Operand',
            value: draft.operand,
            onChange: (v) => {
              draft.operand = v;
              ctx.session.setDraft('smart-edit', draft);
            },
          }),
          mountField(host, {
            label: 'Column',
            value: draft.colId,
            onChange: (v) => {
              draft.colId = v;
              ctx.session.setDraft('smart-edit', draft);
            },
          }),
        ];
        dispos.push(...footerApply(host, ctx, 'smart-edit', {
          validate: (d) => {
            const e = d as EditDraft;
            if (!e.colId.trim()) return { ok: false, errors: ['Column required'] };
            if (!Number.isFinite(Number(e.operand)) && e.op !== 'set') {
              return { ok: false, errors: ['Operand must be numeric'] };
            }
            return { ok: true };
          },
          apply: (d) => {
            const e = d as EditDraft;
            const rows = ctx.gridApi.getSelectedRows() as Array<Record<string, unknown>>;
            if (!rows.length) throw new Error('Select rows to edit');
            const ids = rows.map((r) => String(r.id ?? r.positionId ?? ''));
            const n = Number(e.operand);
            const op =
              e.op === 'multiply' ? { type: 'multiply' as const, factor: n }
                : e.op === 'add' ? { type: 'add' as const, delta: n }
                  : e.op === 'nudge' ? { type: 'nudge' as const, steps: 1, stepSize: n }
                    : { type: 'set' as const, value: Number.isFinite(n) ? n : e.operand };
            ctx.gridApi.applyEditOp(e.colId, ids, op);
          },
          onReset: () => {
            draft.op = 'multiply';
            draft.operand = '2';
          },
        }));
        return dispos;
      }),
    },
    {
      id: 'bulk-update',
      kind: 'settings',
      category: 'editing',
      label: 'Bulk update',
      mount: panel('Bulk update', (host, ctx) => {
        const draft = ctx.session.beginDraft<EditDraft>('bulk-update', {
          colId: 'pnl',
          op: 'set',
          operand: '0',
        });
        const dispos: Disposable[] = [
          mountField(host, {
            label: 'Column',
            value: draft.colId,
            onChange: (v) => {
              draft.colId = v;
              ctx.session.setDraft('bulk-update', draft);
            },
          }),
          mountField(host, {
            label: 'Value',
            value: draft.operand,
            onChange: (v) => {
              draft.operand = v;
              ctx.session.setDraft('bulk-update', draft);
            },
          }),
        ];
        dispos.push(...footerApply(host, ctx, 'bulk-update', {
          validate: (d) => {
            if (!(d as EditDraft).colId.trim()) return { ok: false, errors: ['Column required'] };
            return { ok: true };
          },
          apply: (d) => {
            const e = d as EditDraft;
            const rows = ctx.gridApi.getSelectedRows() as Array<Record<string, unknown>>;
            if (!rows.length) throw new Error('Select rows to edit');
            const ids = rows.map((r) => String(r.id ?? r.positionId ?? ''));
            const n = Number(e.operand);
            ctx.gridApi.applyEditOp(e.colId, ids, {
              type: 'set',
              value: Number.isFinite(n) ? n : e.operand,
            });
          },
          onReset: () => { draft.operand = '0'; },
        }));
        return dispos;
      }),
    },
    {
      id: 'plus-minus',
      kind: 'settings',
      category: 'editing',
      label: 'Plus / minus',
      mount: panel('Plus / minus', (host, ctx) => {
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Nudge selected pnl by ±step.' }),
          mountButton(host, {
            label: '+ step',
            onClick: () => {
              const rows = ctx.gridApi.getSelectedRows() as Array<Record<string, unknown>>;
              if (!rows.length) { showToast('Select rows', { tone: 'warn' }); return; }
              ctx.gridApi.applyEditOp(
                'pnl',
                rows.map((r) => String(r.id ?? '')),
                { type: 'nudge', steps: 1, stepSize: 1 },
              );
            },
          }),
          mountButton(host, {
            label: '− step',
            onClick: () => {
              const rows = ctx.gridApi.getSelectedRows() as Array<Record<string, unknown>>;
              if (!rows.length) { showToast('Select rows', { tone: 'warn' }); return; }
              ctx.gridApi.applyEditOp(
                'pnl',
                rows.map((r) => String(r.id ?? '')),
                { type: 'nudge', steps: -1, stepSize: 1 },
              );
            },
          }),
        ];
        return dispos;
      }),
    },
    {
      id: 'shortcuts',
      kind: 'settings',
      category: 'editing',
      label: 'Shortcuts',
      mount: panel('Shortcuts', (host) => [
        mountEmptyState(host, {
          title: 'Key bindings',
          detail: 'Letter → numeric op wired via edit ribbon (E-MOD-10).',
        }),
      ]),
    },
    {
      id: 'data-change-history',
      kind: 'settings',
      category: 'editing',
      label: 'Edit history',
      mount: panel('Edit history', (host, ctx) => {
        const dispos: Disposable[] = [
          mountBanner(host, { text: 'Undo / redo journal from EditEngine.' }),
          mountButton(host, {
            label: 'Undo',
            onClick: () => {
              if (!ctx.gridApi.undoEdit()) showToast('Nothing to undo');
              else showToast('Undone', { tone: 'ok' });
            },
          }),
          mountButton(host, {
            label: 'Redo',
            onClick: () => {
              if (!ctx.gridApi.redoEdit()) showToast('Nothing to redo');
              else showToast('Redone', { tone: 'ok' });
            },
          }),
        ];
        return dispos;
      }),
    },
  ];
}
