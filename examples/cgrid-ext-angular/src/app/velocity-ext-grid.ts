import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
} from '@wellsfargo-starui/velocity-grid-ext';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid/format';
import { wireEditIntoKernel } from '@wellsfargo-starui/velocity-grid-ext/edit';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid/calc';
import { wireIntoKernel as wireRules } from '@wellsfargo-starui/velocity-grid/rules';
import { COLUMN_DEFS, seedRows, type PositionRow } from './seed';

@Component({
  selector: 'app-velocity-ext-grid',
  standalone: true,
  template: '<div #host class="grid-host"></div>',
})
export class VelocityExtGrid implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  private ext: VelocityGridExt<PositionRow> | null = null;

  ngAfterViewInit(): void {
    this.mount();
  }

  ngOnDestroy(): void {
    this.ext?.destroy();
    this.ext = null;
  }

  private mount(): void {
    let editHandle: ReturnType<typeof wireEditIntoKernel> | undefined;

    const ext = new VelocityGridExt<PositionRow>(this.host.nativeElement, {
      gridId: 'ext-angular',
      getRowId: (row) => row.id,
      columnDefs: COLUMN_DEFS,
      defaultColDef: {
        resizable: true,
        sortable: true,
        editable: true,
        minWidth: 80,
      },
      theme: 'vg-theme-quartz',
      sideBar: { toolPanels: ['columns', 'filters'] },
      rowGroupPanelShow: 'always',
      rowData: seedRows(),
      cellSelection: { suppressHeader: true },
      ext: {
        extensions: [
          { remove: 'settings-launcher' },
          { remove: 'save' },
          ...titleBarExtensions({ name: 'Angular · Ext' }),
          ...ribbonExtensions({ edit: () => editHandle }),
        ],
      },
    });

    wireFormat(ext.grid);
    editHandle = wireEditIntoKernel(ext.grid);
    wireCalc(ext.grid);
    wireRules(ext.grid);
    ext.grid.updateGridOptions({ columnDefs: COLUMN_DEFS });
    this.ext = ext;
  }
}
