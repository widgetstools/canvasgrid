/**
 * React host for VelocityGridExt.
 *
 * The grid is an imperative canvas component that owns its own DOM, its own
 * worker and its own paint loop, so React's job here is narrow and worth
 * stating: mount once, hand ownership over, feed it data, tear it down. It
 * deliberately does NOT re-create the grid when props change — a remount would
 * throw away the worker, the raster cache and any column state the user has
 * touched. Changing options goes through `updateGridOptions`; changing rows
 * goes through `setRowData` (snapshot) or `applyTransactionAsync` (ticks).
 */
import { useEffect, useRef } from 'react';
import {
  VelocityGridExt,
  titleBarExtensions,
  ribbonExtensions,
  type VelocityGridExtOptions,
} from '@wellsfargo-starui/velocity-grid-ext';
import '@wellsfargo-starui/velocity-grid/style.css';
import { wireLabFeatures, type LabWiring } from './wiring';
import type { BlotterRow } from '../data/domain';

export interface LabGridHandle {
  ext: VelocityGridExt<BlotterRow>;
  wiring: LabWiring;
}

export interface VelocityLabGridProps {
  /** Stable per tab. Namespaces persisted column/filter/profile state. */
  gridId: string;
  /** Shown in the ext title bar. */
  title: string;
  options: Omit<VelocityGridExtOptions<BlotterRow>, 'ext'>;
  /** Called once the grid exists, before any data lands. */
  onReady?: (handle: LabGridHandle) => void;
  /** Called on unmount, before destroy — release data subscriptions here. */
  onTeardown?: (handle: LabGridHandle) => void;
}

export function VelocityLabGrid({ gridId, title, options, onReady, onTeardown }: VelocityLabGridProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Props are read through a ref inside the mount effect so the effect can
  // stay keyed on `gridId` alone. Without this, a new `options` object on
  // every render would tear the grid down and rebuild it every frame.
  const latest = useRef({ options, onReady, onTeardown, title });
  latest.current = { options, onReady, onTeardown, title };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const { options: opts, onReady: ready, title: name } = latest.current;
    let wiring: LabWiring | null = null;

    const ext = new VelocityGridExt<BlotterRow>(host, {
      ...opts,
      gridId,
      ext: {
        extensions: [
          ...titleBarExtensions({ name }),
          // The ribbon needs a live handle to the edit wiring, which does not
          // exist until after construction — hence the getter rather than a
          // value. Returning null until then is fine; the ribbon re-reads it.
          ...ribbonExtensions({ edit: () => wiring?.edit }),
        ],
      },
    });

    wiring = wireLabFeatures(ext.grid);
    // Column defs are re-applied after wiring so that formatters, renderers
    // and rule references resolve against engines that now exist.
    if (opts.columnDefs) ext.grid.updateGridOptions({ columnDefs: opts.columnDefs });

    const handle: LabGridHandle = { ext, wiring };
    ready?.(handle);

    return () => {
      latest.current.onTeardown?.(handle);
      ext.destroy();
    };
  }, [gridId]);

  return <div ref={hostRef} className="lab-grid-host" />;
}
