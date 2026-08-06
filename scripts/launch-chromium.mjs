#!/usr/bin/env node
/** Shared Playwright launch helper — prefer bundled Chromium (cross-platform). */
export async function launchChromium(chromium, opts = {}) {
  try {
    return await chromium.launch({ headless: true, ...opts });
  } catch (first) {
    // Fall back to installed Chrome when Playwright browsers aren't present.
    try {
      return await chromium.launch({ headless: true, channel: 'chrome', ...opts });
    } catch {
      throw first;
    }
  }
}
