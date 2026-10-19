// `plot-ask.mjs merge <pr> <sha>`: a 7- and a 40-character hex sha both clear
// the argument check and reach `mergeAt` — the floor the head-moved fix needs.
import { describe, it, expect, afterEach, vi } from 'vitest';

import type { MergePorts } from '../../src/server/entry/merge.js';

const captured: [number, string][] = [];
vi.mock('../../src/server/entry/merge.js', () => ({
  mergeAt: vi.fn(async (_ports: MergePorts, pr: number, sha: string) => {
    captured.push([pr, sha]);
    return { merged: false, reason: 'host-refused', detail: 'stubbed' };
  }),
}));

const { run } = await import('../../src/server/entry/main.js');

describe('plot-ask merge sha length', () => {
  afterEach(() => {
    captured.splice(0);
    vi.restoreAllMocks();
  });

  const cases: [string, string][] = [
    ['a 7-character sha', 'a'.repeat(7)],
    ['a 40-character sha', 'a'.repeat(40)],
  ];

  for (const [name, sha] of cases) {
    it(`passes validation and reaches mergeAt for ${name}`, async () => {
      const out = vi.fn();
      await run(['merge', '7', sha], '/nonexistent', out);
      expect(captured).toEqual([[7, sha]]);
    });
  }
});
