import '@angular/compiler';
import './styles.css';

const gridHost = document.getElementById('grid-mount');
if (!gridHost) throw new Error('#grid-mount missing');

const { mountSsrmGrid } = await import('./app/ssrm-host');
window.__angularSsrm = await mountSsrmGrid(gridHost);

await import('zone.js');
const { bootstrapApplication } = await import('@angular/platform-browser');
const { App } = await import('./app/app');
const { appConfig } = await import('./app/app.config');

await bootstrapApplication(App, appConfig);
