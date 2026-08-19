import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @stomp/stompjs exports.browser is a UMD bundle with no named ESM exports. */
export function stompjsEsmEntry(fromUrl) {
  const appRoot = dirname(fileURLToPath(fromUrl));
  const candidates = [
    join(appRoot, 'node_modules/@stomp/stompjs/esm6/index.js'),
    join(appRoot, 'node_modules/@wellsfargo-starui/velocity-grid-data/node_modules/@stomp/stompjs/esm6/index.js'),
    join(appRoot, 'node_modules/@wellsfargo-starui/velocity-grid-perspective/node_modules/@stomp/stompjs/esm6/index.js'),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error('Could not find @stomp/stompjs ESM entry (esm6/index.js)');
  }
  return hit;
}
