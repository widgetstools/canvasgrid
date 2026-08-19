import { Component } from '@angular/core';
import { VelocityExtGrid } from './velocity-ext-grid';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VelocityExtGrid],
  template: `
    <div class="page">
      <header class="page-header">
        <h1>VelocityGridExt · Angular</h1>
        <p>
          Installed from <code>dist/tarballs/*.tgz</code>, not the monorepo workspace.
        </p>
      </header>
      <app-velocity-ext-grid />
    </div>
  `,
})
export class App {}
