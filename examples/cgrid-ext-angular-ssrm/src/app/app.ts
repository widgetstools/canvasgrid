import { Component } from '@angular/core';
import { VelocitySsrmGrid } from './velocity-ssrm-grid';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VelocitySsrmGrid],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>VelocityGrid SSRM · Angular 16.1</h1>
        <p>
          Perspective SSRM · programmatic DataProvider + shared
          <code>LocalStore</code> (catalog + AppData) · CSV export/import via grid API.
        </p>
      </header>
      <app-velocity-ssrm-grid />
    </div>
  `,
})
export class App {}
