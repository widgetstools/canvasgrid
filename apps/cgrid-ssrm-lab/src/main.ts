/**
 * VelocityGrid Feature Lab (SSRM) — same MarketsGrid Lab shell as the CSRM
 * lab, but each feature tab mounts VelocityGridExt over MockSSRMDataProvider
 * (sparse SSRM v2 + live ticks, no WASM / no broker).
 */
import '@wellsfargo-starui/velocity-grid/style.css';
import '@lab/styles.css';
import { mountLabShell } from '@lab/shell';
import { mountSsrmFeature, type MountedSsrmFeature } from '@lab/mountSsrm';

const app = document.getElementById('app')!;
let mounted: MountedSsrmFeature | null = null;

mountLabShell(app, {
  title: 'VelocityGrid Feature Lab',
  mode: 'ssrm',
  modeBadge: 'SSRM · Mock',
  onFeature: (feature, host, consoleEl) => {
    mounted?.destroy();
    mounted = mountSsrmFeature(host, feature, consoleEl);
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
