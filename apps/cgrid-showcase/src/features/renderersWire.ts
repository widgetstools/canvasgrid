import { wireIntoKernel as wireFormat } from '@cgrid/format';
import {
  wireRenderersIntoKernel,
  type RenderersBridgeHandle,
  type RenderersBridgeOptions,
} from '@cgrid/renderers';

declare global {
  interface Window {
    __cgridRenderers?: RenderersBridgeHandle;
  }
}

/** Wire format + renderers bridges and expose canvas click mapping for action hit regions. */
export function wireShowcaseRenderers(
  grid: unknown,
  gridHost: HTMLElement,
  opts?: RenderersBridgeOptions,
): RenderersBridgeHandle {
  wireFormat(grid);
  const handle = wireRenderersIntoKernel(grid, opts);
  const canvas = gridHost.querySelector('canvas');
  const surface = grid as {
    canvasCoordsFromEvent?: (mouse: MouseEvent) => { x: number; y: number };
  };
  if (canvas) {
    surface.canvasCoordsFromEvent = (mouse) => {
      const rect = canvas.getBoundingClientRect();
      return { x: mouse.clientX - rect.left, y: mouse.clientY - rect.top };
    };
  }
  window.__cgridRenderers = handle;
  return handle;
}
