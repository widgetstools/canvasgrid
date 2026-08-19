/**
 * VelocityGrid Feature Lab (CSRM) — port of MarketsGrid Feature Lab.
 *
 * Shell IA matches stern-bak markets-grid-lab (sidebar categories, feature
 * tabs, inspector, demo console). Each tab mounts VelocityGridExt over a
 * CSRM mock book with Markets-style live ticks (applyTransactionAsync).
 */
import '@wellsfargo-starui/velocity-grid/style.css';
import '@lab/styles.css';
import { mountLabShell } from '@lab/shell';
import { mountCsrmFeature, type MountedCsrmFeature } from '@lab/mountCsrm';

const app = document.getElementById('app')!;
let mounted: MountedCsrmFeature | null = null;

mountLabShell(app, {
  title: 'VelocityGrid Feature Lab',
  mode: 'csrm',
  modeBadge: 'CSRM',
  onFeature: (feature, host, consoleEl) => {
    mounted?.destroy();
    mounted = mountCsrmFeature(host, feature, consoleEl);
    return () => {
      mounted?.destroy();
      mounted = null;
    };
  },
  onLeaveFeature: () => {
    mounted?.destroy();
    mounted = null;
  },
});

window.addEventListener('beforeunload', () => {
  mounted?.destroy();
});
