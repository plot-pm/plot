import { describe, expect, it } from 'vitest';

import { nodePin } from '../src/rules/node-pin.js';

describe('nodePin', () => {
  it('admits a running Node whose major equals the pinned major', () => {
    expect(nodePin('26.13.0', '26\n')).toEqual({ ok: true, running: 26, pinned: 26 });
    expect(nodePin('v26.1.0', 'v26.1.0')).toEqual({ ok: true, running: 26, pinned: 26 });
  });

  it('refuses another major, above or below the pin, and names both', () => {
    expect(nodePin('24.1.0', '26\n')).toEqual({ ok: false, running: 24, pinned: 26 });
    expect(nodePin('27.0.0', '26\n')).toEqual({ ok: false, running: 27, pinned: 26 });
  });

  it('refuses a pin that names no major', () => {
    expect(nodePin('26.13.0', 'lts/iron\n')).toEqual({ ok: false, running: 26, pinned: null });
    expect(nodePin('26.13.0', '')).toEqual({ ok: false, running: 26, pinned: null });
  });

  it('refuses a running version that names no major', () => {
    expect(nodePin('', '26')).toEqual({ ok: false, running: null, pinned: 26 });
  });
});
