import { describe, it, expect } from 'vitest';
import { CGRID_EXT_VERSION } from '../src/index';

describe('@cgrid/ext scaffold', () => {
  it('exposes a version constant', () => {
    expect(CGRID_EXT_VERSION).toBe('0.0.0');
  });
});
