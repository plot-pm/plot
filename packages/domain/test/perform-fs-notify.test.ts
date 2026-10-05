import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { performDecision } from '../src/adapters/performer/perform-fs.js';
import type { Write } from '../src/workflows/decision.js';

describe('perform-fs and the notify write', () => {
  it('skips a notify write and writes no file', () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-perform-notify-'));
    try {
      const writes: Write[] = [
        {
          kind: 'notify',
          worktree: '/estate/.worktrees/feature-one',
          askedAt: '2026-10-05T13:36:00.000Z',
          rung: 'notified-1',
          message: 'plot: feature/one has been waiting on you for 16m (notified-1) — which adapter?',
        },
      ];
      const report = performDecision({ root }, { outcome: 'decided', workflow: 'supervise', writes, detail: null });
      expect(report.written).toEqual([]);
      expect(report.skipped).toEqual(['notify']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
